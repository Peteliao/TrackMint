// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acceptSafetyDisclaimer: vi.fn(),
  locateForSafety: vi.fn(),
  sendSafetyNow: vi.fn(),
  sendWebhookTest: vi.fn(),
  toast: vi.fn()
}));

vi.mock('../src/core/i18n', () => ({
  t: (key: string) => key,
  currentLang: () => 'en'
}));
vi.mock('../src/core/notifier', () => ({ sendWebhookTest: mocks.sendWebhookTest }));
vi.mock('../src/ui/safety', () => ({
  acceptSafetyDisclaimer: mocks.acceptSafetyDisclaimer,
  locateForSafety: mocks.locateForSafety,
  sendSafetyNow: mocks.sendSafetyNow
}));
vi.mock('../src/ui/helpers', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/ui/helpers')>(),
  toast: mocks.toast
}));

import {
  defaultSafetySettings,
  loadSafetySettings,
  saveSafetySettings
} from '../src/core/safety';
import { createSafetySettingsCard } from '../src/ui/safetySettings';

function mount() {
  const card = createSafetySettingsCard();
  document.body.append(card.card);
  return card;
}

function field(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const node = [...document.querySelectorAll<HTMLLabelElement>('label')]
    .find((item) => item.textContent === label);
  if (!node?.htmlFor) throw new Error(`missing field: ${label}`);
  return document.getElementById(node.htmlFor) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}

function button(label: string): HTMLButtonElement {
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((item) => item.textContent?.trim() === label);
  if (!node) throw new Error(`missing button: ${label}`);
  return node;
}

