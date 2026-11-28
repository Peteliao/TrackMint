import { buildMailtoHref, buildSafetyMessage, type SafetyMessage } from './navLinks';
import type {
  CheckInKind,
  SafetyPosition,
  SafetySendResult,
  SafetySettings,
  WebhookConfig
} from './safety';
import { telegramConfigError } from './safety';

export interface NotifierOptions {
  fetchImpl?: typeof fetch;
  openUrl?: (url: string) => void;
  now?: () => number;
  signal?: AbortSignal;
  allowProtocolLaunch?: boolean;
  automated?: boolean;
}

const MANUAL_COOLDOWN_MS = 10_000;
const REQUEST_TIMEOUT_MS = 12_000;
let lastManualSentAt = 0;

function utf8Header(value: string): string {
  return [...new TextEncoder().encode(value)].map((byte) => String.fromCharCode(byte)).join('');
}

export function safetyCooldownRemaining(now = Date.now()): number {
  return Math.max(0, MANUAL_COOLDOWN_MS - (now - lastManualSentAt));
}

function validPosition(position: SafetyPosition): void {
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lon)
    || Math.abs(position.lat) > 90 || Math.abs(position.lon) > 180) {
    throw new Error('invalid-position');
  }
}

async function hmacBase64(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  let binary = '';
  new Uint8Array(signature).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function relayBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function responseInfo(response: Response): Promise<{ detail: string; messageId?: number }> {
  if (!response.ok) return { detail: `http-${response.status}` };
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) return { detail: 'ok' };
  try {
    const data = await response.json() as Record<string, any>;
    if (data.ok === false) {
      return { detail: String(data.error || data.errmsg || data.msg || data.code || 'provider-error').slice(0, 240) };
    }
    const code = data.errcode ?? data.code ?? data.StatusCode ?? data.status;
    if ((typeof code === 'number' && code !== 0 && code !== 200)
      || (typeof code === 'string' && !['0', '200', 'success', 'ok'].includes(code.toLowerCase()))) {
      return { detail: String(data.errmsg || data.msg || data.Message || data.error || code).slice(0, 240) };
    }
    const messageId = data.result?.message_id;
    return { detail: 'ok', ...(Number.isInteger(messageId) && messageId > 0 ? { messageId } : {}) };
  } catch {
    return { detail: 'ok' };
  }
}

async function responseDetail(response: Response): Promise<string> {
  return (await responseInfo(response)).detail;
}

type PostJsonResult = SafetySendResult & { providerMessageId?: number };

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  options: NotifierOptions
): Promise<PostJsonResult> {
  let target: URL;
  try { target = new URL(url); } catch {
    return { channel: url, ok: false, detail: 'invalid-url', fallback: 'copy' };
  }
  if (target.protocol !== 'https:') {
    return { channel: url, ok: false, detail: 'https-required', fallback: 'copy' };
  }
  const fetcher = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const externalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', externalAbort, { once: true });
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    });
    const { detail, messageId } = await responseInfo(response);
    return {
      channel: url,
      ok: detail === 'ok',
      detail,
      ...(detail === 'ok' ? {} : { fallback: 'copy' as const }),
      ...(messageId ? { providerMessageId: messageId } : {})
    };
  } catch (error) {
    const name = (error as Error)?.name;
    return {
      channel: url,
      ok: false,
      detail: name === 'AbortError' ? 'timeout' : name === 'TypeError' ? 'network-or-cors' : 'send-failed',
      fallback: 'copy'
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', externalAbort);
  }
}

async function relayWebhook(
  settings: SafetySettings,
  webhook: WebhookConfig,
  payload: unknown,
  options: NotifierOptions
): Promise<SafetySendResult> {
  const result = await postJson(
    `${relayBase(settings.relayProxyUrl)}/api/notify/webhook`,
    { url: webhook.url, body: payload },
    settings.relayToken ? { Authorization: `Bearer ${settings.relayToken}` } : {},
    options
  );
  return { ...result, channel: webhook.id };
}

function markdownLinks(message: SafetyMessage): string {
  return message.links.map((link) => `[${link.label}](${link.url})`).join('\n');
}

