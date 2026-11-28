// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  maps: [] as any[],
  eventHandlers: new Map<string, Array<(payload?: any) => void>>(),
  requestWakeLock: vi.fn(async () => true),
  releaseWakeLock: vi.fn(async () => {}),
  setThemeModeOverride: vi.fn(),
  setThemeColorOverride: vi.fn(),
  rec: {
    status: 'idle' as 'idle' | 'recording' | 'paused' | 'finished',
    tripId: null as string | null,
    segmentId: null as string | null,
    live: null as any,
    simulated: false,
    permissionDenied: false,
    geoError: null,
    activityGuess: null,
    saveState: { pending: 0, lastSavedAt: 0, error: null, degraded: false }
  },
  rewalk: {
    active: false, tripId: null as string | null, name: '', mode: 'full-fwd',
    pts: [], cum: [], total: 0, idx: 0, maxIdx: 0, entryIdx: 0, entryAlong: 0,
    offTrack: 0, phase: 'locating', targetType: 'end', navTarget: null,
    navTargetType: null, lastFix: null, finished: false, departed: false,
    muted: false, sim: false, externalNav: false, approachBand: null
  },
  appState: {
    view: 'record', activeTripId: null as string | null, activeTripFull: null as any,
    editMode: false, showTripInRecord: false,
    tripDetail: { open: false, tripId: null as string | null, section: 'overview' }
  },
  getTrip: vi.fn(),
  loadTripTrack: vi.fn(),
  loadTripPreview: vi.fn(),
  listWaypoints: vi.fn(),
  loadTripFull: vi.fn(),
  findTrackGaps: vi.fn(),
  updateTrip: vi.fn(),
  addPhotoWaypoint: vi.fn(),
  deletePhotoWaypoint: vi.fn(),
  stopRecording: vi.fn(),
  findRecoverableTrip: vi.fn(),
  setActiveTrip: vi.fn(),
  refreshActiveTrip: vi.fn(),
  openCamera: vi.fn(),
  openWaypointModal: vi.fn(),
  modal: vi.fn(),
  navigate: vi.fn(),
  safetySettings: { enabled: false },
  openSafetyCheckIn: vi.fn(),
  sendSafetyNow: vi.fn()
}));

