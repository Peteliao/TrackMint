import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import WebSocket from 'ws';
import { createRelayServer } from './server.mjs';
import safetyWorker from './worker.mjs';

const ROOM_A = 'a'.repeat(32);
const ROOM_B = 'b'.repeat(32);

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), 2000);
    ws.once('message', (data, isBinary) => {
      clearTimeout(timer);
      if (isBinary) {
        reject(new Error('unexpected binary frame'));
        return;
      }
      resolve(data.toString());
    });
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function closeCode(ws) {
  return new Promise((resolve) => {
    ws.once('close', (code) => resolve(code));
    ws.once('error', () => { /* close event carries the code */ });
  });
}

function rejected(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('close timeout')), 2000);
    ws.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    ws.once('error', () => { /* server closes after rejecting */ });
  });
}

test('relays ciphertext only within the same room', async (t) => {
  const relay = createRelayServer({ port: 0, host: '127.0.0.1' });
  const address = await relay.listen();
  const base = `ws://127.0.0.1:${address.port}/room/`;
  const a = await connect(base + ROOM_A);
  const b = await connect(base + ROOM_A);
  const c = await connect(base + ROOM_B);
  t.after(async () => {
    for (const ws of [a, b, c]) ws.close();
    await relay.close();
  });

  const received = nextMessage(b);
  a.send('ciphertext-envelope');
  assert.equal(await received, 'ciphertext-envelope');

  let leaked = false;
  c.once('message', () => { leaked = true; });
  a.send('second-envelope');
  await delay(150);
  assert.equal(leaked, false);

  const health = await fetch(`http://127.0.0.1:${address.port}/healthz`).then((res) => res.json());
  assert.equal(health.ok, true);
  assert.equal(health.rooms, 2);
  assert.equal(health.clients, 3);
});

test('rejects malformed room paths and binary frames', async (t) => {
  const relay = createRelayServer({ port: 0, host: '127.0.0.1' });
  const address = await relay.listen();
  t.after(() => relay.close());
  await assert.rejects(connect(`ws://127.0.0.1:${address.port}/nope`));

  const a = await connect(`ws://127.0.0.1:${address.port}/room/${ROOM_A}`);
  const b = await connect(`ws://127.0.0.1:${address.port}/room/${ROOM_A}`);
  t.after(() => { a.close(); b.close(); });
  let leaked = false;
  b.once('message', () => { leaked = true; });
  a.send(Buffer.from('binary-frame'));
  await delay(150);
  assert.equal(leaked, false);
});

test('rate limits binary frames before rejecting them', async (t) => {
  const relay = createRelayServer({
    port: 0, host: '127.0.0.1', messageRate: 1, messageBurst: 2
  });
  const address = await relay.listen();
  const ws = await connect(`ws://127.0.0.1:${address.port}/room/${ROOM_A}`);
  t.after(() => { ws.terminate(); return relay.close(); });
  const closed = closeCode(ws);
  for (let i = 0; i < 4; i++) ws.send(Buffer.from(`binary-${i}`));
  assert.equal(await closed, 1008);
});

test('closes abusive sockets and caps rooms', async (t) => {
  const relay = createRelayServer({
    port: 0,
    host: '127.0.0.1',
    maxRooms: 1,
    messageRate: 1,
    messageBurst: 2
  });
  const address = await relay.listen();
  const base = `ws://127.0.0.1:${address.port}/room/`;
  t.after(() => relay.close());

  const a = await connect(base + ROOM_A);
  const b = await connect(base + ROOM_A);
  t.after(() => { a.close(); b.close(); });
  assert.equal(await rejected(base + ROOM_B), 1013);

  const limited = closeCode(a);
  for (let i = 0; i < 4; i++) a.send(`frame-${i}`);
  assert.equal(await limited, 1008);

  const health = await fetch(`http://127.0.0.1:${address.port}/healthz`).then((res) => res.json());
  assert.equal(health.rooms, 1);
  assert.equal(health.clients, 1);
});

