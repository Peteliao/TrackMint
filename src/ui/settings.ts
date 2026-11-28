// Settings view: region (dual-profile) control, language/units/theme, recording prefs,
// BYOK advanced sources, debug simulation switches, storage & data management.
import { t } from '../core/i18n';
import { get, set, patch, resetSettings, MEET_P2P_NOTICE_VERSION } from '../core/settings';
import { meet } from '../core/meet';
import { on } from '../core/events';
import { regionState, setRegionMode, runProbe, simulationModeLabel } from '../core/region';
import { storageEstimate, requestStoragePersistence, eraseAll, listTrips, TRIP_SCHEMA_VERSION,
  listQuarantinedRows, restoreQuarantinedRows, discardQuarantinedRows } from '../core/store';
import { inspectStorageHealth, previewMediaCleanup, executeMediaCleanup } from '../core/storageHealth';
import { runRestoreDrill, type RestoreDrillProgress, type RestoreDrillResult } from '../core/restoreDrill';
import { appState, setActiveTrip } from './state';
import { triggerDownload } from '../core/gpx';
import { exportDiagLog } from '../core/diag';
import { exportBackupFlow, restoreBackupFlow, lastBackupLabel, backupDue } from './backupFlow';
import { appendBackupHistory, clearBackupHistory, listBackupHistory } from '../core/backupHistory';
import { startPlayback, stopPlayback, isPlaying } from '../core/simulator';
import { setLanguage, currentLang } from '../core/i18n';
import { languageTag } from '../core/language';
import { generatePromo, nextVariant, PROMO_VARIANT_COUNT, promoVariantLabel } from '../core/promo';
import { setRewalkVoice } from '../core/rewalk';
import { APP_VERSION } from '../core/version';
import { THEME_OPTIONS } from '../core/themeRegistry';
import { exportImage } from '../core/shareEnv';
import { createSyncPanel } from './syncPanel';
import { eraseSyncState } from '../core/syncStore';
import { openInstallGuide, installSettingsInfo } from './install';
import { refreshWeather, weatherState } from '../core/weatherService';
import { defaultSafetySettings, saveSafetySettings, SAFETY_STORAGE_KEY } from '../core/safety';
import { resetLastGasp } from '../core/safetyMonitor';
import { createSafetySettingsCard } from './safetySettings';
import { el, icon, toast, confirmModal, filePicker, modal } from './helpers';

