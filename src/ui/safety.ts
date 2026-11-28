import { currentLang, en, t, zh } from '../core/i18n';
import { rec } from '../core/recorder';
import { buildSafetyMessage } from '../core/navLinks';
import { fallbackHref, safetyCooldownRemaining, sendSafetyCheckIn } from '../core/notifier';
import {
  loadSafetySettings,
  saveSafetySettings,
  validateSafetySettings,
  type CheckInKind,
  type SafetyPosition,
  type SafetySendResult,
  type SafetySettings
} from '../core/safety';
import { el, icon, modal, toast } from './helpers';

export function readSafetyBattery(): Promise<number | null> {
  const getBattery = (navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }).getBattery;
  return getBattery?.call(navigator)
    .then((battery) => battery.level >= 0 && battery.level <= 1 ? battery.level : null)
    .catch(() => null) || Promise.resolve(null);
}

function recorderState(): SafetyPosition['recordingState'] {
  const status = rec.status;
  return status === 'recording' || status === 'paused' || status === 'finished' ? status : 'idle';
}

export function safetyPositionFromRecorder(): SafetyPosition | null {
  const live = rec.live;
  if (!live || !Number.isFinite(live.lat) || !Number.isFinite(live.lon)) return null;
  const timestamp = rec.lastPoint?.t || rec.lastFixWall;
  if (!timestamp) return null;
  return {
    lat: live.lat,
    lon: live.lon,
    accuracy: live.acc ?? undefined,
    altitude: live.alt ?? undefined,
    speed: live.speed ?? undefined,
    heading: rec.lastPoint?.heading ?? undefined,
    timestamp,
    distanceM: live.distance,
    durationMs: live.duration,
    recordingState: recorderState()
  };
}

export async function locateForSafety(): Promise<SafetyPosition | null> {
  const current = safetyPositionFromRecorder();
  if (current && Date.now() - (current.timestamp || 0) <= 5 * 60_000) {
    return { ...current, batteryLevel: await readSafetyBattery() ?? current.batteryLevel };
  }
  if (!navigator.geolocation) return null;
  const position = await new Promise<SafetyPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (fix) => resolve({
        lat: fix.coords.latitude,
        lon: fix.coords.longitude,
        accuracy: fix.coords.accuracy,
        altitude: fix.coords.altitude ?? undefined,
        speed: fix.coords.speed ?? undefined,
        heading: fix.coords.heading ?? undefined,
        timestamp: fix.timestamp || Date.now(),
        recordingState: recorderState()
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 }
    );
  });
  return position ? { ...position, batteryLevel: await readSafetyBattery() ?? position.batteryLevel } : null;
}

export async function acceptSafetyDisclaimer(
  settings: SafetySettings = loadSafetySettings()
): Promise<SafetySettings | null> {
  if (settings.disclaimerAccepted) return settings;
  const checkbox = el('input', { type: 'checkbox' });
  const accept = el('button', { class: 'btn primary', disabled: true }, t('safety.disclaimerAccept'));
  checkbox.onchange = () => { accept.disabled = !checkbox.checked; };
  let settled = false;
  let resolveDisclaimer: (value: SafetySettings | null) => void;
  const result = new Promise<SafetySettings | null>((resolve) => { resolveDisclaimer = resolve; });
  const finish = (value: SafetySettings | null) => {
    if (settled) return;
    settled = true;
    resolveDisclaimer(value);
  };
  const dialog = modal({
    title: t('safety.disclaimerTitle'),
    body: el('div', { class: 'safety-disclaimer' },
      el('p', { class: 'small faint', lang: 'zh-CN' }, '中文'),
      el('p', { class: 'safety-disclaimer-text', lang: 'zh-CN' }, zh.safety.disclaimerBody),
      el('p', { class: 'small faint', lang: 'en' }, 'English'),
      el('p', { class: 'safety-disclaimer-text', lang: 'en' }, en.safety.disclaimerBody),
      el('label', { class: 'safety-check' }, checkbox, el('span', {}, t('safety.disclaimerCheck')))),
    footer: [el('button', { class: 'btn ghost', onclick: () => dialog.close() }, t('common.close')), accept],
    onClose: () => finish(null)
  });
  accept.onclick = () => {
    const enabled = validateSafetySettings({ ...settings, enabled: true, disclaimerAccepted: true }).length === 0;
    const accepted = saveSafetySettings({
      ...settings,
      enabled,
      disclaimerAccepted: true,
      disclaimerAcceptedAt: Date.now()
    });
    finish(accepted);
    dialog.close();
  };
  return result;
}

