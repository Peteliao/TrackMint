import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoTab } from './utils';

const SAFETY_KEY = 'localtrace.safety.v1';
const SETTINGS_KEY = 'localtrace.settings.v1';
const HOOK_URL = 'https://hooks.example.test/safety?token=local-secret';
const TG_API_BASE = 'https://tg.example.test';
const TG_TOKEN = '123456:abcdefghijklmnopqrstuvwxyz123456';

const safetySettings = {
  enabled: true,
  disclaimerAccepted: true,
  disclaimerAcceptedAt: 1,
  senderAlias: 'Trail Phone',
  emergencyEmails: [] as string[],
  emergencyPhone: '+8613800138000',
  preferredNavMap: 'all',
  relayProxyUrl: '',
  relayToken: '',
  emailMode: 'mailto',
  webhooks: [{
    id: 'e2e-safety-hook',
    name: 'Safety mock',
    platform: 'bark',
    enabled: true,
    url: HOOK_URL,
    secret: '',
    keyword: '',
    customTemplate: ''
  }],
  autoCheckInIntervalMin: 0,
  lowBatteryThreshold: 0,
  sosFeedback: false
};

test.use({
  serviceWorkers: 'block',
  permissions: ['geolocation', 'clipboard-read', 'clipboard-write'],
  geolocation: { latitude: 31.2304, longitude: 121.4737, accuracy: 12 }
});

async function resetBrowserState(page: Page, path = '/') {
  const localOrigin = new URL(test.info().project.use.baseURL || 'http://127.0.0.1:5199').origin;
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('https://hooks.example.test/') || url.startsWith(`${TG_API_BASE}/`)) return route.fallback();
    if (url.startsWith(`${localOrigin}/`)) return route.continue();
    return route.abort();
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__lt))).toBe(true);
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  });
  await page.goto(path);
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__lt))).toBe(true);
}

async function seedSafety(page: Page, settings: object, mainSettings: object = {}, path = '/?sim=1') {
  await page.addInitScript(({ safetyKey, settingsKey, safety, settings: preferences }) => {
    localStorage.setItem(safetyKey, JSON.stringify(safety));
    if (Object.keys(preferences).length) localStorage.setItem(settingsKey, JSON.stringify(preferences));
  }, { safetyKey: SAFETY_KEY, settingsKey: SETTINGS_KEY, safety: settings, settings: mainSettings });
  await resetBrowserState(page, path);
}

async function openSafetyCard(page: Page) {
  await gotoTab(page, 'settings');
  const card = page.locator('#safety-settings');
  if (!await card.evaluate((node) => (node as HTMLDetailsElement).open)) {
    await card.locator(':scope > summary').click();
  }
  await expect(card).toBeVisible();
  return card;
}