function renderCustomTemplate(template: string, message: SafetyMessage, position: SafetyPosition, settings: SafetySettings): unknown {
  const values: Record<string, string> = {
    title: message.title,
    text: message.text,
    smsText: message.smsText,
    sender: settings.senderAlias,
    lat: String(position.lat),
    lon: String(position.lon),
    accuracy: String(position.accuracy ?? ''),
    altitude: String(position.altitude ?? ''),
    battery: Number.isFinite(position.batteryLevel) ? String(Math.round(position.batteryLevel! * 100)) : '',
    timestamp: String(position.timestamp || Date.now()),
    links: JSON.stringify(message.links),
    amap: message.links.find((link) => link.map === 'amap')?.url || '',
    google: message.links.find((link) => link.map === 'google')?.url || '',
    apple: message.links.find((link) => link.map === 'apple')?.url || ''
  };
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, key: string) => values[key] ?? match);
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replace(entry)]));
    }
    return value;
  };
  try {
    return replace(JSON.parse(template));
  } catch {
    throw new Error('invalid-custom-template');
  }
}

interface TelegramRequest {
  method: 'sendLocation' | 'sendMessage';
  body: Record<string, unknown>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]!);
}

function telegramText(message: SafetyMessage): string {
  return message.text.split('\n').map((line, index) => {
    if (index === 0) return `<b>${escapeHtml(line)}</b>`;
    const coordinates = line.match(/^([^:：]*WGS-84\)?[：:]\s*)(-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?)(.*)$/);
    if (coordinates) {
      return `${escapeHtml(coordinates[1])}<code>${escapeHtml(coordinates[2])}</code>${escapeHtml(coordinates[3])}`;
    }
    return escapeHtml(line);
  }).join('\n');
}

function buildTelegramRequests(
  webhook: WebhookConfig,
  position: SafetyPosition,
  message: SafetyMessage
): TelegramRequest[] {
  const common = {
    chat_id: webhook.chatId,
    ...(webhook.messageThreadId ? { message_thread_id: webhook.messageThreadId } : {})
  };
  const requests: TelegramRequest[] = [];
  if (webhook.sendNativeLocation !== false) {
    const amap = message.links.filter((link) => link.map === 'amap');
    const otherMaps = message.links.filter((link) => link.map !== 'amap');
    const rows = [
      ...amap.map((link) => [{ text: link.label, url: link.url }]),
      ...(otherMaps.length ? [otherMaps.map((link) => ({ text: link.label, url: link.url }))] : [])
    ];
    requests.push({
      method: 'sendLocation',
      body: {
        ...common,
        latitude: position.lat,
        longitude: position.lon,
        ...(Number.isFinite(position.accuracy) && position.accuracy! >= 0
          ? { horizontal_accuracy: Math.min(1500, Math.round(position.accuracy!)) }
          : {}),
        ...(Number.isFinite(position.heading)
          ? { heading: ((Math.round(position.heading!) % 360) + 360) % 360 || 360 }
          : {}),
        reply_markup: { inline_keyboard: rows }
      }
    });
  }
  requests.push({
    method: 'sendMessage',
    body: {
      ...common,
      parse_mode: 'HTML',
      text: telegramText(message),
      link_preview_options: { is_disabled: true }
    }
  });
  return requests;
}

async function sendTelegram(
  settings: SafetySettings,
  webhook: WebhookConfig,
  position: SafetyPosition,
  kind: CheckInKind,
  language: string,
  options: NotifierOptions
): Promise<SafetySendResult> {
  const configError = telegramConfigError(webhook);
  if (configError) return { channel: webhook.id, ok: false, detail: configError, fallback: 'copy' };
  const message = buildSafetyMessage(position, settings, kind, language);
  const requests = buildTelegramRequests(webhook, position, message);
  if (settings.relayProxyUrl) {
    const result = await postJson(
      `${relayBase(settings.relayProxyUrl)}/api/notify/telegram`,
      { apiBaseUrl: webhook.url || undefined, botToken: webhook.botToken, messages: requests },
      settings.relayToken ? { Authorization: `Bearer ${settings.relayToken}` } : {},
      options
    );
    const { providerMessageId: _messageId, ...safeResult } = result;
    if (!result.ok) {
      const detail = ['timeout', 'network-or-cors', 'send-failed'].includes(result.detail) ? result.detail : 'tg-api-error';
      return { channel: webhook.id, ok: false, detail, fallback: 'copy' };
    }
    return { ...safeResult, channel: webhook.id };
  }
  const base = relayBase(webhook.url || 'https://api.telegram.org');
  let locationMessageId: number | undefined;
  for (const request of requests) {
    if (request.method === 'sendMessage' && locationMessageId) {
      request.body.reply_parameters = { message_id: locationMessageId, allow_sending_without_reply: true };
    }
    const result = await postJson(
      `${base}/bot${webhook.botToken}/${request.method}`,
      request.body,
      {},
      options
    );
    if (!result.ok) {
      const detail = ['timeout', 'network-or-cors', 'send-failed'].includes(result.detail) ? result.detail : 'tg-api-error';
      return { channel: webhook.id, ok: false, detail, fallback: 'copy' };
    }
    if (request.method === 'sendLocation') locationMessageId = result.providerMessageId;
  }
  return { channel: webhook.id, ok: true, detail: 'ok' };
}