function channelName(settings: SafetySettings, channel: string): string {
  if (channel === 'email') return settings.emailMode === 'mailto' ? t('safety.emailMailto') : t('safety.emailRelay');
  const webhook = settings.webhooks.find((item) => item.id === channel);
  return webhook?.name.trim() || (webhook ? t(`safety.platforms.${webhook.platform}`) : t('safety.channel'));
}

function channelNames(settings: SafetySettings): string[] {
  const names: string[] = [];
  if (settings.emergencyEmails.length) names.push(channelName(settings, 'email'));
  if (settings.emergencyPhone) names.push(t('safety.sms'));
  for (const webhook of settings.webhooks.filter((item) => item.enabled
    && (item.platform === 'telegram' || item.url.trim()))) {
    names.push(channelName(settings, webhook.id));
  }
  return names;
}

function playSosFeedback(): void {
  try { navigator.vibrate?.([200, 100, 200, 100, 400]); } catch { /* vibration unavailable */ }
  const flash = el('div', { class: 'sos-flash', 'aria-hidden': 'true' });
  document.body.append(flash);
  setTimeout(() => flash.remove(), 900);
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.setValueAtTime(660, context.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.46);
    oscillator.onended = () => void context.close();
  } catch { /* audio unavailable */ }
}

async function copyRescueText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('safety.copied'), 'ok');
    return;
  } catch { /* use selection fallback */ }
  const area = el('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
  area.value = text;
  document.body.append(area);
  area.focus();
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  toast(copied ? t('safety.copied') : t('safety.copyFail'), copied ? 'ok' : 'warn');
}

export function openSafetyFallback(
  settings: SafetySettings,
  position: SafetyPosition,
  kind: CheckInKind,
  results: SafetySendResult[] = []
): void {
  const message = buildSafetyMessage(position, settings, kind, currentLang());
  const mailto = fallbackHref(settings, message, 'mailto');
  const sms = fallbackHref(settings, message, 'sms');
  const failed = results.filter((result) => !result.ok);
  const dialog = modal({
    title: t('safety.offlineTitle'),
    body: el('div', { class: 'safety-fallback' },
      el('p', { class: 'muted' }, t('safety.offlineBody')),
      failed.length ? el('div', { class: 'small safety-failure-list' }, failed.map((result) =>
        el('div', {}, `${channelName(settings, result.channel)}: ${result.detail}`))) : null,
      el('pre', { class: 'safety-rescue-text' }, message.smsText)),
    footer: [
      el('button', { class: 'btn ghost', onclick: () => void copyRescueText(message.smsText) }, icon('copy', 15), t('safety.copyText')),
      sms ? el('a', { class: 'btn primary', href: sms }, icon('chat', 15), t('safety.sms')) : null,
      mailto ? el('a', { class: 'btn ghost', href: mailto }, icon('send', 15), t('safety.emailMailto')) : null
    ].filter(Boolean)
  });
  dialog.box.classList.add('safety-fallback-modal');
}

function resultSummary(results: SafetySendResult[]): { ok: boolean; draftOnly: boolean; hasDraft: boolean } {
  return {
    ok: results.length > 0 && results.every((result) => result.ok),
    draftOnly: results.length > 0 && results.every((result) => result.ok && result.detail === 'draft-opened'),
    hasDraft: results.some((result) => result.ok && result.detail === 'draft-opened')
  };
}

