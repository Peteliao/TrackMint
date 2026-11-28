// Minimal blind WebSocket relay for RoamEtch live meetups.
// Rooms are keyed by the SHA-256-derived room id; the relay only forwards
// opaque AES-GCM envelopes and never stores or logs message content.
//
// Optional safety notifications require explicit SAFETY_NOTIFY_*/SMTP configuration; never log notification URLs, recipients, bodies, tokens or errors.
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { domainToASCII, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

const MAX_MESSAGE_BYTES = 128 * 1024;
const MAX_CLIENTS_PER_ROOM = 32;
const MAX_ROOMS = 2_000;
const MAX_CLIENTS = 10_000;
const ROOM_IDLE_MS = 12 * 60 * 60_000;
const SWEEP_MS = 60_000;
const MESSAGE_RATE = 8;
const MESSAGE_BURST = 40;
const MESSAGE_BYTE_RATE = 512 * 1024;
const MESSAGE_BYTE_BURST = 2 * 1024 * 1024;
const MAX_SEND_BUFFER_BYTES = 512 * 1024;
const HEARTBEAT_MS = 30_000;

const DEFAULT_ORIGINS = ['https://peteliao.github.io'];
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RECIPIENTS = 10;
const DEFAULT_MAX_SUBJECT_LENGTH = 256;
const DEFAULT_MAX_TEXT_LENGTH = 32 * 1024;
const DEFAULT_NOTIFY_RATE = 30;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const MAX_RATE_KEYS = 10_000;
const MAX_UPSTREAM_JSON_BYTES = 16 * 1024;
const NOTIFY_PATHS = new Set(['/api/notify/webhook', '/api/notify/email', '/api/notify/telegram']);

class RelayError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'RelayError';
    this.code = code;
    this.status = status;
  }
}

function takeToken(ws, now, rate, burst) {
  if (ws.tokens == null) {
    ws.tokens = burst;
    ws.tokenAt = now;
  }
  ws.tokens = Math.min(burst, ws.tokens + ((now - ws.tokenAt) / 1000) * rate);
  ws.tokenAt = now;
  if (ws.tokens < 1) return false;
  ws.tokens -= 1;
  return true;
}

function takeByteTokens(ws, bytes, now, rate, burst) {
  if (ws.byteTokens == null) {
    ws.byteTokens = burst;
    ws.byteTokenAt = now;
  }
  ws.byteTokens = Math.min(burst, ws.byteTokens + ((now - ws.byteTokenAt) / 1000) * rate);
  ws.byteTokenAt = now;
  if (ws.byteTokens < bytes) return false;
  ws.byteTokens -= bytes;
  return true;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function listValues(value) {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' ? value.split(',') : [];
}

function normalizeHostname(value) {
  let hostname = String(value || '').trim().toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1);
  hostname = hostname.replace(/\.$/, '');
  if (!hostname) return '';
  if (isIP(hostname)) return hostname;
  try { return domainToASCII(hostname).toLowerCase(); } catch { return ''; }
}