vi.mock('../src/core/i18n', () => ({
  t: (key: string, vars: Record<string, any> = {}) => {
    const values = Object.values(vars).map(String);
    return values.length ? `${key} ${values.join(' ')}` : key;
  },
  currentLang: () => 'en'
}));
vi.mock('../src/core/settings', () => ({
  get: (key: string) => ({
    language: 'en', activity: 'hike', units: 'metric', weightKg: 65,
    ascentThreshold: 4, panelCollapsed: false, oledBrightness: 70
  } as Record<string, any>)[key],
  set: vi.fn()
}));
vi.mock('../src/core/events', () => ({
  on: vi.fn((name: string, handler: (payload?: any) => void) => {
    const handlers = mocks.eventHandlers.get(name) || [];
    handlers.push(handler);
    mocks.eventHandlers.set(name, handlers);
    return vi.fn();
  }),
  emit: vi.fn()
}));
vi.mock('../src/core/recorder', () => ({
  rec: mocks.rec,
  startRecording: vi.fn(), pauseRecording: vi.fn(), resumeRecording: vi.fn(),
  stopRecording: mocks.stopRecording, continueTrip: vi.fn(),
  findRecoverableTrip: mocks.findRecoverableTrip, retryGeolocation: vi.fn(),
  setRecordingActivity: vi.fn(), flushBuffer: vi.fn()
}));
vi.mock('../src/core/keepalive', () => ({
  armKeepAlive: vi.fn(), disarmKeepAlive: vi.fn(), isKeepAliveActive: () => false
}));
vi.mock('../src/core/wakelock', () => ({
  requestWakeLock: mocks.requestWakeLock,
  releaseWakeLock: mocks.releaseWakeLock
}));
vi.mock('../src/core/theme', () => ({
  setThemeColorOverride: mocks.setThemeColorOverride,
  setThemeModeOverride: mocks.setThemeModeOverride
}));
vi.mock('../src/core/region', () => ({ regionState: { effective: 'global' } }));
vi.mock('../src/core/providers', () => ({
  availableBasemaps: () => [{ id: 'test', name: 'Test', nameEn: 'Test', kind: 'street', coordSystem: 'WGS' }]
}));
vi.mock('../src/core/geo', () => ({
  fmtDistance: (value: number) => ({ v: String(value), u: 'm' }),
  fmtDuration: (value: number) => String(value),
  fmtSpeed: (value: number) => ({ v: String(value), u: 'km/h' }),
  fmtPace: (value: number) => ({ v: String(value), u: '/km' }),
  fmtAltitude: (value: number) => ({ v: String(value), u: 'm' }),
  signalLevel: () => 0, haversine: () => 0, bearing: () => 0
}));
vi.mock('../src/core/calories', () => ({ estimateCalories: () => 0 }));
vi.mock('../src/core/elevation', () => ({ altSourceShortKey: () => '', altSourceTagClass: () => '' }));
vi.mock('../src/core/store', () => ({
  getTrip: mocks.getTrip,
  loadTripTrack: mocks.loadTripTrack,
  loadTripPreview: mocks.loadTripPreview,
  listWaypoints: mocks.listWaypoints,
  loadTripFull: mocks.loadTripFull,
  updateTrip: mocks.updateTrip,
  addPhotoWaypoint: mocks.addPhotoWaypoint,
  deletePhotoWaypoint: mocks.deletePhotoWaypoint
}));
vi.mock('../src/core/gapRepair', () => ({ findTrackGaps: mocks.findTrackGaps }));
vi.mock('../src/core/safety', () => ({ loadSafetySettings: () => mocks.safetySettings }));
vi.mock('../src/ui/safety', () => ({
  openSafetyCheckIn: mocks.openSafetyCheckIn,
  sendSafetyNow: mocks.sendSafetyNow
}));
vi.mock('../src/core/locks', () => ({ onBroadcast: () => vi.fn() }));
vi.mock('../src/core/history', () => ({ clearHistory: vi.fn() }));
vi.mock('../src/core/waypointMeta', () => ({ WP_ICONS: {} }));
vi.mock('../src/core/rewalk', () => ({
  rewalk: mocks.rewalk,
  stopRewalk: vi.fn(), toggleMute: vi.fn(), startSim: vi.fn(), stopSim: vi.fn(),
  getRewalkNavigation: vi.fn(), markExternalNavigation: vi.fn(), EXTERNAL_NAV_MIN_M: 1000
}));
vi.mock('../src/ui/state', () => ({
  appState: mocks.appState,
  setActiveTrip: mocks.setActiveTrip,
  refreshActiveTrip: mocks.refreshActiveTrip
}));
vi.mock('../src/ui/editor', () => ({
  openWaypointModal: mocks.openWaypointModal, moveWaypoint: vi.fn(), moveVertex: vi.fn(),
  insertVertex: vi.fn(), deleteVertex: vi.fn(), undoEdit: vi.fn(), redoEdit: vi.fn(),
  histState: () => ({ canUndo: false, canRedo: false })
}));
vi.mock('../src/ui/camera', () => ({ openCamera: mocks.openCamera }));
vi.mock('../src/ui/history', () => ({
  clearHistory: vi.fn(), backFromUIState: vi.fn(async () => {}), currentUIState: () => null,
  pushUIState: () => ({ id: 1 }), pushOverlayState: () => 2,
  removeOverlayState: vi.fn(async () => {}), onUIPop: () => vi.fn()
}));
vi.mock('../src/ui/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/helpers')>();
  return { ...actual, toast: vi.fn(), modal: mocks.modal };
});
vi.mock('../src/ui/map', () => ({
  TrackMap: class FakeTrackMap {
    destroyed = false;
    liveMode = false;
    _liveFeats = new Map();
    posMarker = null;
    follow = false;
    basemapId = 'test';
    vectorFallback = false;
    map = { getZoom: () => 5 };
    constructor() { mocks.maps.push(this); }
    init() { return this; }
    observeViewportInset = vi.fn();
    updateViewportInset = vi.fn();
    setTrackData = vi.fn();
    setWaypoints = vi.fn();
    fitTrack = vi.fn();
    updatePosition = vi.fn();
    endLive = vi.fn();
    startLive = vi.fn();
    setFollow = vi.fn();
    setEditMode = vi.fn();
    clearNavGuide = vi.fn();
    setNavGuide = vi.fn();
    clearPosition = vi.fn();
    clearHover = vi.fn();
    appendLive = vi.fn();
    flyTo = vi.fn();
    setBasemap = vi.fn();
    resize = vi.fn();
    pauseRendering = vi.fn();
    resumeRendering = vi.fn();
    destroy = vi.fn();
  }
}));

