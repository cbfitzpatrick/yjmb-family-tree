'use strict';

const q = (selector) => document.querySelector(selector);
let person = null;
let config = {};
let turnstileToken = '';
let turnstileWidgetId = null;
const originalValues = new Map();

function fieldId(label, index) {
  return `field-${index}-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function useTextarea(label, value) {
  const name = label.toLowerCase();
  return name.includes('notes') || name.includes('position') || name.includes('memory') || name.startsWith('vet') || name.startsWith('rat ') || String(value ?? '').length > 100;
}

function renderFields() {
  const container = q('#correction-fields');
  container.replaceChildren();
  originalValues.clear();
  const fields = Array.isArray(person.sourceFields) && person.sourceFields.length
    ? person.sourceFields.map((field) => ({ ...field }))
    : [
        { label: 'Given/Preferred Name', value: person.givenPreferredName || '' },
        { label: 'Nickname', value: person.personalNickname || person.nickname || '' },
        { label: 'Family/Maiden Name', value: person.familyMaidenName || '' },
        { label: 'Married Name', value: person.marriedName || '' },
        { label: 'RAT Year', value: person.ratYearLabel || '' },
        { label: 'Instrument', value: person.instrumentRaw || '' },
        { label: 'Favorite Tech Band Memory', value: person.favoriteTechBandMemory || '' },
      ];
  const keys = new Set(fields.map((field) => String(field.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '')));
  if (!keys.has('treedisplaynamepreference')) {
    fields.push({ label: 'Tree Display Name Preference', value: person.treeDisplayNamePreference || 'Given/Preferred Name' });
  }
  if (!keys.has('treedisplaylastnamepreference')) {
    fields.push({ label: 'Tree Display Last Name Preference', value: person.treeDisplayLastNamePreference || 'Maiden/Family Name' });
  }

  fields.forEach((field, index) => {
    const id = fieldId(field.label, index);
    const wrapper = document.createElement('label');
    wrapper.className = 'form-field';
    if (useTextarea(field.label, field.value)) wrapper.classList.add('form-field-wide');
    const title = document.createElement('span');
    title.textContent = field.label;
    let input;
    const key = String(field.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key === 'treedisplaynamepreference') {
      input = document.createElement('select');
      for (const [value, text] of [
        ['Given/Preferred Name', 'First/Preferred Name'],
        ['Nickname', 'Personal Nickname'],
        ['Both', 'First/Preferred + Personal Nickname'],
      ]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; input.appendChild(option);
      }
    } else if (key === 'treedisplaylastnamepreference') {
      input = document.createElement('select');
      for (const [value, text] of [
        ['Maiden/Family Name', 'Family/Maiden Name'],
        ['Married Name', 'Married/Current Name'],
        ['Both', 'Both last names'],
      ]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; input.appendChild(option);
      }
    } else if (useTextarea(field.label, field.value)) {
      input = document.createElement('textarea');
      input.rows = 3;
    } else {
      input = document.createElement('input');
      input.type = /links?|url/i.test(field.label) ? 'url' : 'text';
    }
    input.id = id;
    input.dataset.fieldLabel = field.label;
    input.value = field.value ?? '';
    originalValues.set(field.label, String(field.value ?? ''));
    wrapper.append(title, input);
    container.appendChild(wrapper);
  });
}

function changesFromForm() {
  const changes = [];
  for (const input of q('#correction-fields').querySelectorAll('input, textarea, select')) {
    const label = input.dataset.fieldLabel;
    const before = originalValues.get(label) ?? '';
    const after = input.value.trim();
    if (after !== before.trim()) changes.push({ label, before, after });
  }
  return changes;
}

function renderTurnstile() {
  const host = q('#turnstile-container');
  if (!host) return;
  const sitekey = String(config.turnstileSiteKey || '').trim();
  if (!sitekey) { host.hidden = true; return; }
  host.hidden = false;
  const tryRender = () => {
    if (!window.turnstile?.render) { setTimeout(tryRender, 150); return; }
    if (turnstileWidgetId !== null) return;
    turnstileWidgetId = window.turnstile.render(host, {
      sitekey,
      theme: 'auto',
      callback: (token) => { turnstileToken = token; },
      'expired-callback': () => { turnstileToken = ''; },
      'error-callback': () => { turnstileToken = ''; },
    });
  };
  tryRender();
}

async function sendCorrection(changes, context) {
  const button = q('#send-correction');
  const status = q('#correction-send-status');
  button.disabled = true;
  status.textContent = 'Submitting protected update…';
  try {
    const payload = {
      version: 4,
      kind: 'correction',
      personId: person.id,
      changes,
      context,
      submittedAt: new Date().toISOString(),
    };
    const result = await window.YJMBSecureData.apiFetch('/submit', {
      method: 'POST',
      body: JSON.stringify({ payload, turnstileToken }),
    });
    status.textContent = result.status === 'auto'
      ? 'Update accepted. It will be applied by the protected updater and recorded in the admin changelog.'
      : 'Update was held because the workbook updater found a structural conflict.';
    button.textContent = 'Accepted';
  } catch (error) {
    console.error(error);
    if (error?.code === 'AUTH_REQUIRED') {
      sessionStorage.setItem('yjmbReturnTo', `${location.pathname.split('/').pop()}${location.search}`);
      location.replace('index.html');
      return;
    }
    status.textContent = `Could not submit the update: ${error.message}`;
    button.disabled = false;
    if (turnstileWidgetId !== null && window.turnstile?.reset) {
      window.turnstile.reset(turnstileWidgetId);
      turnstileToken = '';
    }
  }
}

async function main() {
  const status = q('#correction-status');
  try {
    const personId = new URLSearchParams(window.location.search).get('person');
    if (!personId) throw new Error('No person was selected. Return to the tree and choose “make changes” from a person’s detail panel.');

    const [data, configResponse] = await Promise.all([
      window.YJMBSecureData.loadTreeData(),
      fetch('site_config.json', { cache: 'no-store' }).catch(() => null),
    ]);
    if (configResponse?.ok) config = await configResponse.json();
    person = data.people.find((candidate) => candidate.id === personId);
    if (!person) throw new Error(`No tree record exists for ${personId}.`);

    q('#correction-name').textContent = person.displayName || person.name;
    q('#correction-meta').textContent = `${person.ratYearLabel || '?'} · ${person.instrumentRaw || 'Unknown section'}`;
    renderFields();
    renderTurnstile();
    status.hidden = true;
    q('#correction-form').hidden = false;
  } catch (error) {
    console.error(error);
    if (error?.code === 'AUTH_REQUIRED') {
      sessionStorage.setItem('yjmbReturnTo', `${location.pathname.split('/').pop()}${location.search}`);
      window.location.replace('index.html');
      return;
    }
    status.textContent = error.message;
  }
}

q('#correction-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const changes = changesFromForm();
  const context = q('#correction-context').value.trim();
  if (!changes.length) {
    q('#correction-status').hidden = false;
    q('#correction-status').textContent = context
      ? 'Context alone does not change the workbook. Edit at least one field.'
      : 'Change at least one field before submitting.';
    return;
  }
  q('#correction-status').hidden = true;
  await sendCorrection(changes, context);
});

main();