test('rejects extra clients in a full room', async (t) => {
  const relay = createRelayServer({ port: 0, host: '127.0.0.1', maxClientsPerRoom: 1 });
  const address = await relay.listen();
  const base = `ws://127.0.0.1:${address.port}/room/`;
  t.after(() => relay.close());
  const a = await connect(base + ROOM_A);
  t.after(() => a.close());
  assert.equal(await rejected(base + ROOM_A), 1013);
  const health = await fetch(`http://127.0.0.1:${address.port}/healthz`).then((res) => res.json());
  assert.equal(health.rooms, 1);
  assert.equal(health.clients, 1);
});

test('closes oversized frames', async (t) => {
  const relay = createRelayServer({ port: 0, host: '127.0.0.1', maxMessageBytes: 256 });
  const address = await relay.listen();
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/room/${ROOM_A}`);
  t.after(() => { ws.terminate(); return relay.close(); });
  const closed = closeCode(ws);
  await new Promise((resolve) => ws.once('open', resolve));
  ws.send('x'.repeat(512));
  assert.equal(await closed, 1009);
});

test('relays image-sized frames within the 128 KB limit', async (t) => {
  const relay = createRelayServer({ port: 0, host: '127.0.0.1' });
  const address = await relay.listen();
  const base = `ws://127.0.0.1:${address.port}/room/`;
  t.after(() => relay.close());
  const a = await connect(base + ROOM_A);
  const b = await connect(base + ROOM_A);
  t.after(() => { a.close(); b.close(); });

  const received = nextMessage(b);
  const imageFrame = 'A'.repeat(100 * 1024);
  a.send(imageFrame);
  assert.equal(await received, imageFrame);

  const closed = closeCode(a);
  a.send('B'.repeat(129 * 1024));
  assert.equal(await closed, 1009);
});

test('enforces a byte budget in addition to frame rate', async (t) => {
  const relay = createRelayServer({
    port: 0, host: '127.0.0.1', maxMessageBytes: 2048,
    messageByteRate: 0, messageByteBurst: 1200
  });
  const address = await relay.listen();
  const ws = await connect(`ws://127.0.0.1:${address.port}/room/${ROOM_A}`);
  t.after(() => { ws.terminate(); return relay.close(); });
  const closed = closeCode(ws);
  ws.send('x'.repeat(1300));
  await delay(50);
  ws.send('y'.repeat(1300));
  assert.equal(await closed, 1008);
});

test('closes slow consumers before queuing oversized fan-out buffers', async (t) => {
  const relay = createRelayServer({
    port: 0, host: '127.0.0.1', maxMessageBytes: 2048,
    maxSendBufferBytes: 1024
  });
  const address = await relay.listen();
  const base = `ws://127.0.0.1:${address.port}/room/${ROOM_A}`;
  const a = await connect(base);
  const b = await connect(base);
  t.after(() => { a.close(); b.close(); return relay.close(); });
  const closed = closeCode(b);
  a.send('x'.repeat(1500));
  assert.equal(await closed, 1013);
});

test('sweeps idle rooms and releases their sockets', async (t) => {
  const relay = createRelayServer({ port: 0, host: '127.0.0.1', roomIdleMs: 150, sweepMs: 50 });
  const address = await relay.listen();
  const ws = await connect(`ws://127.0.0.1:${address.port}/room/${ROOM_A}`);
  t.after(() => { ws.terminate(); return relay.close(); });
  const closed = closeCode(ws);
  assert.equal(await closed, 1001);
  const health = await fetch(`http://127.0.0.1:${address.port}/healthz`).then((res) => res.json());
  assert.equal(health.rooms, 0);
  assert.equal(health.clients, 0);
});



const NOTIFY_TOKEN = 'notify-test-token';
const PWA_ORIGIN = 'https://peteliao.github.io';
const PUBLIC_IP = '93.184.216.34';
const publicLookup = (hostname, options, callback) => callback(null, [{ address: PUBLIC_IP, family: 4 }]);
const successfulFetch = async () => new Response('{"ok":true}', {
  status: 200,
  headers: { 'content-type': 'application/json' }
});

