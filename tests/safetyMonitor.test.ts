// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendSafetyCheckIn: vi.fn()
}));

vi.mock('../src/core/notifier', () => ({
  sendSafetyCheckIn: mocks.sendSafetyCheckIn
}));

import {
  createWebhook,
  defaultSafetySettings,
  loadSafetySettings,
  saveSafetySettings,
  type SafetyPosition,
  type SafetySettings
} from '../src/core/safety';
import {
  resetLastGasp,
  startSafetyMonitor,
  stopSafetyMonitor
} from '../src/core/safetyMonitor';

const NOW = Date.parse('2026-11-28T08:00:00Z');
const LAST_GASP_KEY = 'localtrace.safety.last-gasp.v1';
let recording = true;
let position: SafetyPosition;
const originalGetBattery = Object.getOwnPropertyDescriptor(navigator, 'getBattery');

function configure(overrides: Partial<SafetySettings> = {}) {
  return saveSafetySettings({
    ...defaultSafetySettings(),
    enabled: true,
    disclaimerAccepted: true,
    senderAlias: 'Alex',
    emergencyEmails: ['family@example.com'],
    emailMode: 'relay',
    relayProxyUrl: 'https://relay.example.com',
    autoCheckInIntervalMin: 15,
    ...overrides
  });
}

function createBattery(level: number, charging = false) {
  const battery = new EventTarget() as EventTarget & { level: number; charging: boolean };
  battery.level = level;
  battery.charging = charging;
  return battery;
}

