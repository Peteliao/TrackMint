import { currentLang, t } from '../core/i18n';
import { sendWebhookTest } from '../core/notifier';
import {
  CHECK_IN_INTERVALS,
  LOW_BATTERY_THRESHOLDS,
  WEBHOOK_PLATFORMS,
  createWebhook,
  loadSafetySettings,
  normalizePhone,
  parseEmails,
  saveSafetySettings,
  validateSafetySettings,
  type SafetySettings,
  type WebhookPlatform
} from '../core/safety';
import { acceptSafetyDisclaimer, locateForSafety, sendSafetyNow } from './safety';
import { el, icon, toast } from './helpers';

let fieldSequence = 0;

function field(label: string, hint: string, input: HTMLElement) {
  const id = `safety-field-${++fieldSequence}`;
  const hintId = `${id}-hint`;
  input.id = id;
  if (hint) input.setAttribute('aria-describedby', hintId);
  return el('div', { class: 'field' },
    el('label', { for: id }, label),
    input,
    hint ? el('div', { class: 'hint', id: hintId }, hint) : null);
}

function select(value: string, options: Array<[string, string]>, label: string) {
  const node = el('select', { 'aria-label': label });
  for (const [optionValue, text] of options) {
    node.append(el('option', { value: optionValue }, text));
  }
  node.value = value;
  return node;
}

function validationText(code: string): string {
  if (code === 'disclaimer') return t('safety.errDisclaimer');
  if (code === 'senderAlias') return t('safety.errAlias');
  if (code === 'channels') return t('safety.errChannels');
  if (code.startsWith('email:')) return t('safety.errEmail');
  if (code === 'emergencyPhone') return t('safety.errPhone');
  if (code === 'relayProxyUrl') return t('safety.errRelay');
  if (code.endsWith(':tg-token')) return t('safety.errTgToken');
  if (code.endsWith(':tg-chat-id')) return t('safety.errTgChatId');
  if (code.endsWith(':tg-thread')) return t('safety.errTgThread');
  if (code.endsWith(':tg-api-base')) return t('safety.errTgApiBase');
  if (code.endsWith(':template')) return t('safety.errTemplate');
  if (code.endsWith(':url')) return t('safety.errWebhookUrl');
  return t('safety.failed');
}

