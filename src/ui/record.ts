// Record view: map + live panel + controls + OLED power-save lock.
import { t, currentLang } from '../core/i18n';
import { get, set } from '../core/settings';
import { languageTag } from '../core/language';
import { on, emit } from '../core/events';
import { rec, startRecording, pauseRecording, resumeRecording, stopRecording, continueTrip, findRecoverableTrip, retryGeolocation, setRecordingActivity, flushBuffer } from '../core/recorder';
import { armKeepAlive, disarmKeepAlive, isKeepAliveActive } from '../core/keepalive';
import { requestWakeLock, releaseWakeLock } from '../core/wakelock';
import { setThemeColorOverride, setThemeModeOverride } from '../core/theme';
import { regionState } from '../core/region';
import { updateWeatherLocation, refreshWeather, weatherState } from '../core/weatherService';
import { primaryWeatherAlert } from '../core/weatherLive';
import { weatherIcon, weatherCodeKey } from '../core/weather';
import { availableBasemaps } from '../core/providers';
import { fmtDistance, fmtDuration, fmtSpeed, fmtPace, fmtAltitude, signalLevel, haversine, bearing } from '../core/geo';
import { estimateCalories } from '../core/calories';
import { altSourceShortKey, altSourceTagClass } from '../core/elevation';
import { loadTripPreview, listWaypoints, updateTrip, getTrip, addPhotoWaypoint, deletePhotoWaypoint } from '../core/store';
import { routeRepository } from '../core/routeRepository';
import { findTrackGaps } from '../core/gapRepair';
import { onBroadcast } from '../core/locks';
import { clearHistory } from '../core/history';
import { TrackMap } from './map';
import { WP_ICONS } from '../core/waypointMeta';
import { rewalk, stopRewalk, toggleMute, startSim, stopSim, getRewalkNavigation, markExternalNavigation, EXTERNAL_NAV_MIN_M } from '../core/rewalk';
import type { NavigationPlatform } from '../core/navigation';
import { appState, setActiveTrip } from './state';
import { openWaypointModal, moveWaypoint, moveVertex, insertVertex, deleteVertex, undoEdit, redoEdit, histState } from './editor';
import { el, icon, toast, modal, hasOpenOverlay } from './helpers';
import { openCamera } from './camera';
import { backFromUIState, currentUIState, pushUIState, pushOverlayState, removeOverlayState } from './history';
import { loadSafetySettings } from '../core/safety';
import { openSafetyCheckIn, sendSafetyNow } from './safety';

