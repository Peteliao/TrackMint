import { emit } from './events';

export const SAFETY_STORAGE_KEY = 'localtrace.safety.v1';

export type WebhookPlatform = 'wecom' | 'feishu' | 'dingtalk' | 'telegram' | 'ntfy' | 'bark' | 'custom';
export type PreferredNavMap = 'all' | 'amap' | 'google' | 'apple';
export type CheckInKind = 'checkin' | 'sos' | 'test';

export interface WebhookConfig {
  id: string;
  name: string;
  platform: WebhookPlatform;
  enabled: boolean;
  url: string;
  secret?: string;
  keyword?: string;
  customTemplate?: string;
  botToken?: string;
  chatId?: string;
  messageThreadId?: number;
  sendNativeLocation?: boolean;
}

export interface SafetySettings {
  enabled: boolean;
  disclaimerAccepted: boolean;
  disclaimerAcceptedAt?: number;
  senderAlias: string;
  emergencyEmails: string[];
  emergencyPhone: string;
  preferredNavMap: PreferredNavMap;
  relayProxyUrl: string;
  relayToken: string;
  emailMode: 'mailto' | 'relay';
  webhooks: WebhookConfig[];
  autoCheckInIntervalMin: 0 | 15 | 30 | 60;
  lowBatteryThreshold: 0 | 10 | 15 | 20;
  sosFeedback: boolean;
}

export interface SafetyPosition {
  lat: number;
  lon: number;
  accuracy?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  timestamp?: number;
  distanceM?: number;
  durationMs?: number;
  batteryLevel?: number;
  recordingState?: 'idle' | 'recording' | 'paused' | 'finished';
}

export interface SafetySendResult {
  channel: string;
  ok: boolean;
  detail: string;
  fallback?: 'mailto' | 'sms' | 'copy';
}

export const WEBHOOK_PLATFORMS: WebhookPlatform[] = ['wecom', 'feishu', 'dingtalk', 'telegram', 'ntfy', 'bark', 'custom'];
export const CHECK_IN_INTERVALS: SafetySettings['autoCheckInIntervalMin'][] = [0, 15, 30, 60];
export const LOW_BATTERY_THRESHOLDS: SafetySettings['lowBatteryThreshold'][] = [0, 10, 15, 20];

export function defaultSafetySettings(): SafetySettings {
  return {
    enabled: false,
    disclaimerAccepted: false,
    senderAlias: '',
    emergencyEmails: [],
    emergencyPhone: '',
    preferredNavMap: 'all',
    relayProxyUrl: '',
    relayToken: '',
    emailMode: 'mailto',
    webhooks: [],
    autoCheckInIntervalMin: 0,
    lowBatteryThreshold: 0,
    sosFeedback: true
  };
}

