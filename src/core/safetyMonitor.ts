import { on } from './events';
import { sendSafetyCheckIn, type NotifierOptions } from './notifier';
import {
  loadSafetySettings,
  validateSafetySettings,
  type CheckInKind,
  type SafetyPosition,
  type SafetySendResult,
  type SafetySettings
} from './safety';

export interface SafetySnapshot {
  position: SafetyPosition | null;
  recording: boolean;
}

export interface SafetyMonitorHost {
  getSnapshot: () => SafetySnapshot;
  getLanguage: () => string;
  onResult?: (kind: CheckInKind, position: SafetyPosition, results: SafetySendResult[]) => void;
  notifierOptions?: NotifierOptions;
}

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}

const LAST_GASP_KEY = 'localtrace.safety.last-gasp.v1';
const MAX_POSITION_AGE_MS = 5 * 60_000;
const MIN_AUTO_INTERVAL_MS = 15 * 60_000;
let started = false;
let stopHost: (() => void) | null = null;

function fresh(position: SafetyPosition | null, now: number): position is SafetyPosition {
  if (!position || !Number.isFinite(position.timestamp)) return false;
  const age = now - position.timestamp!;
  return age >= -60_000 && age <= MAX_POSITION_AGE_MS;
}

function autoCapable(settings: SafetySettings): boolean {
  return (settings.emailMode === 'relay' && settings.emergencyEmails.length > 0)
    || settings.webhooks.some((webhook) => {
      if (!webhook.enabled) return false;
      return webhook.platform === 'telegram'
        ? Boolean(webhook.botToken?.trim() && webhook.chatId?.trim())
        : Boolean(webhook.url.trim());
    });
}

function lastGasp(): number {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_GASP_KEY) || 'null');
    return typeof value?.at === 'number' ? value.at : 0;
  } catch {
    return 0;
  }
}

function markLastGasp(at: number): void {
  try { localStorage.setItem(LAST_GASP_KEY, JSON.stringify({ at })); } catch { /* storage unavailable */ }
}

function clearLastGasp(): void {
  try { localStorage.removeItem(LAST_GASP_KEY); } catch { /* storage unavailable */ }
}

export function startSafetyMonitor(host: SafetyMonitorHost): () => void {
  if (started) return () => {};
  started = true;
  let active = true;
  let settings = loadSafetySettings();
  let nextAutoAt = 0;
  let lastAutoAt = 0;
  let pendingLowBattery = false;
  let sending = false;
  let battery: BatteryManagerLike | null = null;
  let stopBattery: (() => void) | null = null;
  const batteryLevel = () => battery?.level;

  const resetSchedule = () => {
    nextAutoAt = settings.autoCheckInIntervalMin > 0 ? Date.now() + settings.autoCheckInIntervalMin * 60_000 : 0;
  };

  const deliver = async (kind: CheckInKind, lowBatteryReport = false): Promise<boolean> => {
    const snapshot = host.getSnapshot();
    const now = Date.now();
    if (
      sending || document.hidden || !settings.enabled || !settings.disclaimerAccepted
      || validateSafetySettings(settings).length || !snapshot.recording
      || !autoCapable(settings) || !fresh(snapshot.position, now)
      || now - lastAutoAt < MIN_AUTO_INTERVAL_MS
    ) return false;
    const position = { ...snapshot.position!, batteryLevel: batteryLevel() ?? snapshot.position!.batteryLevel };
    if (lowBatteryReport) markLastGasp(now);
    sending = true;
    lastAutoAt = now;
    try {
      const results = await sendSafetyCheckIn(settings, position, kind, host.getLanguage(), {
        ...host.notifierOptions,
        automated: true,
        allowProtocolLaunch: false
      });
      host.onResult?.(kind, position, results);
      return true;
    } catch {
      host.onResult?.(kind, position, [{ channel: 'auto', ok: false, detail: 'send-failed', fallback: 'copy' }]);
      return true;
    } finally {
      sending = false;
    }
  };

  const tick = () => {
    if (!active || sending || document.hidden || !settings.enabled || !host.getSnapshot().recording) return;
    const now = Date.now();
    const threshold = settings.lowBatteryThreshold;
    const scheduledDue = settings.autoCheckInIntervalMin > 0 && now >= nextAutoAt;
    const lowDue = pendingLowBattery && !!battery && !battery.charging
      && threshold > 0 && battery.level <= threshold / 100;
    if ((!scheduledDue && !lowDue) || now - lastAutoAt < MIN_AUTO_INTERVAL_MS) return;
    if (scheduledDue) nextAutoAt = now + settings.autoCheckInIntervalMin * 60_000;
    void deliver('checkin', lowDue).then((attempted) => {
      if (attempted) pendingLowBattery = false;
    });
  };

  const lowBattery = () => {
    if (!battery) return;
    if (battery.charging) {
      pendingLowBattery = false;
      clearLastGasp();
      return;
    }
    const threshold = settings.lowBatteryThreshold;
    if (
      !settings.enabled || !settings.disclaimerAccepted || !threshold
      || battery.level > threshold / 100 || lastGasp()
    ) return;
    pendingLowBattery = true;
    tick();
  };

  const unsubscribeSettings = on('safety:settings-changed', (next: SafetySettings) => {
    settings = next;
    pendingLowBattery = false;
    resetSchedule();
    lowBattery();
  });
  const timer = window.setInterval(tick, 15_000);
  const visibility = () => { if (!document.hidden) tick(); };
  document.addEventListener('visibilitychange', visibility);
  resetSchedule();

  const setupBattery = async () => {
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> }).getBattery;
    if (!getBattery?.bind(navigator)) return;
    try {
      battery = await getBattery.call(navigator);
      if (!active) return;
      battery.addEventListener('levelchange', lowBattery);
      battery.addEventListener('chargingchange', lowBattery);
      stopBattery = () => {
        battery?.removeEventListener('levelchange', lowBattery);
        battery?.removeEventListener('chargingchange', lowBattery);
        battery = null;
      };
      lowBattery();
    } catch { /* Battery API unavailable or denied */ }
  };
  void setupBattery();

  const cleanup = () => {
    if (!active) return;
    active = false;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', visibility);
    unsubscribeSettings();
    stopBattery?.();
    stopBattery = null;
  };
  stopHost = cleanup;
  return () => {
    cleanup();
    if (stopHost === cleanup) {
      stopHost = null;
      started = false;
    }
  };
}

export function stopSafetyMonitor(): void {
  stopHost?.();
  stopHost = null;
  started = false;
}

export function resetLastGasp(): void {
  clearLastGasp();
}
