// RoamEtch safety-notify Worker: configure SAFETY_NOTIFY_*, SAFETY_RELAY_* and SAFETY_SMTP_FROM; never log bodies or secrets, allowlist provider hosts because Workers cannot pin DNS, and treat per-isolate limits as best-effort.

const DEFAULT_ORIGINS = ['https://peteliao.github.io'];
const MAX_BODY_BYTES = 64 * 1024;
const MAX_UPSTREAM_BYTES = 16 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_RECIPIENTS = 10;
const MAX_SUBJECT_LENGTH = 256;
const MAX_TEXT_LENGTH = 32 * 1024;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_KEYS = 10_000;
const NOTIFY_PATHS = new Set(['/api/notify/webhook', '/api/notify/email', '/api/notify/telegram']);
const rates = new Map();
const encoder = new TextEncoder();

class RelayError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'RelayError';
    this.code = code;
    this.status = status;
  }
}

function splitList(value) {
  return typeof value === 'string' ? value.split(',') : [];
}

function normalizeHostname(value) {
  let hostname = String(value || '').trim().toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1);
  return hostname.replace(/\.$/, '');
}

function isIpv4(address) {
  const parts = address.split('.');
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255);
}

function ipv6Words(address) {
  let value = address;
  const lastColon = value.lastIndexOf(':');
  if (lastColon >= 0) {
    const tail = value.slice(lastColon + 1);
    if (isIpv4(tail)) {
      const [a, b, c, d] = tail.split('.').map(Number);
      value = `${value.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    }
  }
  if ((value.match(/::/g) || []).length > 1) return null;
  const [left, right] = value.split('::');
  const head = left ? left.split(':') : [];
  const tail = right ? right.split(':') : [];
  if (head.some((word) => !/^[0-9a-f]{1,4}$/i.test(word))
    || tail.some((word) => !/^[0-9a-f]{1,4}$/i.test(word))) return null;
  if (!value.includes('::') && head.length !== 8) return null;
  if (value.includes('::') && head.length + tail.length >= 8) return null;
  return [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail].map((word) => parseInt(word, 16));
}

function publicIpv4(words) {
  const [a, b, c] = words;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function publicIpv6(words) {
  const [first, second] = words;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return publicIpv4([words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255]);
  }
  if (words.slice(0, 6).every((word) => word === 0)) return false;
  if (words.slice(0, 4).every((word) => word === 0) && words[4] === 0xffff && words[5] === 0) return false;
  if ((first & 0xfe00) === 0xfc00) return false;
  if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return false;
  if ((first & 0xff00) === 0xff00) return false;
  if (first === 0x0064 && second === 0) return false;
  if (first === 0x0064 && second === 0xff9b) return false;
  if (first === 0x2001 && (second === 0 || second === 0x0db8)) return false;
  if (first === 0x2002 || (first & 0xfff0) === 0x3ff0) return false;
  return true;
}

function isPublicIp(address) {
  if (isIpv4(address)) return publicIpv4(address.split('.').map(Number));
  if (address.includes(':')) {
    const words = ipv6Words(address);
    return words ? publicIpv6(words) : false;
  }
  return false;
}

function isIpLiteral(address) {
  return isIpv4(address) || address.includes(':');
}

function hostnameIsLocal(hostname) {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
    || hostname.endsWith('.internal') || hostname.endsWith('.home.arpa') || !hostname.includes('.');
}

function hostnameAllowed(hostname, allowedHosts) {
  for (const allowed of allowedHosts) {
    if (hostname === allowed || hostname.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function validateWebhookUrl(value, allowedHosts) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new RelayError('invalid-webhook-url');
  let url;
  try { url = new URL(value); } catch { throw new RelayError('invalid-webhook-url'); }
  if (url.protocol !== 'https:') throw new RelayError('protocol-not-allowed', 403);
  const authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/, 1)[0];
  if (url.username || url.password || authority.includes('@')) throw new RelayError('userinfo-not-allowed', 403);
  const hostname = normalizeHostname(url.hostname);
  if (!hostname || !hostnameAllowed(hostname, allowedHosts)) throw new RelayError('host-not-allowed', 403);
  if (isIpLiteral(hostname)) {
    if (!isPublicIp(hostname)) throw new RelayError('ssrf-blocked', 403);
  } else if (hostnameIsLocal(hostname) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname)) {
    throw new RelayError('ssrf-blocked', 403);
  }
  // Workers cannot pin DNS; operators must allowlist public provider hosts only.
  return url;
}

async function tokenMatches(header, token) {
  if (!token || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const actual = encoder.encode(header.slice(7));
  const expected = encoder.encode(token);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

function takeRate(ip) {
  const now = Date.now();
  const key = ip || 'unknown';
  let entry = rates.get(key);
  if (!entry || now >= entry.resetAt) {
    if (!entry && rates.size >= MAX_RATE_KEYS) {
      for (const [oldKey, oldEntry] of rates) {
        if (now >= oldEntry.resetAt) {
          rates.delete(oldKey);
          break;
        }
      }
      if (rates.size >= MAX_RATE_KEYS) return false;
    }
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rates.set(key, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

function responseJson(payload, status, origin, extraHeaders = {}) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    vary: 'Origin',
    ...extraHeaders
  };
  if (origin) headers['access-control-allow-origin'] = origin;
  return new Response(JSON.stringify(payload), { status, headers });
}

async function readLimitedText(body, maxBytes, errorCode) {
  if (!body) return '';
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new RelayError(errorCode, errorCode === 'payload-too-large' ? 413 : 502);
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

async function readJsonBody(request) {
  const contentType = (request.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new RelayError('unsupported-media-type', 415);
  const length = request.headers.get('content-length');
  if (length != null) {
    if (!/^\d+$/.test(length)) throw new RelayError('invalid-content-length');
    if (Number(length) > MAX_BODY_BYTES) throw new RelayError('payload-too-large', 413);
  }
  const text = await readLimitedText(request.body, MAX_BODY_BYTES, 'payload-too-large');
  let value;
  try { value = JSON.parse(text); } catch { throw new RelayError('invalid-json'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RelayError('invalid-json');
  return value;
}

function providerCodeRejected(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.ok === false) return true;
  const code = data.errcode ?? data.code ?? data.StatusCode ?? data.status;
  if (code == null) return false;
  if (typeof code === 'number') return code !== 0 && code !== 200;
  if (typeof code === 'string') return !['0', '200', 'success', 'ok'].includes(code.toLowerCase());
  return true;
}

function withTimeout(operation, externalSignal) {
  const controller = new AbortController();
  const externalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', externalAbort, { once: true });
  if (externalSignal?.aborted) controller.abort();
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RelayError('upstream-timeout', 504));
    }, TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout])
    .finally(() => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', externalAbort);
    });
}

async function deliverWebhook(data, requestConfig, allowedHosts = requestConfig.allowedHosts, externalSignal) {
  const url = validateWebhookUrl(data.url, allowedHosts);
  return withTimeout(async (signal) => {
    const response = await fetch(url.href, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(data.body),
      signal,
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    });
    if (response.status < 200 || response.status >= 300) {
      try { await response.body?.cancel(); } catch { /* no body to cancel */ }
      throw new RelayError('upstream-rejected', 502);
    }
    if (response.status === 204 || !(response.headers.get('content-type') || '').toLowerCase().includes('json')) return;
    const text = await readLimitedText(response.body, MAX_UPSTREAM_BYTES, 'upstream-invalid');
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* status-only success, matching the PWA contract */ }
    if (providerCodeRejected(parsed)) throw new RelayError('provider-rejected', 502);
    const messageId = parsed?.result?.message_id;
    return Number.isInteger(messageId) && messageId > 0 ? messageId : undefined;
  }, externalSignal);
}

function telegramApiBase(value) {
  if (value != null && (typeof value !== 'string' || value.length > 2048)) throw new RelayError('invalid-tg-api-base');
  let url;
  try { url = new URL(value || 'https://api.telegram.org'); } catch { throw new RelayError('invalid-tg-api-base'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new RelayError('invalid-tg-api-base');
  }
  return url.origin;
}

function validTelegramChatId(value) {
  return typeof value === 'string' && /^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/.test(value);
}

function validTelegramThread(value) {
  return value == null || (Number.isInteger(value) && value >= 1 && value <= 2_147_483_647);
}

function validNavigationButton(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 80
    || typeof value.url !== 'string' || value.url.length > 2048) return false;
  try {
    const url = new URL(value.url);
    return url.protocol === 'https:' && !url.username && !url.password
      && ['uri.amap.com', 'www.google.com', 'maps.apple.com'].includes(url.hostname);
  } catch { return false; }
}

function validateTelegramMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['sendLocation', 'sendMessage'].includes(value.method)
    || !value.body || typeof value.body !== 'object' || Array.isArray(value.body)) {
    throw new RelayError('invalid-tg-message');
  }
  const body = value.body;
  if (!validTelegramChatId(body.chat_id) || !validTelegramThread(body.message_thread_id)) {
    throw new RelayError('invalid-tg-chat');
  }
  const target = {
    chat_id: body.chat_id,
    ...(body.message_thread_id != null ? { message_thread_id: body.message_thread_id } : {})
  };
  if (value.method === 'sendLocation') {
    if (!Number.isFinite(body.latitude) || !Number.isFinite(body.longitude)
      || Math.abs(body.latitude) > 90 || Math.abs(body.longitude) > 180
      || (body.horizontal_accuracy != null && (!Number.isFinite(body.horizontal_accuracy)
        || body.horizontal_accuracy < 0 || body.horizontal_accuracy > 1500))
      || (body.heading != null && (!Number.isInteger(body.heading) || body.heading < 1 || body.heading > 360))) {
      throw new RelayError('invalid-tg-location');
    }
    let replyMarkup;
    if (body.reply_markup != null) {
      const keyboard = body.reply_markup?.inline_keyboard;
      if (!Array.isArray(keyboard) || keyboard.length > 3
        || keyboard.some((row) => !Array.isArray(row) || !row.length || row.length > 3 || row.some((button) => !validNavigationButton(button)))) {
        throw new RelayError('invalid-tg-buttons');
      }
      replyMarkup = {
        inline_keyboard: keyboard.map((row) => row.map((button) => ({ text: button.text, url: button.url })))
      };
    }
    return {
      method: value.method,
      body: {
        ...target,
        latitude: body.latitude,
        longitude: body.longitude,
        ...(body.horizontal_accuracy != null ? { horizontal_accuracy: body.horizontal_accuracy } : {}),
        ...(body.heading != null ? { heading: body.heading } : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {})
      }
    };
  }
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4096
    || body.text.includes('\0') || body.parse_mode !== 'HTML') {
    throw new RelayError('invalid-tg-message');
  }
  return {
    method: value.method,
    body: { ...target, parse_mode: 'HTML', text: body.text, link_preview_options: { is_disabled: true } }
  };
}

function validateTelegramPayload(data) {
  if (typeof data.botToken !== 'string' || !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(data.botToken)) {
    throw new RelayError('invalid-tg-token');
  }
  if (!Array.isArray(data.messages) || !data.messages.length || data.messages.length > 2
    || (data.messages.length === 2 && (data.messages[0]?.method !== 'sendLocation' || data.messages[1]?.method !== 'sendMessage'))) {
    throw new RelayError('invalid-tg-message');
  }
  const messages = data.messages.map(validateTelegramMessage);
  if (messages.length === 2 && (messages[0].body.chat_id !== messages[1].body.chat_id
    || messages[0].body.message_thread_id !== messages[1].body.message_thread_id)) {
    throw new RelayError('invalid-tg-chat');
  }
  return {
    apiBaseUrl: telegramApiBase(data.apiBaseUrl),
    botToken: data.botToken,
    messages
  };
}

async function deliverTelegram(payload, requestConfig) {
  const validated = validateTelegramPayload(payload);
  let locationMessageId;
  await withTimeout(async (signal) => {
    for (const message of validated.messages) {
      const body = { ...message.body };
      if (message.method === 'sendMessage' && locationMessageId) {
        body.reply_parameters = { message_id: locationMessageId, allow_sending_without_reply: true };
      }
      const messageId = await deliverWebhook({
        url: `${validated.apiBaseUrl}/bot${validated.botToken}/${message.method}`,
        body
      }, requestConfig, requestConfig.telegramAllowedHosts, signal);
      if (message.method === 'sendLocation') locationMessageId = messageId;
    }
  });
}

function validEmail(address) {
  if (typeof address !== 'string' || address.length > 254 || /[\r\n\0]/.test(address)) return false;
  const parts = address.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length > 0 && local.length <= 64 && domain.length > 0 && domain.length <= 253
    && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..')
    && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(domain);
}

function validateEmailPayload(data) {
  if (!Array.isArray(data.to) || !data.to.length || data.to.length > MAX_RECIPIENTS
    || data.to.some((address) => typeof address !== 'string' || !validEmail(address.trim()))) {
    throw new RelayError('invalid-recipient');
  }
  if (typeof data.subject !== 'string' || !data.subject.trim()
    || data.subject.length > MAX_SUBJECT_LENGTH || /[\r\n\0]/.test(data.subject)) {
    throw new RelayError('invalid-subject');
  }
  if (typeof data.text !== 'string' || !data.text.trim()
    || data.text.length > MAX_TEXT_LENGTH || data.text.includes('\0')) {
    throw new RelayError('invalid-message');
  }
  return {
    to: [...new Set(data.to.map((address) => address.trim()))],
    subject: data.subject.trim(),
    text: data.text
  };
}

async function deliverEmail(payload, requestConfig) {
  if (!validEmail(requestConfig.smtpFrom)) throw new RelayError('mail-unavailable', 503);
  const headers = { 'content-type': 'application/json' };
  if (requestConfig.mailChannelsKey) headers.authorization = `Bearer ${requestConfig.mailChannelsKey}`;
  await withTimeout(async (signal) => {
    const response = await fetch('https://api.mailchannels.net/tx/v1', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        personalizations: [{ to: payload.to.map((email) => ({ email })) }],
        from: { email: requestConfig.smtpFrom },
        subject: payload.subject,
        content: [{ type: 'text/plain', value: payload.text }]
      }),
      signal,
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    });
    if (response.status < 200 || response.status >= 300) {
      try { await response.body?.cancel(); } catch { /* no body to cancel */ }
      throw new RelayError('mail-failed', 502);
    }
  });
}

async function handleRequest(request, env) {
  const origins = new Set();
  const configuredOrigins = splitList(env.SAFETY_RELAY_ORIGINS ?? DEFAULT_ORIGINS.join(','));
  for (const entry of configuredOrigins) {
    try {
      const url = new URL(entry.trim());
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
        && url.pathname === '/' && !url.search && !url.hash) origins.add(url.origin);
    } catch { /* ignore malformed configuration */ }
  }
  const allowedHosts = new Set(splitList(env.SAFETY_RELAY_ALLOWED_HOSTS)
    .map(normalizeHostname)
    .filter((hostname) => hostname && !/[/?#@\s*]/.test(hostname)));
  const requestConfig = {
    enabled: ['1', 'true'].includes(String(env.SAFETY_NOTIFY_ENABLED || '').toLowerCase()),
    token: env.SAFETY_NOTIFY_TOKEN || '',
    origins,
    allowedHosts,
    telegramAllowedHosts: new Set(splitList(env.SAFETY_TELEGRAM_ALLOWED_HOSTS ?? 'api.telegram.org')
      .map(normalizeHostname)
      .filter((hostname) => hostname && !/[/?#@\s*]/.test(hostname))),
    smtpFrom: env.SAFETY_SMTP_FROM || '',
    mailChannelsKey: env.SAFETY_MAILCHANNELS_API_KEY || ''
  };

  let pathname;
  try { pathname = new URL(request.url).pathname; } catch { return responseJson({ ok: false, error: 'invalid-request' }, 400, null); }
  if (!NOTIFY_PATHS.has(pathname)) return responseJson({ ok: false, error: 'not-found' }, 404, null);
  const requestOrigin = request.headers.get('origin');
  const origin = requestOrigin && origins.has(requestOrigin) ? requestOrigin : null;
  const respond = (status, code, extraHeaders = {}) => responseJson(
    status >= 200 && status < 300 ? { ok: true } : { ok: false, error: code },
    status,
    origin,
    extraHeaders
  );
  if (requestOrigin && !origin) return respond(403, 'origin-not-allowed');
  if (!requestConfig.enabled) return respond(404, 'notify-disabled');
  if (!takeRate(request.headers.get('cf-connecting-ip'))) return respond(429, 'rate-limited', { 'retry-after': '60' });
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'Content-Type, Authorization',
        'access-control-max-age': '600',
        'cache-control': 'no-store',
        vary: 'Origin',
        ...(origin ? { 'access-control-allow-origin': origin } : {})
      }
    });
  }
  if (request.method !== 'POST') return respond(405, 'method-not-allowed', { allow: 'POST, OPTIONS' });
  if (!await tokenMatches(request.headers.get('authorization'), requestConfig.token)) return respond(401, 'unauthorized');
  try {
    const data = await readJsonBody(request);
    if (pathname === '/api/notify/webhook') {
      if (typeof data.url !== 'string' || !Object.hasOwn(data, 'body')) throw new RelayError('invalid-webhook');
      await deliverWebhook(data, requestConfig);
    } else if (pathname === '/api/notify/telegram') {
      await deliverTelegram(data, requestConfig);
    } else {
      await deliverEmail(validateEmailPayload(data), requestConfig);
    }
    return respond(200, 'ok');
  } catch (error) {
    if (error instanceof RelayError) return respond(error.status, error.code);
    if (error?.name === 'AbortError') return respond(504, 'upstream-timeout');
    if (pathname === '/api/notify/telegram') return respond(502, 'tg-send-failed');
    return respond(502, pathname === '/api/notify/email' ? 'mail-failed' : 'upstream-error');
  }
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env || {});
    } catch {
      // Never return or log exception details, destinations, tokens, or content.
      return responseJson({ ok: false, error: 'internal-error' }, 500, null);
    }
  }
};