function parseAllowedHosts(value) {
  const hosts = new Set();
  for (const entry of listValues(value)) {
    const raw = String(entry).trim();
    if (!raw || /[/?#@\s*]/.test(raw)) continue;
    const hostname = normalizeHostname(raw);
    if (!hostname || hosts.has(hostname)) continue;
    if (isIP(hostname) || /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname)) hosts.add(hostname);
  }
  return hosts;
}

function parseOrigins(value) {
  const origins = new Set();
  for (const entry of listValues(value)) {
    try {
      const url = new URL(String(entry).trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.pathname !== '/' || url.search || url.hash) continue;
      origins.add(url.origin);
    } catch { /* ignore malformed configuration */ }
  }
  return origins;
}

function smtpFromUrl(value) {
  try {
    const url = new URL(value);
    if (!['smtp:', 'smtps:'].includes(url.protocol) || !url.hostname || url.search || url.hash) return null;
    const port = url.port ? boundedInteger(url.port, 0, 1, 65_535) : (url.protocol === 'smtps:' ? 465 : 587);
    return {
      host: normalizeHostname(url.hostname),
      port,
      secure: url.protocol === 'smtps:' || port === 465,
      user: decodeURIComponent(url.username),
      pass: decodeURIComponent(url.password)
    };
  } catch { return null; }
}

function smtpFromEnvironment(env) {
  if (env.SAFETY_SMTP_URL) return smtpFromUrl(env.SAFETY_SMTP_URL);
  if (!env.SAFETY_SMTP_HOST) return null;
  const secure = env.SAFETY_SMTP_SECURE === '1' || env.SAFETY_SMTP_SECURE === 'true';
  const port = boundedInteger(env.SAFETY_SMTP_PORT, secure ? 465 : 587, 1, 65_535);
  return {
    host: normalizeHostname(env.SAFETY_SMTP_HOST),
    port,
    secure: secure || port === 465,
    user: env.SAFETY_SMTP_USER || '',
    pass: env.SAFETY_SMTP_PASS || ''
  };
}

function createNotifyConfig(options = {}) {
  const env = options.env || process.env;
  const enabled = options.enabled ?? ['1', 'true'].includes(String(env.SAFETY_NOTIFY_ENABLED || '').toLowerCase());
  let smtp = null;
  if (typeof options.smtp === 'string') smtp = smtpFromUrl(options.smtp);
  else if (options.smtp && typeof options.smtp === 'object') smtp = { ...options.smtp };
  else smtp = smtpFromEnvironment(env);
  if (smtp) {
    smtp.host = normalizeHostname(smtp.host);
    smtp.port = boundedInteger(smtp.port, smtp.secure ? 465 : 587, 1, 65_535);
    smtp.secure = smtp.secure === true || smtp.port === 465;
  }
  return {
    enabled: enabled === true,
    token: String(options.token ?? env.SAFETY_NOTIFY_TOKEN ?? ''),
    allowedHosts: parseAllowedHosts(options.allowedHosts ?? env.SAFETY_RELAY_ALLOWED_HOSTS),
    telegramAllowedHosts: parseAllowedHosts(options.telegramAllowedHosts ?? env.SAFETY_TELEGRAM_ALLOWED_HOSTS ?? 'api.telegram.org'),
    origins: parseOrigins(options.origins ?? env.SAFETY_RELAY_ORIGINS ?? DEFAULT_ORIGINS),
    // Test/custom fetchImpl skips DNS pinning; production uses postWebhookWithNode.
    fetchImpl: options.fetchImpl,
    lookup: options.lookup,
    sendMail: options.sendMail,
    smtp,
    from: String(options.from ?? options.smtp?.from ?? env.SAFETY_SMTP_FROM ?? ''),
    maxBodyBytes: boundedInteger(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, 1024, 1024 * 1024),
    timeoutMs: boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 60_000),
    maxRecipients: boundedInteger(options.maxRecipients, DEFAULT_MAX_RECIPIENTS, 1, 50),
    maxSubjectLength: boundedInteger(options.maxSubjectLength, DEFAULT_MAX_SUBJECT_LENGTH, 1, 1024),
    maxTextLength: boundedInteger(options.maxTextLength, DEFAULT_MAX_TEXT_LENGTH, 1, 128 * 1024),
    rateLimit: boundedInteger(options.rateLimit, DEFAULT_NOTIFY_RATE, 1, 10_000),
    rateWindowMs: boundedInteger(options.rateWindowMs, DEFAULT_RATE_WINDOW_MS, 1000, 60 * 60_000)
  };
}

function allowedOrigin(header, origins) {
  return typeof header === 'string' && origins.has(header) ? header : null;
}

function sendJson(res, status, payload, origin = null, extraHeaders = {}) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    vary: 'Origin',
    ...extraHeaders
  };
  if (origin) headers['access-control-allow-origin'] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

function auditNotify(log, status) {
  // Status-only logging: no request path, IP, URL, address, body, token, or exception.
  try { log(`notify status=${status}`); } catch { /* logging must not affect delivery */ }
}

function takeNotifyRate(state, ip, config, now = Date.now()) {
  const key = ip || 'unknown';
  let entry = state.rates.get(key);
  if (!entry || now >= entry.resetAt) {
    if (!entry && state.rates.size >= MAX_RATE_KEYS) {
      for (const [oldKey, oldEntry] of state.rates) {
        if (now >= oldEntry.resetAt) {
          state.rates.delete(oldKey);
          break;
        }
      }
      if (state.rates.size >= MAX_RATE_KEYS) return false;
    }
    entry = { count: 0, resetAt: now + config.rateWindowMs };
    state.rates.set(key, entry);
  }
  entry.count++;
  return entry.count <= config.rateLimit;
}