export function createSafetySettingsCard() {
  let draft = loadSafetySettings();
  const details = el('details', { class: 'settings-collapse safety-settings', id: 'safety-settings' },
    el('summary', {}, icon('shield', 14), t('settings.safetyCard'), el('span', { class: 'safety-state' })));
  const body = el('div', { class: 'settings-collapse-body safety-settings-body' });
  details.append(body);
  const state = details.querySelector('.safety-state') as HTMLElement;
  const errors = el('div', { class: 'safety-validation', role: 'alert', hidden: true });
  const enabled = el('input', { type: 'checkbox', 'aria-label': t('safety.enable') });
  enabled.checked = draft.enabled;
  const senderAlias = el('input', { type: 'text', maxlength: '80', autocomplete: 'nickname', value: draft.senderAlias });
  const emails = el('textarea', { rows: '2', spellcheck: 'false', placeholder: 'name@example.com' });
  emails.value = draft.emergencyEmails.join('\n');
  const phone = el('input', { type: 'tel', inputmode: 'tel', autocomplete: 'off', value: draft.emergencyPhone });
  const navMap = select(draft.preferredNavMap, [
    ['all', t('safety.navAll')], ['amap', t('safety.navAmap')],
    ['google', t('safety.navGoogle')], ['apple', t('safety.navApple')]
  ], t('safety.preferredNavMap'));
  const emailMode = select(draft.emailMode, [
    ['mailto', t('safety.emailMailto')], ['relay', t('safety.emailRelay')]
  ], t('safety.emailMode'));
  const relayUrl = el('input', { type: 'url', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', value: draft.relayProxyUrl, placeholder: 'https://relay.example.com' });
  const relayToken = el('input', { type: 'password', autocomplete: 'new-password', spellcheck: 'false', value: draft.relayToken });
  const autoInterval = select(String(draft.autoCheckInIntervalMin), [
    ['0', t('safety.intervalOff')], ['15', t('safety.interval15')],
    ['30', t('safety.interval30')], ['60', t('safety.interval60')]
  ], t('safety.autoCheckIn'));
  const lowBattery = select(String(draft.lowBatteryThreshold), [
    ['0', t('safety.lowBatteryOff')], ['10', t('safety.lowBattery10')],
    ['15', t('safety.lowBattery15')], ['20', t('safety.lowBattery20')]
  ], t('safety.lowBattery'));
  const feedback = el('input', { type: 'checkbox', checked: draft.sosFeedback, 'aria-label': t('safety.sosFeedback') });
  const webhookList = el('div', { class: 'safety-webhook-list' });
  const newPlatform = select('ntfy', WEBHOOK_PLATFORMS.map((platform) => [platform, t(`safety.platforms.${platform}`)]), t('safety.addWebhook'));
  const addWebhook = el('button', { class: 'btn sm', type: 'button' }, icon('plus', 14), t('safety.addWebhook'));
  const save = el('button', { class: 'btn primary', type: 'button' }, icon('check', 15), t('safety.save'));
  const testSend = el('button', { class: 'btn', type: 'button' }, icon('send', 15), t('safety.testSend'));

  function syncState() {
    state.textContent = draft.enabled ? t('safety.enabled') : t('safety.disabled');
    state.classList.toggle('on', draft.enabled);
    enabled.checked = draft.enabled;
    testSend.disabled = !draft.enabled || !draft.disclaimerAccepted;
  }

  function showErrors(codes: string[]) {
    errors.innerHTML = '';
    errors.hidden = !codes.length;
    if (codes.length) errors.append(el('ul', {}, codes.map((code) => el('li', {}, validationText(code)))));
  }

  function persist(): boolean {
    const candidate = normalizeDraft();
    const codes = validateSafetySettings(candidate);
    showErrors(codes);
    if (codes.length) return false;
    draft = saveSafetySettings(candidate);
    fillForm();
    renderWebhooks();
    syncState();
    toast(t('safety.saved'), 'ok', 1800);
    return true;
  }

  function normalizeDraft(): SafetySettings {
    return {
      ...draft,
      senderAlias: senderAlias.value.trim(),
      emergencyEmails: parseEmails(emails.value),
      emergencyPhone: normalizePhone(phone.value),
      preferredNavMap: navMap.value as SafetySettings['preferredNavMap'],
      emailMode: emailMode.value as SafetySettings['emailMode'],
      relayProxyUrl: relayUrl.value.trim(),
      relayToken: relayToken.value.trim(),
      autoCheckInIntervalMin: Number(autoInterval.value) as SafetySettings['autoCheckInIntervalMin'],
      lowBatteryThreshold: Number(lowBattery.value) as SafetySettings['lowBatteryThreshold'],
      sosFeedback: feedback.checked
    };
  }

  function fillForm() {
    senderAlias.value = draft.senderAlias;
    emails.value = draft.emergencyEmails.join('\n');
    phone.value = draft.emergencyPhone;
    navMap.value = draft.preferredNavMap;
    emailMode.value = draft.emailMode;
    relayUrl.value = draft.relayProxyUrl;
    relayToken.value = draft.relayToken;
    autoInterval.value = String(draft.autoCheckInIntervalMin);
    lowBattery.value = String(draft.lowBatteryThreshold);
    feedback.checked = draft.sosFeedback;
  }

  function renderWebhooks() {
    webhookList.innerHTML = '';
    if (!draft.webhooks.length) {
      webhookList.append(el('div', { class: 'small faint' }, t('safety.webhooksHint')));
      return;
    }
    for (const webhook of draft.webhooks) {
      const item = el('details', { class: 'safety-webhook' },
        el('summary', {}, icon('send', 14), el('span', { class: 'grow' }, webhook.name || t(`safety.platforms.${webhook.platform}`)), el('span', { class: 'small muted' }, t(`safety.platforms.${webhook.platform}`))));
      const content = el('div', { class: 'safety-webhook-fields' });
      const active = el('input', { type: 'checkbox', checked: webhook.enabled, 'aria-label': t('safety.webhookEnabled') });
      const name = el('input', { type: 'text', maxlength: '80', value: webhook.name });
      const platform = select(webhook.platform, WEBHOOK_PLATFORMS.map((value) => [value, t(`safety.platforms.${value}`)]), t('safety.webhookPlatform'));
      const url = el('input', { type: 'url', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', value: webhook.url });
      const botToken = el('input', { type: 'password', maxlength: '128', autocomplete: 'new-password', spellcheck: 'false', value: webhook.botToken || '' });
      const chatId = el('input', { type: 'text', maxlength: '64', inputmode: 'text', autocomplete: 'off', spellcheck: 'false', value: webhook.chatId || '', placeholder: '-1001234567890' });
      const messageThreadId = el('input', { type: 'number', min: '1', max: '2147483647', step: '1', inputmode: 'numeric', value: webhook.messageThreadId?.toString() || '' });
      const nativeLocation = el('input', { type: 'checkbox', checked: webhook.sendNativeLocation !== false, 'aria-label': t('safety.tgNativeLocation') });
      const secret = el('input', { type: 'password', autocomplete: 'new-password', spellcheck: 'false', value: webhook.secret || '' });
      const keyword = el('input', { type: 'text', maxlength: '120', autocomplete: 'off', value: webhook.keyword || '' });
      const template = el('textarea', { rows: '4', spellcheck: 'false', value: webhook.customTemplate || '', placeholder: '{"title":"{{title}}","text":"{{text}}"}' });
      const status = el('div', { class: 'small muted safety-webhook-status', role: 'status' });
      const test = el('button', { class: 'btn sm', type: 'button' }, icon('send', 14), t('safety.webhookTest'));
      const remove = el('button', { class: 'btn sm ghost', type: 'button' }, icon('trash', 14), t('safety.removeWebhook'));
      active.onchange = () => { webhook.enabled = active.checked; };
      name.oninput = () => { webhook.name = name.value; item.querySelector('summary .grow')!.textContent = name.value.trim() || t(`safety.platforms.${webhook.platform}`); };
      platform.onchange = () => {
        webhook.platform = platform.value as WebhookPlatform;
        if (!webhook.name || WEBHOOK_PLATFORMS.includes(webhook.name as WebhookPlatform) || webhook.name === 'TG') {
          webhook.name = webhook.platform === 'telegram' ? 'TG' : webhook.platform;
        }
        renderWebhooks();
      };
      url.oninput = () => { webhook.url = url.value; };
      botToken.oninput = () => { webhook.botToken = botToken.value; };
      chatId.oninput = () => { webhook.chatId = chatId.value; };
      messageThreadId.oninput = () => { webhook.messageThreadId = messageThreadId.value ? Number(messageThreadId.value) : undefined; };
      nativeLocation.onchange = () => { webhook.sendNativeLocation = nativeLocation.checked; };
      secret.oninput = () => { webhook.secret = secret.value; };
      keyword.oninput = () => { webhook.keyword = keyword.value; };
      template.oninput = () => { webhook.customTemplate = template.value; };
      test.onclick = async () => {
        if (!draft.disclaimerAccepted) {
          toast(t('safety.errDisclaimer'), 'warn');
          return;
        }
        test.disabled = true;
        status.textContent = t('safety.webhookTesting');
        try {
          const position = await locateForSafety();
          if (!position) {
            status.textContent = t('safety.noLocation');
            return;
          }
          const result = await sendWebhookTest(normalizeDraft(), webhook, position, currentLang());
          status.textContent = t(result.ok ? 'safety.webhookTestOk' : 'safety.webhookTestFail');
          toast(status.textContent, result.ok ? 'ok' : 'err');
        } finally {
          test.disabled = false;
        }
      };
      remove.onclick = () => {
        draft.webhooks = draft.webhooks.filter((item) => item.id !== webhook.id);
        renderWebhooks();
      };
      content.append(...[
        el('div', { class: 'setting-row' }, el('div', { class: 'txt' }, el('div', { class: 't' }, t('safety.webhookEnabled'))), el('label', { class: 'switch' }, active, el('span', { class: 'slider' }))),
        field(t('safety.webhookPlatform'), '', platform),
        field(t('safety.webhookName'), '', name),
        field(webhook.platform === 'telegram' ? t('safety.tgApiBase') : t('safety.webhookUrl'), webhook.platform === 'telegram' ? t('safety.tgApiBaseHint') : t('safety.webhookUrlHint'), url),
        webhook.platform === 'telegram' ? field(t('safety.tgBotToken'), t('safety.tgBotTokenHint'), botToken) : null,
        webhook.platform === 'telegram' ? field(t('safety.tgChatId'), t('safety.tgChatIdHint'), chatId) : null,
        webhook.platform === 'telegram' ? field(t('safety.tgMessageThreadId'), t('safety.tgMessageThreadIdHint'), messageThreadId) : null,
        webhook.platform === 'telegram' ? el('div', { class: 'setting-row' }, el('div', { class: 'txt' }, el('div', { class: 't' }, t('safety.tgNativeLocation')), el('div', { class: 'd' }, t('safety.tgNativeLocationHint'))), el('label', { class: 'switch' }, nativeLocation, el('span', { class: 'slider' }))) : null,
        webhook.platform === 'telegram' ? el('div', { class: 'small muted safety-tg-hint' }, t('safety.tgSetupHint')) : null,
        ['feishu', 'dingtalk'].includes(webhook.platform) ? field(t('safety.webhookSecret'), t('safety.webhookSecretHint'), secret) : null,
        webhook.platform === 'dingtalk' ? field(t('safety.webhookKeyword'), t('safety.webhookKeywordHint'), keyword) : null,
        webhook.platform === 'custom' ? field(t('safety.customTemplate'), t('safety.customTemplateHint'), template) : null,
        el('div', { class: 'row wrap', style: { marginTop: '8px' } }, test, remove),
        status
      ].filter((node) => node !== null));
      item.append(content);
      webhookList.append(item);
    }
  }

  enabled.onchange = async () => {
    enabled.disabled = true;
    try {
      if (!enabled.checked) {
        draft = saveSafetySettings({ ...normalizeDraft(), enabled: false });
        fillForm();
        renderWebhooks();
        syncState();
        return;
      }
      const candidate = { ...normalizeDraft(), enabled: true };
      const codes = validateSafetySettings(candidate).filter((code) => code !== 'disclaimer');
      showErrors(codes);
      if (codes.length) {
        syncState();
        return;
      }
      if (!draft.disclaimerAccepted) {
        const accepted = await acceptSafetyDisclaimer(candidate);
        if (!accepted) {
          syncState();
          return;
        }
        draft = accepted;
      } else {
        draft = saveSafetySettings(candidate);
      }
      fillForm();
      renderWebhooks();
      syncState();
    } finally {
      enabled.disabled = false;
    }
  };
  addWebhook.onclick = () => {
    const webhook = createWebhook(newPlatform.value as WebhookPlatform);
    draft.webhooks.push(webhook);
    renderWebhooks();
    const last = webhookList.lastElementChild as HTMLDetailsElement | null;
    last?.toggleAttribute('open', true);
  };
  save.onclick = () => { persist(); };
  testSend.onclick = async () => {
    if (!persist()) return;
    await sendSafetyNow('test');
  };
  for (const input of [senderAlias, emails, phone, navMap, emailMode, relayUrl, relayToken, autoInterval, lowBattery, feedback]) {
    input.addEventListener('input', () => { errors.hidden = true; });
  }

  body.append(
    el('div', { class: 'safety-intro' },
      el('div', { class: 'setting-row' }, el('div', { class: 'txt' }, el('div', { class: 't' }, t('safety.enable')), el('div', { class: 'd' }, t('safety.settingsDesc'))), el('label', { class: 'switch' }, enabled, el('span', { class: 'slider' }))),
      el('div', { class: 'backup-warning', style: { marginTop: '8px' } }, icon('shield', 14), t('safety.localOnly'))),
    errors,
    field(t('safety.senderAlias'), t('safety.senderAliasHint'), senderAlias),
    field(t('safety.emergencyEmails'), t('safety.emergencyEmailsHint'), emails),
    field(t('safety.emergencyPhone'), t('safety.emergencyPhoneHint'), phone),
    field(t('safety.preferredNavMap'), t('safety.coordinateHint'), navMap),
    field(t('safety.emailMode'), t('safety.emailModeHint'), emailMode),
    field(t('safety.relayProxyUrl'), t('safety.relayProxyHint'), relayUrl),
    field(t('safety.relayToken'), t('safety.relayTokenHint'), relayToken),
    el('div', { class: 'settings-subhead' }, icon('send', 15), t('safety.webhooks')),
    el('div', { class: 'small faint', style: { marginBottom: '8px' } }, t('safety.webhooksHint')),
    webhookList,
    el('div', { class: 'row wrap', style: { marginTop: '8px' } }, newPlatform, addWebhook),
    el('div', { class: 'sep' }),
    field(t('safety.autoCheckIn'), t('safety.autoCheckInHint'), autoInterval),
    field(t('safety.lowBattery'), t('safety.lowBatteryHint'), lowBattery),
    el('div', { class: 'setting-row' }, el('div', { class: 'txt' }, el('div', { class: 't' }, t('safety.sosFeedback')), el('div', { class: 'd' }, t('safety.sosFeedbackHint'))), el('label', { class: 'switch' }, feedback, el('span', { class: 'slider' }))),
    el('details', { class: 'safety-limitations' }, el('summary', {}, t('safety.limitationsTitle')), el('div', { class: 'small muted' }, t('safety.limitations'))),
    el('div', { class: 'small faint safety-backup-note' }, t('safety.backupExcluded')),
    el('div', { class: 'row wrap', style: { marginTop: '10px' } }, save, testSend)
  );

  renderWebhooks();
  syncState();
  return {
    card: details,
    open: () => { details.open = true; },
    refresh: () => {
      draft = loadSafetySettings();
      fillForm();
      renderWebhooks();
      syncState();
      showErrors([]);
    }
  };
}