async function hold(page: Page, selector: string, duration: number) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`Missing gesture target: ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(duration);
  await page.mouse.up();
}

async function enableSafety(card: Locator) {
  const checkbox = card.getByRole('checkbox', { name: '启用安全与位置报备', exact: true });
  await checkbox.locator('..').locator('.slider').click();
  await expect(checkbox).toBeChecked();
}

async function mockSafetyWebhook(page: Page) {
  const requests: Array<{ body: any; headers: Record<string, string> }> = [];
  await page.route('https://hooks.example.test/**', async (route) => {
    const request = route.request();
    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Title, Priority, Tags, Markdown'
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    const rawBody = request.postData() || '';
    let body: any = rawBody;
    try { body = request.postDataJSON(); } catch { /* ntfy sends plain text */ }
    requests.push({ body, headers: request.headers() });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: '{"ok":true}'
    });
  });
  return requests;
}

async function mockSafetyTelegram(page: Page) {
  const requests: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  await page.route(`${TG_API_BASE}/**`, async (route) => {
    const request = route.request();
    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type'
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    requests.push({ url: request.url(), body: request.postDataJSON(), headers: request.headers() });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, result: { message_id: requests.length === 1 ? 321 : 322 } })
    });
  });
  return requests;
}

test('TG settings send a native location and reply with escaped telemetry through a custom API base', async ({ page }) => {
  const requests = await mockSafetyTelegram(page);
  await seedSafety(page, {
    ...safetySettings,
    senderAlias: '<Trail> & Phone',
    emergencyPhone: '',
    webhooks: [{
      id: 'e2e-tg-hook',
      name: 'TG',
      platform: 'telegram',
      enabled: true,
      url: TG_API_BASE,
      secret: '',
      keyword: '',
      customTemplate: '',
      botToken: TG_TOKEN,
      chatId: '-1001234567890',
      messageThreadId: 42,
      sendNativeLocation: true
    }]
  }, {}, '/');
  const card = await openSafetyCard(page);
  const webhook = card.locator('.safety-webhook');
  await expect(webhook.locator(':scope > summary')).toContainText('TG');
  await webhook.locator(':scope > summary').click();
  await expect(webhook.getByLabel('TG Bot Token', { exact: true })).toHaveAttribute('type', 'password');
  await expect(webhook.getByLabel('TG Chat ID', { exact: true })).toHaveValue('-1001234567890');
  await expect(webhook.getByLabel('TG 话题 ID', { exact: true })).toHaveValue('42');
  const nativeLocation = webhook.locator('input[aria-label="发送 TG 原生位置"]');
  await expect(nativeLocation).toBeChecked();
  await expect(webhook).toContainText('私人聊天请先对机器人发送 /start');

  await webhook.getByRole('button', { name: '测试', exact: true }).click();
  await expect(webhook.locator('.safety-webhook-status')).toHaveText('Webhook 测试发送成功。');
  expect(requests).toHaveLength(2);
  expect(requests[0].url).toBe(`${TG_API_BASE}/bot${TG_TOKEN}/sendLocation`);
  expect(requests[1].url).toBe(`${TG_API_BASE}/bot${TG_TOKEN}/sendMessage`);
  expect(requests[0].body).toMatchObject({
    chat_id: '-1001234567890',
    message_thread_id: 42,
    latitude: 31.2304,
    longitude: 121.4737,
    horizontal_accuracy: 12
  });
  const buttons = requests[0].body.reply_markup.inline_keyboard.flat();
  expect(buttons).toHaveLength(3);
  expect(buttons.find((button: any) => button.text === '高德地图导航（已纠偏）').url).toContain('uri.amap.com');
  expect(buttons.find((button: any) => button.text === 'Google 地图导航').url).toContain('121.473700');
  expect(requests[1].body).toMatchObject({
    chat_id: '-1001234567890',
    message_thread_id: 42,
    parse_mode: 'HTML',
    reply_parameters: { message_id: 321, allow_sending_without_reply: true }
  });
  expect(requests[1].body.text).toContain('&lt;Trail&gt; &amp; Phone');
  expect(requests[1].body.text).toContain('<code>31.230400, 121.473700</code>');
  expect(await card.textContent()).not.toContain(TG_TOKEN);

  await nativeLocation.locator('..').locator('.slider').click();
  await expect(nativeLocation).not.toBeChecked();
  await webhook.getByRole('button', { name: '测试', exact: true }).click();
  await expect(webhook.locator('.safety-webhook-status')).toHaveText('Webhook 测试发送成功。');
  expect(requests).toHaveLength(3);
  expect(requests[2].url).toBe(`${TG_API_BASE}/bot${TG_TOKEN}/sendMessage`);
  expect(requests[2].body.reply_parameters).toBeUndefined();
  const stored = await page.evaluate(({ safetyKey, settingsKey }) => ({
    safety: localStorage.getItem(safetyKey) || '',
    settings: localStorage.getItem(settingsKey) || ''
  }), { safetyKey: SAFETY_KEY, settingsKey: SETTINGS_KEY });
  expect(stored.safety).toContain('abcdefghijklmnopqrstuvwxyz123456');
  expect(stored.settings).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
});

test('first enable shows both disclaimers, isolates credentials and focuses the settings card', async ({ page }) => {
  await resetBrowserState(page, '/?sim=1');
  const card = await openSafetyCard(page);
  await card.getByLabel('报备人名称', { exact: true }).fill('Trail Phone');
  await card.getByLabel('紧急联系人邮箱', { exact: true }).fill('family@example.com');
  await enableSafety(card);

  const dialog = page.getByRole('dialog', { name: '安全与位置报备须知' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.safety-disclaimer-text[lang="zh-CN"]')).toContainText('不保证救援或消息送达');
  await expect(dialog.locator('.safety-disclaimer-text[lang="zh-CN"]')).toContainText('CORS/User-Agent');
  await expect(dialog.locator('.safety-disclaimer-text[lang="en"]')).toContainText('does not guarantee rescue or message delivery');
  await expect(dialog.locator('.safety-disclaimer-text[lang="en"]')).toContainText('CORS/User-Agent');
  const agree = dialog.getByRole('checkbox');
  const accept = dialog.getByRole('button', { name: '我已了解并同意', exact: true });
  await expect(accept).toBeDisabled();
  await agree.check();
  await expect(accept).toBeEnabled();
  await accept.click();

  await expect(dialog).toHaveCount(0);
  await expect(card.locator('.safety-state')).toHaveText('已启用');
  const stored = await page.evaluate(({ safetyKey, settingsKey }) => ({
    safety: localStorage.getItem(safetyKey) || '',
    settings: localStorage.getItem(settingsKey) || ''
  }), { safetyKey: SAFETY_KEY, settingsKey: SETTINGS_KEY });
  expect(stored.safety).toContain('family@example.com');
  expect(stored.settings).not.toContain('family@example.com');

  await page.evaluate(() => (window as any).__lt.shell.navigate('settings', { anchor: 'safety' }, { history: false }));
  await expect(card).toHaveClass(/settings-focus/);
  await expect.poll(() => card.locator(':scope > summary').evaluate((summary) => {
    const cardNode = summary.parentElement!;
    const scroll = cardNode.closest('.view-scroll')!;
    const summaryRect = summary.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    const cardTop = cardNode.getBoundingClientRect().top;
    return summaryRect.top >= scrollRect.top && summaryRect.bottom <= scrollRect.bottom
      && cardTop >= scrollRect.top && cardTop - scrollRect.top < 24;
  })).toBe(true);
});

test('webhook tests use the current form, respect cooldown and do not expose credentials', async ({ page }) => {
  const requests = await mockSafetyWebhook(page);
  await resetBrowserState(page, '/?sim=1');
  const card = await openSafetyCard(page);
  await card.getByLabel('报备人名称', { exact: true }).fill('Trail Phone');
  await card.getByLabel('紧急联系人邮箱', { exact: true }).fill('family@example.com');
  await enableSafety(card);
  const disclaimer = page.getByRole('dialog', { name: '安全与位置报备须知' });
  await disclaimer.getByRole('checkbox').check();
  await disclaimer.getByRole('button', { name: '我已了解并同意', exact: true }).click();
  await card.getByLabel('紧急联系人邮箱', { exact: true }).fill('');

  await card.getByRole('button', { name: '添加 Webhook', exact: true }).click();
  const webhook = card.locator('.safety-webhook').last();
  await webhook.getByLabel('Webhook URL', { exact: true }).fill(HOOK_URL);
  await webhook.getByRole('button', { name: '测试', exact: true }).click();
  await expect(webhook.locator('.safety-webhook-status')).toHaveText('Webhook 测试发送成功。');
  expect(requests).toHaveLength(1);
  expect(requests[0].headers.priority).toBe('high');

  await card.getByRole('button', { name: '测试发送', exact: true }).click();
  await expect(page.getByText('安全报备已发送。', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  await card.getByRole('button', { name: '测试发送', exact: true }).click();
  await expect(page.getByText('请稍候片刻再发送。', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);

  const stored = await page.evaluate(({ safetyKey, settingsKey }) => ({
    safety: localStorage.getItem(safetyKey) || '',
    settings: localStorage.getItem(settingsKey) || ''
  }), { safetyKey: SAFETY_KEY, settingsKey: SETTINGS_KEY });
  expect(stored.safety).toContain('hooks.example.test');
  expect(stored.settings).not.toContain('hooks.example.test');
  await expect(webhook.locator('.safety-webhook-status')).not.toContainText(HOOK_URL);
  expect(await card.textContent()).not.toContain('local-secret');
});

test('record check-in confirms while a two-second hold sends SOS without changing recording', async ({ page }) => {
  const requests = await mockSafetyWebhook(page);
  await seedSafety(page, safetySettings);
  await expect.poll(() => page.evaluate(() => (window as any).__lt.recorder.rec.live?.pointCount || 0)).toBeGreaterThan(0);
  await expect(page.locator('.live-panel')).not.toHaveClass(/collapsed/);
  await expect.poll(() => page.locator('.safety-entry').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('.safety-entry') === node;
  })).toBe(true);

  await page.locator('.safety-entry').click();
  await expect(page.getByRole('dialog', { name: '确认发送安全报备？' })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: '取消', exact: true }).click();

  await hold(page, '.safety-entry', 2150);
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].body.sound).toBe('alarm');
  await expect(page.locator('.safety-confirm')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__lt.recorder.rec.status)).toBe('recording');
});

test('OLED SOS keeps the pocket lock active and hold unlock restores theme and map', async ({ page }) => {
  const requests = await mockSafetyWebhook(page);
  await seedSafety(page, safetySettings, { theme: 'matrix' });
  await expect.poll(() => page.evaluate(() => (window as any).__lt.recorder.rec.live?.pointCount || 0)).toBeGreaterThan(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'matrix');
  await page.evaluate(() => { (window as any).__safetyMap = (window as any).__lt.shell.getViews().record.getMap(); });

  await page.locator('.power-lock-entry').click();
  await expect(page.locator('#oled-dash.active')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'matrix');
  await expect(page.locator('#oled-dash button')).toHaveCount(2);
  expect(await page.locator('#oled-dash .ps-sos .fgc').evaluate((node) => getComputedStyle(node).stroke)).toBe('rgb(255, 91, 91)');

  await hold(page, '.ps-sos', 2150);
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].body.sound).toBe('alarm');
  await expect(page.locator('#oled-dash.active')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__lt.recorder.rec.status)).toBe('recording');

  await hold(page, '.ps-unlock', 1650);
  await expect(page.locator('#oled-dash.active')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'matrix');
  expect(await page.evaluate(() => {
    const map = (window as any).__lt.shell.getViews().record.getMap();
    return map === (window as any).__safetyMap && !map.destroyed && !map._renderingPaused;
  })).toBe(true);
});

test('offline fallback copies the rescue text and exposes only SMS and mailto drafts', async ({ page }) => {
  await seedSafety(page, {
    ...safetySettings,
    webhooks: [],
    emergencyEmails: ['family@example.com']
  });
  await expect.poll(() => page.evaluate(() => (window as any).__lt.recorder.rec.live?.pointCount || 0)).toBeGreaterThan(0);
  await page.context().setOffline(true);
  try {
    await page.locator('.safety-entry').click();
    const confirm = page.getByRole('dialog', { name: '确认发送安全报备？' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: '发送报备', exact: true }).click();

    const fallback = page.locator('.safety-fallback-modal');
    await expect(fallback).toBeVisible();
    await expect(fallback.locator('.safety-rescue-text')).toContainText('Trail Phone');
    const smsHref = await fallback.getByRole('link', { name: '打开短信草稿' }).getAttribute('href');
    const mailtoHref = await fallback.getByRole('link', { name: '邮件草稿（mailto）' }).getAttribute('href');
    expect(decodeURIComponent(smsHref || '')).toContain('sms:+8613800138000');
    expect(decodeURIComponent(mailtoHref || '')).toContain('mailto:family@example.com');

    await fallback.getByRole('button', { name: '复制报备文案' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Trail Phone');
  } finally {
    await page.context().setOffline(false);
  }
});