function validBearerToken(header, token) {
  if (!token || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function readJsonBody(req, maxBytes) {
  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') return Promise.reject(new RelayError('unsupported-media-type', 415));
  const lengthHeader = req.headers['content-length'];
  if (lengthHeader != null) {
    if (!/^\d+$/.test(String(lengthHeader))) return Promise.reject(new RelayError('invalid-content-length', 400));
    if (Number(lengthHeader) > maxBytes) return Promise.reject(new RelayError('payload-too-large', 413));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        fail(new RelayError('payload-too-large', 413));
        req.resume();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-json');
        resolve(value);
      } catch { reject(new RelayError('invalid-json')); }
    };
    const onError = () => fail(new RelayError('invalid-request'));
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
  });
}

function ipv4Words(address) {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const words = parts.map(Number);
  return words.every((word) => word <= 255) ? words : null;
}

function ipv6Words(address) {
  let value = address;
  const lastColon = value.lastIndexOf(':');
  if (lastColon >= 0) {
    const tail = value.slice(lastColon + 1);
    if (isIP(tail) === 4) {
      const words = ipv4Words(tail);
      value = `${value.slice(0, lastColon + 1)}${((words[0] << 8) | words[1]).toString(16)}:${((words[2] << 8) | words[3]).toString(16)}`;
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

function publicIPv4(words) {
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

function publicIPv6(words) {
  const [first, second] = words;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return publicIPv4([words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255]);
  }
  if (words.slice(0, 6).every((word) => word === 0)) return false;
  if (words.slice(0, 4).every((word) => word === 0) && words[4] === 0xffff && words[5] === 0) return false;
  if ((first & 0xfe00) === 0xfc00) return false;
  if ((first & 0xffc0) === 0xfe80) return false;
  if ((first & 0xffc0) === 0xfec0) return false;
  if ((first & 0xff00) === 0xff00) return false;
  if (first === 0x0064 && second === 0) return false;
  if (first === 0x0064 && (second === 0xff9b || (second === 0xff9b && words[2] === 1))) return false;
  if (first === 0x2001 && (second === 0 || second === 0x0db8)) return false;
  if (first === 0x2002) return false;
  if ((first & 0xfff0) === 0x3ff0) return false;
  return true;
}

function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const words = ipv4Words(address);
    return words ? publicIPv4(words) : false;
  }
  if (family === 6) {
    const words = ipv6Words(address);
    return words ? publicIPv6(words) : false;
  }
  return false;
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

function resolvePublicAddress(hostname, lookup, signal) {
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new RelayError('ssrf-blocked', 403);
    return Promise.resolve({ address: hostname, family: isIP(hostname) });
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve(value);
    };
    const onAbort = () => finish(new RelayError('upstream-timeout', 504));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) return onAbort();
    try {
      lookup(hostname, { all: true, verbatim: true }, (error, result) => {
        if (error) return finish(new RelayError('dns-failed', 502));
        const entries = (Array.isArray(result) ? result : [result])
          .filter((entry) => entry && typeof entry.address === 'string')
          .map((entry) => ({ address: entry.address, family: entry.family || isIP(entry.address) }));
        if (!entries.length || entries.some((entry) => !isPublicAddress(entry.address))) {
          return finish(new RelayError('ssrf-blocked', 403));
        }
        finish(null, entries[0]);
      });
    } catch { finish(new RelayError('dns-failed', 502)); }
  });
}

async function validateWebhookUrl(value, config, signal, allowedHosts = config.allowedHosts) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new RelayError('invalid-webhook-url');
  let url;
  try { url = new URL(value); } catch { throw new RelayError('invalid-webhook-url'); }
  if (url.protocol !== 'https:') throw new RelayError('protocol-not-allowed', 403);
  const authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/, 1)[0];
  if (url.username || url.password || authority.includes('@')) throw new RelayError('userinfo-not-allowed', 403);
  const hostname = normalizeHostname(url.hostname);
  if (!hostname) throw new RelayError('invalid-webhook-url');
  if (!hostnameAllowed(hostname, allowedHosts)) throw new RelayError('host-not-allowed', 403);
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new RelayError('ssrf-blocked', 403);
  if (!isIP(hostname) && hostnameIsLocal(hostname)) throw new RelayError('ssrf-blocked', 403);
  const address = await resolvePublicAddress(hostname, config.lookup || dnsLookup, signal);
  return { url, address };
}

function withTimeout(config, timeoutCode, operation, externalSignal) {
  const controller = new AbortController();
  const externalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', externalAbort, { once: true });
  if (externalSignal?.aborted) controller.abort();
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RelayError(timeoutCode, 504));
    }, config.timeoutMs);
  });
  return Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout])
    .finally(() => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', externalAbort);
    });
}

