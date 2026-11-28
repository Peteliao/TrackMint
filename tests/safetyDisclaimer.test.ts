// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ modal: vi.fn() }));

vi.mock('../src/core/i18n', () => ({
  t: (key: string) => key,
  currentLang: () => 'en',
  zh: { safety: { disclaimerBody: '中文风险说明' } },
  en: { safety: { disclaimerBody: 'English risk notice' } }
}));
vi.mock('../src/core/recorder', () => ({
  rec: { status: 'idle', live: null, lastPoint: null, lastFixWall: 0 }
}));
vi.mock('../src/core/notifier', () => ({
  fallbackHref: vi.fn(),
  safetyCooldownRemaining: vi.fn(() => 0),
  sendSafetyCheckIn: vi.fn()
}));
vi.mock('../src/ui/helpers', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/ui/helpers')>(),
  modal: mocks.modal,
  toast: vi.fn()
}));

import {
  defaultSafetySettings,
  loadSafetySettings,
  saveSafetySettings
} from '../src/core/safety';
import { acceptSafetyDisclaimer } from '../src/ui/safety';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  mocks.modal.mockReset().mockImplementation(({ body, footer, onClose }) => {
    const box = document.createElement('div');
    box.append(body, ...(footer || []));
    document.body.append(box);
    return { close: vi.fn(() => { box.remove(); onClose?.(); }) };
  });
});

function acceptButton(): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent === 'safety.disclaimerAccept')!;
}

describe('safety disclaimer', () => {
  it('shows Chinese and English risks and enables only a valid accepted configuration', async () => {
    const settings = saveSafetySettings({
      ...defaultSafetySettings(),
      senderAlias: 'Alex',
      emergencyEmails: ['family@example.com']
    });
    const pending = acceptSafetyDisclaimer(settings);
    const dialog = mocks.modal.mock.calls[0][0];
    const body = dialog.body as HTMLElement;
    expect(body.textContent).toContain('中文风险说明');
    expect(body.textContent).toContain('English risk notice');

    const checkbox = body.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const accept = acceptButton();
    expect(accept.disabled).toBe(true);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(accept.disabled).toBe(false);
    accept.click();

    await expect(pending).resolves.toMatchObject({ enabled: true, disclaimerAccepted: true });
    expect(loadSafetySettings().enabled).toBe(true);
  });

  it('records acceptance without enabling incomplete settings', async () => {
    const settings = saveSafetySettings(defaultSafetySettings());
    const pending = acceptSafetyDisclaimer(settings);
    const dialog = mocks.modal.mock.calls[0][0];
    const body = dialog.body as HTMLElement;
    const checkbox = body.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    const accept = acceptButton();
    accept.click();

    await expect(pending).resolves.toMatchObject({ enabled: false, disclaimerAccepted: true });
    expect(loadSafetySettings().disclaimerAccepted).toBe(true);
    expect(loadSafetySettings().enabled).toBe(false);
  });

  it('does not reopen the notice after acceptance', async () => {
    const settings = saveSafetySettings({ ...defaultSafetySettings(), disclaimerAccepted: true });
    await expect(acceptSafetyDisclaimer(settings)).resolves.toBe(settings);
    expect(mocks.modal).not.toHaveBeenCalled();
  });
});