async function sendWebhook(
  settings: SafetySettings,
  webhook: WebhookConfig,
  position: SafetyPosition,
  kind: CheckInKind,
  language: string,
  options: NotifierOptions
): Promise<SafetySendResult> {
  const message = buildSafetyMessage(position, settings, kind, language);
  if (webhook.platform === 'telegram') return sendTelegram(settings, webhook, position, kind, language, options);
  const relayPlatforms = ['wecom', 'feishu', 'dingtalk'];
  if (relayPlatforms.includes(webhook.platform) && !/^https:\/\//i.test(settings.relayProxyUrl)) {
    return { channel: webhook.id, ok: false, detail: 'relay-required', fallback: 'copy' };
  }
  try {
    if (webhook.platform === 'wecom') {
      const payload = { msgtype: 'markdown', markdown: { content: `# ${message.title}\n${message.text}` } };
      return relayPlatforms.includes(webhook.platform)
        ? relayWebhook(settings, webhook, payload, options)
        : postJson(webhook.url, payload, {}, options);
    }
    if (webhook.platform === 'feishu') {
      const timestamp = Math.floor((options.now?.() || Date.now()) / 1000);
      const sign = webhook.secret ? await hmacBase64(webhook.secret, `${timestamp}\n${webhook.secret}`) : '';
      const payload = {
        msg_type: 'interactive',
        timestamp,
        ...(sign ? { sign } : {}),
        card: {
          config: { wide_screen_mode: true },
          header: {
            title: { tag: 'plain_text', content: message.title },
            template: kind === 'sos' ? 'red' : 'blue'
          },
          elements: [
            { tag: 'markdown', content: message.text },
            {
              tag: 'action',
              actions: message.links.map((link) => ({
                tag: 'button', text: { tag: 'plain_text', content: link.label },
                type: 'primary', url: link.url
              }))
            }
          ]
        }
      };
      return relayWebhook(settings, webhook, payload, options);
    }
    if (webhook.platform === 'dingtalk') {
      const timestamp = options.now?.() || Date.now();
      let url = webhook.url;
      if (webhook.secret) {
        const sign = encodeURIComponent(await hmacBase64(webhook.secret, `${timestamp}\n${webhook.secret}`));
        url += `${url.includes('?') ? '&' : '?'}sign=${sign}&timestamp=${timestamp}`;
      }
      const title = webhook.keyword && !message.title.includes(webhook.keyword)
        ? `${message.title} ${webhook.keyword}`
        : message.title;
      const payload = {
        msgtype: 'actionCard',
        actionCard: {
          title,
          text: `# ${title}\n${message.text}`,
          btnOrientation: '0',
          btns: message.links.map((link) => ({ title: link.label, actionURL: link.url }))
        }
      };
      return relayWebhook(settings, { ...webhook, url }, payload, options);
    }
    if (webhook.platform === 'ntfy') {
      const fetcher = options.fetchImpl || fetch;
      const controller = new AbortController();
      const externalAbort = () => controller.abort();
      options.signal?.addEventListener('abort', externalAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetcher(webhook.url, {
          method: 'POST',
          headers: {
            Title: utf8Header(message.title),
            Priority: kind === 'sos' ? 'urgent' : 'high',
            Tags: kind === 'sos' ? 'warning,rotating_light' : 'round_pushpin',
            Markdown: 'yes'
          },
          body: message.text,
          signal: controller.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer'
        });
        const detail = await responseDetail(response);
        return { channel: webhook.id, ok: detail === 'ok', detail, ...(detail === 'ok' ? {} : { fallback: 'copy' as const }) };
      } catch (error) {
        return { channel: webhook.id, ok: false, detail: (error as Error).name === 'AbortError' ? 'timeout' : 'network-or-cors', fallback: 'copy' };
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', externalAbort);
      }
    }
    if (webhook.platform === 'bark') {
      const payload = {
        title: message.title,
        body: message.text,
        url: message.links[0]?.url,
        group: 'RoamEtch',
        sound: kind === 'sos' ? 'alarm' : 'bell'
      };
      return postJson(webhook.url, payload, {}, options);
    }
    const payload = renderCustomTemplate(
      webhook.customTemplate?.trim() || '{"title":"{{title}}","text":"{{text}}"}',
      message,
      position,
      settings
    );
    return postJson(webhook.url, payload, {}, options);
  } catch (error) {
    return {
      channel: webhook.id,
      ok: false,
      detail: (error as Error)?.message === 'invalid-custom-template' ? 'invalid-custom-template' : 'send-failed',
      fallback: 'copy'
    };
  }
}