function pinnedLookup(address) {
  return (hostname, options, callback) => {
    if (options.all) callback(null, [{ address: address.address, family: address.family }]);
    else callback(null, address.address, address.family);
  };
}

function postWebhookWithNode(target, address, payload, signal) {
  const body = Buffer.from(JSON.stringify(payload));
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = transport(target, {
      method: 'POST',
      agent: false,
      lookup: pinnedLookup(address),
      signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'content-length': body.length
      }
    }, (response) => resolve(response));
    request.on('socket', (socket) => {
      const verify = () => {
        if (socket.remoteAddress && !isPublicAddress(socket.remoteAddress)) {
          request.destroy(new RelayError('ssrf-blocked', 403));
        }
      };
      if (socket.remoteAddress) verify();
      else socket.once('connect', verify);
    });
    request.once('error', reject);
    request.end(body);
  });
}

async function postWebhookWithFetch(fetcher, target, payload, signal) {
  return fetcher(target.href, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
    redirect: 'manual',
    credentials: 'omit',
    referrerPolicy: 'no-referrer'
  });
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

function readNodeJson(response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const cleanup = () => {
      response.off('data', onData);
      response.off('end', onEnd);
      response.off('error', onError);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > MAX_UPSTREAM_JSON_BYTES) {
        fail(new RelayError('upstream-invalid', 502));
        response.destroy();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { resolve(null); }
    };
    const onError = () => fail(new RelayError('upstream-error', 502));
    response.on('data', onData);
    response.once('end', onEnd);
    response.once('error', onError);
  });
}

async function readWebText(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_UPSTREAM_JSON_BYTES) throw new RelayError('upstream-invalid', 502);
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