import { createRecordView } from '../src/ui/record';

const trip = { id: 'trip-1', name: 'Hike', activity: 'hike', status: 'finished', createdAt: 1_700_000_000_000 };
const points = [{ lat: 30, lon: 120, acc: 5, t: 1 }, { lat: 30.001, lon: 120.001, acc: 5, t: 2 }];
const segments = [{ id: 'seg-1', points }];
const waypoints = [{ id: 'wp-1', tripId: 'trip-1', type: 'note', lat: 30, lon: 120 }];
const track = { trip, segments };
const preview = { trip, segments, waypoints, readOnly: true };
let mounted: Array<{ destroy: () => void }> = [];
const originalCreateObjectURL = URL.createObjectURL;

async function mount() {
  const view = createRecordView(mocks.navigate);
  document.body.append(view.view);
  mounted.push(view);
  return view;
}

async function waitForIdleInit() {
  await vi.waitFor(() => expect(mocks.findRecoverableTrip).toHaveBeenCalled());
}

function emitRecorder(name: string, payload?: any) {
  for (const handler of [...(mocks.eventHandlers.get(name) || [])]) handler(payload);
}

async function finish(view: HTMLElement) {
  await waitForIdleInit();
  Object.assign(mocks.rec, { status: 'recording', tripId: 'trip-1' });
  (view.querySelector('.rec-btn.stop') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(view.querySelector('.record-result-sheet')).not.toBeNull());
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  mounted = [];
  mocks.maps.length = 0;
  mocks.eventHandlers.clear();
  Object.assign(mocks.rec, {
    status: 'idle', tripId: null, segmentId: null, live: null, simulated: false,
    permissionDenied: false, geoError: null, activityGuess: null,
    saveState: { pending: 0, lastSavedAt: 0, error: null, degraded: false }
  });
  Object.assign(mocks.rewalk, {
    active: false, tripId: null, name: '', mode: 'full-fwd', pts: [], cum: [],
    total: 0, idx: 0, maxIdx: 0, entryIdx: 0, entryAlong: 0, offTrack: 0,
    phase: 'locating', targetType: 'end', navTarget: null, navTargetType: null,
    lastFix: null, finished: false, departed: false, muted: false, sim: false,
    externalNav: false, approachBand: null
  });
  Object.assign(mocks.appState, {
    view: 'record', activeTripId: null, activeTripFull: null,
    editMode: false, showTripInRecord: false,
    tripDetail: { open: false, tripId: null, section: 'overview' }
  });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
  mocks.getTrip.mockResolvedValue(trip);
  mocks.loadTripTrack.mockResolvedValue(track);
  mocks.listWaypoints.mockResolvedValue(waypoints);
  mocks.loadTripPreview.mockResolvedValue(preview);
  mocks.loadTripFull.mockResolvedValue({ ...track, waypoints, media: [{ blob: new Blob(['photo']) }] });
  mocks.findTrackGaps.mockReturnValue([]);
  mocks.updateTrip.mockResolvedValue(undefined);
  mocks.findRecoverableTrip.mockResolvedValue(null);
  mocks.refreshActiveTrip.mockResolvedValue(null);
  mocks.openCamera.mockReset();
  mocks.modal.mockReset().mockImplementation(({ body }: { body: HTMLElement }) => {
    document.body.append(body);
    return { close: vi.fn(() => body.remove()) };
  });
  mocks.navigate.mockResolvedValue(undefined);
  mocks.safetySettings.enabled = false;
  mocks.openSafetyCheckIn.mockReset();
  mocks.sendSafetyNow.mockReset().mockResolvedValue(undefined);
  mocks.stopRecording.mockImplementation(async () => {
    mocks.rec.status = 'finished';
    mocks.rec.tripId = null;
    mocks.rec.live = null;
    return 'trip-1';
  });
  mocks.setActiveTrip.mockImplementation(async (id: string) => {
    const full = await mocks.loadTripFull(id);
    mocks.appState.activeTripId = id;
    mocks.appState.activeTripFull = full;
    return full;
  });
});