async function sendRelayEmail(
  settings: SafetySettings,
  position: SafetyPosition,
  kind: CheckInKind,
  language: string,
  options: NotifierOptions
): Promise<SafetySendResult> {
  if (!/^https:\/\//i.test(settings.relayProxyUrl)) {
    return { channel: 'email', ok: false, detail: 'relay-required', fallback: 'mailto' };
  }
  const message = buildSafetyMessage(position, settings, kind, language);
  const result = await postJson(
    `${relayBase(settings.relayProxyUrl)}/api/notify/email`,
    { to: settings.emergencyEmails, subject: message.subject, text: message.text },
    settings.relayToken ? { Authorization: `Bearer ${settings.relayToken}` } : {},
    options
  );
  return { ...result, channel: 'email', ...(!result.ok ? { fallback: 'mailto' as const } : {}) };
}

export async function sendSafetyCheckIn(
  settings: SafetySettings,
  position: SafetyPosition,
  kind: CheckInKind,
  language: string,
  options: NotifierOptions = {}
): Promise<SafetySendResult[]> {
  validPosition(position);
  if (!settings.enabled || !settings.disclaimerAccepted) throw new Error('safety-disabled');
  const now = options.now?.() || Date.now();
  if (!options.automated && safetyCooldownRemaining(now) > 0) throw new Error('cooldown');
  if (!options.automated) lastManualSentAt = now;
  const message = buildSafetyMessage(position, settings, kind, language);
  const results: SafetySendResult[] = [];
  if (settings.emergencyEmails.length) {
    if (settings.emailMode === 'mailto') {
      if (options.allowProtocolLaunch === false) {
        if (!options.automated) results.push({ channel: 'email', ok: false, detail: 'user-action-required', fallback: 'mailto' });
      } else {
        try {
          (options.openUrl || ((url) => { window.location.href = url; }))(buildMailtoHref(settings.emergencyEmails, message));
          results.push({ channel: 'email', ok: true, detail: 'draft-opened' });
        } catch (error) {
          results.push({ channel: 'email', ok: false, detail: 'draft-failed', fallback: 'mailto' });
        }
      }
    } else {
      results.push(await sendRelayEmail(settings, position, kind, language, options));
    }
  }
  const enabled = settings.webhooks.filter((webhook) => webhook.enabled
    && (webhook.platform === 'telegram' || webhook.url.trim()));
  if (!enabled.length && !settings.emergencyEmails.length) {
    results.push({ channel: 'copy', ok: false, detail: 'no-channel', fallback: 'copy' });
  }
  results.push(...await Promise.all(enabled.map(async (webhook) => ({
    ...await sendWebhook(settings, webhook, position, kind, language, options),
    channel: webhook.id
  }))));
  return results;
}

export async function sendWebhookTest(
  settings: SafetySettings,
  webhook: WebhookConfig,
  position: SafetyPosition,
  language: string,
  options: NotifierOptions = {}
): Promise<SafetySendResult> {
  validPosition(position);
  const result = await sendWebhook(settings, { ...webhook, enabled: true }, position, 'test', language, options);
  return { ...result, channel: webhook.id };
}

export function fallbackHref(settings: SafetySettings, message: SafetyMessage, kind: 'mailto' | 'sms'): string | null {
  if (kind === 'mailto') return settings.emergencyEmails.length ? buildMailtoHref(settings.emergencyEmails, message) : null;
  return settings.emergencyPhone ? `sms:${encodeURIComponent(settings.emergencyPhone)}?body=${encodeURIComponent(message.smsText)}` : null;
}