async function startNotifyRelay(t, overrides = {}) {
  const relay = createRelayServer({
    port: 0,
    host: '127.0.0.1',
    notify: {
      enabled: true,
      token: NOTIFY_TOKEN,
      allowedHosts: ['example.com'],
      lookup: publicLookup,
      fetchImpl: successfulFetch,
      ...overrides
    }
  });
  const address = await relay.listen();
  t.after(() => relay.close());
  return `http://127.0.0.1:${address.port}`;
}

async function postNotify(base, path, body, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (options.token !== null) headers.authorization = `Bearer ${options.token ?? NOTIFY_TOKEN}`;
  if (options.origin !== null) headers.origin = options.origin ?? PWA_ORIGIN;
  return fetch(`${base}${path}`, {
    method: options.method || 'POST',
    headers,
    ...(options.rawBody !== undefined ? { body: options.rawBody } : { body: JSON.stringify(body) })
  });
}

async function expectNotifyError(response, status, code) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.clone().json(), { ok: false, error: code });
}

function postRawChunked(base, path, text) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${NOTIFY_TOKEN}`,
        origin: PWA_ORIGIN,
        'transfer-encoding': 'chunked'
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        text: Buffer.concat(chunks).toString('utf8')
      }));
    });
    request.once('error', reject);
    const midpoint = Math.floor(text.length / 2);
    request.write(text.slice(0, midpoint));
    request.end(text.slice(midpoint));
  });
}

test('safety notify is disabled by default and requires a configured bearer token', async (t) => {
  const disabled = createRelayServer({ port: 0, host: '127.0.0.1' });
  const disabledAddress = await disabled.listen();
  t.after(() => disabled.close());
  await expectNotifyError(
    await postNotify(`http://127.0.0.1:${disabledAddress.port}`, '/api/notify/webhook', {
      url: 'https://example.com/hook', body: { secret: 'coordinate' }
    }),
    404,
    'notify-disabled'
  );

  const base = await startNotifyRelay(t, { token: '' });
  await expectNotifyError(await postNotify(base, '/api/notify/webhook', {
    url: 'https://example.com/hook', body: 'secret'
  }), 401, 'unauthorized');

  const authenticated = await startNotifyRelay(t);
  await expectNotifyError(await postNotify(authenticated, '/api/notify/webhook', {
    url: 'https://example.com/hook', body: 'secret'
  }, { token: null }), 401, 'unauthorized');
  await expectNotifyError(await postNotify(authenticated, '/api/notify/webhook', {
    url: 'https://example.com/hook', body: 'secret'
  }, { token: 'wrong-token' }), 401, 'unauthorized');
});