afterEach(() => {
  for (const view of mounted) view.destroy();
  document.body.innerHTML = '';
  if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
  else delete (URL as { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
  vi.restoreAllMocks();
});

describe('record view bounded loading', () => {
  it('finishes and renames with track/waypoint reads only, without loading media', async () => {
    const view = await mount();
    await finish(view.view);

    expect(mocks.loadTripTrack).toHaveBeenCalledWith('trip-1');
    expect(mocks.listWaypoints).toHaveBeenCalledWith('trip-1');
    expect(mocks.maps[0].setTrackData).toHaveBeenCalledWith(segments, waypoints);
    expect(mocks.loadTripFull).not.toHaveBeenCalled();
    expect(mocks.setActiveTrip).not.toHaveBeenCalled();

    const input = view.view.querySelector('#record-result-name') as HTMLInputElement;
    input.value = 'Renamed hike';
    input.dispatchEvent(new Event('input'));
    (view.view.querySelector('[data-result-action="done"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(view.view.querySelector('.record-result-sheet')).toBeNull());
    expect(mocks.updateTrip).toHaveBeenCalledWith('trip-1', { name: 'Renamed hike' });
    expect(mocks.refreshActiveTrip).not.toHaveBeenCalled();
    expect(mocks.loadTripFull).not.toHaveBeenCalled();
  });

  it('loads media on demand only when the result sheet opens analysis', async () => {
    const view = await mount();
    await finish(view.view);
    expect(mocks.loadTripFull).not.toHaveBeenCalled();

    (view.view.querySelector('[data-result-action="analysis"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('analysis'));
    expect(mocks.setActiveTrip).toHaveBeenCalledWith('trip-1');
    expect(mocks.loadTripFull).toHaveBeenCalledTimes(1);
  });

  it('prompts driving trips with large gaps and deep-links to track repair', async () => {
    const view = await mount();
    mocks.loadTripTrack.mockResolvedValue({
      trip: { ...trip, activity: 'drive' },
      segments: [{ id: 'seg-1', points }, { id: 'seg-2', points }]
    });
    mocks.findTrackGaps.mockReturnValue([{ index: 0, distance: 640 }]);
    await finish(view.view);

    const sheet = view.view.querySelector('.record-result-sheet')!;
    expect(sheet.textContent).toContain('record.gapRepairTitle');
    expect(sheet.textContent).toContain('640 m');
    (sheet.querySelector('[data-result-gap-repair]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('analysis', { section: 'data', anchor: 'track-gaps' }));
    expect(mocks.setActiveTrip).toHaveBeenCalledWith('trip-1');
    expect(mocks.loadTripFull).toHaveBeenCalledTimes(1);
  });

  it('reattaches to an active recording without reading media', async () => {
    Object.assign(mocks.rec, { status: 'recording', tripId: 'trip-1' });
    await mount();

    await vi.waitFor(() => expect(mocks.maps[0].setTrackData).toHaveBeenCalledWith(segments, waypoints));
    expect(mocks.loadTripPreview).toHaveBeenCalledWith('trip-1');
    expect(mocks.loadTripTrack).not.toHaveBeenCalled();
    expect(mocks.listWaypoints).not.toHaveBeenCalled();
    expect(mocks.maps[0].updatePosition).toHaveBeenCalledWith(30.001, 120.001, 5, null);
    expect(mocks.loadTripFull).not.toHaveBeenCalled();
    expect(mocks.setActiveTrip).not.toHaveBeenCalled();
  });

  it('refreshes quick-photo waypoints without loading the full track or media', async () => {
    Object.assign(mocks.rec, {
      status: 'recording', tripId: 'trip-1', live: { lat: 30, lon: 120 }
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, value: vi.fn(() => 'blob:photo-thumb')
    });
    mocks.addPhotoWaypoint.mockResolvedValue({
      number: 1, waypoint: { id: 'photo-waypoint' }, media: { id: 'photo-media' }
    });
    const view = await mount();
    await vi.waitFor(() => expect(mocks.maps[0].setTrackData).toHaveBeenCalled());
    mocks.listWaypoints.mockClear();
    mocks.loadTripFull.mockClear();
    mocks.refreshActiveTrip.mockClear();

    (view.view.querySelector('.rec-btn.node') as HTMLButtonElement).click();
    (document.querySelectorAll('.sheet-row')[1] as HTMLButtonElement).click();
    const camera = mocks.openCamera.mock.calls[0][0];
    const result = await camera.onQuickSave({
      fix: { lat: 30, lon: 120 }, takenAt: 1, thumb: new Blob(['thumb'])
    });

    expect(result.ok).toBe(true);
    expect(mocks.listWaypoints).toHaveBeenCalledWith('trip-1');
    expect(mocks.maps[0].setWaypoints).toHaveBeenCalledWith(waypoints);
    expect(mocks.loadTripFull).not.toHaveBeenCalled();
    expect(mocks.refreshActiveTrip).not.toHaveBeenCalled();

    await result.undo();
    expect(mocks.deletePhotoWaypoint).toHaveBeenCalledWith('photo-waypoint', 'trip-1', 'photo-media');
    expect(mocks.listWaypoints).toHaveBeenCalledTimes(2);
    expect(mocks.loadTripFull).not.toHaveBeenCalled();
    expect(mocks.refreshActiveTrip).not.toHaveBeenCalled();
  });

  it('shows an interrupted trip through the bounded preview loader', async () => {
    mocks.findRecoverableTrip.mockResolvedValue({ id: 'trip-1', name: 'Interrupted', status: 'paused' });
    await mount();

    await vi.waitFor(() => expect(mocks.maps[0].setTrackData).toHaveBeenCalledWith(segments, waypoints), { timeout: 2000 });
    expect(mocks.loadTripPreview).toHaveBeenCalledWith('trip-1');
    expect(mocks.loadTripTrack).not.toHaveBeenCalled();
    expect(mocks.listWaypoints).not.toHaveBeenCalled();
    expect(mocks.loadTripFull).not.toHaveBeenCalled();
    expect(mocks.setActiveTrip).not.toHaveBeenCalled();
  });

  it('creates recording additions as route nodes by default', async () => {
    const view = await mount();
    await waitForIdleInit();
    Object.assign(mocks.rec, {
      status: 'recording', tripId: 'trip-1', live: { lat: 30, lon: 120 }
    });
    view.refresh();

    (view.view.querySelector('.rec-btn.node') as HTMLButtonElement).click();
    const sheet = mocks.modal.mock.calls[0][0].body as HTMLElement;
    (sheet.querySelector('.sheet-row') as HTMLButtonElement).click();

    expect(mocks.openWaypointModal).toHaveBeenCalledWith(
      { lat: 30, lon: 120 },
      expect.objectContaining({ tripId: 'trip-1', defaultType: 'route' })
    );
  });

  it('opens a check-in confirmation from the map safety button without changing recording state', async () => {
    const view = await mount();
    await waitForIdleInit();
    (view.view.querySelector('.safety-entry') as HTMLButtonElement).click();
    expect(mocks.openSafetyCheckIn).toHaveBeenCalledWith('checkin');
    expect(mocks.rec.status).toBe('idle');
  });

  it('sends SOS after a two-second hold and swallows the following click', async () => {
    const view = await mount();
    await waitForIdleInit();
    const entry = view.view.querySelector('.safety-entry') as HTMLButtonElement;
    vi.useFakeTimers();
    try {
      const down = new MouseEvent('pointerdown', { bubbles: true });
      Object.defineProperty(down, 'pointerId', { value: 7 });
      entry.dispatchEvent(down);
      expect(entry.classList.contains('holding')).toBe(true);
      vi.advanceTimersByTime(1999);
      expect(mocks.sendSafetyNow).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(mocks.sendSafetyNow).toHaveBeenCalledWith('sos');
      entry.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
      entry.click();
      expect(mocks.openSafetyCheckIn).not.toHaveBeenCalled();
      expect(entry.classList.contains('holding')).toBe(false);
      expect(mocks.rec.status).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a short or cancelled safety hold', async () => {
    const view = await mount();
    await waitForIdleInit();
    const entry = view.view.querySelector('.safety-entry') as HTMLButtonElement;
    vi.useFakeTimers();
    try {
      const down = new MouseEvent('pointerdown', { bubbles: true });
      Object.defineProperty(down, 'pointerId', { value: 8 });
      entry.dispatchEvent(down);
      vi.advanceTimersByTime(1000);
      entry.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
      vi.advanceTimersByTime(2000);
      expect(mocks.sendSafetyNow).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('OLED pocket lock', () => {
    async function enterFromIdle() {
      const view = await mount();
      await waitForIdleInit();
      const entry = view.view.querySelector('.power-lock-entry') as HTMLButtonElement;
      await vi.waitFor(() => expect(entry.disabled).toBe(false));
      expect(view.isPowerLockActive()).toBe(false);
      entry.click();
      expect(view.isPowerLockActive()).toBe(true);
      return { view, entry, target: mocks.maps[0] };
    }

    function unlock() {
      const ring = document.querySelector('.ps-unlock') as HTMLElement;
      ring.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }));
    }

    it('enters manually from idle and restores the map, theme and wake lock on unlock', async () => {
      const { view, target } = await enterFromIdle();

      expect(mocks.rec.status).toBe('idle');
      expect(target.pauseRendering).toHaveBeenCalledTimes(1);
      expect((view.view.querySelector('#map-container') as HTMLElement).style.display).toBe('none');
      expect(document.documentElement.classList.contains('oled-lock')).toBe(true);
      expect(document.querySelector('#oled-dash')?.getAttribute('aria-hidden')).toBe('false');
      expect(mocks.setThemeModeOverride).toHaveBeenCalledWith('dark');
      expect(mocks.setThemeColorOverride).toHaveBeenCalledWith('#000000');
      expect(mocks.requestWakeLock).toHaveBeenCalledTimes(1);

      unlock();

      await vi.waitFor(() => expect(view.isPowerLockActive()).toBe(false));
      expect(target.resumeRendering).toHaveBeenCalledTimes(1);
      expect((view.view.querySelector('#map-container') as HTMLElement).style.display).toBe('');
      expect(document.documentElement.classList.contains('oled-lock')).toBe(false);
      expect(document.querySelector('#oled-dash')?.getAttribute('aria-hidden')).toBe('true');
      expect(mocks.setThemeColorOverride).toHaveBeenLastCalledWith(null);
      expect(mocks.setThemeModeOverride).toHaveBeenLastCalledWith(null);
      expect(mocks.releaseWakeLock).toHaveBeenCalledTimes(1);
    });

    it('adds the SOS action only after safety is enabled and keeps keyboard confirmation available', async () => {
      const { view } = await enterFromIdle();
      expect(document.querySelectorAll('#oled-dash button')).toHaveLength(1);
      expect(document.querySelectorAll('[data-oled-action]')).toHaveLength(0);

      mocks.safetySettings.enabled = true;
      emitRecorder('safety:settings-changed', mocks.safetySettings);
      expect(document.querySelectorAll('#oled-dash button')).toHaveLength(2);
      const sos = document.querySelector('[data-oled-action="sos"]') as HTMLButtonElement;
      expect(sos.disabled).toBe(false);
      sos.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
      expect(mocks.openSafetyCheckIn).toHaveBeenCalledWith('sos');
      expect(view.isPowerLockActive()).toBe(true);
      expect(mocks.rec.status).toBe('idle');
    });

    it('keeps the entry disabled in the finished state', async () => {
      const view = await mount();
      await waitForIdleInit();
      const entry = view.view.querySelector('.power-lock-entry') as HTMLButtonElement;
      await vi.waitFor(() => expect(entry.disabled).toBe(false));

      mocks.rec.status = 'finished';
      view.refresh();
      entry.click();

      expect(entry.disabled).toBe(true);
      expect(view.isPowerLockActive()).toBe(false);
      expect(mocks.maps[0].pauseRendering).not.toHaveBeenCalled();
    });

    it('reacquires the wake lock on pause and direct stop while OLED is active', async () => {
      const { view } = await enterFromIdle();

      mocks.requestWakeLock.mockClear();
      mocks.rec.status = 'paused';
      emitRecorder('recorder:paused');
      expect(mocks.requestWakeLock).toHaveBeenCalledTimes(1);

      mocks.requestWakeLock.mockClear();
      mocks.rec.status = 'finished';
      emitRecorder('recorder:stopped');
      expect(mocks.requestWakeLock).toHaveBeenCalledTimes(1);
      expect(view.isPowerLockActive()).toBe(true);

      unlock();
      await vi.waitFor(() => expect(view.isPowerLockActive()).toBe(false));
      expect(mocks.releaseWakeLock).toHaveBeenCalledTimes(1);
    });
  });

  it('redraws an active re-walk with a preview instead of full media loading', async () => {
    Object.assign(mocks.rewalk, {
      active: true, tripId: 'trip-1', name: 'Hike', cum: [0, 100], total: 100
    });
    await mount();

    await vi.waitFor(() => expect(mocks.maps[0].setTrackData).toHaveBeenCalledWith(segments, waypoints));
    expect(mocks.loadTripPreview).toHaveBeenCalledWith('trip-1');
    expect(mocks.loadTripTrack).not.toHaveBeenCalled();
    expect(mocks.listWaypoints).not.toHaveBeenCalled();
    expect(mocks.loadTripFull).not.toHaveBeenCalled();
  });
});