async function deliverWebhook(payload, config, allowedHosts = config.allowedHosts, externalSignal) {
  const result = await withTimeout(config, 'upstream-timeout', async (signal) => {
    const target = await validateWebhookUrl(payload.url, config, signal, allowedHosts);
    const response = config.fetchImpl
      ? await postWebhookWithFetch(config.fetchImpl, target.url, payload.body, signal)
      : await postWebhookWithNode(target.url, target.address, payload.body, signal);
    const status = Number(response.status);
    if (status < 200 || status >= 300) {
      if (config.fetchImpl) {
        try { await response.body?.cancel(); } catch { /* no body to cancel */ }
      } else if (typeof response.resume === 'function') response.resume();
      throw new RelayError('upstream-rejected', 502);
    }
    const contentType = String(response.headers?.get?.('content-type') ?? response.headers?.['content-type'] ?? '').toLowerCase();
    if (!contentType.includes('json') || status === 204) return;
    const data = config.fetchImpl
      ? await readWebText(response).then((text) => {
        try { return JSON.parse(text); } catch { return null; }
      })
      : await readNodeJson(response);
    if (providerCodeRejected(data)) throw new RelayError('provider-rejected', 502);
    const messageId = data?.result?.message_id;
    return Number.isInteger(messageId) && messageId > 0 ? messageId : undefined;
  }, externalSignal);
  return result;
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

async function deliverTelegram(payload, config) {
  const validated = validateTelegramPayload(payload);
  let locationMessageId;
  await withTimeout(config, 'upstream-timeout', async (signal) => {
    for (const message of validated.messages) {
      const body = { ...message.body };
      if (message.method === 'sendMessage' && locationMessageId) {
        body.reply_parameters = { message_id: locationMessageId, allow_sending_without_reply: true };
      }
      const messageId = await deliverWebhook({
        url: `${validated.apiBaseUrl}/bot${validated.botToken}/${message.method}`,
        body
      }, config, config.telegramAllowedHosts, signal);
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

function validateEmailPayload(data, config) {
  if (!Array.isArray(data.to) || !data.to.length || data.to.length > config.maxRecipients
    || data.to.some((address) => typeof address !== 'string' || !validEmail(address.trim()))) {
    throw new RelayError('invalid-recipient');
  }
  if (typeof data.subject !== 'string' || !data.subject.trim()
    || data.subject.length > config.maxSubjectLength || /[\r\n\0]/.test(data.subject)) {
    throw new RelayError('invalid-subject');
  }
  if (typeof data.text !== 'string' || !data.text.trim()
    || data.text.length > config.maxTextLength || data.text.includes('\0')) {
    throw new RelayError('invalid-message');
  }
  return {
    to: [...new Set(data.to.map((address) => address.trim()))],
    subject: data.subject.trim(),
    text: data.text
  };
}

function smtpMailer(config) {
  if (!config.mailerPromise) {
    config.mailerPromise = import('nodemailer').then(({ default: nodemailer }) => nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      requireTLS: !config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      connectionTimeout: config.timeoutMs,
      greetingTimeout: config.timeoutMs,
      socketTimeout: config.timeoutMs,
      disableFileAccess: true,
      disableUrlAccess: true,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }
    })).catch(() => {
      config.mailerPromise = null;
      throw new RelayError('mail-unavailable', 503);
    });
  }
  return config.mailerPromise;
}

async function deliverEmail(payload, config) {
  if (!validEmail(config.from)) throw new RelayError('mail-unavailable', 503);
  if (!config.sendMail && !config.smtp) throw new RelayError('mail-unavailable', 503);
  const message = { from: config.from, to: payload.to, subject: payload.subject, text: payload.text };
  await withTimeout(config, 'mail-timeout', async () => {
    try {
      if (config.sendMail) await config.sendMail(message);
      else {
        const mailer = await smtpMailer(config);
        await mailer.sendMail(message);
      }
    } catch (error) {
      if (error instanceof RelayError) throw error;
      throw new RelayError('mail-failed', 502);
    }
  });
}

async function handleNotifyRequest(req, res, pathname, config, state, log) {
  const origin = allowedOrigin(req.headers.origin, config.origins);
  const respond = (status, code, headers = {}) => {
    sendJson(res, status, status >= 200 && status < 300 ? { ok: true } : { ok: false, error: code }, origin, headers);
    auditNotify(log, status);
  };
  if (req.headers.origin && !origin) return respond(403, 'origin-not-allowed');
  if (!config.enabled) return respond(404, 'notify-disabled');
  if (!takeNotifyRate(state, req.socket.remoteAddress, config)) return respond(429, 'rate-limited', { 'retry-after': '60' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization',
      'access-control-max-age': '600',
      'cache-control': 'no-store',
      vary: 'Origin',
      ...(origin ? { 'access-control-allow-origin': origin } : {})
    });
    res.end();
    auditNotify(log, 204);
    return;
  }
  if (req.method !== 'POST') return respond(405, 'method-not-allowed', { allow: 'POST, OPTIONS' });
  if (!validBearerToken(req.headers.authorization, config.token)) return respond(401, 'unauthorized');
  let data;
  try { data = await readJsonBody(req, config.maxBodyBytes); }
  catch (error) {
    if (error instanceof RelayError) return respond(error.status, error.code, error.status === 413 ? { connection: 'close' } : {});
    return respond(400, 'invalid-request');
  }
  try {
    if (pathname === '/api/notify/webhook') {
      if (typeof data.url !== 'string' || !Object.hasOwn(data, 'body')) throw new RelayError('invalid-webhook');
      await deliverWebhook({ url: data.url, body: data.body }, config);
    } else if (pathname === '/api/notify/telegram') {
      await deliverTelegram(data, config);
    } else {
      const payload = validateEmailPayload(data, config);
      await deliverEmail(payload, config);
    }
    respond(200, 'ok');
  } catch (error) {
    if (error instanceof RelayError) return respond(error.status, error.code);
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return respond(504, 'upstream-timeout');
    return respond(502, pathname === '/api/notify/email' ? 'mail-failed' : pathname === '/api/notify/telegram' ? 'tg-send-failed' : 'upstream-error');
  }
}

export function createRelayServer({
  port = process.env.PORT || 8080,
  host = process.env.HOST || '0.0.0.0',
  log = () => {},
  maxMessageBytes = MAX_MESSAGE_BYTES,
  maxClientsPerRoom = MAX_CLIENTS_PER_ROOM,
  maxRooms = MAX_ROOMS,
  maxClients = MAX_CLIENTS,
  roomIdleMs = ROOM_IDLE_MS,
  sweepMs = SWEEP_MS,
  messageRate = MESSAGE_RATE,
  messageBurst = MESSAGE_BURST,
  messageByteRate = MESSAGE_BYTE_RATE,
  messageByteBurst = MESSAGE_BYTE_BURST,
  maxSendBufferBytes = MAX_SEND_BUFFER_BYTES,
  notify = {}
} = {}) {
  const rooms = new Map();
  const notifyConfig = createNotifyConfig(notify && typeof notify === 'object' ? notify : {});
  const notifyState = { rates: new Map() };
  let clientCount = 0;
  const httpServer = createServer((req, res) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://relay.local').pathname; }
    catch {
      sendJson(res, 400, { ok: false, error: 'invalid-request' });
      return;
    }
    if (pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: clientCount }));
      return;
    }
    if (NOTIFY_PATHS.has(pathname)) {
      handleNotifyRequest(req, res, pathname, notifyConfig, notifyState, log).catch(() => {
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal-error' });
        else res.destroy();
        auditNotify(log, 500);
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  httpServer.requestTimeout = 15_000;
  httpServer.headersTimeout = 10_000;

  const wss = new WebSocketServer({ noServer: true, maxPayload: maxMessageBytes });

  httpServer.on('upgrade', (req, socket, head) => {
    const room = roomFromUrl(req.url);
    if (!room) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let state = rooms.get(room);
      if (!state && rooms.size >= maxRooms) {
        ws.close(1013, 'relay full');
        return;
      }
      if (clientCount >= maxClients) {
        ws.close(1013, 'relay full');
        return;
      }
      if (!state) {
        state = { peers: new Set(), lastActivity: Date.now() };
        rooms.set(room, state);
      }
      if (state.peers.size >= maxClientsPerRoom) {
        ws.close(1013, 'room full');
        return;
      }
      state.peers.add(ws);
      clientCount++;
      ws.room = room;
      ws.isAlive = true;
      log(`join ${room.slice(0, 8)} (${state.peers.size})`);

      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', (data, isBinary) => {
        const now = Date.now();
        if (!takeToken(ws, now, messageRate, messageBurst)
          || !takeByteTokens(ws, data.length, now, messageByteRate, messageByteBurst)) {
          ws.close(1008, 'rate limit');
          return;
        }
        if (isBinary || !data.length) return;
        state.lastActivity = now;
        for (const peer of state.peers) {
          if (peer === ws || peer.readyState !== 1) continue;
          if (peer.bufferedAmount + data.length > maxSendBufferBytes) {
            peer.close(1013, 'slow consumer');
            continue;
          }
          try { peer.send(data.toString('utf8'), { binary: false }); } catch { /* peer close handles cleanup */ }
        }
      });
      ws.on('close', () => {
        state.peers.delete(ws);
        clientCount = Math.max(0, clientCount - 1);
        if (!state.peers.size && rooms.get(room) === state) rooms.delete(room);
        log(`leave ${room.slice(0, 8)} (${state.peers.size})`);
      });
      ws.on('error', (err) => {
        if (/max payload/i.test(String(err?.message || ''))) {
          try { ws.close(1009, 'payload too large'); } catch { ws.terminate(); }
          return;
        }
        try { ws.terminate(); } catch { /* already closed */ }
      });
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* close handles it */ }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  const sweep = roomIdleMs > 0
    ? setInterval(() => {
        const now = Date.now();
        for (const [room, state] of rooms) {
          if (now - state.lastActivity <= roomIdleMs) continue;
          rooms.delete(room);
          for (const ws of state.peers) {
            try { ws.close(1001, 'room idle'); } catch { /* already closed */ }
          }
          log(`idle ${room.slice(0, 8)}`);
        }
      }, Math.max(250, Math.min(sweepMs, roomIdleMs)))
    : null;
  sweep?.unref?.();

  return {
    httpServer,
    wss,
    rooms,
    listen: () => new Promise((resolve) => httpServer.listen(port, host, () => resolve(httpServer.address()))),
    close: () => new Promise((resolve) => {
      clearInterval(heartbeat);
      if (sweep) clearInterval(sweep);
      notifyState.rates.clear();
      for (const ws of wss.clients) {
        try { ws.terminate(); } catch { /* already closed */ }
      }
      wss.close(() => httpServer.close(() => resolve()));
    })
  };
}

function roomFromUrl(url) {
  let pathname;
  try { pathname = new URL(url, 'http://relay.local').pathname; } catch { return ''; }
  const match = /^\/room\/([A-Za-z0-9_-]{8,128})$/.exec(pathname);
  return match ? match[1] : '';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = createRelayServer({ log: (line) => console.log(`[relay] ${line}`) });
  const address = await relay.listen();
  console.log(`[relay] listening on ws://${address.address}:${address.port}/room/{room}`);
  const shutdown = async () => {
    await relay.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