test('safety notify handles configurable CORS preflight and rejects other origins', async (t) => {
  const base = await startNotifyRelay(t, { origins: ['https://trips.example.net'] });
  const preflight = await postNotify(base, '/api/notify/webhook', undefined, {
    method: 'OPTIONS',
    token: null,
    origin: 'https://trips.example.net'
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://trips.example.net');
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type, Authorization');
  assert.equal(preflight.headers.get('vary'), 'Origin');

  const denied = await postNotify(base, '/api/notify/webhook', {
    url: 'https://example.com/hook', body: 'secret'
  }, { method: 'OPTIONS', token: null });
  await expectNotifyError(denied, 403, 'origin-not-allowed');
  assert.equal(denied.headers.get('access-control-allow-origin'), null);

  const accepted = await postNotify(base, '/api/notify/webhook', {
    url: 'https://example.com/hook', body: 'secret'
  }, { origin: 'https://trips.example.net' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('access-control-allow-origin'), 'https://trips.example.net');
});

test('rejects unsafe webhook protocols, userinfo, hosts, and literal addresses before fetch', async (t) => {
  let fetchCalls = 0;
  const base = await startNotifyRelay(t, {
    allowedHosts: [
      'example.com', '127.0.0.1', '10.0.0.1', '169.254.169.254', '::1',
      '::ffff:7f00:1', '::ffff:127.0.0.1', 'fc00::1'
    ],
    fetchImpl: async () => { fetchCalls++; return new Response('{}', { status: 200 }); }
  });
  const cases = [
    ['http://example.com/hook', 'protocol-not-allowed'],
    ['file:///etc/passwd', 'protocol-not-allowed'],
    ['ftp://example.com/hook', 'protocol-not-allowed'],
    ['https://user:password@example.com/hook', 'userinfo-not-allowed'],
    ['https://@example.com/hook', 'userinfo-not-allowed'],
    ['https://example.com.evil.test/hook', 'host-not-allowed'],
    ['https://localhost/hook', 'host-not-allowed'],
    ['https://127.0.0.1/hook', 'ssrf-blocked'],
    ['https://2130706433/hook', 'ssrf-blocked'],
    ['https://10.0.0.1/hook', 'ssrf-blocked'],
    ['https://169.254.169.254/latest/meta-data', 'ssrf-blocked'],
    ['https://[::1]/hook', 'ssrf-blocked'],
    ['https://[::ffff:127.0.0.1]/hook', 'ssrf-blocked'],
    ['https://[fc00::1]/hook', 'ssrf-blocked']
  ];
  for (const [url, code] of cases) {
    await expectNotifyError(await postNotify(base, '/api/notify/webhook', { url, body: 'secret' }), 403, code);
  }
  assert.equal(fetchCalls, 0);
});

test('rejects private DNS answers and requires an explicit host allowlist', async (t) => {
  for (const addresses of [
    [{ address: '127.0.0.1', family: 4 }],
    [{ address: PUBLIC_IP, family: 4 }, { address: '192.168.1.8', family: 4 }],
    [{ address: 'fe80::1', family: 6 }]
  ]) {
    let fetchCalls = 0;
    const base = await startNotifyRelay(t, {
      lookup: (hostname, options, callback) => callback(null, addresses),
      fetchImpl: async () => { fetchCalls++; return new Response('{}', { status: 200 }); }
    });
    await expectNotifyError(await postNotify(base, '/api/notify/webhook', {
      url: 'https://example.com/hook', body: 'secret'
    }), 403, 'ssrf-blocked');
    assert.equal(fetchCalls, 0);
  }

  let fetchCalls = 0;
  const base = await startNotifyRelay(t, {
    allowedHosts: [],
    fetchImpl: async () => { fetchCalls++; return new Response('{}', { status: 200 }); }
  });
  await expectNotifyError(await postNotify(base, '/api/notify/webhook', {
    url: 'https://custom.example.net/hook', body: 'secret'
  }), 403, 'host-not-allowed');
  assert.equal(fetchCalls, 0);
});

test('forwards allowed webhook bodies without credentials and accepts provider success codes', async (t) => {
  const calls = [];
  const lookups = [];
  const base = await startNotifyRelay(t, {
    lookup: (hostname, options, callback) => {
      lookups.push(hostname);
      callback(null, [{ address: PUBLIC_IP, family: 4 }]);
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response('{"errcode":0,"errmsg":"ignored"}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  const body = { msgtype: 'markdown', markdown: { content: 'private check-in' } };
  const response = await postNotify(base, '/api/notify/webhook', {
    url: 'https://hooks.example.com:443/path?q=1', body
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), PWA_ORIGIN);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(lookups, ['hooks.example.com']);
  assert.equal(calls[0].url, 'https://hooks.example.com/path?q=1');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(calls[0].options.headers).sort(), ['accept', 'content-type']);
  assert.deepEqual(JSON.parse(calls[0].options.body), body);
});

test('propagates webhook provider errors without leaking upstream details', async (t) => {
  const providerResponses = [
    { ok: false, error: 'secret-provider-detail' },
    { errcode: 93000, errmsg: 'secret-provider-detail' },
    { code: 'invalid', msg: 'secret-provider-detail' },
    { StatusCode: 500, Message: 'secret-provider-detail' },
    { status: 'failed', error: 'secret-provider-detail' }
  ];
  for (const provider of providerResponses) {
    const base = await startNotifyRelay(t, {
      fetchImpl: async () => new Response(JSON.stringify(provider), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    });
    const response = await postNotify(base, '/api/notify/webhook', {
      url: 'https://example.com/hook?token=secret-token', body: { lat: 31.2, lon: 121.5 }
    });
    await expectNotifyError(response, 502, 'provider-rejected');
    assert.equal((await response.clone().text()).includes('secret-provider-detail'), false);
  }

  const base = await startNotifyRelay(t, {
    fetchImpl: async () => { throw new Error('network failed for https://secret.example/hook token=secret-token'); }
  });
  const response = await postNotify(base, '/api/notify/webhook', {
    url: 'https://example.com/hook?token=secret-token', body: { lat: 31.2, lon: 121.5, text: 'private-body' }
  });
  await expectNotifyError(response, 502, 'upstream-error');
  const responseText = await response.clone().text();
  for (const secret of ['secret.example', 'secret-token', '31.2', '121.5', 'private-body']) {
    assert.equal(responseText.includes(secret), false);
  }
});

test('Worker rejects provider error payloads without leaking upstream details', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'secret-provider-detail' }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
  const response = await safetyWorker.fetch(new Request('https://relay.example/api/notify/webhook', {
    method: 'POST',
    headers: {
      origin: 'https://peteliao.github.io',
      authorization: 'Bearer test-token',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ url: 'https://open.feishu.cn/test', body: { msgtype: 'text' } })
  }), {
    SAFETY_NOTIFY_ENABLED: '1',
    SAFETY_NOTIFY_TOKEN: 'test-token',
    SAFETY_RELAY_ALLOWED_HOSTS: 'open.feishu.cn'
  });
  await expectNotifyError(response, 502, 'provider-rejected');
  assert.equal((await response.clone().text()).includes('secret-provider-detail'), false);
});

test('rejects redirects, non-success statuses, and oversized upstream JSON', async (t) => {
  const responses = [
    new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
    new Response('private-upstream-detail', { status: 500 }),
    new Response(`{"errcode":0,"padding":"${'x'.repeat(17 * 1024)}"}`, {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  ];
  const expected = ['upstream-rejected', 'upstream-rejected', 'upstream-invalid'];
  for (let index = 0; index < responses.length; index++) {
    const base = await startNotifyRelay(t, { fetchImpl: async () => responses[index] });
    const response = await postNotify(base, '/api/notify/webhook', {
      url: 'https://example.com/hook', body: 'secret'
    });
    await expectNotifyError(response, 502, expected[index]);
    assert.equal((await response.clone().text()).includes('private-upstream-detail'), false);
  }
});

test('enforces request size, JSON, webhook, and email validation', async (t) => {
  const base = await startNotifyRelay(t, {
    maxBodyBytes: 1024,
    fetchImpl: async () => { throw new Error('fetch must not run'); }
  });
  await expectNotifyError(await postNotify(base, '/api/notify/webhook', {
    url: 'https://example.com/hook', body: 'x'.repeat(1100)
  }), 413, 'payload-too-large');

  const chunkedBody = JSON.stringify({ url: 'https://example.com/hook', body: 'x'.repeat(1100) });
  const chunked = await postRawChunked(base, '/api/notify/webhook', chunkedBody);
  assert.equal(chunked.status, 413);
  assert.deepEqual(JSON.parse(chunked.text), { ok: false, error: 'payload-too-large' });

  await expectNotifyError(await postNotify(base, '/api/notify/webhook', undefined, {
    rawBody: '{', headers: { 'content-type': 'application/json' }
  }), 400, 'invalid-json');
  await expectNotifyError(await postNotify(base, '/api/notify/webhook', {
    url: 'https://example.com/hook', body: 'secret'
  }, { headers: { 'content-type': 'text/plain' } }), 415, 'unsupported-media-type');
  await expectNotifyError(await postNotify(base, '/api/notify/webhook', {
    url: 'https://example.com/hook'
  }), 400, 'invalid-webhook');

  let sendCalls = 0;
  const mailBase = await startNotifyRelay(t, {
    sendMail: async () => { sendCalls++; },
    from: 'safety@example.com'
  });
  const validMail = { to: ['person@example.com'], subject: 'Check-in', text: 'I am safe' };
  const invalidMails = [
    [{ ...validMail, to: [] }, 'invalid-recipient'],
    [{ ...validMail, to: Array.from({ length: 11 }, (_, index) => `person${index}@example.com`) }, 'invalid-recipient'],
    [{ ...validMail, to: ['not-an-email'] }, 'invalid-recipient'],
    [{ ...validMail, to: ['a..b@example.com'] }, 'invalid-recipient'],
    [{ ...validMail, to: ['person@example.com\r\nBcc:other@example.com'] }, 'invalid-recipient'],
    [{ ...validMail, subject: 'x'.repeat(257) }, 'invalid-subject'],
    [{ ...validMail, subject: 'hello\r\nBcc: other@example.com' }, 'invalid-subject'],
    [{ ...validMail, text: 'x'.repeat(32 * 1024 + 1) }, 'invalid-message']
  ];
  for (const [body, code] of invalidMails) {
    await expectNotifyError(await postNotify(mailBase, '/api/notify/email', body), 400, code);
  }
  assert.equal(sendCalls, 0);
});

test('sends injected email and maps mail failures to non-sensitive errors', async (t) => {
  const validMail = { to: ['person@example.com'], subject: 'Check-in', text: 'I am safe' };
  const sent = [];
  const base = await startNotifyRelay(t, {
    from: 'safety@example.com',
    sendMail: async (message) => { sent.push(message); }
  });
  const response = await postNotify(base, '/api/notify/email', {
    to: ['one@example.com', 'two@example.com', 'one@example.com'],
    subject: 'Safety check-in',
    text: 'Check-in text'
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(sent, [{
    from: 'safety@example.com',
    to: ['one@example.com', 'two@example.com'],
    subject: 'Safety check-in',
    text: 'Check-in text'
  }]);

  const logs = [];
  const failingRelay = createRelayServer({
    port: 0,
    host: '127.0.0.1',
    log: (line) => logs.push(line),
    notify: {
      enabled: true,
      token: NOTIFY_TOKEN,
      from: 'safety@example.com',
      sendMail: async () => { throw new Error('SMTP password=secret-smtp recipient=private@example.com'); }
    }
  });
  const address = await failingRelay.listen();
  t.after(() => failingRelay.close());
  const failure = await postNotify(`http://127.0.0.1:${address.port}`, '/api/notify/email', {
    to: ['private@example.com'], subject: 'private-subject', text: 'private-body'
  });
  await expectNotifyError(failure, 502, 'mail-failed');
  const failureText = await failure.clone().text();
  const auditText = `${failureText}\n${logs.join('\n')}`;
  for (const secret of ['secret-smtp', 'private@example.com', 'private-subject', 'private-body', NOTIFY_TOKEN]) {
    assert.equal(auditText.includes(secret), false);
  }
  assert.ok(logs.every((line) => /^notify status=\d+$/.test(line)));

  const unavailable = await startNotifyRelay(t);
  await expectNotifyError(await postNotify(unavailable, '/api/notify/email', validMail), 503, 'mail-unavailable');
});

test('loads the configured Nodemailer transport and maps connection failures safely', async (t) => {
  const base = await startNotifyRelay(t, {
    smtp: { host: '127.0.0.1', port: 1, secure: false, user: '', pass: '' },
    from: 'safety@example.com',
    timeoutMs: 200
  });
  const response = await postNotify(base, '/api/notify/email', {
    to: ['family@example.com'],
    subject: 'Safety check-in',
    text: 'Test location'
  });
  await expectNotifyError(response, 502, 'mail-failed');
});

test('rate limits notify requests per client IP', async (t) => {
  const base = await startNotifyRelay(t, { rateLimit: 2, rateWindowMs: 60_000 });
  for (let index = 0; index < 2; index++) {
    const response = await postNotify(base, '/api/notify/webhook', {
      url: 'https://example.com/hook', body: 'secret'
    });
    assert.equal(response.status, 200);
  }
  await expectNotifyError(await postNotify(base, '/api/notify/webhook', {
    url: 'https://example.com/hook', body: 'secret'
  }), 429, 'rate-limited');
});

test('times out injected webhook delivery without exposing details', async (t) => {
  const base = await startNotifyRelay(t, {
    timeoutMs: 20,
    fetchImpl: async (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('secret-timeout-detail', 'AbortError')), { once: true });
    })
  });
  const response = await postNotify(base, '/api/notify/webhook', {
    url: 'https://example.com/hook', body: 'private-body'
  });
  await expectNotifyError(response, 504, 'upstream-timeout');
  assert.equal((await response.clone().text()).includes('secret-timeout-detail'), false);
});

const TG_TOKEN = '123456:abcdefghijklmnopqrstuvwxyz123456';
const tgPayload = () => ({
  botToken: TG_TOKEN,
  messages: [
    {
      method: 'sendLocation',
      body: {
        chat_id: '-1001234567890', message_thread_id: 42, latitude: 31.2304, longitude: 121.4737,
        horizontal_accuracy: 12, heading: 360, live_period: 86400,
        reply_markup: { inline_keyboard: [[{
          text: '高德地图', url: 'https://uri.amap.com/marker?position=121.479,31.225', callback_data: 'discard-me'
        }]] }
      }
    },
    {
      method: 'sendMessage',
      body: {
        chat_id: '-1001234567890', message_thread_id: 42, parse_mode: 'HTML', text: '<b>安全报备</b>',
        reply_markup: { force_reply: true }
      }
    }
  ]
});

test('relay sends TG location then replies with telemetry through the allowlisted provider', async (t) => {
  const calls = [];
  const logs = [];
  const relay = createRelayServer({
    port: 0,
    host: '127.0.0.1',
    log: (line) => logs.push(line),
    notify: {
      enabled: true,
      token: NOTIFY_TOKEN,
      telegramAllowedHosts: ['api.telegram.org', 'tg-proxy.example'],
      lookup: publicLookup,
      fetchImpl: async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length === 1 ? 321 : 322 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }
  });
  const address = await relay.listen();
  t.after(() => relay.close());
  const response = await postNotify(`http://127.0.0.1:${address.port}`, '/api/notify/telegram', tgPayload());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TG_TOKEN}/sendLocation`);
  assert.equal(calls[1].url, `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`);
  assert.deepEqual(calls[1].body.reply_parameters, { message_id: 321, allow_sending_without_reply: true });
  assert.equal(calls[0].body.latitude, 31.2304);
  assert.equal(calls[0].body.message_thread_id, 42);
  assert.equal(calls[0].body.heading, 360);
  assert.equal(Object.hasOwn(calls[0].body, 'live_period'), false);
  assert.equal(Object.hasOwn(calls[0].body.reply_markup.inline_keyboard[0][0], 'callback_data'), false);
  assert.deepEqual(calls[1].body.link_preview_options, { is_disabled: true });
  assert.equal(Object.hasOwn(calls[1].body, 'reply_markup'), false);
  assert.deepEqual(Object.keys(calls[0].options.headers).sort(), ['accept', 'content-type']);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  assert.ok(logs.every((line) => /^notify status=\d+$/.test(line)));
  assert.equal(logs.join('\n').includes(TG_TOKEN), false);
});

test('relay rejects invalid TG payloads and unapproved custom API hosts before fetch', async (t) => {
  let fetchCalls = 0;
  const base = await startNotifyRelay(t, {
    fetchImpl: async () => { fetchCalls++; return successfulFetch(); }
  });
  const cases = [
    [{ ...tgPayload(), botToken: 'invalid' }, 'invalid-tg-token'],
    [{ ...tgPayload(), apiBaseUrl: 'http://api.telegram.org' }, 'invalid-tg-api-base'],
    [{ ...tgPayload(), apiBaseUrl: 'https://tg-proxy.example' }, 'host-not-allowed'],
    [{ ...tgPayload(), messages: [] }, 'invalid-tg-message'],
    [{ ...tgPayload(), messages: [{ ...tgPayload().messages[0], body: { chat_id: 'invalid' } }] }, 'invalid-tg-chat'],
    [{ ...tgPayload(), messages: [{ ...tgPayload().messages[0], body: { chat_id: '123', latitude: 91 } }] }, 'invalid-tg-location'],
    [{ ...tgPayload(), messages: [{
      ...tgPayload().messages[0], body: { chat_id: '123', latitude: 31.2304, longitude: 121.4737, heading: 0 }
    }] }, 'invalid-tg-location'],
    [{ ...tgPayload(), messages: [tgPayload().messages[0], {
      ...tgPayload().messages[1], body: { ...tgPayload().messages[1].body, chat_id: '@other_channel' }
    }] }, 'invalid-tg-chat']
  ];
  for (const [payload, code] of cases) {
    await expectNotifyError(await postNotify(base, '/api/notify/telegram', payload), code === 'host-not-allowed' ? 403 : 400, code);
  }
  assert.equal(fetchCalls, 0);
});

test('relay supports text-only TG custom API delivery and stops on provider rejection', async (t) => {
  const calls = [];
  const base = await startNotifyRelay(t, {
    telegramAllowedHosts: ['tg-proxy.example'],
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response('{"ok":true,"result":{"message_id":77}}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  const response = await postNotify(base, '/api/notify/telegram', {
    apiBaseUrl: 'https://tg-proxy.example',
    botToken: TG_TOKEN,
    messages: [{ method: 'sendMessage', body: { chat_id: '@checkin_channel', parse_mode: 'HTML', text: '<b>Safe</b>' } }]
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://tg-proxy.example/bot${TG_TOKEN}/sendMessage`);
  assert.equal(calls[0].body.chat_id, '@checkin_channel');

  let failingCalls = 0;
  const failing = await startNotifyRelay(t, {
    fetchImpl: async () => {
      failingCalls++;
      return new Response('{"ok":false,"error_code":401,"description":"secret-token-detail"}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  const rejected = await postNotify(failing, '/api/notify/telegram', tgPayload());
  await expectNotifyError(rejected, 502, 'provider-rejected');
  assert.equal(failingCalls, 1);
  assert.equal((await rejected.clone().text()).includes('secret-token-detail'), false);
});

test('Worker sends TG location and telemetry replies without leaking provider details', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length === 1 ? 501 : 502 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const response = await safetyWorker.fetch(new Request('https://relay.example/api/notify/telegram', {
    method: 'POST',
    headers: {
      origin: 'https://peteliao.github.io',
      authorization: 'Bearer test-token',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ ...tgPayload(), apiBaseUrl: 'https://tg-proxy.example' })
  }), {
    SAFETY_NOTIFY_ENABLED: '1',
    SAFETY_NOTIFY_TOKEN: 'test-token',
    SAFETY_TELEGRAM_ALLOWED_HOSTS: 'tg-proxy.example'
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://tg-proxy.example/bot${TG_TOKEN}/sendLocation`);
  assert.equal(calls[1].url, `https://tg-proxy.example/bot${TG_TOKEN}/sendMessage`);
  assert.deepEqual(calls[1].body.reply_parameters, { message_id: 501, allow_sending_without_reply: true });
  assert.equal(Object.hasOwn(calls[0].body, 'live_period'), false);
  assert.equal(Object.hasOwn(calls[0].body.reply_markup.inline_keyboard[0][0], 'callback_data'), false);
  assert.deepEqual(calls[1].body.link_preview_options, { is_disabled: true });
  assert.equal(Object.hasOwn(calls[1].body, 'reply_markup'), false);

  globalThis.fetch = async () => new Response('{"ok":false,"description":"secret-provider-detail"}', {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
  const rejected = await safetyWorker.fetch(new Request('https://relay.example/api/notify/telegram', {
    method: 'POST',
    headers: {
      origin: 'https://peteliao.github.io',
      authorization: 'Bearer test-token',
      'content-type': 'application/json'
    },
    body: JSON.stringify(tgPayload())
  }), {
    SAFETY_NOTIFY_ENABLED: '1',
    SAFETY_NOTIFY_TOKEN: 'test-token'
  });
  await expectNotifyError(rejected, 502, 'provider-rejected');
  assert.equal((await rejected.clone().text()).includes('secret-provider-detail'), false);
});