export function createSettingsView(navigate) {
  const view = el('div', { class: 'view', id: 'view-settings' });
  const scroll = el('div', { class: 'view-scroll' });
  view.append(scroll);

  function section(label) {
    return el('div', { class: 'section-label' }, label);
  }
  function panel(...rows) {
    return el('div', { class: 'card' }, ...rows);
  }
  function card(iconKey, title, ...rows) {
    return el('div', { class: 'card' }, el('h3', {}, icon(iconKey, 18), title), ...rows);
  }
  function collapsible(title, ...rows) {
    const details = el('details', { class: 'settings-collapse' },
      el('summary', {}, icon('chevronRight', 14), title),
      el('div', { class: 'settings-collapse-body' }, ...rows));
    return { details, open: () => { details.open = true; } };
  }
  function segRow(label, options, current, onPick, note = '', className = '') {
    const toggle = el('div', { class: `seg-toggle${className ? ` ${className}` : ''}` });
    for (const [val, txt] of options) {
      const b = el('button', { class: val === current ? 'active' : '', 'data-value': val }, txt);
      b.onclick = () => {
        toggle.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        onPick(val);
      };
      toggle.append(b);
    }
    return el('div', { class: 'setting-row stack', style: { flexWrap: 'wrap' } },
      el('div', { class: 'txt' }, el('div', { class: 't' }, label), note ? el('div', { class: 'd' }, note) : null), toggle);
  }
  function switchRow(label, desc, key, onChange = null) {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!get(key);
    cb.onchange = () => { set(key, cb.checked); onChange?.(cb.checked); };
    return el('div', { class: 'setting-row' },
      el('div', { class: 'txt' }, el('div', { class: 't' }, label), desc ? el('div', { class: 'd' }, desc) : null),
      el('label', { class: 'switch' }, cb, el('span', { class: 'slider' })));
  }
  function numRow(label, desc, key, { min = 0, max = 10000, step = 1, unit = '' } = {}) {
    const inp = el('input', { type: 'number', min, max, step, value: get(key), style: { width: '90px' } });
    inp.onchange = () => set(key, Math.max(min, Math.min(max, +inp.value || min)));
    return el('div', { class: 'setting-row' },
      el('div', { class: 'txt' }, el('div', { class: 't' }, label + (unit ? ` (${unit})` : '')), desc ? el('div', { class: 'd' }, desc) : null), inp);
  }
  function textRow(label, hint, key, placeholder = '', type = 'text', savedMessage = t('settings.keySaved')) {
    const inp = el('input', { type, value: get(key) || '', placeholder });
    inp.onchange = () => { set(key, inp.value.trim()); toast(savedMessage, 'ok', 1800); };
    return el('div', { class: 'field' }, el('label', {}, label), inp, hint ? el('div', { class: 'hint' }, hint) : null);
  }
  function textAreaRow(label, hint, key, placeholder = '', savedMessage = t('settings.keySaved')) {
    const inp = el('textarea', { rows: '3', placeholder, spellcheck: 'false' });
    inp.value = get(key) || '';
    inp.onchange = () => { set(key, inp.value.trim()); toast(savedMessage, 'ok', 1800); };
    return el('div', { class: 'field' }, el('label', {}, label), inp, hint ? el('div', { class: 'hint' }, hint) : null);
  }

  // ---- region ----
  const probeTable = el('table', { class: 'probe-table' });
  const regionNote = el('div', { class: 'small faint', style: { marginTop: '8px' } });
  function renderProbe() {
    const s = regionState;
    probeTable.innerHTML = '';
    const row = (name, st, ms) => el('tr', {},
      el('td', {}, name),
      el('td', { class: st === 'ok' ? 'ok' : st === 'fail' ? 'bad' : 'pending' },
        st === 'ok' ? '● ' + t('region.probeOk') : st === 'fail' ? '● ' + t('region.probeFail') : '○ ' + t('region.probePending')),
      el('td', { class: 'mono faint' }, ms != null ? `${ms}ms` : ''));
    probeTable.append(
      el('tr', { class: 'faint' }, el('td', {}, t('region.probeTitle')), el('td', {}, ''), el('td', {}, '')),
      row(t('region.cn'), s.probe.cn, s.probe.cnMs),
      row(t('region.global'), s.probe.global, s.probe.globalMs),
      el('tr', {}, el('td', { class: 'faint' }, t('region.syncJudge')), el('td', { colspan: 2, class: 'faint' }, s.syncGuess === 'cn' ? t('region.cn') : t('region.global')))
    );
    regionNote.textContent = s.simulated
      ? t('region.simActive', { mode: simulationModeLabel(s.simulated) })
      : t('region.coordNote');
  }
  renderProbe();
  on('region:probed', renderProbe);
  on('region:changed', renderProbe);
  on('region:probing', renderProbe);

  const reprobeBtn = el('button', { class: 'btn sm' }, '↻ ' + t('region.reprobe'));
  reprobeBtn.onclick = async () => {
    reprobeBtn.disabled = true;
    reprobeBtn.textContent = t('region.probing') + '…';
    await runProbe();
    renderProbe();
    reprobeBtn.disabled = false;
    reprobeBtn.textContent = '↻ ' + t('region.reprobe');
  };

  const regionCard = card('map', t('settings.region'),
    segRow(t('region.title'), [
      ['auto', t('region.modeAuto')], ['cn', t('region.modeCn')], ['global', t('region.modeGlobal')]
    ], get('regionMode'), (v) => { setRegionMode(v); renderProbe(); }, t('region.switchHint')),
    probeTable,
    el('div', { class: 'row', style: { marginTop: '8px' } }, reprobeBtn),
    regionNote
  );

  // ---- appearance ----
  const langCard = panel(
    segRow(t('settings.language'), [
      ['auto', t('settings.langAuto')], ['zh', t('settings.langZh')], ['en', t('settings.langEn')],
      ['zh-TW', t('settings.langZhTw')], ['ja', t('settings.langJa')],
      ['ko', t('settings.langKo')], ['es', t('settings.langEs')]
    ], get('language'), (v) => setLanguage(v), t('settings.langNote')),
    segRow(t('settings.units'), [['metric', t('settings.metric')], ['imperial', t('settings.imperial')]], get('units'), (v) => set('units', v)),
    segRow(t('settings.theme'), THEME_OPTIONS.map((option) => [option.id, t(option.labelKey)]),
      get('theme'), (v) => set('theme', v), t('settings.themeAutoHint'), 'theme-toggle')
  );

  // ---- recording ----
  const voiceToggle = el('input', { type: 'checkbox' });
  voiceToggle.checked = get('rewalkVoice') !== false;
  voiceToggle.onchange = () => setRewalkVoice(voiceToggle.checked);
  on('rewalk:mute', ({ muted }) => { voiceToggle.checked = !muted; });
  const voiceRow = el('div', { class: 'setting-row' },
    el('div', { class: 'txt' },
      el('div', { class: 't' }, t('settings.rewalkVoice')),
      el('div', { class: 'd' }, t('settings.rewalkVoiceHint'))),
    el('label', { class: 'switch' }, voiceToggle, el('span', { class: 'slider' })));
  const recCard = panel(
    segRow(t('settings.activity'), [['auto', t('settings.activityAuto')], ...['hike', 'drive', 'bike', 'run', 'travel'].map((a) => [a, t(`record.activities.${a}`)])], get('activity'), (v) => set('activity', v), t('settings.activityAutoHint')),
    segRow(t('settings.speedDisplay'), [['auto', t('settings.speedAuto')], ['speed', t('settings.speedSpeed')], ['pace', t('settings.speedPace')]], get('speedDisplay'), (v) => set('speedDisplay', v)),
    segRow(t('settings.recordQuality'), [['high', t('settings.qHigh')], ['balanced', t('settings.qBalanced')], ['low', t('settings.qLow')]], get('recordQuality'), (v) => set('recordQuality', v)),
    switchRow(t('settings.wakeLock'), t('settings.wakeLockHint'), 'wakeLock'),
    voiceRow,
    numRow(t('settings.ascentThreshold'), '3–5 m', 'ascentThreshold', { min: 1, max: 20, unit: 'm' }),
    numRow(t('settings.weight'), t('settings.weightHint'), 'weightKg', { min: 30, max: 200, unit: 'kg' }),
    numRow(t('settings.accuracyLimit'), '', 'accuracyLimit', { min: 10, max: 500, unit: 'm' })
  );

  // ---- privacy ----
  const privacyCard = panel(
    numRow(t('settings.privacyRadius'), t('settings.privacyRadiusHint'), 'privacyRadius', { min: 0, max: 5000, step: 50, unit: 'm' })
  );
  const safetyCard = createSafetySettingsCard();

  // ---- weather ----
  let weatherMode = get('weatherProviderMode') || 'auto';
  const weatherFields = el('div', { class: 'weather-settings-fields' });
  const weatherModeNote = el('div', { class: 'small faint', style: { margin: '2px 0 10px' } });
  const weatherStatus = el('div', { class: 'small muted weather-settings-status' });
  const weatherRanking = el('div', { class: 'small faint weather-settings-ranking' });
  const weatherProbeBtn = el('button', { class: 'btn sm' }, icon('refresh', 14), t('settings.weatherProbe'));
  function renderWeatherFields() {
    weatherFields.innerHTML = '';
    weatherFields.hidden = weatherMode !== 'custom';
    const noteKey = weatherMode === 'cn' ? 'weatherCnNote'
      : weatherMode === 'global' ? 'weatherGlobalNote'
        : weatherMode === 'custom' ? 'weatherCustomNote' : 'weatherAutoNote';
    weatherModeNote.textContent = t(`settings.${noteKey}`);
    if (weatherMode !== 'custom') return;
    const saved = t('settings.weatherSaved');
    const url = textRow(t('settings.weatherCustomUrl'), t('settings.weatherCustomUrlHint'), 'weatherCustomUrl', 'https://…/weather?lat={lat}&lon={lon}', 'url', saved);
    const key = textRow(t('settings.weatherCustomKey'), t('settings.weatherCustomKeyHint'), 'weatherCustomKey', '', 'password', saved);
    url.querySelector('input').autocomplete = 'off';
    key.querySelector('input').autocomplete = 'new-password';
    weatherFields.append(
      url, key,
      textAreaRow(t('settings.weatherCustomHeaders'), t('settings.weatherCustomHeadersHint'), 'weatherCustomHeaders', '{"Authorization":"Bearer …"}', saved),
      textAreaRow(t('settings.weatherCustomMapping'), t('settings.weatherCustomMappingHint'), 'weatherCustomMapping', '', saved),
      el('div', { class: 'hint mono' }, t('settings.weatherMappingExample'))
    );
  }
  function renderWeatherStatus() {
    const current = weatherState.current;
    const location = weatherState.location;
    weatherProbeBtn.disabled = weatherState.fetching || !get('weatherEnabled') || !location;
    weatherProbeBtn.textContent = '';
    weatherProbeBtn.append(icon('refresh', 14), weatherState.fetching ? t('settings.weatherProbing') : t('settings.weatherProbe'));
    weatherStatus.textContent = !location ? t('settings.weatherNoLocation')
      : current
        ? `${t('weather.source', { source: current.source })} · ${t(current.cached ? 'weather.cached' : 'weather.latency', { ms: current.latencyMs ?? 0 })}`
        : weatherState.error
          ? weatherState.error === 'weather-offline' ? t('weather.errorOffline')
            : weatherState.error.startsWith('weather-custom') ? t('weather.errorCustom')
              : weatherState.error === 'weather-provider-unconfigured' ? t('weather.errorUnconfigured')
                : t('weather.errorUnavailable')
          : t('weather.unavailable');
    const ranking = weatherState.ranking;
    weatherRanking.textContent = ranking?.results?.length
      ? t('settings.weatherStatus') + ' · ' + ranking.results.map((result) => result.ok
        ? t('weather.probeResult', { source: t(`weather.providers.${result.id}`), ms: result.ms })
        : t('weather.probeFailed', { source: t(`weather.providers.${result.id}`) })).join(' · ')
      : t('weather.noProbe');
    weatherRanking.hidden = !get('weatherEnabled');
  }
  renderWeatherFields();
  renderWeatherStatus();
  weatherProbeBtn.onclick = async () => {
    if (!weatherState.location) return;
    weatherProbeBtn.disabled = true;
    await refreshWeather({ force: true, probe: true });
    renderWeatherStatus();
  };
  const weatherProviderRow = segRow(t('settings.weatherProvider'), [
    ['auto', t('settings.weatherProviderAuto')], ['cn', t('settings.weatherProviderCn')],
    ['global', t('settings.weatherProviderGlobal')], ['custom', t('settings.weatherProviderCustom')]
  ], weatherMode, (v) => { weatherMode = v; set('weatherProviderMode', v); renderWeatherFields(); }, t('settings.weatherAutoNote'), 'weather-provider-toggle');
  const weatherCard = card('sun', t('settings.weatherGroup'),
    switchRow(t('settings.weatherEnabled'), t('settings.weatherEnabledHint'), 'weatherEnabled'),
    switchRow(t('settings.weatherAlertEnabled'), t('settings.weatherAlertEnabledHint'), 'weatherAlertEnabled'),
    weatherProviderRow,
    weatherModeNote,
    el('div', { class: 'weather-settings-state' }, weatherStatus, weatherRanking,
      el('div', { class: 'row', style: { marginTop: '8px' } }, weatherProbeBtn)),
    weatherFields,
    el('div', { class: 'small faint', style: { marginTop: '10px', lineHeight: '1.55' } }, t('weather.privacy')),
    el('div', { class: 'small muted', style: { marginTop: '6px', lineHeight: '1.55' } }, t('weather.notOfficial')),
    el('div', { class: 'small faint', style: { marginTop: '6px' } }, t('weather.attribution'))
  );
  const stopWeatherStatus = on('weather:changed', renderWeatherStatus);
  const stopWeatherSettings = on('settings:changed', ({ key, reset }) => {
    if (reset || key === 'weatherProviderMode') {
      weatherMode = get('weatherProviderMode') || 'auto';
      weatherProviderRow.querySelectorAll('button').forEach((button) => {
        button.classList.toggle('active', button.dataset.value === weatherMode);
      });
      renderWeatherFields();
    }
    renderWeatherStatus();
  });

  // ---- advanced / BYOK ----
  const advCard = card('compass', t('settings.advanced'),
    textRow(t('settings.tiandituKey'), t('settings.tiandituKeyHint'), 'tiandituKey', 'tk=…'),
    textRow(t('settings.maptilerKey'), '', 'maptilerKey'),
    textRow(t('settings.customTileName'), '', 'customTileName'),
    textRow(t('settings.customTile'), t('settings.customTileHint'), 'customTileUrl', 'https://…/{z}/{x}/{y}.png'),
    textRow(t('settings.elevationEndpoint'), t('settings.elevationEndpointHint'), 'elevationEndpoint', 'https://api.open-meteo.com/v1/elevation')
  );

  // ---- live meetup relay (blind forwarding only; key stays in the fragment) ----
  let meetRelayMode = get('meetRelayMode') || 'mqtt';
  const meetRelayFields = el('div', {});
  function renderMeetRelayFields() {
    meetRelayFields.innerHTML = '';
    if (meetRelayMode === 'ws') {
      meetRelayFields.append(
        textRow(t('settings.meetWsUrl'), t('settings.meetWsHint'), 'meetWsUrl', 'wss://example.workers.dev/room/{room}')
      );
    } else {
      const resetBtn = el('button', { class: 'btn sm ghost', type: 'button' },
        icon('refresh', 14), t('settings.meetBrokerReset'));
      resetBtn.onclick = () => {
        set('meetMqttUrl', '');
        set('meetMqttPrefix', 'roametch/v2/meet');
        renderMeetRelayFields();
        toast(t('settings.meetBrokerResetDone'), 'ok', 2200);
      };
      meetRelayFields.append(
        textRow(t('settings.meetBroker'), t('settings.meetBrokerHint'), 'meetMqttUrl', t('settings.meetBrokerAuto')),
        textRow(t('settings.meetPrefix'), t('settings.meetPrefixHint'), 'meetMqttPrefix', 'roametch/v2/meet'),
        el('div', { class: 'row wrap', style: { marginTop: '-4px' } }, resetBtn)
      );
    }
  }
  renderMeetRelayFields();
  const relaySection = el('div', { class: 'relay-settings-block' },
    el('div', { class: 'settings-subhead relay-subhead' }, icon('globe', 15), t('settings.meetRelay')),
    el('div', { class: 'small muted', style: { margin: '-2px 0 10px' } }, t('settings.meetChannelNote')),
    segRow(t('settings.meetChannel'), [
      ['mqtt', t('settings.meetMqtt')], ['ws', t('settings.meetWs')]
    ], meetRelayMode, (v) => { meetRelayMode = v; set('meetRelayMode', v); renderMeetRelayFields(); }, t('settings.meetSettingsNote')),
    meetRelayFields
  );
  const p2pToggle = el('input', { type: 'checkbox' });
  p2pToggle.checked = get('meetP2PEnabled') === true;
  p2pToggle.onchange = async () => {
    const enabled = p2pToggle.checked;
    p2pToggle.disabled = true;
    if (enabled && Number(get('meetP2PNoticeVersion')) < MEET_P2P_NOTICE_VERSION) {
      p2pToggle.checked = false;
      const accepted = await confirmModal({
        title: t('meet.p2pNoticeTitle'),
        message: t('meet.p2pNoticeBody'),
        confirmText: t('meet.p2pNoticeConfirm')
      });
      if (!accepted) { p2pToggle.disabled = false; return; }
      set('meetP2PNoticeVersion', MEET_P2P_NOTICE_VERSION);
    }
    set('meetP2PEnabled', enabled);
    if (enabled) meet.resumeP2P();
    else meet.stopP2P();
    p2pToggle.checked = enabled;
    p2pToggle.disabled = false;
  };
  const p2pSection = el('div', { class: 'relay-settings-block' },
    el('div', { class: 'settings-subhead relay-subhead' }, icon('shield', 15), t('settings.meetP2P')),
    el('div', { class: 'setting-row' },
      el('div', { class: 'txt' }, el('div', { class: 't' }, t('settings.meetP2P')), el('div', { class: 'd' }, t('settings.meetP2PHint'))),
      el('label', { class: 'switch' }, p2pToggle, el('span', { class: 'slider' }))),
    el('div', { class: 'small faint', style: { marginTop: '8px' } }, t('settings.meetP2PPrivacy')));
  const alertSection = el('div', { class: 'relay-settings-block' },
    el('div', { class: 'settings-subhead relay-subhead' }, icon('warn', 15), t('settings.meetAlerts')),
    el('div', { class: 'small muted', style: { margin: '-2px 0 10px' } }, t('settings.meetAlertsHint')),
    switchRow(t('settings.meetAlertEnabled'), t('settings.meetAlertEnabledHint'), 'meetAlertEnabled'),
    numRow(t('settings.meetAlertDistance'), t('settings.meetAlertDistanceHint'), 'meetAlertDistance', { min: 100, max: 5000, step: 50, unit: 'm' }),
    segRow(t('settings.meetAlertCooldown'), [
      [1, t('settings.cooldownMinutes', { m: 1 })],
      [3, t('settings.cooldownMinutes', { m: 3 })],
      [5, t('settings.cooldownMinutes', { m: 5 })],
      [10, t('settings.cooldownMinutes', { m: 10 })]
    ], Number(get('meetAlertCooldownMin')) || 5, (v) => set('meetAlertCooldownMin', v), t('settings.meetAlertCooldownHint')),
    switchRow(t('settings.meetAlertGoal'), t('settings.meetAlertGoalHint'), 'meetAlertGoal'));
  const meetAdvanced = collapsible(t('settings.meetAdvanced'),
    alertSection,
    relaySection,
    p2pSection,
    el('div', { class: 'settings-subhead' }, icon('globe', 15), t('settings.meetIce')),
    textAreaRow(t('settings.meetStun'), t('settings.meetStunHint'), 'meetStun', 'stun:stun.cloudflare.com:3478'),
    textAreaRow(t('settings.meetTurn'), t('settings.meetTurnHint'), 'meetTurnUrl', 'turn:turn.example.com:3478'),
    textRow(t('settings.meetTurnUser'), '', 'meetTurnUser'),
    textRow(t('settings.meetTurnPass'), t('settings.meetIceHint'), 'meetTurnPass', '', 'password'));
  const meetCard = card('meet', t('settings.meetGroup'),
    textRow(t('settings.meetNick'), t('settings.meetNickHint'), 'meetName', t('meet.namePlaceholder')),
    meetAdvanced.details);

  // ---- debug ----
  const simSel = el('select', { style: { width: '170px' } });
  for (const [v, k] of [['off', 'simOff'], ['cn', 'simCn'], ['global', 'simGlobal'], ['offline', 'simOffline'], ['corsfail', 'simCors']]) {
    simSel.append(el('option', { value: v }, t(`settings.${k}`)));
  }
  simSel.value = get('sim').network;
  const simEnable = el('input', { type: 'checkbox' });
  simEnable.checked = get('sim').enabled;
  function applySim() {
    patch({ sim: { ...get('sim'), enabled: simEnable.checked, network: simSel.value } });
    runProbe({ silent: true });
    renderProbe();
    renderSimBanner();
  }
  simEnable.onchange = applySim;
  simSel.onchange = applySim;

  const speedSel = el('select', { style: { width: '90px' } });
  for (const s of [1, 5, 20, 50, 100, 200]) speedSel.append(el('option', { value: s }, `${s}×`));
  speedSel.value = String(get('sim').playbackSpeed);
  speedSel.onchange = () => patch({ sim: { ...get('sim'), playbackSpeed: +speedSel.value } });

  const playBtn = el('button', { class: 'btn sm primary' }, icon('play', 14), t('settings.simStart'));
  const playFileBtn = el('button', { class: 'btn sm' }, t('settings.simFile'));
  const playStatus = el('span', { class: 'small faint' });
  playBtn.onclick = async () => {
    if (isPlaying()) { await stopPlayback(); playBtn.innerHTML = ''; playBtn.append(icon('play', 14), t('settings.simStart')); playStatus.textContent = ''; return; }
    const ok = await startPlayback({});
    if (ok) {
      playBtn.innerHTML = '';
      playBtn.append(icon('stop', 14), t('settings.simStop'));
      navigate('record');
    }
  };
  playFileBtn.onclick = async () => {
    const f = await filePicker('.gpx,application/gpx+xml,text/xml');
    if (!f) return;
    const text = await f.text();
    const ok = await startPlayback({ gpxText: text, name: f.name });
    if (ok) { navigate('record'); playBtn.innerHTML = ''; playBtn.append(icon('stop', 14), t('settings.simStop')); }
  };
  on('sim:progress', ({ i, total }) => { playStatus.textContent = `${i}/${total}`; });
  on('sim:stopped', () => { playBtn.innerHTML = ''; playBtn.append(icon('play', 14), t('settings.simStart')); playStatus.textContent = ''; });

  const simBanner = el('div', {});
  function renderSimBanner() {
    simBanner.innerHTML = '';
    if (get('sim').enabled && get('sim').network !== 'off') {
      simBanner.append(el('div', { class: 'debug-banner' }, '🧪 ' + t('region.simActive', { mode: simulationModeLabel(get('sim').network) })));
    }
  }
  renderSimBanner();

  const diagBtn = el('button', { class: 'btn sm' }, icon('download', 14), t('settings.diagLog'));
  diagBtn.onclick = () => {
    triggerDownload(exportDiagLog(), `roametch-diag-${Date.now()}.json`);
    toast(t('settings.diagLogOk'), 'ok');
  };

  const debugCard = card('settings', t('settings.debug'),
    simBanner,
    el('div', { class: 'setting-row' },
      el('div', { class: 'txt' }, el('div', { class: 't' }, t('settings.simNetwork')), el('div', { class: 'd' }, t('settings.simNetworkHint', { global: t('region.simGlobal'), offline: t('region.simOffline') }))),
      el('label', { class: 'switch' }, simEnable, el('span', { class: 'slider' })), simSel),
    el('div', { class: 'setting-row', style: { flexWrap: 'wrap' } },
      el('div', { class: 'txt' }, el('div', { class: 't' }, t('settings.simPlayback')), el('div', { class: 'd' }, t('settings.simPlaybackHint'))),
      el('div', { class: 'row' }, speedSel, playBtn)),
    el('div', { class: 'row wrap', style: { marginTop: '6px' } }, playFileBtn, playStatus),
    el('div', { class: 'sep' }),
    diagBtn
  );

  // ---- data & storage ----
  const storageLine = el('div', { class: 'small muted' });
  const persistenceLine = el('div', { class: 'small muted', style: { marginTop: '3px' } });
  const persistBtn = el('button', { class: 'btn sm' }, icon('shield', 14), t('settings.storagePersist'));
  persistBtn.onclick = async () => {
    persistBtn.disabled = true;
    const granted = await requestStoragePersistence();
    await refreshStorage();
    toast(t(granted ? 'settings.storagePersistOk' : 'settings.storagePersistFail'), granted ? 'ok' : 'warn', 3500);
  };
  const healthLine = el('div', { class: 'small muted', style: { marginTop: '3px' }, 'aria-live': 'polite' }, t('settings.healthIdle'));
  const healthDetails = el('div', { class: 'storage-health', hidden: true });
  const healthBtn = el('button', { class: 'btn sm' }, icon('shield', 14), t('settings.healthCheck'));
  const healthCancelBtn = el('button', { class: 'btn sm ghost', hidden: true }, t('settings.healthCancel'));
  let healthController: AbortController | null = null;
  const cleanupLine = el('div', { class: 'small muted', style: { marginTop: '6px' }, hidden: true });
  const cleanupBtn = el('button', { class: 'btn sm danger', hidden: true }, icon('trash', 14), t('settings.cleanupAction'));
  let cleanupPreview: Awaited<ReturnType<typeof previewMediaCleanup>> | null = null;
  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
  healthCancelBtn.onclick = () => healthController?.abort();
  healthBtn.onclick = async () => {
    healthController?.abort();
    const controller = new AbortController();
    healthController = controller;
    healthBtn.disabled = true;
    healthBtn.textContent = t('settings.healthChecking');
    healthCancelBtn.hidden = false;
    healthDetails.hidden = true;
    cleanupLine.hidden = true;
    cleanupBtn.hidden = true;
    cleanupPreview = null;
    try {
      const [result, preview] = await Promise.all([
        inspectStorageHealth({
          signal: controller.signal,
          onProgress: ({ phase, processed }) => {
            healthLine.textContent = t('settings.healthProgress', { phase: t(`settings.healthPhase.${phase}`), n: processed });
          }
        }),
        previewMediaCleanup()
      ]);
      if (controller.signal.aborted) return;
      cleanupPreview = preview;
      healthLine.textContent = t(result.healthy ? 'settings.healthClean' : result.ok ? 'settings.healthAdvisory' : 'settings.healthIssues', { n: result.totals.issues });
      healthLine.style.color = result.ok ? result.healthy ? 'var(--accent)' : 'var(--warn)' : 'var(--danger)';
      healthDetails.innerHTML = '';
      healthDetails.append(
        el('div', { class: 'small' }, t('settings.healthSummary', {
          trips: result.counts.trips, points: result.counts.points,
          snapshots: result.counts.snapshotPoints, media: result.counts.media,
          bytes: formatBytes(result.counts.photoBytes)
        })),
        el('div', { class: 'small faint', style: { marginTop: '4px' } }, t('settings.healthReadOnly')),
        cleanupLine,
        el('div', { class: 'row wrap', style: { marginTop: '6px' } }, cleanupBtn));
      cleanupLine.textContent = preview.count
        ? t('settings.cleanupPreview', { n: preview.count, bytes: formatBytes(preview.bytes) })
        : t('settings.cleanupEmpty');
      cleanupLine.hidden = false;
      cleanupBtn.hidden = !preview.count;
      for (const issue of result.issues) {
        healthDetails.append(el('div', { class: `health-issue ${issue.severity}` },
          el('div', {},
            el('strong', {}, t(`settings.healthIssue.${issue.type}`)),
            el('span', { class: 'mono' }, ` × ${issue.count}`)),
          issue.sampleIds.length ? el('div', { class: 'small faint mono' }, t('settings.healthSample', { ids: issue.sampleIds.slice(0, 3).join(', ') })) : null));
      }
      healthDetails.hidden = false;
    } catch (e) {
      console.error(e);
      const cancelled = controller.signal.aborted || e?.name === 'AbortError';
      healthLine.textContent = t(cancelled ? 'settings.healthCancelled' : 'settings.healthFail');
      healthLine.style.color = cancelled ? 'var(--warn)' : 'var(--danger)';
    } finally {
      if (healthController === controller) healthController = null;
      healthCancelBtn.hidden = true;
      healthBtn.disabled = false;
      healthBtn.innerHTML = '';
      healthBtn.append(icon('shield', 14), t('settings.healthCheck'));
    }
  };
  cleanupBtn.onclick = async () => {
    const preview = cleanupPreview;
    if (!preview?.count) return;
    const confirmed = await confirmModal({
      title: t('settings.cleanupTitle'),
      message: t('settings.cleanupConfirm', { n: preview.count, bytes: formatBytes(preview.bytes) }),
      danger: true,
      confirmText: t('settings.cleanupAction')
    });
    if (!confirmed) return;
    cleanupBtn.disabled = true;
    try {
      const result = await executeMediaCleanup(preview.token);
      cleanupPreview = null;
      toast(t('settings.cleanupDone', { n: result.deleted, bytes: formatBytes(result.bytes) }), 'ok');
      await refreshStorage();
      healthBtn.click();
    } catch (e) {
      console.error(e);
      toast(t('settings.cleanupFail'), 'err');
    } finally {
      cleanupBtn.disabled = false;
    }
  };
  const quarantineLine = el('div', { class: 'small muted', style: { marginTop: '6px' }, 'aria-live': 'polite' }, t('settings.quarantineIdle'));
  const quarantineList = el('div', { class: 'quarantine-list', hidden: true });
  const quarantineBackupBtn = el('button', { class: 'btn sm' }, icon('download', 14), t('settings.quarantineBackup'));
  const quarantineRestoreBtn = el('button', { class: 'btn sm' }, icon('export', 14), t('settings.quarantineRestore'));
  const quarantineDiscardBtn = el('button', { class: 'btn sm danger' }, icon('trash', 14), t('settings.quarantineDiscard'));
  let quarantined: Awaited<ReturnType<typeof listQuarantinedRows>> = [];
  async function renderQuarantine() {
    quarantined = await listQuarantinedRows();
    quarantineLine.textContent = t('settings.quarantineSummary', { n: quarantined.length });
    quarantineLine.style.color = quarantined.length ? 'var(--warn)' : '';
    quarantineList.innerHTML = '';
    for (const record of quarantined.slice(0, 20)) {
      quarantineList.append(el('div', { class: 'small mono' }, `${record.sourceTable} · ${record.rowId} · ${record.reason}`));
    }
    quarantineList.hidden = !quarantined.length;
    for (const button of [quarantineBackupBtn, quarantineRestoreBtn, quarantineDiscardBtn]) button.disabled = !quarantined.length;
  }
  quarantineBackupBtn.onclick = async () => {
    try { await exportBackupFlow(); }
    catch { toast(t('backup.exportErr'), 'err'); }
  };
  quarantineRestoreBtn.onclick = async () => {
    const confirmed = await confirmModal({
      title: t('settings.quarantineRestore'),
      message: t('settings.quarantineRestoreConfirm', { n: quarantined.length }),
      confirmText: t('settings.quarantineRestore')
    });
    if (!confirmed) return;
    quarantineRestoreBtn.disabled = true;
    try {
      const result = await restoreQuarantinedRows();
      toast(t('settings.quarantineRestored', { restored: result.restored, skipped: result.skipped }), 'ok', 4000);
      await renderQuarantine();
    } catch (error) {
      console.error(error);
      toast(t('settings.quarantineFailed'), 'err');
    } finally {
      await renderQuarantine();
    }
  };
  quarantineDiscardBtn.onclick = async () => {
    const confirmed = await confirmModal({
      title: t('settings.quarantineDiscard'),
      message: t('settings.quarantineDiscardConfirm', { n: quarantined.length }),
      danger: true,
      confirmText: t('settings.quarantineDiscard')
    });
    if (!confirmed) return;
    quarantineDiscardBtn.disabled = true;
    try {
      const discarded = await discardQuarantinedRows(quarantined.map((record) => record.id));
      toast(t('settings.quarantineDiscarded', { n: discarded }), 'ok');
    } catch (error) {
      console.error(error);
      toast(t('settings.quarantineFailed'), 'err');
    } finally {
      await renderQuarantine();
    }
  };
  const backupHealthLine = el('div', { class: 'small muted', style: { marginTop: '3px' } });
  const backupBtn = el('button', { class: 'btn sm' }, icon('download', 14), t('trips.backup'));
  backupBtn.onclick = async () => {
    try { await exportBackupFlow(); refreshStorage(); }
    catch { toast(t('backup.exportErr'), 'err'); }
  };
  const restoreBtn = el('button', { class: 'btn sm' }, icon('export', 14), t('trips.restore'));
  restoreBtn.onclick = async () => {
    const f = await filePicker('.trip,.zip,.enc,application/zip,application/octet-stream');
    if (!f) return;
    try {
      await restoreBackupFlow(f, { onRestored: async () => {
        const trips = await listTrips();
        const nextId = trips.some((trip) => trip.id === appState.activeTripId) ? appState.activeTripId : trips[0]?.id || null;
        await setActiveTrip(nextId);
        await refreshStorage();
      } });
    } catch { toast(t('trips.restoreErr'), 'err'); }
  };
  const drillLine = el('div', { class: 'small muted', id: 'restore-drill-status', style: { marginTop: '6px' }, 'aria-live': 'polite' }, t('settings.drillIdle'));
  const drillBtn = el('button', { class: 'btn sm' }, icon('shield', 14), t('settings.drillAction'));
  const drillCancelBtn = el('button', { class: 'btn sm ghost', hidden: true }, t('settings.drillCancel'));
  let drillController: AbortController | null = null;
  async function recordDrill(result: RestoreDrillResult | null) {
    await appendBackupHistory({
      kind: 'drill', status: result?.ok ? 'drill-passed' : 'failed', createdAt: Date.now(),
      filename: 'restore-drill.trip', bytes: 0, encrypted: false,
      backupFormat: 'localtrace-backup', tripSchema: TRIP_SCHEMA_VERSION, appVersion: APP_VERSION,
      trips: result?.counts.trips || 0, segments: result?.counts.segments || 0,
      chunks: result?.counts.trackChunks || 0, waypoints: result?.counts.waypoints || 0,
      media: result?.counts.media || 0, mediaChecked: result?.mediaChecked || 0, mediaFailed: 0,
      source: 'drill'
    });
    await renderBackupHistory();
  }
  drillCancelBtn.onclick = () => drillController?.abort();
  drillBtn.onclick = async () => {
    if (drillController) return;
    const controller = new AbortController();
    drillController = controller;
    drillBtn.disabled = true;
    drillCancelBtn.hidden = false;
    drillLine.style.color = '';
    drillLine.textContent = t('settings.drillPhase.prepare');
    const onProgress = (progress: RestoreDrillProgress) => {
      const phase = t(`settings.drillPhase.${progress.phase}`);
      drillLine.textContent = progress.total
        ? `${phase} ${progress.loaded || 0}/${progress.total}`
        : phase;
    };
    try {
      const result = await runRestoreDrill({ signal: controller.signal, onProgress });
      await recordDrill(result);
      if (result.ok) {
        const checks = Object.values(result.checks).filter(Boolean).length;
        drillLine.style.color = 'var(--accent)';
        drillLine.textContent = t('settings.drillPassed', {
          checks, media: result.mediaChecked, seconds: (result.durationMs / 1000).toFixed(1)
        });
        toast(t('settings.drillPassedToast'), 'ok', 3500);
      } else if (result.status === 'aborted') {
        drillLine.style.color = 'var(--warn)';
        drillLine.textContent = t('settings.drillAborted');
        toast(t('settings.drillAborted'), 'warn', 3000);
      } else if (result.status === 'unsupported') {
        drillLine.style.color = 'var(--warn)';
        drillLine.textContent = t('settings.drillUnsupported');
        toast(t('settings.drillUnsupported'), 'warn', 3500);
      } else {
        drillLine.style.color = 'var(--danger)';
        drillLine.textContent = t('settings.drillFailed', { code: result.error?.code || 'restore-drill-failed' });
        toast(t('settings.drillFailedToast'), 'err', 3500);
      }
    } catch (error) {
      console.error(error);
      await recordDrill(null);
      drillLine.style.color = 'var(--danger)';
      drillLine.textContent = t('settings.drillFailed', { code: 'restore-drill-failed' });
      toast(t('settings.drillFailedToast'), 'err', 3500);
    } finally {
      drillController = null;
      drillBtn.disabled = false;
      drillCancelBtn.hidden = true;
    }
  };
  const historyList = el('div', { class: 'backup-history-list' });
  const historyBox = el('div', { class: 'backup-history', hidden: true }, historyList);
  const historyClearBtn = el('button', { class: 'btn sm ghost' }, t('settings.historyClear'));
  let historyRevision = 0;
  async function renderBackupHistory() {
    const revision = ++historyRevision;
    const records = await listBackupHistory();
    if (revision !== historyRevision) return;
    historyList.innerHTML = '';
    historyBox.hidden = !records.length;
    historyClearBtn.hidden = !records.length;
    for (const record of records) {
      const failed = record.status === 'failed';
      const integrity = record.media > 0
        ? t('settings.historyIntegrity', { checked: record.mediaChecked, total: record.media })
        : '';
      historyList.append(el('div', { class: 'backup-history-item' },
        el('div', { class: 'row wrap', style: { justifyContent: 'space-between', gap: '6px' } },
          el('strong', {}, `${t(`settings.historyKind.${record.kind}`)} · ${t(`settings.historyStatus.${record.status}`)}`),
          el('span', { class: 'small', style: { color: failed ? 'var(--danger)' : 'var(--muted)' } },
            new Date(record.createdAt).toLocaleString(languageTag(currentLang())))),
        record.filename ? el('div', { class: 'small mono', style: { marginTop: '4px', wordBreak: 'break-all' } }, record.filename) : null,
        el('div', { class: 'small muted', style: { marginTop: '4px' } },
          t('settings.historyCounts', { trips: record.trips, waypoints: record.waypoints, media: record.media }),
          ` · ${formatBytes(record.bytes)}`,
          integrity ? ` · ${integrity}` : ''),
        el('div', { class: 'small faint', style: { marginTop: '2px' } },
          t('settings.historySource', { source: t(`settings.historyOrigin.${record.source}`) }))));
    }
  }
  historyClearBtn.onclick = async () => {
    const confirmed = await confirmModal({
      title: t('settings.historyClear'),
      message: t('settings.historyClearConfirm'),
      danger: true,
      confirmText: t('settings.historyClear')
    });
    if (!confirmed) return;
    historyClearBtn.disabled = true;
    try {
      if (!await clearBackupHistory()) throw new Error('backup history clear failed');
      toast(t('settings.historyCleared'), 'ok');
      await renderBackupHistory();
    } catch (e) {
      console.error(e);
      toast(t('settings.historyClearFail'), 'err');
    } finally {
      historyClearBtn.disabled = false;
    }
  };
  const eraseBtn = el('button', { class: 'btn danger block' }, icon('trash', 14), t('settings.clearAll'));
  eraseBtn.onclick = async () => {
    const ok = await confirmModal({ title: t('settings.clearAll'), message: t('settings.clearConfirm'), danger: true, confirmText: t('settings.clearAll') });
    if (!ok) return;
    const again = await confirmModal({ title: t('settings.dangerTitle'), message: t('settings.clearConfirm2'), danger: true, confirmText: t('common.confirm') });
    if (!again) return;
    await eraseAll();
    try { await eraseSyncState(); } catch (error) { console.warn('sync state clear failed', error); }
    try {
      localStorage.removeItem(SAFETY_STORAGE_KEY);
      localStorage.removeItem('localtrace.safety.last-gasp.v1');
      saveSafetySettings(defaultSafetySettings());
    } catch { /* safety settings unavailable */ }
    safetyCard.refresh();
    await setActiveTrip(null);
    toast(t('settings.cleared'), 'ok');
    refreshStorage();
  };
  const resetBtn = el('button', { class: 'btn sm' }, icon('refresh', 14), t('settings.resetAction'));
  resetBtn.onclick = async () => {
    const ok = await confirmModal({
      title: t('settings.resetTitle'),
      message: t('settings.resetConfirm'),
      confirmText: t('settings.resetAction')
    });
    if (!ok) return;
    meet.stopP2P();
    resetSettings();
    saveSafetySettings(defaultSafetySettings());
    resetLastGasp();
    toast(t('settings.resetDone'), 'ok', 1600);
    setTimeout(() => location.reload(), 450);
  };
  async function refreshStorage() {
    const est = await storageEstimate();
    storageLine.textContent = est.quota
      ? `${t('settings.storageUsage')}: ${(est.usage / 1048576).toFixed(1)} MB / ${(est.quota / 1048576).toFixed(0)} MB`
      : t('settings.storageUsage') + ': --';
    const persistent = est.persisted == null ? t('settings.storagePersistUnsupported') : t(est.persisted ? 'settings.storagePersisted' : 'settings.storageNotPersisted');
    persistenceLine.textContent = `${t('settings.storagePersistence')}: ${persistent}`;
    persistBtn.disabled = est.persisted === true || !navigator.storage?.persist;
    persistBtn.title = t('settings.storagePersistHint');
    backupHealthLine.textContent = t('backup.lastBackup', { when: lastBackupLabel() }) + (backupDue() ? ' · ' + t('backup.dueShort') : '');
    backupHealthLine.style.color = backupDue() ? 'var(--warn)' : '';
    await renderQuarantine();
    await renderBackupHistory();
  }
  refreshStorage();
  on('backup:exported', refreshStorage);
  on('backup:restored', refreshStorage);
  on('sync:completed', refreshStorage);
  const dangerZone = el('div', { class: 'danger-zone' },
    el('div', { class: 'dz-title' }, icon('warn', 14), t('settings.dangerTitle')),
    el('div', { class: 'small faint', style: { marginBottom: '10px' } }, t('settings.dangerHint')),
    eraseBtn);
  const syncPanel = createSyncPanel();
  const dataCard = card('database', t('settings.dataBackup'), storageLine, persistenceLine,
    el('div', { class: 'row wrap', style: { marginTop: '8px' } }, persistBtn),
    el('div', { class: 'small faint', style: { margin: '5px 0 9px' } }, t('settings.storagePersistHint')),
    el('div', { class: 'sep' }),
    el('div', { class: 'row wrap', style: { marginBottom: '6px' } }, healthBtn, healthCancelBtn),
    healthLine, healthDetails,
    el('div', { class: 'sep' }),
    el('div', { class: 'row wrap', style: { marginBottom: '4px' } }, icon('shield', 15), t('settings.quarantineTitle')),
    el('div', { class: 'small faint' }, t('settings.quarantineDesc')),
    quarantineLine, quarantineList,
    el('div', { class: 'row wrap', style: { marginTop: '6px' } }, quarantineBackupBtn, quarantineRestoreBtn, quarantineDiscardBtn),
    el('div', { class: 'sep' }),
    backupHealthLine,
    el('div', { class: 'row wrap', style: { marginTop: '8px' } }, backupBtn, restoreBtn, drillBtn),
    el('div', { class: 'small faint', style: { margin: '6px 0 0' }, 'data-safety-backup-note': '' }, t('safety.backupExcluded')),
    el('div', { class: 'small faint', style: { margin: '6px 0 0' } }, t('settings.drillDesc')),
    el('div', { class: 'row wrap', style: { marginTop: '4px', alignItems: 'center' } }, drillLine, drillCancelBtn),
    el('div', { class: 'row wrap settings-subhead', style: { marginTop: '14px' } }, icon('database', 15), t('settings.historyTitle'), historyClearBtn),
    el('div', { class: 'small faint', style: { margin: '-2px 0 8px' } }, t('settings.historyDesc')),
    historyBox,
    el('div', { class: 'settings-subhead', style: { marginTop: '14px' } }, icon('refresh', 15), t('settings.resetTitle')),
    el('div', { class: 'small muted', style: { margin: '-2px 0 10px' } }, t('settings.resetDesc')),
    resetBtn,
    el('div', { class: 'sep' }),
    dangerZone);

  // ---- shareable promo image ----
  function copyPromoCaption(caption) {
    const text = caption;
    const fallback = () => {
      const area = el('textarea', { readonly: true, rows: '11' });
      area.value = text;
      const m = modal({
        title: t('settings.promoCopy'),
        body: el('div', { class: 'field' }, area),
        footer: [el('button', { class: 'btn primary', onclick: () => m.close() }, t('common.close'))]
      });
      setTimeout(() => { area.focus(); area.select(); }, 60);
      toast(t('settings.promoCopyFail'), 'warn');
    };
    const paste = async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast(t('settings.promoCopied'), 'ok');
        return;
      } catch { /* fall back to a hidden textarea */ }
      try {
        const area = el('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
        area.value = text;
        document.body.append(area);
        area.focus();
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        if (ok) {
          toast(t('settings.promoCopied'), 'ok');
          return;
        }
      } catch { /* fall through */ }
      fallback();
    };
    paste();
  }
  function openPromoPreview(blob, filename, caption, variant) {
    let current = { blob, filename, caption, variant };
    let currentFile = new File([blob], filename, { type: 'image/png' });
    const canShare = !!navigator.share && !!navigator.canShare?.({ files: [currentFile] });
    let currentUrl = URL.createObjectURL(blob);
    let closed = false;
    const img = el('img', { class: 'promo-preview-img', src: currentUrl, alt: t('settings.promoPreviewAlt') });
    img.dataset.variant = String(variant);
    const variantSelect = el('select', { class: 'promo-variant-select', 'aria-label': t('settings.promoVariant') });
    const featureGroup = el('optgroup', { label: t('settings.promoVariantGroup') });
    const audienceGroup = el('optgroup', { label: t('settings.promoVariantAudienceGroup', { n: 17 }) });
    for (let i = 0; i < PROMO_VARIANT_COUNT; i++) {
      const option = el('option', { value: String(i) }, `${promoVariantLabel(i)} · ${i + 1}`);
      (i < 8 ? featureGroup : audienceGroup).append(option);
    }
    variantSelect.append(featureGroup, audienceGroup);
    variantSelect.value = String(variant);
    const variantIndex = el('div', { class: 'small muted promo-variant-index' }, t('settings.promoVariantIndex', { n: variant + 1 }));
    const actionButton = (name: string, label: string, primary = false) => el('button',
      { class: `btn${primary ? ' primary' : ''}` },
      el('span', { class: 'promo-action-icon' }, icon(name, 18)),
      el('span', { class: 'promo-action-label' }, label));
    const nextBtn = actionButton('refresh', t('settings.promoNext'));
    const copyBtn = actionButton('copy', t('settings.promoCopy'));
    const saveBtn = actionButton('download', t('settings.promoDownload'), !canShare);
    const shareBtn = canShare ? actionButton('share', t('settings.promoShare'), true) : null;
    const promoActions = el('div', { class: `promo-actions${shareBtn ? '' : ' three'}` },
      nextBtn, copyBtn, saveBtn, ...(shareBtn ? [shareBtn] : []));
    const setBusy = (busy: boolean) => {
      nextBtn.disabled = busy;
      variantSelect.disabled = busy;
      saveBtn.disabled = busy;
      if (shareBtn) shareBtn.disabled = busy;
    };
    const applyPromo = (result: typeof current) => {
      const nextFile = new File([result.blob], result.filename, { type: 'image/png' });
      const nextUrl = URL.createObjectURL(result.blob);
      const previousUrl = currentUrl;
      current = result;
      currentFile = nextFile;
      img.src = nextUrl;
      img.dataset.variant = String(result.variant);
      variantSelect.value = String(result.variant);
      variantIndex.textContent = t('settings.promoVariantIndex', { n: result.variant + 1 });
      currentUrl = nextUrl;
      URL.revokeObjectURL(previousUrl);
    };
    const m = modal({
      title: t('settings.promoPreviewTitle'),
      wide: true,
      body: el('div', {},
        el('div', { class: 'small muted promo-preview-note' }, t('settings.promoKeep')),
        el('label', { class: 'promo-variant-picker' },
          el('span', { class: 'promo-variant-title' }, t('settings.promoVariant')),
          variantIndex,
          variantSelect,
          el('span', { class: 'small faint promo-variant-hint' }, t('settings.promoVariantHint'))),
        img),
      footer: [promoActions],
      onClose: () => {
        if (closed) return;
        closed = true;
        URL.revokeObjectURL(currentUrl);
      }
    });
    m.box.classList.add('promo-modal');
    const renderVariant = async (requestedVariant: number) => {
      if (closed || nextBtn.disabled) return;
      setBusy(true);
      try {
        const result = await generatePromo(requestedVariant);
        if (!closed) applyPromo(result);
      } catch (err) {
        if (!closed) {
          console.error(err);
          toast(t('settings.promoFailed'), 'err');
        }
      } finally {
        if (!closed) setBusy(false);
      }
    };
    copyBtn.onclick = () => copyPromoCaption(current.caption);
    nextBtn.onclick = () => renderVariant(nextVariant(current.variant));
    variantSelect.onchange = () => renderVariant(Number(variantSelect.value));
    saveBtn.onclick = async () => {
      const res = await exportImage(current.blob, current.filename);
      if (res.mode === 'longpress') {
        img.src = res.dataUrl;
        toast(t('settings.promoLongPress'), 'warn');
      } else {
        toast(t('settings.promoDownloaded'), 'ok');
      }
    };
    if (shareBtn) {
      shareBtn.onclick = async () => {
        try {
          await navigator.share({ title: t('promo.shareTitle'), text: current.caption, files: [currentFile] });
        } catch (e) {
          if (e?.name !== 'AbortError') saveBtn.click();
        }
      };
    }
  }
  const promoBtn = el('button', { class: 'btn primary' }, icon('sparkles', 15), t('settings.promoAction'));
  let promoBusy = false;
  promoBtn.onclick = async () => {
    if (promoBusy) return;
    promoBusy = true;
    promoBtn.disabled = true;
    promoBtn.replaceChildren(icon('refresh', 15), t('settings.promoGenerating'));
    try {
      const { blob, filename, caption, variant } = await generatePromo();
      openPromoPreview(blob, filename, caption, variant);
    } catch (err) {
      console.error(err);
      toast(t('settings.promoFailed'), 'err');
    } finally {
      promoBusy = false;
      promoBtn.disabled = false;
      promoBtn.replaceChildren(icon('sparkles', 15), t('settings.promoAction'));
    }
  };
  const promoCard = card('sparkles', t('settings.promoTitle'),
    el('div', { class: 'promo-hero' },
      el('img', { src: './icons/icon-192.png', alt: '', width: '52', height: '52', loading: 'lazy' }),
      el('div', { class: 'small muted promo-brand-line' }, t('app.brandLine')),
      el('div', { class: 'promo-headline' },
        el('span', { class: 'promo-slogan' }, t('app.slogan')))),
    el('div', { class: 'small muted', style: { margin: '10px 0' } }, t('settings.promoDesc')),
    promoBtn,
    el('div', { class: 'small faint', style: { marginTop: '8px' } }, t('settings.promoKeep'))
  );
  promoCard.classList.add('promo-card');

  // ---- install ----
  const installInfo = installSettingsInfo();
  const installBtn = installInfo.installed
    ? el('button', { class: 'btn sm', disabled: true }, icon('check', 14), t('settings.installDone'))
    : el('button', { class: 'btn sm primary', onclick: () => openInstallGuide() }, icon('download', 14), t('settings.installAction'));
  const installCard = card('download', t('settings.installTitle'),
    el('div', { class: 'small muted', style: { marginBottom: '10px' } }, t('settings.installDesc')),
    installBtn
  );

  // ---- about ----
  const debugSlot = el('div', { class: 'settings-debug', style: { display: 'none' } }, debugCard);
  let debugTaps = 0;
  let debugTimer = 0;
  const aboutVersion = el('button', { class: 'about-version' }, t('settings.aboutText', { version: APP_VERSION }));
  aboutVersion.onclick = () => {
    debugTaps++;
    clearTimeout(debugTimer);
    if (debugTaps >= 7) {
      debugTaps = 0;
      debugSlot.style.display = '';
      debugSlot.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    debugTimer = window.setTimeout(() => { debugTaps = 0; }, 2200);
  };
  const aboutCard = card('info', t('settings.about'),
    aboutVersion,
    el('div', { class: 'small faint', style: { marginTop: '6px' } }, '⚠ ' + t('settings.disclaimer')));
  const mapAdvanced = collapsible(t('settings.advanced'), advCard, meetCard);

  scroll.append(
    el('div', { class: 'page-head' }, el('h2', { class: 'page-title' }, t('settings.title'))),
    section(t('settings.appearanceGroup')), langCard,
    section(t('settings.recordGroup')), recCard,
    section(t('settings.privacyGroup')), privacyCard, safetyCard.card,
    section(t('settings.weatherGroup')), weatherCard,
    section(t('settings.mapGroup')), regionCard, mapAdvanced.details,
    section(t('settings.syncGroup')), syncPanel.card,
    section(t('settings.dataGroup')), dataCard,
    section(t('settings.aboutGroup')), aboutCard, installCard, promoCard, debugSlot
  );

  return {
    view,
    refresh: () => { renderProbe(); renderSimBanner(); refreshStorage(); syncPanel.refresh(); renderWeatherStatus(); safetyCard.refresh(); },
    destroy: () => { syncPanel.destroy(); healthController?.abort(); stopWeatherStatus(); stopWeatherSettings(); },
    resize: () => {},
    focus: (intent) => {
      const anchor = typeof intent === 'string' ? intent : intent?.anchor;
      if (anchor !== 'relay' && anchor !== 'database' && anchor !== 'weather' && anchor !== 'safety') return;
      requestAnimationFrame(() => {
        if (anchor === 'safety') {
          safetyCard.open();
          safetyCard.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          safetyCard.card.classList.remove('settings-focus');
          void safetyCard.card.offsetWidth;
          safetyCard.card.classList.add('settings-focus');
          setTimeout(() => safetyCard.card.classList.remove('settings-focus'), 2000);
          return;
        }
        if (anchor === 'weather') {
          weatherCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          weatherCard.classList.remove('settings-focus');
          void weatherCard.offsetWidth;
          weatherCard.classList.add('settings-focus');
          setTimeout(() => weatherCard.classList.remove('settings-focus'), 2000);
          return;
        }
        if (anchor === 'database') {
          dataCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
          dataCard.classList.remove('settings-focus');
          void dataCard.offsetWidth;
          dataCard.classList.add('settings-focus');
          setTimeout(() => dataCard.classList.remove('settings-focus'), 2000);
          return;
        }
        mapAdvanced.open();
        meetAdvanced.open();
        relaySection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        meetCard.classList.remove('settings-focus');
        void meetCard.offsetWidth;
        meetCard.classList.add('settings-focus');
        setTimeout(() => meetCard.classList.remove('settings-focus'), 2000);
      });
    }
  };
}
