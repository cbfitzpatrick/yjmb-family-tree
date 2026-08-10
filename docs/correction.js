'use strict';

const q = (selector) => document.querySelector(selector);
let person = null;
const originalValues = new Map();

function fieldId(label, index) {
  return `field-${index}-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function useTextarea(label, value) {
  const name = label.toLowerCase();
  return name.includes('notes') || name.includes('position and year') || name.startsWith('vet') || name.startsWith('rat ') || String(value ?? '').length > 100;
}

function renderFields() {
  const container = q('#correction-fields');
  container.replaceChildren();
  const fields = Array.isArray(person.sourceFields) && person.sourceFields.length
    ? person.sourceFields
    : [
        { label: 'Given/Preferred Name', value: person.givenPreferredName || '' },
        { label: 'Nickname', value: person.nickname || '' },
        { label: 'Family/Maiden Name', value: person.familyMaidenName || '' },
        { label: 'Married Name', value: person.marriedName || '' },
        { label: 'RAT Year', value: person.ratYearLabel || '' },
        { label: 'Instrument', value: person.instrumentRaw || '' },
      ];

  fields.forEach((field, index) => {
    const id = fieldId(field.label, index);
    const wrapper = document.createElement('label');
    wrapper.className = 'form-field';
    if (useTextarea(field.label, field.value)) wrapper.classList.add('form-field-wide');
    const title = document.createElement('span');
    title.textContent = field.label;
    let input;
    if (useTextarea(field.label, field.value)) {
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
  for (const input of q('#correction-fields').querySelectorAll('input, textarea')) {
    const label = input.dataset.fieldLabel;
    const before = originalValues.get(label) ?? '';
    const after = input.value.trim();
    if (after !== before.trim()) changes.push({ label, before, after });
  }
  return changes;
}

function formatChanges(changes) {
  if (!changes.length) return '[No direct field edits; see additional context.]';
  return changes.map((change) => [
    change.label,
    `Current: ${change.before || '[blank]'}`,
    `Proposed: ${change.after || '[blank]'}`,
  ].join('\n')).join('\n\n');
}

async function sendCorrection(changes, context) {
  const button = q('#send-correction');
  const status = q('#correction-send-status');
  button.disabled = true;
  status.textContent = 'Sending…';
  try {
    await window.YJMBAdminMail.sendAdminEmail({
      subject: `[Entry Change Request] ${person.name}`,
      fields: {
        'Request type': 'Entry Change Request',
        'Person': person.name,
        'Record ID': person.id,
        'RAT year': person.ratYearLabel || '[blank]',
        'Instrument / section': person.instrumentRaw || '[blank]',
        'Requested changes': formatChanges(changes),
        'Additional context': context || '[not provided]',
        'Profile URL': window.location.href,
        'Submitted at': new Date().toISOString(),
      },
    });
    status.textContent = '';
    window.YJMBAdminMail.showAdminBanner('entry change request');
  } catch (error) {
    console.error(error);
    status.textContent = `Could not send the entry change request: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function main() {
  const status = q('#correction-status');
  try {
    const personId = new URLSearchParams(window.location.search).get('person');
    if (!personId) throw new Error('No person was selected. Return to the tree and choose “make changes” from a person’s detail panel.');

    const data = await window.YJMBSecureData.loadTreeData();
    person = data.people.find(candidate => candidate.id === personId);
    if (!person) throw new Error(`No tree record exists for ${personId}.`);

    q('#correction-name').textContent = person.name;
    q('#correction-meta').textContent = `${person.ratYearLabel} · ${person.instrumentRaw || 'Unknown section'}`;
    renderFields();
    status.hidden = true;
    q('#correction-form').hidden = false;
  } catch (error) {
    console.error(error);
    if (error?.code === 'AUTH_REQUIRED') { window.location.replace('index.html'); return; }
    status.textContent = error.message;
  }
}

q('#correction-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const changes = changesFromForm();
  const context = q('#correction-context').value.trim();
  if (!changes.length && !context) {
    q('#correction-status').hidden = false;
    q('#correction-status').textContent = 'Change at least one field or add context before sending an entry change request.';
    return;
  }
  q('#correction-status').hidden = true;
  await sendCorrection(changes, context);
});

main();