function fillRequired() {
  (field('safety.senderAlias') as HTMLInputElement).value = 'Alex';
  (field('safety.emergencyEmails') as HTMLTextAreaElement).value = 'family@example.com';
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.clearAllMocks();
  mocks.acceptSafetyDisclaimer.mockImplementation(async (candidate) => saveSafetySettings({
    ...candidate,
    disclaimerAccepted: true,
    disclaimerAcceptedAt: Date.now()
  }));
  mocks.locateForSafety.mockResolvedValue({ lat: 30, lon: 120, timestamp: Date.now() });
  mocks.sendWebhookTest.mockResolvedValue({ channel: 'local-id', ok: true, detail: 'ok' });
  mocks.sendSafetyNow.mockResolvedValue(undefined);
});

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('safety settings card', () => {
  it('saves credentials only under the independent safety storage key', () => {
    mount();
    fillRequired();
    button('safety.save').click();

    expect(loadSafetySettings()).toMatchObject({
      enabled: false,
      senderAlias: 'Alex',
      emergencyEmails: ['family@example.com']
    });
    expect(localStorage.getItem('localtrace.settings.v1')).toBeNull();
  });

  it('asks for disclaimer acceptance before enabling a valid configuration', async () => {
    mount();
    fillRequired();
    const enabled = document.querySelector<HTMLInputElement>('input[aria-label="safety.enable"]')!;
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(mocks.acceptSafetyDisclaimer).toHaveBeenCalledTimes(1));
    expect(mocks.acceptSafetyDisclaimer).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      disclaimerAccepted: false,
      senderAlias: 'Alex'
    }));
    expect(loadSafetySettings().enabled).toBe(true);
    expect(document.querySelector('.safety-state')?.textContent).toBe('safety.enabled');
  });

  it('keeps safety disabled when the disclaimer is dismissed', async () => {
    mocks.acceptSafetyDisclaimer.mockResolvedValue(null);
    mount();
    fillRequired();
    const enabled = document.querySelector<HTMLInputElement>('input[aria-label="safety.enable"]')!;
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(enabled.disabled).toBe(false));
    expect(loadSafetySettings().enabled).toBe(false);
    expect(enabled.checked).toBe(false);
  });

  it('blocks enabling incomplete settings before showing the disclaimer', async () => {
    mount();
    const enabled = document.querySelector<HTMLInputElement>('input[aria-label="safety.enable"]')!;
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(enabled.disabled).toBe(false));
    expect(mocks.acceptSafetyDisclaimer).not.toHaveBeenCalled();
    expect(document.querySelector('.safety-validation')?.textContent).toContain('safety.errAlias');
    expect(document.querySelector('.safety-validation')?.textContent).toContain('safety.errChannels');
    expect(loadSafetySettings().enabled).toBe(false);
  });

  it('adds, tests and removes a webhook without exposing its URL in status text', async () => {
    saveSafetySettings({ ...defaultSafetySettings(), disclaimerAccepted: true });
    mount();
    button('safety.addWebhook').click();
    const platform = field('safety.webhookPlatform') as HTMLSelectElement;
    platform.value = 'custom';
    platform.dispatchEvent(new Event('change'));
    (field('safety.webhookUrl') as HTMLInputElement).value = 'https://hooks.example.com/secret-token';
    (field('safety.relayProxyUrl') as HTMLInputElement).value = 'https://relay.example.com';
    field('safety.webhookUrl').dispatchEvent(new Event('input'));
    field('safety.relayProxyUrl').dispatchEvent(new Event('input'));
    button('safety.webhookTest').click();

    await vi.waitFor(() => expect(mocks.sendWebhookTest).toHaveBeenCalledTimes(1));
    expect(mocks.sendWebhookTest.mock.calls[0][0].relayProxyUrl).toBe('https://relay.example.com');
    expect(mocks.sendWebhookTest.mock.calls[0][1].url).toContain('secret-token');
    expect(document.querySelector('.safety-webhook-status')?.textContent).toBe('safety.webhookTestOk');
    expect(document.body.textContent).not.toContain('secret-token');

    button('safety.removeWebhook').click();
    expect(document.querySelector('.safety-webhook')).toBeNull();
  });

  it('configures and persists TG credentials, topic and native location without displaying the token', async () => {
    saveSafetySettings({ ...defaultSafetySettings(), disclaimerAccepted: true });
    mount();
    button('safety.addWebhook').click();
    const platform = field('safety.webhookPlatform') as HTMLSelectElement;
    platform.value = 'telegram';
    platform.dispatchEvent(new Event('change'));

    expect(field('safety.webhookName')).toHaveProperty('value', 'TG');
    (field('safety.tgApiBase') as HTMLInputElement).value = 'https://tg-proxy.example.com';
    (field('safety.tgBotToken') as HTMLInputElement).value = '123456:abcdefghijklmnopqrstuvwxyz123456';
    (field('safety.tgChatId') as HTMLInputElement).value = '-1001234567890';
    (field('safety.tgMessageThreadId') as HTMLInputElement).value = '42';
    for (const label of ['safety.tgApiBase', 'safety.tgBotToken', 'safety.tgChatId', 'safety.tgMessageThreadId']) {
      field(label).dispatchEvent(new Event('input'));
    }
    const nativeLocation = document.querySelector<HTMLInputElement>('input[aria-label="safety.tgNativeLocation"]')!;
    expect(nativeLocation.checked).toBe(true);
    nativeLocation.checked = false;
    nativeLocation.dispatchEvent(new Event('change'));
    expect(document.body.textContent).toContain('safety.tgSetupHint');
    button('safety.save').click();

    expect(loadSafetySettings().webhooks[0]).toMatchObject({
      name: 'TG',
      platform: 'telegram',
      url: 'https://tg-proxy.example.com',
      botToken: '123456:abcdefghijklmnopqrstuvwxyz123456',
      chatId: '-1001234567890',
      messageThreadId: 42,
      sendNativeLocation: false
    });
    expect(document.body.textContent).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    button('safety.webhookTest').click();
    await vi.waitFor(() => expect(mocks.sendWebhookTest).toHaveBeenCalledTimes(1));
    expect(mocks.sendWebhookTest.mock.calls[0][1]).toMatchObject({ chatId: '-1001234567890', messageThreadId: 42 });
  });

  it('persists current fields before sending a check-in test', async () => {
    saveSafetySettings({
      ...defaultSafetySettings(),
      enabled: true,
      disclaimerAccepted: true,
      senderAlias: 'Alex',
      emergencyEmails: ['family@example.com']
    });
    mount();
    (field('safety.senderAlias') as HTMLInputElement).value = 'Trail team';
    button('safety.testSend').click();

    await vi.waitFor(() => expect(mocks.sendSafetyNow).toHaveBeenCalledWith('test'));
    expect(loadSafetySettings().senderAlias).toBe('Trail team');
  });
});