export function createWebhook(platform: WebhookPlatform = 'ntfy'): WebhookConfig {
  return {
    id: globalThis.crypto?.randomUUID?.() || `safety-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: platform === 'telegram' ? 'TG' : platform,
    platform,
    enabled: true,
    url: '',
    secret: '',
    keyword: '',
    customTemplate: '',
    ...(platform === 'telegram' ? { botToken: '', chatId: '', sendNativeLocation: true } : {})
  };
}

function text(value: unknown, max = 2048): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function oneOf<T extends string | number>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback;
}

function normalizeEmails(value: unknown): string[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，;；\n]+/) : [];
  return [...new Set(source.map((item) => text(item, 254).toLowerCase()).filter(Boolean))].slice(0, 10);
}

export function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '').slice(0, 24);
}

export function telegramConfigError(webhook: WebhookConfig): string | null {
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(webhook.botToken || '')) return 'tg-token';
  if (!/^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/.test(webhook.chatId || '')) return 'tg-chat-id';
  if (webhook.messageThreadId != null
    && (!Number.isInteger(webhook.messageThreadId) || webhook.messageThreadId < 1 || webhook.messageThreadId > 2_147_483_647)) {
    return 'tg-thread';
  }
  if (webhook.url) {
    try {
      const url = new URL(webhook.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        return 'tg-api-base';
      }
    } catch {
      return 'tg-api-base';
    }
  }
  return null;
}

export function normalizeSafetySettings(value: unknown): SafetySettings {
  const defaults = defaultSafetySettings();
  if (!value || typeof value !== 'object') return defaults;
  const raw = value as Partial<SafetySettings>;
  const disclaimerAccepted = raw.disclaimerAccepted === true;
  const webhooks = Array.isArray(raw.webhooks) ? raw.webhooks.slice(0, 12).map((item) => {
    const entry = (item || {}) as Partial<WebhookConfig>;
    const platform = oneOf(entry.platform, WEBHOOK_PLATFORMS, 'ntfy');
    const messageThreadId = Number(entry.messageThreadId);
    return {
      ...createWebhook(platform),
      id: text(entry.id, 80) || createWebhook(platform).id,
      name: text(entry.name, 80),
      enabled: entry.enabled !== false,
      url: text(entry.url, 4096),
      secret: text(entry.secret, 1024),
      keyword: text(entry.keyword, 120),
      customTemplate: typeof entry.customTemplate === 'string' ? entry.customTemplate.slice(0, 32_768) : '',
      botToken: text(entry.botToken, 128),
      chatId: text(entry.chatId, 64),
      messageThreadId: Number.isInteger(messageThreadId) && messageThreadId > 0 && messageThreadId <= 2_147_483_647
        ? messageThreadId
        : undefined,
      sendNativeLocation: entry.sendNativeLocation !== false
    };
  }) : [];
  return {
    enabled: raw.enabled === true && disclaimerAccepted,
    disclaimerAccepted,
    disclaimerAcceptedAt: typeof raw.disclaimerAcceptedAt === 'number' && Number.isFinite(raw.disclaimerAcceptedAt)
      ? raw.disclaimerAcceptedAt
      : undefined,
    senderAlias: text(raw.senderAlias, 80),
    emergencyEmails: normalizeEmails(raw.emergencyEmails),
    emergencyPhone: normalizePhone(text(raw.emergencyPhone, 32)),
    preferredNavMap: oneOf(raw.preferredNavMap, ['all', 'amap', 'google', 'apple'] as const, 'all'),
    relayProxyUrl: text(raw.relayProxyUrl, 2048),
    relayToken: text(raw.relayToken, 2048),
    emailMode: oneOf(raw.emailMode, ['mailto', 'relay'] as const, 'mailto'),
    webhooks,
    autoCheckInIntervalMin: oneOf(raw.autoCheckInIntervalMin, CHECK_IN_INTERVALS, 0),
    lowBatteryThreshold: oneOf(raw.lowBatteryThreshold, LOW_BATTERY_THRESHOLDS, 0),
    sosFeedback: raw.sosFeedback !== false
  };
}

export function loadSafetySettings(): SafetySettings {
  try {
    return normalizeSafetySettings(JSON.parse(localStorage.getItem(SAFETY_STORAGE_KEY) || 'null'));
  } catch {
    return defaultSafetySettings();
  }
}

export function saveSafetySettings(settings: SafetySettings): SafetySettings {
  const normalized = normalizeSafetySettings(settings);
  try {
    localStorage.setItem(SAFETY_STORAGE_KEY, JSON.stringify(normalized));
    emit('safety:settings-changed', normalized);
  } catch { /* storage unavailable */ }
  return normalized;
}

export function parseEmails(value: string): string[] {
  return normalizeEmails(value);
}

export function hasDeliveryChannel(settings: SafetySettings): boolean {
  return settings.emergencyEmails.length > 0 || settings.webhooks.some((webhook) => {
    if (!webhook.enabled) return false;
    return webhook.platform === 'telegram'
      ? Boolean(webhook.botToken?.trim() && webhook.chatId?.trim())
      : Boolean(webhook.url.trim());
  });
}

export function needsRelay(settings: SafetySettings): boolean {
  return settings.emailMode === 'relay' || settings.webhooks.some((webhook) =>
    webhook.enabled && ['wecom', 'feishu', 'dingtalk'].includes(webhook.platform));
}

export function validateSafetySettings(settings: SafetySettings): string[] {
  const errors: string[] = [];
  if (!settings.enabled) return errors;
  if (!settings.disclaimerAccepted) errors.push('disclaimer');
  if (!settings.senderAlias.trim()) errors.push('senderAlias');
  if (!hasDeliveryChannel(settings) && !settings.emergencyPhone) errors.push('channels');
  for (const email of settings.emergencyEmails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`email:${email}`);
  }
  if (settings.emergencyPhone && !/^\+?\d{5,20}$/.test(settings.emergencyPhone)) errors.push('emergencyPhone');
  if ((needsRelay(settings) || settings.relayProxyUrl.trim()) && !/^https:\/\//i.test(settings.relayProxyUrl)) errors.push('relayProxyUrl');
  for (const webhook of settings.webhooks.filter((item) => item.enabled)) {
    if (webhook.platform === 'telegram') {
      const code = telegramConfigError(webhook);
      if (code) errors.push(`webhook:${webhook.id}:${code}`);
      continue;
    }
    if (!/^https:\/\//i.test(webhook.url)) errors.push(`webhook:${webhook.id}:url`);
    if (webhook.platform === 'custom' && webhook.customTemplate?.trim()) {
      try { JSON.parse(webhook.customTemplate); } catch { errors.push(`webhook:${webhook.id}:template`); }
    }
  }
  return errors;
}