export function createRecordView(navigate: (name: 'analysis' | 'export' | 'settings', intent?: any) => void | Promise<void> = () => {}) {
  const view = el('div', { class: 'view', id: 'view-record' });
  const mapContainer = el('div', { id: 'map-container' });
  const layerPill = el('button', { class: 'map-layer-pill', onclick: openLayerSheet });
  const tools = el('div', { class: 'map-tools' });
  const controls = el('div', { class: 'rec-controls' });
  view.append(mapContainer, layerPill, tools, controls);

  let map = null;
  let psActive = false;
  let powerLockBusy = false;
  let powerLockExitPromise = null;
  let powerLockEntry = null;
  let stopFlowPromise = null;
  let resultSheet = null;
  let unlockGuardUntil = 0;
  let unlockReleaseTimer = 0;
  const swallowUnlockGhostClick = (e) => {
    if (e.detail === 0 || performance.now() >= unlockGuardUntil) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const clearUnlockGuard = () => {
    unlockGuardUntil = 0;
    document.removeEventListener('pointerdown', clearUnlockGuard, true);
    document.removeEventListener('pointerup', releaseUnlockGuard, true);
    document.removeEventListener('pointercancel', releaseUnlockGuard, true);
    clearTimeout(unlockReleaseTimer);
  };
  const releaseUnlockGuard = () => {
    unlockGuardUntil = performance.now() + 500;
    document.removeEventListener('pointerup', releaseUnlockGuard, true);
    document.removeEventListener('pointercancel', releaseUnlockGuard, true);
    clearTimeout(unlockReleaseTimer);
  };
  function armUnlockGuard() {
    clearUnlockGuard();
    unlockGuardUntil = Infinity;
    document.addEventListener('pointerdown', clearUnlockGuard, true);
    document.addEventListener('pointerup', releaseUnlockGuard, true);
    document.addEventListener('pointercancel', releaseUnlockGuard, true);
    unlockReleaseTimer = window.setTimeout(clearUnlockGuard, 6000);
  }
  document.addEventListener('click', swallowUnlockGhostClick, true);
  let oledThemeActive = false;
  let viewingTrip = null;
  let viewingTripEditable = false;
  let recoverable = null;
  let readOnly = false;

  // ---------- map ----------
  function initialCenter() {
    if (regionState.effective === 'cn') return { center: [116.4, 39.9], zoom: 9 };
    return { center: [10, 30], zoom: 3 };
  }
  function buildMap() {
    const { center, zoom } = initialCenter();
    map = new TrackMap(mapContainer, {
      fallbackText: t('map.fallback'),
      onWaypointClick: (wp) => {
        if (wp.tripId && (!appState.editMode || !canEditMap())) {
          toast(t('record.editTripOnly'), 'warn');
          return;
        }
        openWaypointModal(wp, recEditOpts());
      },
      onWaypointMove: (wp, lon, lat) => moveWaypoint(wp, lon, lat, recEditOpts()),
      onMapClick: (lon, lat) => { if (appState.editMode && canEditMap() && appState.activeTripId) openWaypointModal({ lat, lon }); },
      onVertexMove: (segId, idx, lon, lat) => moveVertex(segId, idx, lon, lat),
      onVertexInsert: (segId, idx, lon, lat) => insertVertex(segId, idx, lon, lat),
      onVertexDelete: (segId, idx) => deleteVertex(segId, idx)
    }).init(center, zoom);
    map.observeViewportInset(controls);
    syncPowerLockEntry();
    return map;
  }
  async function loadTripMapData(tripId) {
    const [track, waypoints] = await Promise.all([routeRepository.load(tripId), listWaypoints(tripId)]);
    return track ? { ...track, waypoints } : null;
  }
  async function renderFinishedTrip(full, fit = true) {
    const target = map;
    if (!full || !target || target.destroyed) return;
    target.endLive();
    target.setTrackData(full.segments, full.waypoints);
    // fitBounds is valid before the first style load, so offline tiles must not
    // delay the result sheet or prevent the finished track from being framed.
    if (fit) target.fitTrack();
  }
  buildMap();

  // ---------- layers (one entry, bottom sheet) ----------
  function basemapLabel(b) {
    if (b.id === 'custom' && !get('customTileName')) return t('map.customSource');
    if (currentLang() === 'zh') return b.name;
    if (currentLang() === 'zh-TW' && b.nameZhTw) return b.nameZhTw;
    return b.nameEn || b.name;
  }
  function renderMapLayer() {
    const list = availableBasemaps();
    const cur = list.find((b) => b.id === map?.basemapId) || list[0];
    layerPill.innerHTML = '';
    if (cur) {
      layerPill.append(icon('layers', 16),
        el('span', { class: 'ml-name' }, basemapLabel(cur)),
        el('span', { class: 'ml-cs' }, cur.coordSystem === 'GCJ02' ? 'GCJ' : 'WGS'),
        el('span', { class: 'chev' }, icon('chevron', 14)));
      layerPill.title = `${t('map.layers')} · ${t('map.styleCs')}: ${cur.coordSystem}`;
    }
    if (map?.vectorFallback) layerPill.append(el('span', { class: 'ml-cs' }, t('map.vectorShort')));
  }
  renderMapLayer();

  function openLayerSheet() {
    let m;
    const list = availableBasemaps();
    const rows = list.map((b) => el('button', {
      class: 'sheet-row' + (map?.basemapId === b.id ? ' active' : ''),
      onclick: () => { map.setBasemap(b.id); m.close(); renderMapLayer(); }
    },
      el('span', { class: 's-ic' }, icon(b.kind === 'satellite' ? 'globe' : b.kind === 'terrain' ? 'mountain' : 'map', 18)),
      el('span', { class: 's-txt' },
        el('div', { class: 's-t' }, basemapLabel(b)),
        el('div', { class: 's-d' }, `${t(`map.${b.kind}`)} · ${b.coordSystem === 'GCJ02' ? 'GCJ-02' : 'WGS-84'}`)),
      map?.basemapId === b.id ? el('span', { class: 's-check' }, icon('check', 18)) : null
    ));
    m = modal({
      title: t('map.layers'),
      body: el('div', {},
        el('div', { class: 'sheet-list' }, rows),
        el('div', { class: 'sheet-note' }, t('map.layerNote')))
    });
  }

  on('region:changed', renderMapLayer);
  on('region:probed', renderMapLayer);
  on('settings:changed', ({ key }) => { if (['tiandituKey', 'customTileUrl', 'language'].includes(key)) renderMapLayer(); });
  on('map:basemap', renderMapLayer);

  // ---------- tools ----------
  const followBtn = el('button', {
    class: 'iconbtn', title: t('record.follow'),
    onclick: () => {
      if (!map.posMarker) { locateOnce({ follow: true }); return; }
      map.setFollow(!map.follow);
      followBtn.classList.toggle('active', map.follow);
    }
  }, icon('follow'));
  const fitBtn = el('button', { class: 'iconbtn', title: t('record.fit'), onclick: () => map.fitTrack() }, icon('fit'));
  const undoBtn = el('button', { type: 'button', class: 'iconbtn', title: t('edit.undo'), 'aria-label': t('edit.undo'), onclick: () => undoEdit(recEditOpts()), style: { display: 'none' } }, icon('undo'));
  const redoBtn = el('button', { type: 'button', class: 'iconbtn', title: t('edit.redo'), 'aria-label': t('edit.redo'), onclick: () => redoEdit(recEditOpts()), style: { display: 'none' } }, icon('redo'));
  const editBtn = el('button', {
    type: 'button', class: 'iconbtn', title: t('record.editMode'), 'aria-label': t('record.editMode'),
    'aria-pressed': 'false', disabled: true, onclick: toggleEdit
  }, icon('edit'));
  tools.append(followBtn, fitBtn, undoBtn, redoBtn);
  const safetyEntry = el('button', {
    type: 'button', class: 'safety-entry iconbtn',
    title: `${t('record.safetyCheckIn')} · ${t('record.safetySosHold')}`,
    'aria-label': t('record.safetyCheckIn'),
    onclick: (event) => {
      event.stopPropagation();
      openSafetyCheckIn('checkin');
    }
  }, icon('shield', 18));
  let safetyHoldTimer = 0;
  let safetyLongPress = false;
  let safetyPointer: number | null = null;
  const clearSafetyHold = () => {
    clearTimeout(safetyHoldTimer);
    safetyHoldTimer = 0;
    safetyPointer = null;
    safetyEntry.classList.remove('holding');
  };
  safetyEntry.addEventListener('pointerdown', (event) => {
    if (safetyPointer != null) return;
    safetyPointer = event.pointerId;
    safetyLongPress = false;
    safetyEntry.classList.add('holding');
    try { safetyEntry.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
    safetyHoldTimer = window.setTimeout(() => {
      safetyLongPress = true;
      safetyHoldTimer = 0;
      try { safetyEntry.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
      void sendSafetyNow('sos');
    }, 2000);
  });
  safetyEntry.addEventListener('pointerup', clearSafetyHold);
  safetyEntry.addEventListener('pointercancel', clearSafetyHold);
  safetyEntry.addEventListener('pointerleave', clearSafetyHold);
  safetyEntry.addEventListener('click', (event) => {
    if (safetyLongPress) {
      safetyLongPress = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  safetyEntry.addEventListener('blur', clearSafetyHold);
  safetyEntry.addEventListener('contextmenu', (event) => event.preventDefault());
  on('map:followoff', () => followBtn.classList.remove('active'));
  on('history:changed', syncEditTools);

  function canEnterPowerLock() {
    return !!map && !map.destroyed && !powerLockBusy && !powerLockExitPromise
      && (rec.status === 'idle' || rec.status === 'recording' || rec.status === 'paused');
  }
  function syncPowerLockEntry() {
    if (powerLockEntry) powerLockEntry.disabled = !canEnterPowerLock();
  }
  function enterPowerLock() {
    if (!canEnterPowerLock()) {
      toast(t('record.lockUnavailable'), 'warn');
      return;
    }
    void setPowerLock(true).catch((e) => {
      console.error('power lock entry failed', e);
      toast(t('common.unavailable'), 'err', 4200);
    });
  }

  function canEditMap() {
    const trip = viewingTrip?.trip;
    return viewingTripEditable && !viewingTrip?.readOnly && trip?.status === 'finished'
      && appState.activeTripId === trip.id && appState.view === 'record'
      && rec.status !== 'recording' && rec.status !== 'paused'
      && !rewalk.active && !psActive && !readOnly;
  }
  function leaveEditMode() {
    if (!appState.editMode) return;
    appState.editMode = false;
    map?.setEditMode(false);
    editBtn.classList.remove('active');
    editBtn.setAttribute('aria-pressed', 'false');
    undoBtn.style.display = 'none';
    redoBtn.style.display = 'none';
    tools.classList.remove('with-history');
  }
  function syncEditTools() {
    if (appState.editMode && !canEditMap()) leaveEditMode();
    const visible = appState.editMode && canEditMap();
    editBtn.disabled = !canEditMap();
    editBtn.classList.toggle('active', appState.editMode);
    editBtn.setAttribute('aria-pressed', String(appState.editMode));
    undoBtn.style.display = visible ? '' : 'none';
    redoBtn.style.display = visible ? '' : 'none';
    tools.classList.toggle('with-history', visible);
    const history = histState();
    undoBtn.disabled = !history.canUndo;
    redoBtn.disabled = !history.canRedo;
  }
  function toggleEdit() {
    if (!canEditMap()) { toast(t('record.editTripOnly'), 'warn'); return; }
    appState.editMode = !appState.editMode;
    map.setEditMode(appState.editMode);
    syncEditTools();
    if (appState.editMode) toast(t('record.editModeOn'), 'info', 3500);
  }

  // ---------- live panel ----------
  const panel = el('div', { class: 'live-panel' + (get('panelCollapsed') ? ' collapsed' : '') });
  const pStatus = el('span', { class: 'st idle' }, t('record.statusIdle'));
  const pSave = el('span', { class: 'lp-save' });
  pSave.onclick = (e) => {
    e.stopPropagation();
    if (!rec.saveState.error) return;
    if (rec.saveState.error === 'finalize') void onStop();
    else void retrySave();
  };
  powerLockEntry = el('button', {
    type: 'button', class: 'power-lock-entry iconbtn', disabled: true,
    'aria-label': t('record.powerLock'), title: t('record.powerLock'),
    onclick: (e) => { e.stopPropagation(); enterPowerLock(); }
  }, icon('powerlock', 18));
  tools.insertBefore(powerLockEntry, undoBtn);
  tools.insertBefore(editBtn, undoBtn);
  const pHead = el('div', { class: 'lp-head', onclick: togglePanel },
    pStatus, pSave, el('span', { class: 'rec-dot', id: 'panel-rec-dot' }), safetyEntry, el('span', { class: 'chev' }, icon('chevron', 16)));
  function togglePanel() {
    panel.classList.toggle('collapsed');
    set('panelCollapsed', panel.classList.contains('collapsed'));
    map?.updateViewportInset();
  }
  const compact = el('div', { class: 'lp-compact' });
  function metric(key, hero = false) {
    const num = el('span', { class: 'num' }, '--');
    const unit = el('small', {});
    const v = el('div', { class: 'v' }, num, unit);
    const k = el('div', { class: 'k' }, t(key));
    const c = el('div', { class: 'lp-metric' + (hero ? ' hero' : '') }, v, k);
    compact.append(c);
    return { v, k, c, num, unit };
  }
  const cDist = metric('panel.distance', true);
  const cDur = metric('panel.duration');
  const cSpeed = metric('panel.speed');
  cSpeed.c.classList.add('tap');
  cSpeed.c.title = t('settings.speedDisplay');
  cSpeed.c.onclick = () => {
    const cur = speedMode();
    set('speedDisplay', cur === 'speed' ? 'pace' : 'speed');
    if (rec.live) renderPanel(rec.live);
  };
  const moreGrid = el('div', { class: 'lp-more' });
  function moreCell(key) {
    const num = el('span', { class: 'num' }, '--');
    const unit = el('small', {});
    const v = el('div', { class: 'v' }, num, unit);
    const k = el('div', { class: 'k' }, t(key));
    const c = el('div', { class: 'lp-more-cell' }, v, k);
    moreGrid.append(c);
    return { v, k, c, num, unit };
  }
  const cAvg = moreCell('panel.avgSpeed');
  const cCal = moreCell('panel.calories');
  const cAlt = moreCell('panel.altitude');
  const cAsc = moreCell('panel.ascent');
  const cDesc = moreCell('panel.descent');
  const cSig = moreCell('panel.signal');
  const detail = el('div', { class: 'lp-detail' });
  const detailSlots = Array.from({ length: 7 }, () => el('span', {}));
  detail.append(...detailSlots);
  const qualityStatus = el('span', { class: 'lp-quality-status' }, '--');
  const qualityAccuracyValue = el('strong', { class: 'mono' }, '--');
  const qualityAccuracyTrend = el('span', { class: 'small faint' }, t('record.qualityTrendUnknown'));
  const qualityTrendGraph = el('div', { class: 'lp-accuracy-graph', 'aria-label': t('record.qualityAccuracy') });
  const qualityLastFix = el('strong', { class: 'mono' }, '--');
  const qualitySampleRate = el('strong', { class: 'mono' }, '--');
  const qualityCompleteness = el('strong', { class: 'mono' }, '--');
  const qualityMeta = el('div', { class: 'lp-quality-meta' });
  const qualityPanel = el('div', { class: 'lp-quality', hidden: true },
    el('div', { class: 'lp-quality-head' },
      el('strong', {}, t('record.qualityTitle')),
      qualityStatus),
    el('div', { class: 'lp-quality-main' },
      el('div', { class: 'lp-accuracy' },
        el('div', { class: 'lp-accuracy-label' },
          el('span', { class: 'small faint' }, t('record.qualityAccuracy')),
          qualityAccuracyValue,
          qualityAccuracyTrend),
        qualityTrendGraph),
      el('div', { class: 'lp-quality-metrics' },
        el('div', {}, el('span', { class: 'small faint' }, t('record.qualityLastFix')), qualityLastFix),
        el('div', {}, el('span', { class: 'small faint' }, t('record.qualitySampleRate')), qualitySampleRate),
        el('div', {}, el('span', { class: 'small faint' }, t('record.qualityCompleteness')), qualityCompleteness))),
    qualityMeta);
  let qualityWarningKey = '';
  panel.append(pHead, compact, moreGrid, qualityPanel, detail);

  const SIG_KEYS = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  function createSignal(host) {
    const bars = el('span', { class: 'sig-bars lv0' });
    for (let i = 0; i < 4; i++) bars.append(el('i'));
    const text = el('small', { class: 'sig-txt' }, '--');
    host.replaceChildren(bars, text);
    return { bars, text };
  }
  function renderSignal(output, acc) {
    const lv = signalLevel(acc);
    output.bars.className = `sig-bars lv${lv}`;
    output.text.textContent = lv ? t(`panel.sig${SIG_KEYS[lv]}`) : '--';
  }
  const panelSignal = createSignal(cSig.v);

  function percent(value: number | null | undefined): string {
    return Number.isFinite(value) ? `${Math.round(value! * 100)}%` : '--';
  }
  function spanText(value: number | null | undefined): string {
    return Number.isFinite(value) ? fmtDuration(value!, { compact: true }) : '--';
  }
  function renderAccuracyTrend(samples: { acc: number }[]) {
    const recent = samples.slice(-24);
    if (recent.length < 2) {
      qualityTrendGraph.replaceChildren(el('span', { class: 'small faint' }, t('record.qualityTrendUnknown')));
      return;
    }
    const width = 156, height = 34, pad = 3;
    const values = recent.map((sample) => Math.max(0, sample.acc));
    const max = Math.max(1, ...values);
    const points = values.map((value, index) => [
      pad + index * (width - pad * 2) / (values.length - 1),
      height - pad - value / max * (height - pad * 2)
    ]);
    const path = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('record.qualityAccuracy'));
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', path);
    line.setAttribute('class', 'lp-accuracy-line');
    svg.append(line);
    const last = points[points.length - 1];
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', String(last[0]));
    dot.setAttribute('cy', String(last[1]));
    dot.setAttribute('r', '2.5');
    dot.setAttribute('class', 'lp-accuracy-dot');
    svg.append(dot);
    qualityTrendGraph.replaceChildren(svg);
  }
  function renderQualityPanel() {
    const active = rec.status === 'recording' || rec.status === 'paused';
    qualityPanel.hidden = !active || !rec.quality;
    if (!active || !rec.quality) return;
    const quality = rec.quality;
    const warnings = quality.warnings || [];
    const severe = warnings.some((warning) => warning.severity === 'critical');
    const attention = warnings.length > 0;
    qualityStatus.textContent = t(severe ? 'record.qualityCritical' : attention ? 'record.qualityAttention' : 'record.qualityGood');
    qualityStatus.className = `lp-quality-status ${severe ? 'bad' : attention ? 'warn' : 'good'}`;
    const latest = quality.accuracySamples?.at(-1);
    qualityAccuracyValue.textContent = latest ? `±${Math.round(latest.acc)}m` : '--';
    const trend = quality.accuracyTrend?.trend;
    qualityAccuracyTrend.textContent = t(`record.qualityTrend${trend ? trend[0].toUpperCase() + trend.slice(1) : 'Unknown'}`);
    qualityAccuracyTrend.className = `small ${trend === 'worsening' ? 'bad' : trend === 'improving' ? 'good' : 'faint'}`;
    renderAccuracyTrend(quality.accuracySamples || []);
    qualityLastFix.textContent = quality.lastValidFixAgeMs == null
      ? t('record.qualityNoFix') : spanText(quality.lastValidFixAgeMs);
    qualitySampleRate.textContent = quality.validSampleRatePerMin == null
      ? '--' : `${quality.validSampleRatePerMin.toFixed(1)}/min`;
    qualityCompleteness.textContent = percent(quality.trackCompleteness ?? quality.completeness);
    const meta = [
      t('record.qualityMetaDuration', { duration: spanText(quality.activeDurationMs) }),
      t('record.qualityMetaValidSpan', { duration: spanText(quality.validSpanMs) }),
      t('record.qualityMetaTrackSpan', { duration: spanText(quality.trackSpanMs) })
    ];
    if (quality.storage.supported && quality.storage.usageRatio != null) {
      meta.push(t('record.qualityMetaStorage', { pct: Math.round(quality.storage.usageRatio * 100) }));
    }
    if (quality.battery.supported && quality.battery.level != null) {
      meta.push(t('record.qualityMetaBattery', {
        pct: Math.round(quality.battery.level * 100),
        state: quality.battery.charging ? ` · ${t('record.qualityCharging')}` : ''
      }));
    }
    qualityMeta.replaceChildren(...meta.map((text) => el('span', {}, text)));
  }

  let liveActivity = 'auto';
  function currentActivity() {
    if (rec.tripId && (rec.status === 'recording' || rec.status === 'paused')) return liveActivity;
    return appState.activeTripFull?.trip?.activity || get('activity');
  }
  function speedMode() {
    const s = get('speedDisplay');
    if (s === 'speed' || s === 'pace') return s;
    const a = currentActivity();
    return a === 'hike' || a === 'run' ? 'pace' : 'speed';
  }

  const altTag = el('span', { class: 'tag', hidden: true });
  cAlt.v.append(altTag);
  function clearLivePanel() {
    for (const item of [cDist, cDur, cSpeed, cAvg, cCal, cAlt, cAsc, cDesc]) {
      item.num.textContent = '--';
      item.unit.textContent = '';
    }
    cSpeed.k.textContent = t(speedMode() === 'pace' ? 'panel.pace' : 'panel.speed');
    panelSignal.bars.className = 'sig-bars lv0';
    panelSignal.text.textContent = '--';
    cSig.k.textContent = t('panel.signal');
    altTag.hidden = true;
    altTag.className = 'tag';
    altTag.textContent = '';
    detailSlots.forEach((slot) => {
      slot.textContent = '';
      slot.hidden = true;
      slot.classList.remove('lp-coords');
    });
    renderQualityPanel();
  }
  function renderPanel(L) {
    if (!L || rec.live !== L || (rec.status !== 'recording' && rec.status !== 'paused')) {
      clearLivePanel();
      return;
    }
    const units = get('units');
    const d = fmtDistance(L.distance, units);
    cDist.num.textContent = d.v;
    cDist.unit.textContent = d.u;
    cDur.num.textContent = fmtDuration(L.duration);
    cDur.unit.textContent = '';
    if (speedMode() === 'pace') {
      const p = fmtPace(L.speed, units);
      cSpeed.num.textContent = p.v;
      cSpeed.unit.textContent = p.u;
      cSpeed.k.textContent = t('panel.pace');
    } else {
      const s = fmtSpeed(L.speed, units);
      cSpeed.num.textContent = s.v;
      cSpeed.unit.textContent = s.u;
      cSpeed.k.textContent = t('panel.speed');
    }
    const avg = L.movingMs > 0 ? L.distance / (L.movingMs / 1000) : 0;
    const av = fmtSpeed(avg, units);
    cAvg.num.textContent = av.v;
    cAvg.unit.textContent = av.u;
    const baseAct = currentActivity();
    const act = baseAct === 'auto' ? rec.activityGuess : baseAct;
    const cal = act ? estimateCalories(act, L.movingMs, avg, get('weightKg')) : null;
    cCal.num.textContent = cal != null ? String(cal) : '—';
    cCal.unit.textContent = cal != null ? 'kcal' : '';
    const a = fmtAltitude(L.alt, units);
    cAlt.num.textContent = a.v;
    cAlt.unit.textContent = a.u;
    altTag.hidden = !L.altSrc;
    altTag.className = `tag ${altSourceTagClass(L.altSrc)}`;
    altTag.textContent = L.altSrc ? t(altSourceShortKey(L.altSrc)) : '';
    cAsc.num.textContent = String(Math.round(L.ascent));
    cAsc.unit.textContent = 'm';
    cDesc.num.textContent = String(Math.round(L.descent));
    cDesc.unit.textContent = 'm';
    renderSignal(panelSignal, L.acc);
    cSig.k.textContent = L.acc != null ? `${t('panel.signal')} ±${Math.round(L.acc)}m` : t('panel.signal');
    const slopeTxt = L.slope != null ? `${L.slope > 0 ? '+' : ''}${L.slope.toFixed(1)}%` : '--';
    const mx = fmtSpeed(L.maxSpeed || 0, units);
    const values = [
      `${t('panel.slope')} ${slopeTxt}`,
      `${t('panel.maxSpeed')} ${mx.v}${mx.u}`,
      `${t('panel.moving')} ${fmtDuration(L.movingMs, { compact: true })}`,
      `${t('panel.still')} ${fmtDuration(L.stillMs, { compact: true })}`,
      `${t('panel.points')} ${L.pointCount}`,
      L.segCount > 1 ? `${t('panel.segments')} ${L.segCount}` : '',
      L.lat != null ? `${L.lat.toFixed(5)}, ${L.lon.toFixed(5)}` : ''
    ];
    detailSlots.forEach((slot, index) => {
      slot.textContent = values[index];
      slot.hidden = !values[index];
      slot.classList.toggle('lp-coords', index === 6);
    });
    renderQualityPanel();
  }

  function renderSaveChip() {
    const active = rec.status === 'recording' || rec.status === 'paused';
    pSave.style.display = active ? '' : 'none';
    const s = rec.saveState;
    pSave.className = 'lp-save';
    if (!active) return;
    if (s.degraded) {
      pSave.classList.add('bad');
      pSave.textContent = t('record.saveDegradedShort');
      pSave.title = t('record.saveDegraded', { n: s.pending });
    } else if (s.error) {
      pSave.classList.add('bad');
      pSave.textContent = t('record.saveFailedShort');
      pSave.title = t('record.saveFailed', { n: s.pending });
    } else if (s.pending > 0) {
      pSave.classList.add('pending');
      pSave.textContent = t('record.savePendingShort', { n: s.pending });
      pSave.title = t('record.savePending', { n: s.pending });
    } else {
      pSave.textContent = t('record.saveOkShort');
      pSave.title = s.lastSavedAt
        ? `${t('record.saveOk')} · ${new Date(s.lastSavedAt).toLocaleTimeString(languageTag(currentLang()))}`
        : t('record.saveOk');
    }
  }

  function renderStatus() {
    const dot = panel.querySelector('#panel-rec-dot');
    const mapSt = { idle: 'statusIdle', recording: 'statusRecording', paused: 'statusPaused', finished: 'statusFinished' };
    let extra = rec.simulated ? ` · ${t('record.simRecording')}` : '';
    if (!rec.simulated && rec.status === 'recording') {
      if (rec.geoError) extra += ` · ${t('record.statusGap')}`;
      else if (!rec.firstFixT) extra += ` · ${t('record.searching')}`;
    }
    pStatus.textContent = t(`record.${mapSt[rec.status] || 'statusIdle'}`) + extra;
    pStatus.className = `st ${rec.status}`;
    dot.className = `rec-dot ${rec.status}`;
    renderSaveChip();
    syncPowerLockEntry();
    emit('recstatus:changed', rec.status);
  }

  // ---------- buttons ----------
  const actRow = el('div', { class: 'rec-activity' });
  const btnRow = el('div', { class: 'rec-buttons' });
  const activitySel = el('select', { class: 'btn sm', style: { maxWidth: '130px' } });
  for (const a of ['auto', 'hike', 'drive', 'bike', 'run', 'travel']) {
    activitySel.append(el('option', { value: a }, a === 'auto' ? t('record.activityAuto') : t(`record.activities.${a}`)));
  }
  activitySel.value = get('activity');
  activitySel.onchange = () => set('activity', activitySel.value);
  const autoTag = el('button', { type: 'button', class: 'live-auto-tag', disabled: true });
  const liveActSel = el('select', { class: 'live-act-select' });
  for (const a of ['auto', 'hike', 'drive', 'bike', 'run', 'travel']) {
    liveActSel.append(el('option', { value: a }, a === 'auto' ? t('record.activityAuto') : t(`record.activities.${a}`)));
  }
  const liveActWrap = el('div', { class: 'live-act-mode' },
    icon('compass', 14),
    el('span', { class: 'la-k' }, t('record.activityLabel')),
    liveActSel,
    el('span', { class: 'la-chev' }, icon('chevron', 13)));
  liveActSel.onchange = async () => {
    liveActivity = liveActSel.value;
    if (rec.tripId) { await updateTrip(rec.tripId, { activity: liveActivity }); setRecordingActivity(liveActivity); }
    if (liveActivity !== 'auto') rec.activityGuess = null;
    renderAutoTag();
  };
  const autoTagIcon = icon('sparkles', 12);
  const autoTagPulse = el('span', { class: 'la-pulse' });
  const autoTagText = el('span', {});
  function activityReasonText(reason: any): string {
    const params = reason?.params || {};
    const values = {
      speed: Number(params.speed).toFixed(1),
      accel: Number(params.accel).toFixed(2),
      grade: Number(params.grade).toFixed(1),
      pct: Math.round(Number(params.pct) || 0),
      distance: Math.round(Number(params.distance) || 0),
      interval: Math.round(Number(params.interval) || 0),
      samples: Math.round(Number(params.samples) || 0),
      margin: Math.round(Number(params.margin) || 0)
    };
    const key = `record.activityReason${reason?.code ? reason.code[0].toUpperCase() + reason.code.slice(1) : 'Evidence'}`;
    return t(key, values);
  }
  function showActivityClassification() {
    const classification = rec.activityClassification;
    if (!classification) return;
    const confidence = Math.round((classification.confidence || 0) * 100);
    const body = el('div', { class: 'activity-classification' },
      el('div', { class: 'activity-classification-summary' },
        el('strong', {}, classification.activity ? t(`record.activities.${classification.activity}`) : t('record.activityAuto')),
        el('span', { class: `chip ${classification.lowConfidence ? 'warn' : 'good'}` }, t('record.activityConfidence', { pct: confidence }))));
    if (classification.lowConfidence) body.append(el('p', { class: 'small warn' }, t('record.activityLowConfidence')));
    body.append(el('h4', {}, t('record.activityEvidence')));
    body.append(el('ul', { class: 'activity-evidence-list' },
      ...(classification.reasons || []).map((reason: any) => el('li', {}, activityReasonText(reason)))));
    const candidates = classification.candidates || [];
    if (candidates.length) {
      body.append(el('h4', {}, t('record.activityCandidates')));
      body.append(el('div', { class: 'activity-candidates' },
        ...candidates.slice(0, 3).map((candidate: any) => el('div', { class: 'activity-candidate' },
          el('span', {}, t(`record.activities.${candidate.activity}`)),
          el('span', { class: 'mono' }, t('record.activityConfidence', { pct: Math.round((candidate.confidence || 0) * 100) })),
          el('small', { class: 'faint' }, (candidate.reasons || []).slice(0, 2).map(activityReasonText).join(' · '))))));
    }
    const dialog = modal({
      title: t('record.activityEvidence'),
      body,
      footer: [el('button', { class: 'btn primary', onclick: () => dialog.close() }, t('common.close'))]
    });
  }
  autoTag.onclick = (event) => { event.stopPropagation(); showActivityClassification(); };
  function renderAutoTag() {
    const mode = (rec.status === 'recording' || rec.status === 'paused') ? liveActivity : get('activity');
    const classification = rec.activityClassification;
    autoTag.hidden = mode !== 'auto';
    autoTag.style.display = '';
    autoTag.classList.toggle('detected', !!rec.activityGuess);
    autoTag.replaceChildren(rec.activityGuess ? autoTagIcon : autoTagPulse, autoTagText);
    autoTagText.textContent = rec.activityGuess
      ? t('record.autoDetectedConfidence', {
        a: t(`record.activities.${rec.activityGuess}`),
        pct: Math.round((classification?.confidence || 0) * 100)
      })
      : t('record.autoDetecting');
    autoTag.disabled = !classification;
    autoTag.title = classification ? t('record.activityEvidence') : '';
    autoTag.setAttribute('aria-label', autoTag.title || autoTagText.textContent);
  }
  renderAutoTag();
  actRow.append(liveActWrap, autoTag);

  const bannerBox = el('div', {});
  const viewBar = el('div', { class: 'view-trip-bar', style: { display: 'none' } });

  // ---------- re-walk navigation panel ----------
  let rwFollowOn = true;
  let rwHeadingOn = false;
  const rewalkBox = el('div', { class: 'rewalk-card', style: { display: 'none' } });
  const rwName = el('div', { class: 'rw-name' });
  const rwPhase = el('span', { class: 'rw-phase' }, t('rewalk.phaseLocating'));
  const rwPct = el('span', { class: 'rw-pct mono' }, '0%');
  const rwBarFill = el('div', { class: 'rw-fill' });
  const rwLeftK = el('span', { class: 'rw-k' }, t('rewalk.remaining'));
  const rwLeft = el('span', { class: 'mono' }, '--');
  const rwEtaK = el('span', { class: 'rw-k' }, t('rewalk.eta'));
  const rwEta = el('span', { class: 'mono' }, t('rewalk.etaUnknown'));
  const rwDir = el('span', { class: 'rw-dir', style: { display: 'none' } }, icon('chevronRight', 15));
  const rwOff = el('span', { class: 'rw-off' }, t('rewalk.onTrack'));
  const rwNext = el('div', { class: 'rw-next small' });
  const rwTurn = el('div', { class: 'rw-turn small', hidden: true });
  const rwFollow = el('button', { class: 'btn sm active', onclick: () => { rwFollowOn = !rwFollowOn; rwFollow.classList.toggle('active', rwFollowOn); map?.setFollow(rwFollowOn); } }, icon('follow', 14), t('record.follow'));
  const rwHeading = el('button', {
    class: 'btn sm', onclick: () => {
      rwHeadingOn = !rwHeadingOn;
      rwHeading.classList.toggle('active', rwHeadingOn);
      map?.setHeadingUp(rwHeadingOn);
    }
  }, icon('compass', 14), t('rewalk.headingUp'));
  const rwMute = el('button', { class: 'btn sm', onclick: () => toggleMute() }, t('rewalk.mute'));
  const rwSim = el('button', { class: 'btn sm', onclick: () => (rewalk.sim ? stopSim() : startSim()) }, t('rewalk.simWalk'));
  const rwNavigate = el('button', { class: 'btn sm primary', style: { display: 'none' }, onclick: openExternalNavigation }, icon('flag', 14), t('rewalk.navigateTarget', { target: t('wp.types.start') }));
  const rwExit = el('button', { class: 'btn sm danger', onclick: () => { stopRewalk(); toast(t('rewalk.exited'), 'info', 2000); } }, icon('x', 14), t('rewalk.exit'));
  rewalkBox.append(
    el('div', { class: 'row rw-head', style: { alignItems: 'center', gap: '8px' } }, rwName, rwPhase, rwPct),
    el('div', { class: 'rw-bar' }, rwBarFill),
    el('div', { class: 'rw-stats small' }, el('span', {}, rwLeftK, ' ', rwLeft), el('span', {}, rwEtaK, ' ', rwEta), rwDir, rwOff),
    rwNext,
    rwTurn,
    el('div', { class: 'row wrap', style: { gap: '8px', marginTop: '8px' } }, rwFollow, rwHeading, rwNavigate, rwMute, rwSim, rwExit)
  );
  function navigationPlatform(): NavigationPlatform {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'ios'
      : /Android/i.test(navigator.userAgent) ? 'android' : 'web';
  }
  function openExternalNavigation() {
    const nav = getRewalkNavigation(navigationPlatform());
    if (!nav) { toast(t('rewalk.navOpenFailed'), 'warn'); return; }
    const target = targetLabel(rewalk.navTargetType || rewalk.targetType);
    const tripId = rewalk.tripId;
    const targetId = rewalk.navTarget?.id;
    const targetLat = rewalk.navTarget?.lat;
    const targetLon = rewalk.navTarget?.lon;
    const provider = nav.provider === 'amap' ? 'Amap' : 'Google Maps';
    let dialog;
    dialog = modal({
      title: t('rewalk.navDialogTitle'),
      body: el('p', { class: 'small muted', style: { marginTop: 0 } },
        t('rewalk.navDialogBody', { provider, target })),
      footer: [
        el('button', { class: 'btn ghost', onclick: () => dialog.close() }, t('common.cancel')),
        el('button', { class: 'btn primary', onclick: () => {
          dialog.close();
          const currentNav = getRewalkNavigation(navigationPlatform());
          if (!currentNav || rewalk.tripId !== tripId || rewalk.navTarget?.id !== targetId
            || rewalk.navTarget?.lat !== targetLat || rewalk.navTarget?.lon !== targetLon) return;
          let opened = false;
          try {
            const child = window.open(currentNav.primary, '_blank');
            opened = !!child;
            if (child) child.opener = null;
          } catch { /* external navigation unavailable */ }
          if (!opened) {
            try { window.location.assign(currentNav.fallback); }
            catch { toast(t('rewalk.navOpenFailed'), 'warn'); return; }
          }
          if (markExternalNavigation()) toast(t('rewalk.navOpened'), 'ok', 3500);
        } }, icon('flag', 15), t('rewalk.navConfirm'))
      ]
    });
  }
  function targetLabel(type) {
    return t(type === 'start' ? 'wp.types.start' : 'wp.types.end');
  }
  function rewalkDirectionKey(degrees) {
    const keys = ['north', 'northEast', 'east', 'southEast', 'south', 'southWest', 'west', 'northWest'];
    return keys[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
  }
  function updateRewalk(f) {
    const phase = f.phase || 'follow';
    const done = phase === 'finished' || f.finished;
    const canNavigate = phase === 'approach' && !done && !f.externalNav
      && (f.navDist ?? 0) >= EXTERNAL_NAV_MIN_M;
    rwNavigate.style.display = canNavigate ? '' : 'none';
    rwNavigate.replaceChildren(icon('flag', 14), t('rewalk.navigateTarget', { target: targetLabel(f.navTargetType || f.targetType) }));
    rwEta.textContent = Number.isFinite(f.etaSeconds) ? fmtDuration(f.etaSeconds * 1000, { compact: true }) : t('rewalk.etaUnknown');
    rwEta.title = f.etaSource ? t(`rewalk.etaSource${f.etaSource[0].toUpperCase()}${f.etaSource.slice(1)}`) : '';
    rwTurn.hidden = true;
    rwTurn.textContent = '';
    rwPhase.textContent = t(done ? 'rewalk.phaseDone'
      : phase === 'locating' ? 'rewalk.phaseLocating'
        : phase === 'approach' ? 'rewalk.phaseApproach'
          : 'rewalk.phaseFollow');
    rwPhase.className = `rw-phase ${done ? 'done' : phase}`;
    const pct = done ? 100 : Math.round((f.progress || 0) * 100);
    rwBarFill.style.width = `${pct}%`;
    rwPct.textContent = `${pct}%`;
    if (phase === 'locating' && !done) {
      rwLeftK.textContent = t('rewalk.remaining');
      rwLeft.textContent = '--';
      rwOff.textContent = t('rewalk.waitingGps');
      rwOff.classList.remove('bad');
      rwDir.style.display = 'none';
      rwNext.textContent = '';
      return;
    }
    if (phase === 'approach' && !done) {
      const d = fmtDistance(f.navDist ?? f.remaining ?? 0, get('units'));
      const target = targetLabel(f.navTargetType || f.targetType);
      rwLeftK.textContent = t('rewalk.navDist');
      rwLeft.textContent = `${d.v}${d.u}`;
      rwOff.textContent = `${t('rewalk.navTo')} ${target}`;
      rwOff.classList.remove('bad');
      rwDir.style.display = '';
      const rel = (f.navBearing ?? 0) - (f.heading ?? 0);
      rwDir.style.transform = `rotate(${rel - 90}deg)`;
      rwNext.textContent = f.externalNav ? t('rewalk.externalGuide') : `${t('rewalk.target')} ${target}`;
      return;
    }
    rwDir.style.display = 'none';
    rwLeftK.textContent = t('rewalk.remaining');
    const d = fmtDistance(f.remaining, get('units'));
    rwLeft.textContent = `${d.v}${d.u}`;
    const off = f.offRoute || (f.offTrack || 0) > 60;
    rwOff.textContent = done ? t('rewalk.phaseDone')
      : f.offRoute ? `${t('rewalk.offRouteFor', { s: Math.floor((f.offRouteForMs || 0) / 1000) })} · ${t('rewalk.offTrack', { m: Math.round(f.offTrack || 0) })}`
        : off ? t('rewalk.offTrack', { m: Math.round(f.offTrack) }) : t('rewalk.onTrack');
    rwOff.classList.toggle('bad', off && !done);
    if (!done && f.turn) {
      rwTurn.hidden = false;
      const turn = fmtDistance(f.turn.distanceM, get('units'));
      rwTurn.textContent = t('rewalk.turnPrompt', {
        turn: t(`rewalk.turn${f.turn.direction[0].toUpperCase()}${f.turn.direction.slice(1)}`),
        distance: `${turn.v}${turn.u}`
      });
    }
    rwNext.textContent = f.finished ? t('rewalk.finished')
      : f.nextWp ? `${t('rewalk.nextWp')} ${WP_ICONS[f.nextWp.type] || '📍'} ${f.nextWp.name || t(`wp.types.${f.nextWp.type}`)} · ${Math.round(f.nextWp.dist)} m`
        : t('rewalk.noWp');
  }
  function renderRewalk() {
    const on = rewalk.active;
    rewalkBox.style.display = on ? '' : 'none';
    panel.style.display = on ? 'none' : '';
    actRow.style.display = on ? 'none' : '';
    btnRow.style.display = on ? 'none' : '';
    if (!on) return;
    rwName.textContent = `${t('rewalk.title')} · ${rewalk.name}`;
    rwMute.textContent = rewalk.muted ? t('rewalk.unmute') : t('rewalk.mute');
    rwSim.textContent = rewalk.sim ? t('rewalk.simStop') : t('rewalk.simWalk');
    rwHeading.classList.toggle('active', rwHeadingOn);
    const along = rewalk.along || 0;
    const span = Math.max(1e-6, rewalk.total - rewalk.entryAlong);
    const navTarget = rewalk.navTarget;
    let navDist = null;
    let navBearing = null;
    if (rewalk.phase === 'approach' && navTarget && rewalk.lastFix) {
      navDist = haversine(rewalk.lastFix.lat, rewalk.lastFix.lon, navTarget.lat, navTarget.lon);
      navBearing = bearing(rewalk.lastFix.lat, rewalk.lastFix.lon, navTarget.lat, navTarget.lon);
    }
    updateRewalk({
      progress: Math.max(0, Math.min(1, (along - rewalk.entryAlong) / span)),
      remaining: Math.max(0, rewalk.total - along),
      offTrack: rewalk.offTrack, offRoute: rewalk.offRoute, offRouteForMs: rewalk.offRouteForMs,
      nextWp: null, finished: rewalk.finished,
      phase: rewalk.phase, mode: rewalk.mode, targetType: rewalk.targetType,
      navTargetType: rewalk.navTargetType,
      navDist, navBearing, heading: rewalk.lastFix?.heading ?? null,
      etaSeconds: rewalk.etaSeconds, etaSource: rewalk.etaSource, turn: rewalk.turn, externalNav: rewalk.externalNav
    });
  }
  on('rewalk:started', ({ segments, waypoints }) => {
    leaveEditMode();
    viewingTripEditable = false;
    viewingTrip = null;
    rwHeadingOn = false;
    renderViewBar();
    if (map && !psActive) {
      map.clearNavGuide();
      map.setHeadingUp(false);
      map.setTrackData(segments, waypoints);
      setTimeout(() => map.fitTrack(), 300);
    }
    renderRewalk();
    toast(t('rewalk.hint'), 'info', 5000);
  });
  on('rewalk:fix', (f) => {
    if (map && !psActive) {
      const heading = rwHeadingOn ? (f.heading ?? f.routeBearing) : f.heading;
      map.updatePosition(f.lat, f.lon, f.acc, heading);
      if (f.phase === 'approach' && f.targetLat != null) {
        map.setNavGuide(f.lat, f.lon, f.targetLat, f.targetLon, targetLabel(f.navTargetType || f.targetType));
      } else {
        map.clearNavGuide();
      }
      if (rwFollowOn) map.setFollow(true);
    }
    updateRewalk(f);
  });
  on('rewalk:finished', () => {
    if (map && !psActive) map.clearNavGuide();
    toast(t('rewalk.finished'), 'ok', 4000);
    renderRewalk();
  });
  on('rewalk:stopped', () => {
    rwHeadingOn = false;
    rwHeading.classList.remove('active');
    renderRewalk();
    if (map && !psActive) { map.clearNavGuide(); map.setTrackData([], []); map.clearPosition(); }
    renderButtons(); renderBanners();
  });
  on('rewalk:mute', () => renderRewalk());
  on('rewalk:sim', () => renderRewalk());
  on('rewalk:navigation', () => renderRewalk());
  on('map:headingup', ({ active }) => {
    if (!rewalk.active) return;
    rwHeadingOn = !!active;
    rwHeading.classList.toggle('active', rwHeadingOn);
  });
  on('rewalk:geoerror', ({ code }) => toast(geoErrorMsg(code), 'warn', 4500));

  controls.append(rewalkBox, viewBar, bannerBox, panel, actRow, btnRow);

  function renderViewBar() {
    viewBar.innerHTML = '';
    syncEditTools();
    if (!viewingTrip || rec.status === 'recording' || rec.status === 'paused') { viewBar.style.display = 'none'; return; }
    viewBar.style.display = '';
    viewBar.append(
      el('span', { class: 'vt-name' }, icon('fit', 14), `${t('record.viewing')} ${viewingTrip.trip.name || t('record.newTripName')}`),
      el('button', { class: 'btn sm', onclick: exitView }, icon('x', 14), t('record.exitView'))
    );
  }
  function exitView() {
    leaveEditMode();
    viewingTrip = null;
    viewingTripEditable = false;
    appState.showTripInRecord = false;
    map?.setTrackData([], []);
    map?.clearHover();
    renderViewBar();
    toast(t('record.exitViewOk'), 'ok', 2000);
  }

  function runRecAction(p) {
    p.catch((e) => {
      console.error(e);
      renderButtons();
      renderBanners();
    });
  }

  // ---------- embedded camera: quick photo waypoints ----------
  const CAMERA_FIX_MAX_AGE_MS = 15_000;
  let cameraFixRequest = null;
  let cameraFixMissUntil = 0;

  function liveCameraFix() {
    const L = rec.live;
    if (!L || L.lat == null || L.lon == null || Date.now() - rec.lastFixWall > CAMERA_FIX_MAX_AGE_MS) return null;
    return { lat: L.lat, lon: L.lon, alt: L.alt ?? null, acc: L.acc ?? null };
  }

  function locateCameraFix() {
    if (!navigator.geolocation) return Promise.resolve(null);
    if (Date.now() < cameraFixMissUntil) return Promise.resolve(null);
    if (cameraFixRequest) return cameraFixRequest;
    cameraFixRequest = new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition((pos) => {
        const c = pos.coords;
        const fresh = Date.now() - (pos.timestamp || Date.now()) <= 20_000;
        const valid = fresh && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)
          && Math.abs(c.latitude) <= 90 && Math.abs(c.longitude) <= 180
          && (!Number.isFinite(c.accuracy) || c.accuracy <= 200);
        resolve(valid ? { lat: c.latitude, lon: c.longitude, alt: c.altitude ?? null, acc: c.accuracy ?? null } : null);
      }, () => resolve(null), { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
    }).then((fix) => {
      cameraFixRequest = null;
      if (!fix) cameraFixMissUntil = Date.now() + 5_000;
      return fix;
    });
    return cameraFixRequest;
  }

  function cameraFix() {
    if (rec.simulated) return Promise.resolve(liveCameraFix());
    if (rec.status === 'paused') return locateCameraFix();
    const live = liveCameraFix();
    return live ? Promise.resolve(live) : locateCameraFix();
  }

  function openQuickCamera() {
    if (!rec.tripId || (rec.status !== 'recording' && rec.status !== 'paused')) {
      toast(t('camera.noFix'), 'warn');
      return;
    }
    armKeepAlive();
    openCamera({ mode: 'quick', getFix: cameraFix, onQuickSave: saveCapturedPhoto });
  }

  async function saveCapturedPhoto(shot) {
    const tripId = rec.tripId;
    if (!tripId || !shot.fix) return { ok: false };
    try {
      const saved = await addPhotoWaypoint({
        tripId,
        photo: shot,
        fix: shot.fix,
        takenAt: shot.takenAt,
        nameFor: (n) => t('record.photoNodeName', { n })
      });
      await refreshRecordingWaypointsOnly(tripId);
      const thumbUrl = URL.createObjectURL(shot.thumb);
      return {
        ok: true,
        label: t('record.photoSaved', { n: saved.number }),
        thumbUrl,
        undo: async () => {
          await deletePhotoWaypoint(saved.waypoint.id, tripId, saved.media.id);
          await refreshRecordingWaypointsOnly(tripId);
        }
      };
    } catch (e) {
      console.error(e);
      return { ok: false };
    }
  }

  function openOledCamera() {
    if (psCamAct.hidden || !rec.tripId || (rec.status !== 'recording' && rec.status !== 'paused')) return;
    armKeepAlive();
    openCamera({
      mode: 'oled',
      idleCloseMs: 20_000,
      getFix: cameraFix,
      onQuickSave: saveCapturedPhoto
    });
  }

  const startBtn = el('button', { class: 'rec-pill start', onclick: onStart }, icon('play', 17), t('record.start'));
  const nodeBtn = el('button', { class: 'rec-btn node', onclick: openNodeActions }, icon('pin', 20), t('record.node'));
  const pauseBtn = el('button', { class: 'rec-btn pause', onclick: () => runRecAction(pauseRecording()) }, icon('pause', 22), t('record.pause'));
  const resumeBtn = el('button', {
    class: 'rec-btn resume', onclick: () => { armKeepAlive(); runRecAction(resumeRecording()); }
  }, icon('play', 22), t('record.resume'));
  const stopBtn = el('button', {
    type: 'button', class: 'rec-btn stop', title: t('record.stop'),
    'aria-label': t('record.stop'), onclick: onStop
  }, icon('stop', 22), t('record.stop'));
  btnRow.append(activitySel, startBtn, nodeBtn, pauseBtn, resumeBtn, stopBtn);

  function openNodeActions() {
    if (!rec.tripId || (rec.status !== 'recording' && rec.status !== 'paused')) return;
    let m: ReturnType<typeof modal>;
    const close = (action) => { m.close(); action(); };
    m = modal({
      title: t('record.node'),
      body: el('div', { class: 'sheet-list' },
        el('button', { class: 'sheet-row', onclick: () => close(openRecWaypoint) },
          el('span', { class: 's-ic' }, icon('pin', 18)),
          el('span', { class: 's-txt' }, el('div', { class: 's-t' }, t('record.addNode')), el('div', { class: 's-d' }, t('record.addNodeHint')))),
        el('button', { class: 'sheet-row', onclick: () => close(openQuickCamera) },
          el('span', { class: 's-ic' }, icon('camera', 18)),
          el('span', { class: 's-txt' }, el('div', { class: 's-t' }, t('record.photo')), el('div', { class: 's-d' }, t('camera.titleQuick')))))
    });
  }

  function renderButtons() {
    syncEditTools();
    const status = rec.status;
    const active = status === 'recording' || status === 'paused';
    activitySel.className = 'rec-pill select';
    activitySel.hidden = active;
    startBtn.hidden = active;
    nodeBtn.hidden = !active;
    pauseBtn.hidden = status !== 'recording';
    resumeBtn.hidden = status !== 'paused';
    stopBtn.hidden = !active;
    stopBtn.disabled = !!stopFlowPromise;
    actRow.hidden = !active;
    if (!active) clearLivePanel();
    if (active) liveActSel.value = liveActivity;
    renderAutoTag();
    renderStatus();
    renderPsTop();
    updatePsCamera();
  }

  // One-shot fix when the view opens idle: triggers the permission prompt on first
  // visit (iOS) and centers the map on the current position.
  let locateSeq = 0;
  function locateOnce(opts: any = {}) {
    if (!navigator.geolocation) return;
    const seq = ++locateSeq;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (seq !== locateSeq) return;
        rec.permissionDenied = false;
        rec.geoError = null;
        const c = pos.coords;
        updateWeatherLocation(c.latitude, c.longitude);
        map.updatePosition(c.latitude, c.longitude, c.accuracy, c.heading);
        map.flyTo(c.latitude, c.longitude, Math.max(map.map.getZoom(), 15));
        if (opts.follow) { map.setFollow(true); followBtn.classList.add('active'); }
        renderBanners();
      },
      (err) => {
        if (seq !== locateSeq) return;
        if (err.code === 1) { rec.permissionDenied = true; renderBanners(); }
      },
      { enableHighAccuracy: true, maximumAge: 20000, timeout: 15000 }
    );
  }

  async function onStart() {
    if (resultSheet && !(await closeResultSheet('done'))) return;
    // Keep iOS media playback armed while the tap gesture is still valid.
    armKeepAlive();
    if (navigator.permissions?.query) {
      try {
        const st = await navigator.permissions.query({ name: 'geolocation' });
        if (st.state === 'denied') {
          rec.permissionDenied = true;
          disarmKeepAlive();
          renderBanners();
          toast(t('record.permissionDenied'), 'warn', 5000);
          return;
        }
      } catch { /* query unsupported — watchPosition error path still covers it */ }
    }
    const ok = await startRecording({ activity: activitySel.value }).catch((e) => {
      console.error(e);
      toast(t('record.startFailed'), 'err', 4800);
      return false;
    });
    if (!ok) disarmKeepAlive();
  }
  function suggestedTripName(full) {
    const tr = full?.trip;
    const activity = tr?.activity && tr.activity !== 'auto'
      ? t(`record.activities.${tr.activity}`)
      : t('record.newTripName');
    const locale = languageTag(currentLang());
    const when = new Date(tr?.createdAt || Date.now()).toLocaleString(locale, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    return `${activity} · ${when}`;
  }
  function setResultBusy(sheet, busy) {
    sheet.input.disabled = busy;
    sheet.closeButton.disabled = busy;
    sheet.actions.forEach((button) => { button.disabled = busy; });
  }
  function showResultError(sheet, message = t('record.resultNameFail'), nameError = true) {
    sheet.error.textContent = message;
    sheet.error.style.display = '';
    if (nameError) sheet.input.setAttribute('aria-invalid', 'true');
    else sheet.input.removeAttribute('aria-invalid');
  }
  function clearResultError(sheet) {
    sheet.error.textContent = '';
    sheet.error.style.display = 'none';
    sheet.input.removeAttribute('aria-invalid');
  }
  async function saveResultName(sheet) {
    if (sheet.savePromise) return sheet.savePromise;
    const name = sheet.input.value.trim().slice(0, 60);
    sheet.input.value = name;
    if (name === sheet.savedName) return true;
    const save = Promise.resolve().then(async () => {
      try {
        await updateTrip(sheet.tripId, { name });
        sheet.savedName = name;
        if (viewingTrip?.trip.id === sheet.tripId) {
          viewingTrip = { ...viewingTrip, trip: { ...viewingTrip.trip, name } };
          renderViewBar();
        }
        if (appState.activeTripFull?.trip.id === sheet.tripId) {
          appState.activeTripFull = { ...appState.activeTripFull, trip: { ...appState.activeTripFull.trip, name } };
        }
        toast(t('record.tripNamed'), 'ok');
        return true;
      } catch (e) {
        console.error('trip rename failed', e);
        showResultError(sheet);
        toast(t('record.resultNameFail'), 'err', 4200);
        return false;
      }
    }).finally(() => {
      sheet.savePromise = null;
    });
    sheet.savePromise = save;
    return save;
  }
  function dismissResultSheet(sheet) {
    if (sheet.closed) return;
    sheet.closed = true;
    sheet.node.remove();
    if (resultSheet === sheet) resultSheet = null;
  }
  function closeResultSheet(action = 'done', intent = null) {
    const sheet = resultSheet;
    if (!sheet || sheet.closed) return Promise.resolve(false);
    if (sheet.closePromise) return sheet.closePromise;
    setResultBusy(sheet, true);
    const close = (async () => {
      try {
        if (!(await saveResultName(sheet))) return false;
        if (action === 'analysis' || action === 'export') {
          try {
            const full = await setActiveTrip(sheet.tripId);
            if (!full) throw new Error('finished trip is unavailable');
          } catch (e) {
            console.error('result navigation failed', e);
            showResultError(sheet, t('common.unavailable'), false);
            toast(t('common.unavailable'), 'err', 4200);
            return false;
          }
        }
        await removeOverlayState(sheet.historyId);
        if (action === 'analysis' || action === 'export') {
          try {
            if (intent) await navigate(action, intent);
            else await navigate(action);
          } catch (e) {
            sheet.historyId = pushOverlayState(() => dismissResultSheet(sheet));
            console.error('result navigation failed', e);
            showResultError(sheet, t('common.unavailable'), false);
            toast(t('common.unavailable'), 'err', 4200);
            return false;
          }
        }
        dismissResultSheet(sheet);
        return true;
      } finally {
        if (!sheet.closed) {
          sheet.closePromise = null;
          setResultBusy(sheet, false);
        }
      }
    })();
    sheet.closePromise = close;
    return close;
  }
  function showResultSheet({ tripId, defaultName, savedName, initialError = false, gapCount = 0, gapDistance = '' }) {
    if (resultSheet) return false;
    const titleId = 'record-result-title';
    const inputId = 'record-result-name';
    const hintId = 'record-result-name-hint';
    const errorId = 'record-result-error';
    const input = el('input', {
      type: 'text', id: inputId, value: defaultName, maxlength: '60',
      autocomplete: 'off', enterkeyhint: 'save', 'aria-describedby': hintId
    });
    const error = el('div', {
      id: errorId, role: 'alert', 'aria-live': 'assertive',
      style: { display: 'none', color: 'var(--danger)', fontSize: '12px', marginTop: '8px' }
    });
    const closeButton = el('button', {
      type: 'button', class: 'iconbtn', 'data-result-close': '',
      'aria-label': t('common.close'), style: { width: '38px', height: '38px' }
    }, icon('x', 18));
    const actions = [
      el('button', {
        type: 'button', class: 'btn primary', 'data-result-action': 'analysis',
        style: { flex: '1 1 0' }, onclick: () => { void closeResultSheet('analysis'); }
      }, icon('analysis', 17), t('analysis.title')),
      el('button', {
        type: 'button', class: 'btn', 'data-result-action': 'export',
        style: { flex: '1 1 0' }, onclick: () => { void closeResultSheet('export'); }
      }, icon('export', 17), t('export.title')),
      el('button', {
        type: 'button', class: 'btn ghost', 'data-result-action': 'done',
        style: { flex: '1 1 0' }, onclick: () => { void closeResultSheet('done'); }
      }, t('common.save'))
    ];
    const gapNotice = gapCount > 0
      ? el('div', {
        class: 'card', role: 'status',
        style: { margin: '12px 0', padding: '12px', borderColor: 'var(--warn)' }
      },
        el('div', { style: { fontWeight: '650', marginBottom: '4px' } }, t('record.gapRepairTitle', { n: gapCount })),
        el('p', { class: 'small muted', style: { margin: '0 0 10px' } }, t('record.gapRepairHint', { d: gapDistance })),
        el('button', {
          type: 'button', class: 'btn primary sm', 'data-result-gap-repair': '',
          onclick: () => { void closeResultSheet('analysis', { section: 'data', anchor: 'track-gaps' }); }
        }, icon('routeFwd', 15), t('analysis.gapFill')))
      : null;
    const node = el('section', {
      class: 'record-result-sheet', role: 'dialog', 'aria-modal': 'false',
      'aria-labelledby': titleId,
      style: {
        position: 'fixed', left: '50%', bottom: 'calc(var(--tabbar-h) + var(--safe-b) + 12px)',
        transform: 'translateX(-50%)', width: 'min(560px, calc(100vw - 24px))',
        maxHeight: 'calc(100vh - var(--tabbar-h) - var(--safe-b) - 32px)',
        overflowY: 'auto', zIndex: '350', padding: '14px',
        background: 'var(--bg-elev)', color: 'var(--text)',
        border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-2)'
      }
    },
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } },
        el('h3', { id: titleId, style: { margin: '0', flex: '1', fontSize: '16px', fontWeight: '650' } }, t('record.resultTitle')),
        closeButton),
      el('p', { class: 'small muted', style: { margin: '0 0 12px' } }, t('record.resultHint')),
      el('div', { class: 'field' },
        el('label', { for: inputId }, t('record.tripName')),
        input,
        el('div', { id: hintId, class: 'hint' }, t('record.nameTripHint')),
        error),
      gapNotice,
      el('div', { style: { display: 'flex', gap: '8px' } }, actions)
    );
    const sheet = {
      tripId, node, input, error, closeButton, actions,
      savedName, savePromise: null, closePromise: null, closed: false, historyId: 0
    };
    closeButton.onclick = () => { void closeResultSheet('done'); };
    input.addEventListener('input', () => clearResultError(sheet));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        void closeResultSheet('done');
      }
    });
    resultSheet = sheet;
    view.append(node);
    sheet.historyId = pushOverlayState(() => dismissResultSheet(sheet));
    if (initialError) showResultError(sheet);
    return true;
  }
  async function finishRecordingFlow() {
    if (rec.status !== 'recording' && rec.status !== 'paused') return;
    let id;
    try {
      id = await stopRecording();
    } catch (e) {
      console.error('stop recording failed', e);
      id = null;
    }
    if (!id) {
      toast(t('record.stopSaveFailed'), 'err', 5200);
      renderButtons();
      renderBanners();
      return;
    }

    activitySel.value = 'auto';
    set('activity', 'auto');

    const wasOled = psActive;
    let full = null;
    let loadFailed = false;
    try {
      full = await loadTripMapData(id);
    } catch (e) {
      loadFailed = true;
      console.error('finished trip load failed', e);
    }
    if (!full) {
      loadFailed = true;
      try {
        const trip = await getTrip(id);
        if (trip) full = { trip, segments: [], waypoints: [] };
      } catch (e) {
        console.error('finished trip metadata load failed', e);
      }
    }
    const defaultName = full ? suggestedTripName(full) : t('record.newTripName');
    let savedName = full?.trip.name || '';
    let initialNameError = false;
    try {
      await updateTrip(id, { name: defaultName });
      savedName = defaultName;
      if (full) full = { ...full, trip: { ...full.trip, name: defaultName } };
    } catch (e) {
      initialNameError = true;
      console.error('default trip name save failed', e);
    }
    if (loadFailed) toast(t('common.unavailable'), 'err', 5200);

    leaveEditMode();
    viewingTripEditable = false;
    viewingTrip = full;
    renderViewBar();
    if (wasOled) {
      try {
        await setPowerLock(false, { guardUnlockClick: false });
      } catch (e) {
        console.error('map restore after OLED stop failed', e);
        toast(t('common.unavailable'), 'err', 5200);
      }
    } else if (full) {
      await renderFinishedTrip(full);
    }
    renderButtons();
    renderBanners();
    renderViewBar();
    toast(t('record.stopped'), 'ok');
    const saveGaps = full && (full.trip.activity === 'drive' || full.trip.activity === 'bike')
      ? findTrackGaps(full.segments || [], { minDist: 300 })
      : [];
    const saveGapDistance = saveGaps.length
      ? (() => { const d = fmtDistance(saveGaps.reduce((sum, gap) => sum + gap.distance, 0), get('units')); return `${d.v} ${d.u}`; })()
      : '';
    showResultSheet({ tripId: id, defaultName, savedName, initialError: initialNameError, gapCount: saveGaps.length, gapDistance: saveGapDistance });
  }
  function onStop() {
    if (stopFlowPromise) return stopFlowPromise;
    stopFlowPromise = finishRecordingFlow().finally(() => {
      stopFlowPromise = null;
      renderButtons();
    });
    return stopFlowPromise;
  }

  // ---------- waypoints mid-recording ----------
  function recEditOpts() {
    if (rec.status !== 'recording' && rec.status !== 'paused') return {};
    const tripId = rec.tripId;
    if (!tripId) return {};
    return {
      tripId,
      scopeCurrent: () => (rec.status === 'recording' || rec.status === 'paused') && rec.tripId === tripId,
      onSaved: refreshRecordingWaypoints
    };
  }
  function refreshRecordingWaypoints(full) {
    if (!full || full.trip.id !== rec.tripId) return;
    try {
      if (map && !psActive) map.setWaypoints(full.waypoints);
    } catch (e) {
      console.warn('waypoint refresh failed', e);
    }
  }
  async function refreshRecordingWaypointsOnly(tripId = rec.tripId) {
    if (!tripId) return;
    const waypoints = await listWaypoints(tripId);
    if (tripId !== rec.tripId) return;
    try {
      if (map && !psActive) map.setWaypoints(waypoints);
    } catch (e) {
      console.warn('waypoint refresh failed', e);
    }
  }
  function openRecWaypoint() {
    const L = rec.live;
    if (!L || L.lat == null || L.lon == null) { toast(t('record.nodeNoFix'), 'warn'); return; }
    openWaypointModal({ lat: L.lat, lon: L.lon }, { ...recEditOpts(), defaultType: 'route' });
  }

  // ---------- banners ----------
  function geoBanner(msg, onRetry, label = t('record.geoRetry')) {
    return el('div', { class: 'debug-banner', style: { display: 'flex', gap: '8px', alignItems: 'center' } },
      el('span', { class: 'grow' }, '⚠ ' + msg),
      el('button', { class: 'btn sm', onclick: onRetry }, label));
  }
  async function retrySave() {
    const ok = await flushBuffer();
    if (ok) toast(t('record.saveOk'), 'ok', 2200);
  }
  function geoErrorMsg(code) {
    return code === 'unavailable' ? t('record.geoUnavailable')
      : code === 'timeout' ? t('record.geoTimeout')
        : code === 'denied' ? t('record.permissionDenied')
          : t('record.geoSilent');
  }
  function qualityWarningAction(warning: any) {
    if (warning.action === 'retry-location') return () => retryGeolocation();
    if (warning.action === 'retry-save') return () => { void retrySave(); };
    if (warning.action === 'free-storage') return () => { void navigate('settings', { anchor: 'database' }); };
    return () => toast(t('record.qualityActionCharge'), 'info', 4500);
  }
  function qualityWarningLabel(warning: any) {
    if (warning.action === 'retry-location') return t('record.geoRetry');
    if (warning.action === 'retry-save') return t('record.saveRetry');
    if (warning.action === 'free-storage') return t('record.qualityActionStorage');
    return t('record.qualityActionCharge');
  }
  function activeQualityWarnings() {
    const active = rec.status === 'recording' || rec.status === 'paused';
    return active ? (rec.quality?.warnings || []).filter((warning) => {
      if (warning.code === 'storage-capacity' || warning.code === 'storage-write') return false;
      if (rec.geoError && warning.action === 'retry-location') return false;
      return true;
    }) : [];
  }
  function renderQualityWarnings() {
    const warnings = activeQualityWarnings();
    warnings.sort((a, b) => (a.severity === 'critical' ? -1 : 1) - (b.severity === 'critical' ? -1 : 1));
    qualityWarningKey = warnings.map((warning) => warning.code).join(',');
    for (const warning of warnings.slice(0, 2)) {
      const banner = geoBanner(t(warning.messageKey, warning.params), qualityWarningAction(warning), qualityWarningLabel(warning));
      banner.classList.toggle('critical', warning.severity === 'critical');
      bannerBox.append(banner);
    }
  }
  function renderBanners() {
    bannerBox.innerHTML = '';
    if (readOnly) {
      bannerBox.append(el('div', { class: 'debug-banner' }, t('record.tabLocked')));
    }
    if (rec.saveState.error) {
      bannerBox.append(geoBanner(
        rec.saveState.degraded
          ? t('record.saveDegraded', { n: rec.saveState.pending })
          : t('record.saveFailed', { n: rec.saveState.pending }),
        rec.saveState.error === 'finalize' ? () => { void onStop(); } : () => { void retrySave(); },
        rec.saveState.error === 'finalize' ? t('record.stopRetry') : t('record.saveRetry')
      ));
    }
    if (rec.permissionDenied && rec.status !== 'recording') {
      bannerBox.append(geoBanner(t('record.permissionDenied'), rec.status === 'paused' ? () => resumeRecording() : onStart));
    } else if (rec.geoError && (rec.status === 'recording' || rec.status === 'idle')) {
      bannerBox.append(geoBanner(geoErrorMsg(rec.geoError), rec.status === 'idle' ? onStart : retryGeolocation));
    } else if (rec.geoError && rec.status === 'paused' && !rec.permissionDenied) {
      bannerBox.append(geoBanner(geoErrorMsg(rec.geoError), () => resumeRecording()));
    }
    renderQualityWarnings();
    if (recoverable && rec.status === 'idle') {
      bannerBox.append(el('div', { class: 'card', style: { pointerEvents: 'auto', display: 'flex', gap: '8px', alignItems: 'center', padding: '10px 12px' } },
        el('span', { class: 'grow small' }, `⏸ ${recoverable.name || t('record.newTripName')}`),
        el('button', { class: 'btn sm primary', onclick: async () => {
          const ok = await continueTrip(recoverable.id);
          if (ok) { recoverable = null; map.startLive(); map.setFollow(true); renderBanners(); renderButtons(); }
        } }, t('trips.continueRec')),
        el('button', { class: 'btn sm', onclick: async () => {
          await updateTrip(recoverable.id, { status: 'finished' });
          await setActiveTrip(recoverable.id);
          recoverable = null;
          renderBanners();
        } }, t('record.stop'))
      ));
    }
  }

  // ---------- power-save lock: dim dashboard + hold-to-unlock ----------
  const ps = el('div', { id: 'oled-dash', 'aria-hidden': 'true' });
  function enterOledTheme() {
    if (oledThemeActive) return;
    oledThemeActive = true;
    setThemeModeOverride('dark');
    setThemeColorOverride('#000000');
  }
  function leaveOledTheme() {
    if (!oledThemeActive) return;
    oledThemeActive = false;
    setThemeColorOverride(null);
    setThemeModeOverride(null);
  }
  const psTop = el('div', { class: 'od-top' });
  const psWeather = el('div', { class: 'od-weather', hidden: true });
  const odGrid = el('div', { class: 'od-grid' });
  const psBottom = el('div', { class: 'od-bottom' });
  const OLED_BRIGHTNESS_MIN = 35;
  const clampOledBrightness = (value) => Math.max(OLED_BRIGHTNESS_MIN, Math.min(100, Math.round(Number(value) || 70)));
  const mixOledColor = (from: string, to: string, amount: number) => {
    const channels = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    const a = channels(from), b = channels(to);
    return `rgb(${a.map((value, index) => Math.round(value + (b[index] - value) * amount)).join(',')})`;
  };
  let oledBrightnessFrame = 0;
  const oledBrightnessInput = el('input', {
    id: 'oled-brightness', type: 'range', min: OLED_BRIGHTNESS_MIN, max: 100, step: 1,
    value: clampOledBrightness(get('oledBrightness')), 'aria-label': t('record.oledBrightness')
  });
  const oledBrightnessValue = el('output', { class: 'ps-brightness-value', for: 'oled-brightness' }, '70%');
  const psBrightness = el('div', { class: 'ps-brightness', title: t('record.oledBrightnessHint') },
    el('label', { class: 'ps-brightness-label', for: 'oled-brightness' }, t('record.oledBrightness')),
    oledBrightnessInput,
    oledBrightnessValue);
  function applyOledBrightness(value = get('oledBrightness')) {
    const brightness = clampOledBrightness(value);
    const amount = (brightness - OLED_BRIGHTNESS_MIN) / (100 - OLED_BRIGHTNESS_MIN);
    ps.style.setProperty('--oled-primary', mixOledColor('#8d8d8d', '#ffffff', amount));
    ps.style.setProperty('--oled-secondary', mixOledColor('#6f6f6f', '#bbbbbb', amount));
    ps.style.setProperty('--oled-muted', mixOledColor('#525252', '#888888', amount));
    ps.style.setProperty('--oled-accent', mixOledColor('#176c58', '#2bcda7', amount));
    ps.style.setProperty('--oled-track', mixOledColor('#2b2b2b', '#4a4a4a', amount));
    oledBrightnessInput.value = String(brightness);
    oledBrightnessValue.textContent = `${brightness}%`;
    oledBrightnessInput.setAttribute('aria-valuetext', `${brightness}%`);
  }
  oledBrightnessInput.addEventListener('input', () => {
    oledBrightnessValue.textContent = `${clampOledBrightness(oledBrightnessInput.value)}%`;
    if (oledBrightnessFrame) return;
    oledBrightnessFrame = requestAnimationFrame(() => {
      oledBrightnessFrame = 0;
      const brightness = clampOledBrightness(oledBrightnessInput.value);
      applyOledBrightness(brightness);
      set('oledBrightness', brightness);
    });
  });
  on('settings:changed', ({ key }) => { if (key === 'oledBrightness') applyOledBrightness(); });
  applyOledBrightness();
  const unlockStatus = el('div', { class: 'ps-lock-status' }, t('record.lockPassive'));
  function odCell(key, hero = false) {
    const num = el('span', { class: 'num' }, '--');
    const unit = el('small', {});
    const c = el('div', { class: 'od-cell' + (hero ? ' hero' : '') }, el('div', { class: 'v' }, num, unit), el('div', { class: 'k' }, t(key)));
    odGrid.append(c);
    return { num, unit };
  }
  const odDist = odCell('panel.distance', true);
  const odDur = odCell('panel.duration');
  const odSig = odCell('panel.signal');
  const odSpeed = odCell('panel.speed');
  const odAlt = odCell('panel.altitude');
  const odAsc = odCell('panel.ascent');
  const odDesc = odCell('panel.descent');
  const oledSignal = createSignal(odSig.num.parentElement);
  psBottom.innerHTML = `
    <div class="ps-actions">
      <div class="ps-primary-actions">
        <div class="ps-act">
          <button type="button" class="ps-ring ps-unlock" aria-label="${t('record.lockHint')}">
            <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
              <circle class="bgc" cx="52" cy="52" r="46" fill="none" stroke-width="6"/>
              <circle class="fgc" cx="52" cy="52" r="46" fill="none" stroke-width="6" stroke-linecap="round"/>
            </svg>
            <span class="ps-lock"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="2" fill="none"/></svg></span>
          </button>
          <div class="ps-hint">${t('record.lockHint')}</div>
        </div>
      </div>
    </div>
    <div class="ps-sub">${t('record.lockSub')}</div>`;
  const psSosAct = el('div', { class: 'ps-act ps-sos-act' });
  const psSosRing = el('button', {
    type: 'button', class: 'ps-ring ps-sos', 'data-oled-action': 'sos',
    'aria-label': t('record.safetySosHold'), title: t('record.safetySosHold'), disabled: true
  },
  el('span', {
    html: '<svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true"><circle class="bgc" cx="52" cy="52" r="46" fill="none" stroke-width="6"/><circle class="fgc" cx="52" cy="52" r="46" fill="none" stroke-width="6" stroke-linecap="round"/></svg>'
  }),
  el('span', { class: 'ps-lock' }, icon('shield', 26)));
  psSosAct.append(psSosRing, el('div', { class: 'ps-hint' }, t('record.safetySosHold')));
  const psSosFg = psSosRing.querySelector('.fgc') as SVGCircleElement;
  psBottom.querySelector('.ps-primary-actions').append(psSosAct);
  function updatePsSafety() {
    const available = loadSafetySettings().enabled;
    const primary = psBottom.querySelector('.ps-primary-actions')!;
    if (available && !psSosAct.isConnected) primary.append(psSosAct);
    if (!available) psSosAct.remove();
    psSosRing.disabled = !available;
  }
  on('safety:settings-changed', updatePsSafety);
  updatePsSafety();
  const psCamAct = el('div', { class: 'ps-act ps-cam-act', hidden: true });
  psCamAct.innerHTML = `
    <div class="ps-cam-track" role="button" aria-label="${t('record.camSwipe')}" title="${t('record.camSwipeHint')}">
      <span class="ps-cam-arrow">‹</span>
      <span class="ps-cam-knob">
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4V8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/><circle cx="12" cy="13" r="3.4" stroke="currentColor" stroke-width="2" fill="none"/></svg>
      </span>
    </div>
    <div class="ps-hint">${t('record.camSwipe')}</div>`;
  psBottom.querySelector('.ps-actions').append(psCamAct);
  psBottom.querySelector('.ps-actions').prepend(unlockStatus);
  ps.append(psTop, psWeather, psBrightness, odGrid, psBottom);
  document.body.append(ps);

  function renderPsTop() {
    psTop.innerHTML = '';
    psTop.append(
      el('span', { class: `rec-dot ${rec.status}` }),
      el('span', {}, t(`record.${rec.status === 'recording' ? 'statusRecording' : rec.status === 'paused' ? 'statusPaused' : 'statusIdle'}`)),
      el('span', { class: 'grow' }),
      el('span', { class: 'ps-mode' }, icon('powerlock', 15), t('record.powerLock'))
    );
  }

  function renderOledWeather() {
    const current = weatherState.current;
    if (!psActive || !get('weatherEnabled') || !current) {
      psWeather.hidden = true;
      return;
    }
    const alert = get('weatherAlertEnabled') ? primaryWeatherAlert(current.alerts) : null;
    psWeather.hidden = false;
    psWeather.className = `od-weather${alert ? ` alert ${alert.level}` : ''}`;
    psWeather.innerHTML = '';
    if (alert) {
      const label = `${t(`weather.levels.${alert.level}`)} · ${t(`weather.alerts.${alert.kind}`)}${alert.forecast ? ` · ${t('weather.forecast')}` : ''}`;
      const detail = alert.message || `${alert.official ? t('weather.official') : t('weather.risk')} · ${current.source}`;
      psWeather.append(
        el('span', { class: 'od-weather-icon' }, '⚠'),
        el('div', { class: 'od-weather-copy' }, el('strong', {}, label), el('small', {}, detail))
      );
      psWeather.setAttribute('role', 'alert');
      psWeather.setAttribute('aria-live', 'assertive');
    } else {
      const temp = current.summary.temp;
      const shownTemp = temp != null ? Math.round(get('units') === 'imperial' ? temp * 9 / 5 + 32 : temp) : null;
      const condition = current.summary.condition?.trim() || t(`story.codes.${weatherCodeKey(current.summary.code)}`);
      psWeather.append(
        el('span', { class: 'od-weather-icon' }, weatherIcon(current.summary.code)),
        el('div', { class: 'od-weather-copy' },
          el('strong', {}, `${condition}${shownTemp != null ? ` · ${shownTemp}°` : ''}`),
          el('small', {}, `${current.source} · ${t(current.cached ? 'weather.cached' : 'weather.updated', { time: new Date(current.fetchedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })}`))
      );
      psWeather.setAttribute('role', 'status');
      psWeather.setAttribute('aria-live', 'polite');
    }
  }
  on('weather:changed', renderOledWeather);
  on('weather:alert', renderOledWeather);

  const unlockRing = psBottom.querySelector('.ps-unlock') as HTMLElement;
  const unlockFg = psBottom.querySelector('.ps-unlock .fgc') as SVGCircleElement;
  const psSub = psBottom.querySelector('.ps-sub') as HTMLElement;
  function updatePsSub() {
    psSub.textContent = isKeepAliveActive()
      ? `${t('record.lockSub')} · ${t('record.keepAliveOn')}`
      : t('record.lockSub');
  }
  const RING_C = 2 * Math.PI * 46;
  function bindHold(ringEl, fgEl, duration, onDone) {
    let start = 0;
    let raf = 0;
    function reset() {
      start = 0;
      ringEl.classList.remove('holding');
      cancelAnimationFrame(raf);
      raf = 0;
      fgEl.style.strokeDashoffset = String(RING_C);
    }
    function loop(ts) {
      if (!start) return;
      const p = Math.min(1, (ts - start) / duration);
      fgEl.style.strokeDashoffset = String(RING_C * (1 - p));
      if (p >= 1) { reset(); onDone(); return; }
      raf = requestAnimationFrame(loop);
    }
    ringEl.addEventListener('pointerdown', (e) => {
      if (!psActive) return;
      e.preventDefault();
      e.stopPropagation();
      reset();
      try { ringEl.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      ringEl.classList.add('holding');
      start = performance.now();
      raf = requestAnimationFrame(loop);
    });
    ringEl.addEventListener('pointerup', reset);
    ringEl.addEventListener('pointercancel', reset);
    ringEl.addEventListener('pointerleave', reset);
  }
  const unlockPowerLock = () => {
    if (!psActive) return;
    void setPowerLock(false).catch((e) => {
      console.error('power lock exit failed', e);
      toast(t('common.unavailable'), 'err', 4200);
    });
  };
  bindHold(unlockRing, unlockFg, 1500, unlockPowerLock);
  unlockRing.addEventListener('click', (e) => {
    if (e.detail === 0) unlockPowerLock();
  });
  bindHold(psSosRing, psSosFg, 2000, () => { void sendSafetyNow('sos'); });
  psSosRing.addEventListener('click', (e) => {
    if (e.detail === 0) openSafetyCheckIn('sos');
  });
  ps.addEventListener('contextmenu', (e) => e.preventDefault());

  function updatePsCamera() {
    psCamAct.hidden = !(rec.status === 'recording' || rec.status === 'paused');
  }

  const psCamTrack = psCamAct.querySelector('.ps-cam-track') as HTMLElement;
  let camGesture: { startX: number; startY: number; ready: boolean; invalid: boolean; target: number; current: number; raf: number } | null = null;
  const setCamProgress = (value: number) => {
    psCamTrack.style.setProperty('--cam-progress', String(Math.max(0, Math.min(1, value))));
  };
  function animateCam() {
    if (!camGesture) return;
    const delta = camGesture.target - camGesture.current;
    camGesture.current += delta * (Math.abs(delta) < 0.02 ? 0.55 : 0.34);
    if (Math.abs(camGesture.target - camGesture.current) < 0.004) camGesture.current = camGesture.target;
    setCamProgress(camGesture.current);
    camGesture.raf = camGesture.current !== camGesture.target ? requestAnimationFrame(animateCam) : 0;
  }
  const resetCamGesture = () => {
    if (!camGesture) return;
    cancelAnimationFrame(camGesture.raf);
    camGesture = null;
    psCamTrack.classList.remove('dragging', 'ready');
    setCamProgress(0);
  };
  psCamTrack.addEventListener('pointerdown', (e) => {
    if (!psActive || psCamAct.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    try { psCamTrack.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    resetCamGesture();
    psCamTrack.classList.add('dragging');
    camGesture = { startX: e.clientX, startY: e.clientY, ready: false, invalid: false, target: 0, current: 0, raf: 0 };
    setCamProgress(0);
  });
  psCamTrack.addEventListener('pointermove', (e) => {
    if (!camGesture) return;
    e.preventDefault();
    const dx = e.clientX - camGesture.startX;
    const dy = e.clientY - camGesture.startY;
    if (Math.abs(dy) > Math.abs(dx) + 18) camGesture.invalid = true;
    camGesture.ready = dx <= -120 && Math.abs(dy) <= 90 && !camGesture.invalid;
    camGesture.target = Math.max(0, Math.min(1, -dx / 120));
    psCamTrack.classList.toggle('ready', camGesture.ready);
    if (!camGesture.raf) camGesture.raf = requestAnimationFrame(animateCam);
  });
  const endCamGesture = (e) => {
    if (!camGesture) return;
    const fire = e.type === 'pointerup' && camGesture.ready;
    resetCamGesture();
    if (fire) openOledCamera();
  };
  psCamTrack.addEventListener('pointerup', endCamGesture);
  psCamTrack.addEventListener('pointercancel', resetCamGesture);
  psCamTrack.addEventListener('lostpointercapture', resetCamGesture);

  function renderOled(L) {
    if (!L || !psActive) return;
    const units = get('units');
    const d = fmtDistance(L.distance, units);
    odDist.num.textContent = d.v;
    odDist.unit.textContent = d.u;
    odDur.num.textContent = fmtDuration(L.duration);
    odDur.unit.textContent = '';
    if (speedMode() === 'pace') {
      const p = fmtPace(L.speed, units);
      odSpeed.num.textContent = p.v;
      odSpeed.unit.textContent = p.u;
    } else {
      const s = fmtSpeed(L.speed, units);
      odSpeed.num.textContent = s.v;
      odSpeed.unit.textContent = s.u;
    }
    const a = fmtAltitude(L.alt, units);
    odAlt.num.textContent = a.v;
    odAlt.unit.textContent = a.u;
    odAsc.num.textContent = String(Math.round(L.ascent));
    odAsc.unit.textContent = 'm';
    odDesc.num.textContent = String(Math.round(L.descent));
    odDesc.unit.textContent = 'm';
    renderSignal(oledSignal, L.acc);
  }

  async function setPowerLock(on, options: { guardUnlockClick?: boolean } = {}) {
    if (on) {
      if (!canEnterPowerLock()) {
        toast(t('record.lockUnavailable'), 'warn');
        return false;
      }
      if (psActive) return true;
      if (powerLockBusy || powerLockExitPromise) return false;
      powerLockBusy = true;
      try {
        const target = map;
        if (!target || target.destroyed) {
          toast(t('record.lockUnavailable'), 'warn');
          return false;
        }
        // Dark palette is applied before the black overlay so the transition reads
        // as a theme switch, not an abrupt flash; the CSS fade reveals it underneath.
        enterOledTheme();
        target.pauseRendering();
        mapContainer.style.display = 'none';
        psActive = true;
        document.documentElement.classList.add('oled-lock');
        ps.setAttribute('aria-hidden', 'false');
        ps.classList.add('active');
        pushUIState({ type: 'oled' });
        requestWakeLock();
        applyOledBrightness();
        renderPsTop();
        updatePsCamera();
        updatePsSafety();
        if (rec.live?.lat != null && rec.live?.lon != null) {
          updateWeatherLocation(rec.live.lat, rec.live.lon, { force: true, probe: !weatherState.ranking });
        } else if (weatherState.location) {
          void refreshWeather({ force: true, probe: !weatherState.ranking });
        } else {
          locateOnce();
        }
        renderOledWeather();
        renderOled(rec.live);
        updatePsSub();
        setTimeout(() => { if (psActive) updatePsSub(); }, 1200);
        return true;
      } finally {
        powerLockBusy = false;
        syncPowerLockEntry();
      }
    }

    if (!psActive && !powerLockExitPromise) return true;
    if (powerLockExitPromise) return powerLockExitPromise;
    const exit = (async () => {
      // A finger still on the glass can synthesize a click on whatever sits under
      // the ring after the overlay disappears; swallow that lift click, however
      // long the user keeps holding. Programmatic OLED stop must not consume the
      // first tap on the result sheet.
      if (options.guardUnlockClick !== false) armUnlockGuard();
      psActive = false;
      // Restore the saved theme first, then fade the overlay to reveal it.
      leaveOledTheme();
      document.documentElement.classList.remove('oled-lock');
      ps.setAttribute('aria-hidden', 'true');
      ps.classList.remove('active');
      const state = currentUIState();
      if (state?.type === 'oled') backFromUIState(state.id);
      if (rec.status !== 'recording') releaseWakeLock();
      mapContainer.style.display = '';
      const target = map;
      if (target && !target.destroyed) target.resumeRendering();
      return !!target && !target.destroyed;
    })().catch((e) => {
      console.error('power lock restore failed', e);
      throw e;
    }).finally(() => {
      powerLockExitPromise = null;
      syncPowerLockEntry();
    });
    powerLockExitPromise = exit;
    return exit;
  }

  // ---------- recorder events ----------
  on('recorder:started', async ({ simulated }) => {
    leaveEditMode();
    viewingTripEditable = false;
    viewingTrip = null;
    renderViewBar();
    map?.startLive();
    map?.setFollow(true);
    followBtn.classList.add('active');
    liveActivity = (await getTrip(rec.tripId))?.activity || get('activity');
    renderButtons();
    renderBanners();
    renderPanel(rec.live);
    if (!simulated) toast(t('record.bgHint'), 'info', 6000);
  });
  on('recorder:paused', () => {
    if (psActive) void requestWakeLock();
    renderButtons(); renderBanners();
  });
  on('recorder:resumed', async () => {
    liveActivity = (await getTrip(rec.tripId))?.activity || get('activity');
    renderButtons(); renderBanners(); renderPanel(rec.live);
  });
  on('recorder:stopped', () => {
    if (psActive) void requestWakeLock();
    clearLivePanel(); renderButtons(); renderBanners();
  });
  on('recorder:busy', () => { readOnly = true; renderBanners(); toast(t('record.tabLocked'), 'warn', 4000); });
  const offBroadcast = onBroadcast((msg) => {
    if (msg.type === 'rec-state') {
      const other = msg.state === 'recording' || msg.state === 'paused';
      if (other !== readOnly) { readOnly = other; renderBanners(); }
    } else if (msg.type === 'rec-released' && readOnly) {
      readOnly = false;
      renderBanners();
    }
  });
  on('recorder:denied', () => { renderBanners(); renderButtons(); toast(t('record.permissionDenied'), 'warn', 5000); });
  on('recorder:geoerror', ({ code }) => {
    renderBanners();
    renderStatus();
    if (code && code !== 'denied') toast(geoErrorMsg(code), 'warn', 4500);
  });
  on('recorder:background', ({ gapMs }) => {
    toast(t('record.bgReturn', { s: Math.round(gapMs / 1000) }), 'warn', 6000);
  });
  on('recorder:point', ({ point, live }) => {
    if (map && !psActive) map.appendLive(point, rec.segmentId);
    renderPanel(live);
    renderOled(live);
    if (live.pointCount === 1 && !rec.simulated) { renderStatus(); toast(t('record.firstFix'), 'ok', 2500); }
  });
  on('recorder:tick', ({ live }) => {
    renderPanel(live);
    renderOled(live);
    const warningKey = activeQualityWarnings().map((warning) => warning.code).join(',');
    if (warningKey !== qualityWarningKey) renderBanners();
  });
  on('recorder:quality', () => {
    renderQualityPanel();
    renderBanners();
  });
  on('recorder:saved', () => { renderSaveChip(); renderBanners(); });
  on('recorder:persistence', () => { renderSaveChip(); });
  on('recorder:saveerror', () => { renderSaveChip(); renderBanners(); });
  on('recorder:starterror', () => { renderButtons(); renderBanners(); });
  on('recorder:filtered', ({ count }) => {
    if (count === 1 || count % 10 === 0) toast(t('record.invalidPoint', { n: count }), 'warn', 2000);
  });

  // ---------- active trip display ----------
  on('trip:active', (full) => {
    if (!map || psActive) return;
    if (rec.status === 'recording' || rec.status === 'paused') return;
    if (!full) {
      leaveEditMode();
      viewingTripEditable = false;
      viewingTrip = null;
      renderViewBar();
      map.setTrackData([], []);
      return;
    }
    // Library map views allow editing; routine refreshes only redraw.
    if (appState.showTripInRecord) {
      leaveEditMode();
      clearHistory();
      appState.showTripInRecord = false;
      viewingTripEditable = true;
      viewingTrip = full;
      map.setTrackData(full.segments, full.waypoints);
      renderViewBar();
      return;
    }
    if (viewingTripEditable && viewingTrip?.trip.id === full.trip.id) {
      viewingTrip = full;
      map.setTrackData(full.segments, full.waypoints);
      renderViewBar();
    }
  });
  on('activity:classification', () => renderAutoTag());
  on('activity:guess', ({ activity }) => {
    renderAutoTag();
    toast(t('record.autoDetected', { a: t(`record.activities.${activity}`) }), 'info', 2500);
  });
  on('settings:changed', ({ key, keys }) => {
    if (key === 'activity' || keys?.includes('activity')) {
      activitySel.value = get('activity');
      renderAutoTag();
    }
  });

  // keyboard shortcuts
  function onKeydown(e) {
    if (e.repeat || e.isComposing || e.defaultPrevented || appState.view !== 'record' || hasOpenOverlay()) return;
    const target = e.target;
    if (target instanceof Element && target.closest(
      'input, textarea, select, button, a, label, summary, [contenteditable]:not([contenteditable="false"]), '
      + '[role="button"], [role="link"], [role="menuitem"], [role="option"], [role="checkbox"], '
      + '[role="radio"], [role="switch"], [role="tab"], [tabindex]:not([tabindex="-1"])'
    )) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && appState.editMode && canEditMap()) {
      e.preventDefault();
      if (e.shiftKey) redoEdit(recEditOpts());
      else undoEdit(recEditOpts());
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      if (rec.status === 'recording') runRecAction(pauseRecording());
      else if (rec.status === 'paused') runRecAction(resumeRecording());
    }
  }
  document.addEventListener('keydown', onKeydown);

  // ---------- init ----------
  (async () => {
    // proactive permission state: banner before the user even taps start
    if (navigator.permissions?.query) {
      try {
        const st = await navigator.permissions.query({ name: 'geolocation' });
        rec.permissionDenied = st.state === 'denied';
        st.onchange = () => {
          rec.permissionDenied = st.state === 'denied';
          if (!rec.permissionDenied && rec.geoError === 'denied') rec.geoError = null;
          renderBanners();
        };
      } catch { /* query unsupported */ }
    }
    // rebuilt while a recording is active (e.g. language switch): reattach to live trip
    if (rec.tripId && (rec.status === 'recording' || rec.status === 'paused')) {
      liveActivity = (await getTrip(rec.tripId))?.activity || get('activity');
      const preview = await loadTripPreview(rec.tripId);
      if (preview) {
        map.setTrackData(preview.segments, preview.waypoints);
        map.liveMode = true;
        map._liveFeats = new Map();
        const last = preview.segments[preview.segments.length - 1]?.points.slice(-1)[0];
        if (last) {
          map.updatePosition(last.lat, last.lon, last.acc, null);
          updateWeatherLocation(last.lat, last.lon);
          map.fitTrack();
        }
      }
      renderButtons();
      renderBanners();
      renderPanel(rec.live);
      return;
    }
    recoverable = await findRecoverableTrip();
    renderBanners();
    renderButtons();
    renderRewalk();
    if (rewalk.active) {
      const preview = await loadTripPreview(rewalk.tripId);
      if (preview) { map.setTrackData(preview.segments, preview.waypoints); setTimeout(() => map.fitTrack(), 600); }
      return;
    }
    if (appState.showTripInRecord && appState.activeTripFull) {
      leaveEditMode();
      clearHistory();
      appState.showTripInRecord = false;
      const full = appState.activeTripFull;
      viewingTripEditable = true;
      viewingTrip = full;
      map.setTrackData(full.segments, full.waypoints);
      renderViewBar();
      setTimeout(() => map.fitTrack(), 600);
    } else if (recoverable) {
      const preview = await loadTripPreview(recoverable.id);
      if (preview) setTimeout(() => { viewingTripEditable = false; viewingTrip = preview; map.setTrackData(preview.segments, preview.waypoints); map.fitTrack(); renderViewBar(); }, 600);
    } else if (rec.status === 'idle' || rec.status === 'finished') {
      locateOnce();
    }
  })();

  // iOS PWAs often resume from suspension instead of reloading — locate on return,
  // but never yank the map away from a trip/re-walk the user is looking at.
  function onVisibility() {
    if (document.visibilityState !== 'visible') return;
    if (viewingTrip || recoverable || rewalk.active) return;
    if (map?.posMarker || !(rec.status === 'idle' || rec.status === 'finished')) return;
    locateOnce();
  }
  document.addEventListener('visibilitychange', onVisibility);

  return {
    view,
    getMap: () => map,
    isPowerLockActive: () => psActive,
    resize: () => { map?.resize(); renderMapLayer(); },
    refresh: () => { renderButtons(); renderBanners(); renderViewBar(); renderRewalk(); },
    focus: (intent) => {
      if (!intent || (intent.tripId && intent.tripId !== appState.activeTripId)) return;
      requestAnimationFrame(() => {
        if (intent.tripId && intent.tripId !== appState.activeTripId) return;
        if (intent.fit && map && !psActive && !map.destroyed) map.fitTrack();
        if (intent.anchor) document.querySelector(`[data-anchor="${intent.anchor}"]`)?.scrollIntoView({ block: 'center' });
      });
    },
    destroy: () => {
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('click', swallowUnlockGhostClick, true);
      document.removeEventListener('pointerdown', clearUnlockGuard, true);
      document.removeEventListener('pointerup', releaseUnlockGuard, true);
      document.removeEventListener('pointercancel', releaseUnlockGuard, true);
      clearTimeout(unlockReleaseTimer);
      offBroadcast();
      if (resultSheet) {
        resultSheet.closed = true;
        resultSheet.node.remove();
        removeOverlayState(resultSheet.historyId);
        resultSheet = null;
      }
      leaveOledTheme();
      document.documentElement.classList.remove('oled-lock');
      if (psActive) {
        if (rec.status !== 'recording') releaseWakeLock();
      }
      map?.destroy();
      map = null;
      ps.remove();
    }
  };
}