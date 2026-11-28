import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wgs84ToGcj02 } from '../src/core/coords';

const values = new Map<string, string>();
const position = {
  lat: 25.033964,
  lon: 121.564468,
  accuracy: 8,
  altitude: 685,
  timestamp: Date.parse('2026-11-28T08:42:10Z'),
  batteryLevel: 0.24,
  distanceM: 7400,
  durationMs: 2 * 3600_000 + 15 * 60_000 + 30_000,
  recordingState: 'recording' as const
};

let safety: typeof import('../src/core/safety');
let navLinks: typeof import('../src/core/navLinks');
let notifier: typeof import('../src/core/notifier');

beforeEach(async () => {
  vi.resetModules();
  values.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  });
  safety = await import('../src/core/safety');
  navLinks = await import('../src/core/navLinks');
  notifier = await import('../src/core/notifier');
});

function enabledSettings() {
  return {
    ...safety.defaultSafetySettings(),
    enabled: true,
    disclaimerAccepted: true,
    senderAlias: '张三的手机',
    emergencyEmails: ['family@example.com'],
    emergencyPhone: '+8613800138000',
    webhooks: []
  };
}

describe('safety settings', () => {
  it('normalizes credentials and requires the disclaimer before enabling', () => {
    const disabled = safety.normalizeSafetySettings({ enabled: true, emergencyEmails: 'A@EXAMPLE.com, a@example.com，b@example.com' });
    expect(disabled.enabled).toBe(false);
    expect(disabled.emergencyEmails).toEqual(['a@example.com', 'b@example.com']);
    const enabled = safety.normalizeSafetySettings({ ...disabled, disclaimerAccepted: true, enabled: true });
    expect(enabled.enabled).toBe(true);
    expect(enabled.disclaimerAcceptedAt).toBeUndefined();
  });

  it('persists only under the dedicated local safety key', () => {
    const settings = enabledSettings();
    safety.saveSafetySettings(settings);
    expect([...values.keys()]).toEqual([safety.SAFETY_STORAGE_KEY]);
    expect(safety.loadSafetySettings()).toEqual(settings);
  });

  it('requires a relay only for platforms that cannot be called directly', () => {
    const settings = enabledSettings();
    settings.webhooks = [{ ...safety.createWebhook('ntfy'), url: 'https://ntfy.sh/roametch' }];
    expect(safety.validateSafetySettings(settings)).toEqual([]);
    settings.webhooks[0].platform = 'wecom';
    expect(safety.validateSafetySettings(settings)).toContain('relayProxyUrl');
  });

  it('requires HTTPS for relay and webhook transport', () => {
    const settings = enabledSettings();
    settings.webhooks = [{ ...safety.createWebhook('ntfy'), url: 'http://ntfy.sh/roametch' }];
    expect(safety.validateSafetySettings(settings)).toContain(`webhook:${settings.webhooks[0].id}:url`);
    settings.webhooks[0] = { ...safety.createWebhook('wecom'), url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret' };
    settings.relayProxyUrl = 'http://relay.example.com';
    expect(safety.validateSafetySettings(settings)).toContain('relayProxyUrl');
  });

  it('normalizes TG credentials, negative chat ids, topics and native location defaults', () => {
    const settings = safety.normalizeSafetySettings({
      ...enabledSettings(),
      emergencyEmails: [],
      webhooks: [{
        ...safety.createWebhook('telegram'),
        botToken: '123456:abcdefghijklmnopqrstuvwxyz123456',
        chatId: '-1001234567890',
        messageThreadId: 42,
        url: 'https://tg-proxy.example/'
      }]
    });
    expect(settings.webhooks[0]).toMatchObject({
      name: 'TG',
      platform: 'telegram',
      chatId: '-1001234567890',
      messageThreadId: 42,
      sendNativeLocation: true
    });
    expect(safety.validateSafetySettings(settings)).toEqual([]);
    settings.webhooks[0].chatId = 'not-a-chat';
    expect(safety.validateSafetySettings(settings)).toContain(`webhook:${settings.webhooks[0].id}:tg-chat-id`);
    settings.webhooks[0].chatId = '-1001234567890';
    settings.webhooks[0].botToken = '';
    expect(safety.validateSafetySettings(settings)).toContain(`webhook:${settings.webhooks[0].id}:tg-token`);
  });
});

describe('safety navigation and message generation', () => {
  it('corrects only the AMap coordinate and keeps Google and Apple in WGS-84', () => {
    const settings = enabledSettings();
    const message = navLinks.buildSafetyMessage(position, settings, 'checkin', 'zh');
    const [gcjLon, gcjLat] = wgs84ToGcj02(position.lon, position.lat);
    expect(message.links).toHaveLength(3);
    expect(message.links[0].url).toContain(`position=${gcjLon.toFixed(6)},${gcjLat.toFixed(6)}`);
    expect(message.links[0].url).toContain('coordinate=gcj02');
    expect(message.links[1].url).toContain(`query=${position.lat.toFixed(6)},${position.lon.toFixed(6)}`);
    expect(message.links[2].url).toContain(`ll=${position.lat.toFixed(6)},${position.lon.toFixed(6)}`);
    expect(message.text).toContain('25.033964, 121.564468');
    expect(message.text).toContain('±8m');
    expect(message.text).toContain('24%');
  });

  it('honors the preferred map and builds compact SMS and mail drafts', () => {
    const settings = { ...enabledSettings(), preferredNavMap: 'google' as const };
    const message = navLinks.buildSafetyMessage(position, settings, 'sos', 'en');
    expect(message.title).toContain('SOS');
    expect(message.links.map((link) => link.map)).toEqual(['google']);
    expect(message.smsText).toContain('WGS-84: 25.033964, 121.564468');
    expect(message.smsText).not.toContain('Altitude');
    expect(navLinks.buildSmsHref(settings.emergencyPhone, message)).toMatch(/^sms:%2B8613800138000\?body=/);
    expect(navLinks.buildMailtoHref(settings.emergencyEmails, message)).toMatch(/^mailto:family%40example\.com\?subject=/);
  });
});

describe('safety notifier', () => {
  it('renders a custom JSON template without exposing the endpoint in the result', async () => {
    const settings = { ...enabledSettings(), emergencyEmails: [] };
    settings.webhooks = [{
      ...safety.createWebhook('custom'),
      name: 'Private endpoint',
      url: 'https://example.com/secret-token',
      customTemplate: '{"sender":"{{sender}}","coordinates":"{{lat}},{{lon}}","title":"{{title}}"}'
    }];
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const [result] = await notifier.sendSafetyCheckIn(settings, position, 'checkin', 'en', { fetchImpl: fetchImpl as any, automated: true });
    expect(result).toEqual({ channel: settings.webhooks[0].id, ok: true, detail: 'ok' });
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      sender: '张三的手机', coordinates: '25.033964,121.564468', title: '[RoamEtch Safety Check-in]'
    });
  });

  it('encodes Chinese ntfy titles as UTF-8 header bytes accepted by fetch', async () => {
    const settings = { ...enabledSettings(), emergencyEmails: [] };
    const webhook = { ...safety.createWebhook('ntfy'), url: 'https://ntfy.example/roametch' };
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', {
      status: 200, headers: { 'content-type': 'application/json' }
    }));
    const result = await notifier.sendWebhookTest(settings, webhook, position, 'zh', { fetchImpl: fetchImpl as any });
    expect(result.ok).toBe(true);
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect([...headers.Title].every((character) => character.charCodeAt(0) <= 255)).toBe(true);
    const decoded = new TextDecoder().decode(Uint8Array.from([...headers.Title], (character) => character.charCodeAt(0)));
    expect(decoded).toBe(navLinks.buildSafetyMessage(position, settings, 'test', 'zh').title);
  });

  it('treats provider-level errors as failed delivery', async () => {
    const settings = { ...enabledSettings(), emergencyEmails: [] };
    settings.webhooks = [{ ...safety.createWebhook('custom'), url: 'https://example.com/hook' }];
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"errcode":93000,"errmsg":"invalid keyword"}', {
      status: 200, headers: { 'content-type': 'application/json' }
    }));
    const [result] = await notifier.sendSafetyCheckIn(settings, position, 'checkin', 'en', { fetchImpl: fetchImpl as any, automated: true });
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('invalid keyword');
    expect(result.fallback).toBe('copy');
  });

  it('routes WeCom through the configured relay and signs Feishu and DingTalk', async () => {
    const settings = { ...enabledSettings(), emergencyEmails: [], relayProxyUrl: 'https://relay.example.com/' };
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"errcode":0}', { status: 200, headers: { 'content-type': 'application/json' } }));
    settings.webhooks = [
      { ...safety.createWebhook('wecom'), url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret' },
      { ...safety.createWebhook('feishu'), url: 'https://open.feishu.cn/open-apis/bot/v2/hook/secret', secret: 'signing-secret' },
      { ...safety.createWebhook('dingtalk'), url: 'https://oapi.dingtalk.com/robot/send?access_token=secret', secret: 'signing-secret' }
    ];
    const results = await notifier.sendSafetyCheckIn(settings, position, 'sos', 'en', {
      fetchImpl: fetchImpl as any, automated: true, now: () => Date.parse('2026-11-28T08:42:10Z')
    });
    expect(results.every((result) => result.ok)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const [url] of fetchImpl.mock.calls) expect(url).toBe('https://relay.example.com/api/notify/webhook');
    const feishuEnvelope = JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string);
    const feishuBody = feishuEnvelope.body;
    expect(feishuBody.timestamp).toBe(Math.floor(Date.parse('2026-11-28T08:42:10Z') / 1000));
    expect(feishuBody.sign).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(feishuBody.card.header.template).toBe('red');
    const dingtalkEnvelope = JSON.parse((fetchImpl.mock.calls[2][1] as RequestInit).body as string);
    expect(dingtalkEnvelope.url).toContain('sign=');
    expect(dingtalkEnvelope.url).toContain(`timestamp=${Date.parse('2026-11-28T08:42:10Z')}`);
  });

  it('opens mail drafts synchronously and offers offline fallbacks on network failure', async () => {
    const settings = enabledSettings();
    const openUrl = vi.fn();
    const mailResults = await notifier.sendSafetyCheckIn(settings, position, 'checkin', 'en', { openUrl, automated: true });
    expect(openUrl).toHaveBeenCalledOnce();
    expect(mailResults[0]).toMatchObject({ ok: true, detail: 'draft-opened' });

    settings.emailMode = 'relay';
    settings.relayProxyUrl = 'https://relay.example.com';
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => { throw new TypeError('Failed to fetch'); });
    const relayResults = await notifier.sendSafetyCheckIn(settings, position, 'checkin', 'en', { fetchImpl: fetchImpl as any, automated: true });
    expect(relayResults[0]).toMatchObject({ ok: false, detail: 'network-or-cors', fallback: 'mailto' });
  });

  it('rejects plaintext notification requests before calling fetch', async () => {
    const settings = { ...enabledSettings(), emergencyEmails: [] };
    settings.webhooks = [{ ...safety.createWebhook('custom'), url: 'http://example.com/hook' }];
    const fetchImpl = vi.fn();
    const webhookResults = await notifier.sendSafetyCheckIn(settings, position, 'sos', 'en', { fetchImpl, automated: true });
    expect(webhookResults[0]).toMatchObject({ ok: false, detail: 'https-required' });

    settings.emergencyEmails = ['family@example.com'];
    settings.emailMode = 'relay';
    settings.relayProxyUrl = 'http://relay.example.com';
    settings.webhooks = [];
    const emailResults = await notifier.sendSafetyCheckIn(settings, position, 'sos', 'en', { fetchImpl, automated: true });
    expect(emailResults[0]).toMatchObject({ ok: false, detail: 'relay-required', fallback: 'mailto' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not count an unlaunchable mail draft against successful automatic delivery', async () => {
    const settings = enabledSettings();
    settings.webhooks = [{ ...safety.createWebhook('custom'), url: 'https://example.com/hook' }];
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const results = await notifier.sendSafetyCheckIn(settings, position, 'checkin', 'en', {
      fetchImpl: fetchImpl as any,
      automated: true,
      allowProtocolLaunch: false
    });
    expect(results).toEqual([{ channel: settings.webhooks[0].id, ok: true, detail: 'ok' }]);
  });

  it('sends a TG native location with navigation buttons and replies with escaped telemetry', async () => {
    const settings = { ...enabledSettings(), emergencyEmails: [], senderAlias: '<Alex> & Team' };
    const webhook = {
      ...safety.createWebhook('telegram'),
      botToken: '123456:abcdefghijklmnopqrstuvwxyz123456',
      chatId: '-1001234567890',
      messageThreadId: 42
    };
    const responses = [
      new Response('{"ok":true,"result":{"message_id":321}}', {
        status: 200, headers: { 'content-type': 'application/json' }
      }),
      new Response('{"ok":true,"result":{"message_id":322}}', {
        status: 200, headers: { 'content-type': 'application/json' }
      })
    ];
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => responses.shift()!);
    const result = await notifier.sendWebhookTest(settings, webhook, { ...position, heading: 0 }, 'en', { fetchImpl: fetchImpl as any });

    expect(result).toEqual({ channel: webhook.id, ok: true, detail: 'ok' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.telegram.org/bot${webhook.botToken}/sendLocation`);
    expect(fetchImpl.mock.calls[1][0]).toBe(`https://api.telegram.org/bot${webhook.botToken}/sendMessage`);
    const location = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(location).toMatchObject({
      chat_id: '-1001234567890',
      message_thread_id: 42,
      latitude: position.lat,
      longitude: position.lon,
      horizontal_accuracy: 8,
      heading: 360
    });
    expect(location.reply_markup.inline_keyboard).toHaveLength(2);
    expect(location.reply_markup.inline_keyboard[0][0].url).toContain('coordinate=gcj02');
    expect(location.reply_markup.inline_keyboard[1].map((button: any) => button.url).join(' ')).toContain('25.033964');
    const telemetry = JSON.parse(fetchImpl.mock.calls[1][1].body as string);
    expect(telemetry.parse_mode).toBe('HTML');
    expect(telemetry.reply_parameters).toEqual({ message_id: 321, allow_sending_without_reply: true });
    expect(telemetry.text).toContain('&lt;Alex&gt; &amp; Team');
    expect(telemetry.text).toContain('<code>25.033964, 121.564468</code>');
    expect(telemetry.text).toContain('Altitude: 685 m');
    expect(telemetry.text).toContain('Distance: 7.4 km');
    expect(telemetry.text).toContain('Duration: 02:15:30');
    expect(telemetry.text).toContain('Battery: 24%');
    expect(telemetry.text).toContain('Activity: Trip in progress');
    expect(telemetry.text).toContain('[TEST]');
    expect(JSON.stringify(result)).not.toContain(webhook.botToken);
  });

  it('can send TG text only through a custom API base', async () => {
    const settings = { ...enabledSettings(), emergencyEmails: [] };
    const webhook = {
      ...safety.createWebhook('telegram'),
      botToken: '123456:abcdefghijklmnopqrstuvwxyz123456',
      chatId: '@roametch_alerts',
      url: 'https://tg-proxy.example/',
      sendNativeLocation: false
    };
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"ok":true,"result":{"message_id":9}}', {
      status: 200, headers: { 'content-type': 'application/json' }
    }));
    const result = await notifier.sendWebhookTest(settings, webhook, position, 'zh', { fetchImpl: fetchImpl as any });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://tg-proxy.example/bot${webhook.botToken}/sendMessage`);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.chat_id).toBe('@roametch_alerts');
    expect(body.reply_parameters).toBeUndefined();
  });

  it('routes TG location and telemetry through the configured relay without exposing its token', async () => {
    const settings = { ...enabledSettings(), emergencyEmails: [], relayProxyUrl: 'https://relay.example.com/', relayToken: 'relay-secret' };
    const webhook = {
      ...safety.createWebhook('telegram'),
      botToken: '123456:abcdefghijklmnopqrstuvwxyz123456',
      chatId: '-1001234567890',
      url: 'https://tg-proxy.example'
    };
    settings.webhooks = [webhook];
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', {
      status: 200, headers: { 'content-type': 'application/json' }
    }));
    const [result] = await notifier.sendSafetyCheckIn(settings, { ...position, heading: 90 }, 'sos', 'en', {
      fetchImpl: fetchImpl as any, automated: true
    });
    expect(result).toEqual({ channel: webhook.id, ok: true, detail: 'ok' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe('https://relay.example.com/api/notify/telegram');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer relay-secret' });
    const envelope = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(envelope).toMatchObject({ apiBaseUrl: 'https://tg-proxy.example', botToken: webhook.botToken });
    expect(envelope.messages.map((message: any) => message.method)).toEqual(['sendLocation', 'sendMessage']);
    expect(JSON.stringify(result)).not.toContain(webhook.botToken);
  });

  it('does not expose relay or provider secrets in TG failures', async () => {
    const settings = { ...enabledSettings(), emergencyEmails: [], relayProxyUrl: 'https://relay.example.com' };
    const webhook = {
      ...safety.createWebhook('telegram'),
      botToken: '123456:abcdefghijklmnopqrstuvwxyz123456',
      chatId: '-1001234567890'
    };
    settings.webhooks = [webhook];
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      ok: false, error: `private relay detail ${webhook.botToken}`
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const [result] = await notifier.sendSafetyCheckIn(settings, position, 'sos', 'en', {
      fetchImpl: fetchImpl as any, automated: true
    });
    expect(result).toEqual({ channel: webhook.id, ok: false, detail: 'tg-api-error', fallback: 'copy' });
    expect(JSON.stringify(result)).not.toContain(webhook.botToken);
    expect(JSON.stringify(result)).not.toContain('private relay detail');
  });

  it('maps TG API failures to safe details and stops before replying', async () => {
    const settings = { ...enabledSettings(), emergencyEmails: [] };
    const webhook = {
      ...safety.createWebhook('telegram'),
      botToken: '123456:abcdefghijklmnopqrstuvwxyz123456',
      chatId: '-1001234567890'
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: false, error_code: 400, description: `Unauthorized ${webhook.botToken}`
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await notifier.sendWebhookTest(settings, webhook, position, 'en', { fetchImpl: fetchImpl as any });
    expect(result).toEqual({ channel: webhook.id, ok: false, detail: 'tg-api-error', fallback: 'copy' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(webhook.botToken);
  });

  it('enforces the manual cooldown but does not block automated check-ins', async () => {
    const settings = { ...enabledSettings(), emergencyEmails: [] };
    settings.webhooks = [{ ...safety.createWebhook('custom'), url: 'https://example.com/hook' }];
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    let now = 2_000_000_000_000;
    const options = { fetchImpl: fetchImpl as any, now: () => now };
    await notifier.sendSafetyCheckIn(settings, position, 'sos', 'en', options);
    await expect(notifier.sendSafetyCheckIn(settings, position, 'checkin', 'en', options)).rejects.toThrow('cooldown');
    await notifier.sendSafetyCheckIn(settings, position, 'checkin', 'en', { ...options, automated: true });
    now += 10_000;
    await expect(notifier.sendSafetyCheckIn(settings, position, 'checkin', 'en', options)).resolves.toBeDefined();
  });
});