function installBattery(battery: ReturnType<typeof createBattery>) {
  Object.defineProperty(navigator, 'getBattery', {
    configurable: true,
    value: vi.fn(async () => battery)
  });
  return battery;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function start(positionFollowsClock = true) {
  return startSafetyMonitor({
    getSnapshot: () => ({
      position: positionFollowsClock ? { ...position, timestamp: Date.now() } : position,
      recording
    }),
    getLanguage: () => 'en'
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  localStorage.clear();
  recording = true;
  position = { lat: 30, lon: 120, timestamp: NOW, recordingState: 'recording' };
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(navigator, 'getBattery', { configurable: true, value: undefined });
  mocks.sendSafetyCheckIn.mockResolvedValue([{ channel: 'email', ok: true, detail: 'ok' }]);
});

afterEach(() => {
  stopSafetyMonitor();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  if (originalGetBattery) Object.defineProperty(navigator, 'getBattery', originalGetBattery);
  else delete (navigator as Navigator & { getBattery?: unknown }).getBattery;
});

describe('safety monitor', () => {
  it('sends scheduled check-ins only in a visible active recording with automated options', async () => {
    configure();
    const stop = start();
    await flush();

    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(mocks.sendSafetyCheckIn).toHaveBeenCalledTimes(1);
    expect(mocks.sendSafetyCheckIn).toHaveBeenCalledWith(
      loadSafetySettings(),
      expect.objectContaining({ lat: 30, lon: 120 }),
      'checkin',
      'en',
      expect.objectContaining({ automated: true, allowProtocolLaunch: false })
    );
    stop();
  });

  it('includes direct TG channels in automatic reporting without requiring a relay', async () => {
    const telegram = {
      ...createWebhook('telegram'),
      botToken: '123456789:abcdefghijklmnopqrstuvwxyzABCDE',
      chatId: '-1001234567890'
    };
    configure({
      emergencyEmails: [],
      emailMode: 'mailto',
      relayProxyUrl: '',
      webhooks: [telegram],
      autoCheckInIntervalMin: 15,
      lowBatteryThreshold: 15
    });
    const stop = start();
    await flush();

    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(mocks.sendSafetyCheckIn).toHaveBeenCalledTimes(1);
    expect(loadSafetySettings().webhooks[0].platform).toBe('telegram');
    stop();
  });

  it('does not send while stopped or with a stale position', async () => {
    configure();
    recording = false;
    const stop = start(false);
    await flush();
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(mocks.sendSafetyCheckIn).not.toHaveBeenCalled();

    recording = true;
    position.timestamp = Date.now() - 6 * 60_000;
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(mocks.sendSafetyCheckIn).not.toHaveBeenCalled();
    stop();
  });

  it('catches up once when the app returns to the foreground', async () => {
    configure();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const stop = start();
    await flush();
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(mocks.sendSafetyCheckIn).not.toHaveBeenCalled();

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();

    expect(mocks.sendSafetyCheckIn).toHaveBeenCalledTimes(1);
    stop();
  });

  it('sends one low-battery report per charging cycle while preserving the 15-minute minimum', async () => {
    configure({ autoCheckInIntervalMin: 0, lowBatteryThreshold: 15 });
    const battery = installBattery(createBattery(0.1));
    const stop = start();
    await flush();
    expect(mocks.sendSafetyCheckIn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(LAST_GASP_KEY) || 'null')).toEqual({ at: NOW });

    battery.level = 0.09;
    battery.dispatchEvent(new Event('levelchange'));
    await flush();
    expect(mocks.sendSafetyCheckIn).toHaveBeenCalledTimes(1);

    battery.charging = true;
    battery.dispatchEvent(new Event('chargingchange'));
    expect(localStorage.getItem(LAST_GASP_KEY)).toBeNull();

    battery.charging = false;
    battery.dispatchEvent(new Event('chargingchange'));
    await flush();
    expect(mocks.sendSafetyCheckIn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(mocks.sendSafetyCheckIn).toHaveBeenCalledTimes(2);
    stop();
  });

  it('keeps an attempted low-battery report deduplicated after a restart', async () => {
    configure({ autoCheckInIntervalMin: 0, lowBatteryThreshold: 15 });
    const battery = installBattery(createBattery(0.1));
    const stop = start();
    await flush();
    expect(mocks.sendSafetyCheckIn).toHaveBeenCalledTimes(1);
    stop();

    const stopAfterReload = start();
    await flush();
    battery.level = 0.09;
    battery.dispatchEvent(new Event('levelchange'));
    await flush();
    expect(mocks.sendSafetyCheckIn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(LAST_GASP_KEY) || 'null')).toEqual({ at: NOW });
    stopAfterReload();
  });

  it('waits for recording instead of consuming the low-battery marker', async () => {
    configure({ autoCheckInIntervalMin: 0, lowBatteryThreshold: 15 });
    const battery = installBattery(createBattery(0.1));
    recording = false;
    const stop = start();
    await flush();
    expect(mocks.sendSafetyCheckIn).not.toHaveBeenCalled();
    expect(localStorage.getItem(LAST_GASP_KEY)).toBeNull();

    recording = true;
    battery.dispatchEvent(new Event('levelchange'));
    await flush();
    expect(mocks.sendSafetyCheckIn).toHaveBeenCalledTimes(1);
    stop();
  });

  it('removes interval, visibility, settings and battery listeners on cleanup', async () => {
    configure({ autoCheckInIntervalMin: 15, lowBatteryThreshold: 15 });
    const battery = installBattery(createBattery(0.5));
    const stop = start();
    await flush();
    stop();

    battery.level = 0.1;
    battery.dispatchEvent(new Event('levelchange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(mocks.sendSafetyCheckIn).not.toHaveBeenCalled();
  });

  it('ignores a battery promise that resolves after the monitor is restarted', async () => {
    configure({ autoCheckInIntervalMin: 0, lowBatteryThreshold: 15 });
    const oldBattery = createBattery(0.1);
    let resolveOld!: (battery: typeof oldBattery) => void;
    const getBattery = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(createBattery(0.5));
    Object.defineProperty(navigator, 'getBattery', { configurable: true, value: getBattery });

    const stopOld = start();
    stopOld();
    const stopCurrent = start();
    await flush();
    resolveOld(oldBattery);
    await flush();
    oldBattery.dispatchEvent(new Event('levelchange'));
    await flush();

    expect(mocks.sendSafetyCheckIn).not.toHaveBeenCalled();
    stopCurrent();
  });

  it('clears the persisted low-battery marker on reset', () => {
    localStorage.setItem(LAST_GASP_KEY, JSON.stringify({ at: NOW }));
    resetLastGasp();
    expect(localStorage.getItem(LAST_GASP_KEY)).toBeNull();
  });
});