export async function sendSafetyNow(kind: CheckInKind, preset?: SafetyPosition): Promise<void> {
  let settings = loadSafetySettings();
  if (!settings.enabled || !settings.disclaimerAccepted) {
    settings = await acceptSafetyDisclaimer() || settings;
    if (!settings.enabled) {
      toast(t('safety.configureFirst'), 'warn', 4200);
      return;
    }
  }
  const cooldown = safetyCooldownRemaining();
  if (cooldown > 0) {
    toast(t('safety.cooldown'), 'warn');
    return;
  }
  if (validateSafetySettings(settings).length) {
    toast(t('safety.configureFirst'), 'warn', 4200);
    return;
  }
  const position = preset || await locateForSafety();
  if (!position) {
    toast(t('safety.noLocation'), 'err');
    return;
  }
  if (kind === 'sos' && settings.sosFeedback) playSosFeedback();
  if (!navigator.onLine) {
    openSafetyFallback(settings, position, kind, [{ channel: 'offline', ok: false, detail: 'offline' }]);
    return;
  }
  try {
    const results = await sendSafetyCheckIn(settings, position, kind, currentLang());
    const summary = resultSummary(results);
    if (summary.ok) toast(summary.draftOnly ? t('safety.draftOpened') : summary.hasDraft ? t('safety.sentWithDraft') : t('safety.sent'), 'ok');
    else {
      toast(t('safety.partial'), 'warn');
      openSafetyFallback(settings, position, kind, results);
    }
  } catch (error) {
    const code = (error as Error).message;
    toast(t(code === 'cooldown' ? 'safety.cooldown' : code === 'safety-disabled' ? 'safety.disabled' : 'safety.failed'), 'err');
  }
}

export function openSafetyCheckIn(kind: 'checkin' | 'sos' = 'checkin'): void {
  void (async () => {
    let settings = loadSafetySettings();
    if (!settings.enabled || !settings.disclaimerAccepted) {
      settings = await acceptSafetyDisclaimer() || settings;
      if (!settings.enabled) {
        toast(t('safety.configureFirst'), 'warn', 4200);
        return;
      }
    }
    if (validateSafetySettings(settings).length) {
      toast(t('safety.configureFirst'), 'warn', 4200);
      return;
    }
    const position = await locateForSafety();
    if (!position) {
      toast(t('safety.noLocation'), 'err');
      return;
    }
    const message = buildSafetyMessage(position, settings, kind, currentLang());
    const send = el('button', { class: `btn ${kind === 'sos' ? 'danger' : 'primary'}` }, icon('shield', 15), t(kind === 'sos' ? 'safety.sosSend' : 'safety.confirmSend'));
    const dialog = modal({
      title: t(kind === 'sos' ? 'safety.sosTitle' : 'safety.confirmTitle'),
      body: el('div', { class: 'safety-confirm' },
        el('div', { class: 'safety-position-card' },
          el('div', { class: 'safety-coordinates' }, `${position.lat.toFixed(6)}, ${position.lon.toFixed(6)}`),
          el('div', { class: 'small muted' }, `${t('safety.accuracy')}: ${position.accuracy == null ? '--' : `±${Math.round(position.accuracy)}m`}`),
          position.altitude != null ? el('div', { class: 'small muted' }, `${t('safety.altitude')}: ${Math.round(position.altitude)}m`) : null,
          position.batteryLevel != null ? el('div', { class: 'small muted' }, `${t('safety.battery')}: ${Math.round(position.batteryLevel * 100)}%`) : null),
        el('div', { class: 'small muted safety-channel-preview' }, `${t('safety.channels')}: ${channelNames(settings).join(' · ') || t('safety.noChannels')}`),
        el('pre', { class: 'small safety-rescue-text' }, message.smsText),
        el('p', { class: 'small faint' }, t('safety.privacyBypass'))),
      footer: [el('button', { class: 'btn ghost', onclick: () => dialog.close() }, t('common.cancel')), send]
    });
    send.onclick = () => {
      dialog.close();
      void sendSafetyNow(kind, position);
    };
  })();
}

export function handleSafetyMonitorResult(kind: CheckInKind, position: SafetyPosition, results: SafetySendResult[]): void {
  const settings = loadSafetySettings();
  const summary = resultSummary(results);
  if (summary.ok) toast(t('safety.autoSent'), 'ok');
  else {
    toast(t('safety.autoFailed'), 'warn', 5000);
    openSafetyFallback(settings, position, kind, results);
  }
}
