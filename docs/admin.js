'use strict';

const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  data: null,
  people: new Map(),
  adminKey: '',
  selectedId: null,
  adding: false,
  sheetChanges: new Map(),
  scale: 0.58,
  previewCardIcons: false,
  previewIconGuides: false,
};

const ADMIN_HEADERS = () => ({ 'X-Developer-Key': state.adminKey });
const norm = (value) => String(value ?? '').trim();
const lower = (value) => norm(value).toLowerCase();

async function reloadAdminAssets() {
  const button = q('#admin-reload-assets');
  if (button) button.disabled = true;
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => /yjmb|github|pages/i.test(key)).map((key) => caches.delete(key)));
    }
    const stamp = Date.now();
    const files = ['styles.css', 'admin.js', 'secure-data.js', 'section-leader-icon.png', 'rat-parent-icon.png', 'band-club-icon.png'];
    await Promise.all(files.map(async (file) => {
      try {
        const url = new URL(file, window.location.href);
        url.searchParams.set('_assetReload', String(stamp));
        await fetch(url, { cache: 'reload', credentials: 'same-origin' });
      } catch { /* optional asset */ }
    }));
    const next = new URL(window.location.href);
    next.searchParams.set('_assetReload', String(stamp));
    window.location.replace(next.toString());
  } finally {
    if (button) button.disabled = false;
  }
}

function status(message, isError = false) {
  const el = q('#admin-status');
  el.textContent = message || '';
  el.classList.toggle('error-text', isError);
}

async function adminApi(path, options = {}) {
  return window.YJMBSecureData.apiFetch(path, {
    ...options,
    headers: { ...ADMIN_HEADERS(), ...(options.headers || {}) },
  });
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function colorForSection(section) {
  return state.data.sectionColors?.[section] || state.data.sectionGradients?.[section]?.[0] || '#d9d9d9';
}

function cardBackground(person) {
  const sections = (person.instruments || []).filter(Boolean);
  if (!sections.length) return '#d9d9d9';
  if (sections.length === 1) return colorForSection(sections[0]);
  const stops = [];
  sections.forEach((section, i) => {
    const color = colorForSection(section);
    const start = (100 * i / sections.length).toFixed(4);
    const end = (100 * (i + 1) / sections.length).toFixed(4);
    stops.push(`${color} ${start}%`, `${color} ${end}%`);
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function adminCardNameParts(person) {
  const given = norm(person.cardGivenName || person.givenPreferredName || person.displayName || person.name);
  const family = norm(person.cardFamilyName || person.familyMaidenName);
  if (family) return [given, family];
  const words = norm(person.displayName || person.name).split(/\s+/).filter(Boolean);
  return words.length > 1 ? [words.slice(0, -1).join(' '), words.at(-1)] : [words[0] || 'Unknown'];
}

function adminCardFontSize(person, sourceWidth = 150, hasIcons = false) {
  const canvas = adminCardFontSize.canvas || (adminCardFontSize.canvas = document.createElement('canvas'));
  const context = canvas.getContext('2d');
  const lines = adminCardNameParts(person);
  const base = 22;
  if (!context) return base;
  context.font = `${base}px Arial, Helvetica, sans-serif`;
  const widest = Math.max(1, ...lines.map((line) => context.measureText(line).width));
  const usable = Math.max(70, Number(sourceWidth || 150) - (hasIcons ? 44 : 24));
  return Math.max(13, Math.min(base, Math.floor(base * usable / widest)));
}

function inlineRoleIconSvg(kind) {
  const icons = {
    'drum-major': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c1.7-.8 3.2.2 3.6 1.7l.6 2.3.8-4.6c.2-1.2 2-1 1.9.3l-.4 5.2.9-4.3c.3-1.2 2.1-.8 1.8.4l-.9 4.3.9-3.3c.3-1.1 2-.6 1.7.5l-1.1 4.2c-.6 2.4-2 4-4 4.7l-2.8 1-2.3-6.1L4 5.5Zm16 0c-1.7-.8-3.2.2-3.6 1.7l-.6 2.3-.8-4.6c-.2-1.2-2-1-1.9.3l.4 5.2-.9-4.3c-.3-1.2-2.1-.8-1.8.4l.9 4.3-.9-3.3c.3-1.1 2-.6 1.7.5l-1.1 4.2c-.6 2.4-2 4-4 4.7l2.8 1 2.3-6.1L20 5.5Z" fill="currentColor"/></svg>',
    'mcm': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l1.3-2h5.4L16 7h4v12H4Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13" r="4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    'libraries': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5.5c3.2-.8 6-.2 9 1.8v12c-3-2-5.8-2.6-9-1.8Zm18 0c-3.2-.8-6-.2-9 1.8v12c3-2 5.8-2.6 9-1.8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    'uniforms': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 4 2 4-2 4 4-3 3v9H7v-9L4 8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 6v14M9.5 10h5" stroke="currentColor" stroke-width="1.4"/></svg>',
    'guard-captain': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v18M8 4l10 3-10 4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    'informal-leadership': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h4l8-4v12l-8-4H4Zm4 4 2 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    'other-leadership': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  };
  return icons[kind] || '';
}

function adminCardIconElement(kind, sample = false) {
  const wrapper = document.createElement('span');
  wrapper.className = sample ? 'admin-icon-sample-icon' : `card-status-icon card-role-icon icon-${kind}`;
  const imageAssets = { 'section-leader': 'section-leader-icon.png', 'rat-parent': 'rat-parent-icon.png', 'band-club': 'band-club-icon.png' };
  if (imageAssets[kind]) {
    const img = document.createElement('img'); img.src = imageAssets[kind]; img.alt = ''; wrapper.appendChild(img);
  } else {
    wrapper.innerHTML = inlineRoleIconSvg(kind);
  }
  return wrapper;
}

function personPreviewIconKinds(person) {
  return [...new Set([...(person.leadershipIcons || []), ...(person.bandClubLeadership ? ['band-club'] : [])])];
}

function relationLine(segment, width, color) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', segment.start.x); line.setAttribute('y1', segment.start.y);
  line.setAttribute('x2', segment.end.x); line.setAttribute('y2', segment.end.y);
  line.setAttribute('stroke', color); line.setAttribute('stroke-width', width);
  line.setAttribute('stroke-linecap', 'square');
  return line;
}

function renderAdminTree() {
  const svg = q('#admin-tree-connectors');
  const cards = q('#admin-tree-cards');
  const holder = q('#admin-tree-holder');
  svg.replaceChildren(); cards.replaceChildren();
  const width = Math.max(1, Number(state.data.width || 1));
  const height = Math.max(1, Number(state.data.height || 1));
  holder.style.width = `${Math.ceil(width * state.scale)}px`;
  holder.style.height = `${Math.ceil(height * state.scale)}px`;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', Math.ceil(width * state.scale));
  svg.setAttribute('height', Math.ceil(height * state.scale));

  for (const connector of state.data.connectors || []) {
    const segments = [connector.parentStem, ...(connector.siblingBus ? [connector.siblingBus] : []), ...(connector.childStems || [])].filter(Boolean);
    for (const segment of segments) {
      svg.appendChild(relationLine(segment, state.data.connectorWidth || 9, '#777777'));
    }
  }

  const filter = lower(q('#admin-person-search').value);
  for (const person of state.data.people) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'admin-tree-card';
    card.dataset.personId = person.id;
    const c = person.card || {};
    card.style.left = `${Number(c.x || 0) * state.scale}px`;
    card.style.top = `${Number(c.y || 0) * state.scale}px`;
    card.style.width = `${Number(c.width || 150) * state.scale}px`;
    card.style.height = `${Number(c.height || 80) * state.scale}px`;
    card.style.background = cardBackground(person);
    const previewKinds = state.previewCardIcons ? personPreviewIconKinds(person) : [];
    card.style.fontSize = `${adminCardFontSize(person, Number(c.width || 150), previewKinds.length > 0) * state.scale}px`;
    card.classList.toggle('admin-preview-icon-guides', state.previewIconGuides);
    const nameWrap = document.createElement('span');
    nameWrap.className = 'admin-tree-card-name';
    for (const lineText of adminCardNameParts(person)) {
      const line = document.createElement('span');
      line.className = 'admin-tree-card-name-line';
      line.textContent = lineText;
      nameWrap.appendChild(line);
    }
    card.appendChild(nameWrap);
    for (const kind of previewKinds) card.appendChild(adminCardIconElement(kind));
    card.title = `${person.displayName || person.name} · ${person.ratYearLabel || '?'} · ${person.instrumentRaw || '?'}`;
    if (filter) {
      const hay = [person.name, person.displayName, person.personalNickname, person.sectionNicknames, person.ratYearLabel, person.instrumentRaw].map(lower).join(' ');
      if (!hay.includes(filter)) card.classList.add('admin-tree-dim');
      else card.classList.add('admin-tree-match');
    }
    card.addEventListener('click', () => openPersonEditor(person.id));
    cards.appendChild(card);
  }
}

function fieldInput(field, index) {
  const wrapper = document.createElement('label');
  wrapper.className = 'form-field';
  const label = document.createElement('span'); label.textContent = field.label;
  const longField = /notes|position|memory|vet$|rat\s+\d+/i.test(field.label) || String(field.value || '').length > 100;
  const key = lower(field.label).replace(/[^a-z0-9]+/g, '');
  let input;
  if (key === 'treedisplaynamepreference' || key === 'treedisplaylastnamepreference') {
    input = document.createElement('select');
    const choices = key === 'treedisplaynamepreference'
      ? [['Given/Preferred Name','First/Preferred Name'], ['Nickname','Personal Nickname'], ['Both','First/Preferred + Personal Nickname']]
      : [['Maiden/Family Name','Family/Maiden Name'], ['Married Name','Married/Current Name'], ['Both','Both last names']];
    for (const [value, text] of choices) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; input.appendChild(option);
    }
  } else if (longField) {
    input = document.createElement('textarea'); input.rows = 3; wrapper.classList.add('form-field-wide');
  } else {
    input = document.createElement('input'); input.type = 'text';
  }
  input.dataset.fieldLabel = field.label;
  input.dataset.before = String(field.value ?? '');
  input.value = field.value ?? '';
  input.id = `admin-field-${index}`;
  wrapper.append(label, input);
  return wrapper;
}

function addPreferenceFields(fields, person = null) {
  const out = fields.map((field) => ({ ...field }));
  const keys = new Set(out.map((field) => lower(field.label).replace(/[^a-z0-9]+/g, '')));
  if (!keys.has('treedisplaynamepreference')) out.push({ label: 'Tree Display Name Preference', value: person?.treeDisplayNamePreference || 'Given/Preferred Name' });
  if (!keys.has('treedisplaylastnamepreference')) out.push({ label: 'Tree Display Last Name Preference', value: person?.treeDisplayLastNamePreference || 'Maiden/Family Name' });
  return out;
}

function editorFieldsFor(person) {
  if (person?.sourceFields?.length) return addPreferenceFields(person.sourceFields, person);
  const labels = state.data.people[0]?.sourceFields?.map((field) => field.label) || [];
  return addPreferenceFields(labels.map((label) => ({ label, value: '' })), person);
}

function openPersonEditor(personId) {
  state.adding = false;
  state.selectedId = personId;
  const person = state.people.get(personId);
  q('#admin-editor-title').textContent = `Edit ${person.displayName || person.name}`;
  q('#admin-delete-person').hidden = false;
  const editor = q('#admin-editor'); editor.replaceChildren();
  editorFieldsFor(person).forEach((field, index) => editor.appendChild(fieldInput(field, index)));
  q('#admin-editor-wrap').hidden = false;
  q('#admin-editor-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openAddEditor() {
  state.adding = true;
  state.selectedId = null;
  q('#admin-editor-title').textContent = 'Add person';
  q('#admin-delete-person').hidden = true;
  const editor = q('#admin-editor'); editor.replaceChildren();
  editorFieldsFor(null).forEach((field, index) => editor.appendChild(fieldInput({ label: field.label, value: '' }, index)));
  q('#admin-editor-wrap').hidden = false;
  q('#admin-editor-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function editorChanges() {
  return qa('input[data-field-label], textarea[data-field-label], select[data-field-label]', q('#admin-editor')).map((input) => ({
    label: input.dataset.fieldLabel,
    before: input.dataset.before || '',
    after: input.value.trim(),
  })).filter((item) => item.before.trim() !== item.after.trim());
}

async function savePerson() {
  try {
    let payload;
    if (state.adding) {
      const fields = {};
      for (const input of qa('input[data-field-label], textarea[data-field-label], select[data-field-label]', q('#admin-editor'))) {
        if (input.value.trim()) fields[input.dataset.fieldLabel] = input.value.trim();
      }
      payload = { kind: 'admin-add', fields };
    } else {
      const changes = editorChanges();
      if (!changes.length) { status('No fields changed.'); return; }
      payload = { kind: 'admin-patch', personId: state.selectedId, changes };
    }
    status('Queuing protected administrator update…');
    await adminApi('/admin/action', { method: 'POST', body: JSON.stringify({ payload }) });
    status('Administrator update queued. GitHub Actions will rebuild the encrypted tree; refresh after the workflow finishes.');
  } catch (error) { console.error(error); status(error.message, true); }
}

async function deletePerson() {
  if (!state.selectedId) return;
  const person = state.people.get(state.selectedId);
  if (!confirm(`Delete ${person?.displayName || person?.name || state.selectedId} from the master workbook? This is changelogged and can be reverted if no later edit conflicts.`)) return;
  try {
    await adminApi('/admin/action', { method: 'POST', body: JSON.stringify({ payload: { kind: 'admin-delete', personId: state.selectedId } }) });
    status('Delete queued and will be recorded in the protected changelog.');
  } catch (error) { status(error.message, true); }
}

function allHeaders() {
  const out = [];
  const seen = new Set();
  for (const person of state.data.people) for (const field of person.sourceFields || []) {
    if (!seen.has(field.label)) { seen.add(field.label); out.push(field.label); }
  }
  for (const label of ['Tree Display Name Preference', 'Tree Display Last Name Preference']) {
    if (!seen.has(label)) { seen.add(label); out.push(label); }
  }
  return out;
}

function sourceValue(person, label) {
  const found = person.sourceFields?.find((field) => field.label === label);
  if (found) return found.value ?? '';
  if (label === 'Tree Display Name Preference') return person.treeDisplayNamePreference || 'Given/Preferred Name';
  if (label === 'Tree Display Last Name Preference') return person.treeDisplayLastNamePreference || 'Maiden/Family Name';
  return '';
}

function sheetKey(personId, label) { return `${personId}\u0000${label}`; }

function renderSpreadsheet() {
  const headers = allHeaders();
  const filter = lower(q('#admin-sheet-search').value);
  const table = document.createElement('table'); table.className = 'admin-table';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const name of ['Record ID', ...headers]) { const th = document.createElement('th'); th.textContent = name; hr.appendChild(th); }
  thead.appendChild(hr); table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const person of state.data.people) {
    const hay = lower([person.id, person.name, ...headers.map((h) => sourceValue(person, h))].join(' '));
    if (filter && !hay.includes(filter)) continue;
    const row = document.createElement('tr');
    const id = document.createElement('td'); id.textContent = person.id; row.appendChild(id);
    for (const label of headers) {
      const td = document.createElement('td');
      td.contentEditable = 'true'; td.spellcheck = false;
      const key = sheetKey(person.id, label);
      const current = state.sheetChanges.has(key) ? state.sheetChanges.get(key).after : sourceValue(person, label);
      td.textContent = current;
      td.dataset.personId = person.id; td.dataset.label = label; td.dataset.before = sourceValue(person, label);
      td.addEventListener('input', () => {
        const after = td.textContent.trim(); const before = td.dataset.before || '';
        if (after === before.trim()) state.sheetChanges.delete(key);
        else state.sheetChanges.set(key, { personId: person.id, label, before, after });
        q('#admin-sheet-dirty').textContent = `${state.sheetChanges.size} edited cell${state.sheetChanges.size === 1 ? '' : 's'}`;
      });
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  q('#admin-table-wrap').replaceChildren(table);
}

async function saveSpreadsheet() {
  if (!state.sheetChanges.size) { status('No spreadsheet cells changed.'); return; }
  const grouped = new Map();
  for (const item of state.sheetChanges.values()) {
    if (!grouped.has(item.personId)) grouped.set(item.personId, []);
    grouped.get(item.personId).push({ label: item.label, before: item.before, after: item.after });
  }
  try {
    status(`Queuing ${grouped.size} protected row update(s)…`);
    for (const [personId, changes] of grouped) {
      await adminApi('/admin/action', { method: 'POST', body: JSON.stringify({ payload: { kind: 'admin-patch', personId, changes } }) });
    }
    state.sheetChanges.clear();
    q('#admin-sheet-dirty').textContent = '0 edited cells';
    status('Spreadsheet edits queued. They will be changelogged cell-by-cell when applied.');
  } catch (error) { console.error(error); status(error.message, true); }
}

function payloadSummary(item) {
  const p = item.payload || {};
  if (p.kind === 'correction') return `${p.changes?.length || 0} field change(s) for ${p.personId}`;
  if (String(p.kind || '').startsWith('admin-')) return p.kind;
  const self = p.self || {};
  return [self.givenPreferredName, self.familyMaidenName, self.ratYear].filter(Boolean).join(' · ');
}

async function loadRequests() {
  const host = q('#admin-request-list'); host.textContent = 'Loading protected request queues…';
  try {
    const data = await adminApi('/admin/requests');
    host.replaceChildren();
    const items = [...(data.review || []), ...(data.auto || [])];
    if (!items.length) { host.textContent = 'No pending protected requests.'; return; }
    for (const item of items) {
      const div = document.createElement('article'); div.className = 'admin-list-item';
      const title = document.createElement('h3'); title.textContent = `${item.queue === 'review' ? 'Needs review' : 'Pending automatic'} · ${item.displayName || item.id}`;
      const meta = document.createElement('p'); meta.textContent = `${item.kind || 'addition'} · ${item.receivedAt || ''} · risk ${item.risk?.score ?? 0}`;
      const summary = document.createElement('p'); summary.textContent = payloadSummary(item);
      const reasons = document.createElement('p'); reasons.textContent = (item.risk?.reasons || []).join('; ') || 'No risk notes.';
      const details = document.createElement('details');
      const ds = document.createElement('summary'); ds.textContent = 'Protected payload details';
      const pre = document.createElement('pre'); pre.className = 'admin-code'; pre.textContent = JSON.stringify(item.payload, null, 2);
      details.append(ds, pre);
      const actions = document.createElement('div'); actions.className = 'admin-item-actions';
      if (item.queue === 'review') {
        const approve = document.createElement('button'); approve.className = 'primary-button'; approve.textContent = 'Approve / retry';
        approve.addEventListener('click', () => requestAction(item, 'approve'));
        actions.appendChild(approve);
      }
      const deny = document.createElement('button'); deny.className = 'danger-button'; deny.textContent = 'Deny';
      deny.addEventListener('click', () => requestAction(item, 'deny'));
      actions.appendChild(deny);
      div.append(title, meta, summary, reasons, details, actions); host.appendChild(div);
    }
  } catch (error) { host.textContent = error.message; }
}

async function requestAction(item, action) {
  if (action === 'deny' && !confirm('Deny and delete this still-pending protected update?')) return;
  try {
    await adminApi('/admin/request-action', { method: 'POST', body: JSON.stringify({ id: item.id, queue: item.queue, action }) });
    status(action === 'approve' ? 'Request approved/retried.' : 'Request denied.');
    await loadRequests();
  } catch (error) { status(error.message, true); }
}

function unreciprocatedClaims() {
  const claims = [];
  for (const person of state.data.people) {
    const own = person.relationshipClaims || {};
    if (own.vet && own.vet.raw && !own.vet.reciprocated) claims.push({ source: person, role: 'VET', claim: own.vet });
    for (const claim of own.rats || []) if (claim.raw && !claim.reciprocated) claims.push({ source: person, role: 'RAT', claim });
  }
  return claims;
}

function renderReciprocity() {
  const host = q('#admin-reciprocity-list'); host.replaceChildren();
  const items = unreciprocatedClaims();
  if (!items.length) { host.textContent = 'All resolved VET/RAT claims in this build are reciprocated.'; return; }
  for (const item of items) {
    const div = document.createElement('article'); div.className = 'admin-list-item';
    const target = item.claim.id ? state.people.get(item.claim.id) : null;
    div.innerHTML = `<h3>${htmlEscape(item.source.displayName || item.source.name)} → ${htmlEscape(item.role)}: ${htmlEscape(item.claim.name || item.claim.raw)}</h3><p>${htmlEscape(item.claim.raw || '')}</p>`;
    const actions = document.createElement('div'); actions.className = 'admin-item-actions';
    if (target) {
      const validate = document.createElement('button'); validate.className = 'primary-button'; validate.textContent = 'Validate reciprocal side';
      validate.addEventListener('click', async () => {
        try {
          await adminApi('/admin/action', { method: 'POST', body: JSON.stringify({ payload: { kind: 'admin-reciprocate', sourceId: item.source.id, targetId: target.id, role: item.role } }) });
          status('Reciprocal validation queued.');
        } catch (error) { status(error.message, true); }
      });
      actions.appendChild(validate);
    } else {
      const edit = document.createElement('button'); edit.className = 'secondary-button'; edit.textContent = 'Open source profile';
      edit.addEventListener('click', () => { selectTab('tree'); openPersonEditor(item.source.id); });
      actions.appendChild(edit);
      const note = document.createElement('span'); note.textContent = 'Referenced person is unresolved; identify/correct it before reciprocity can be validated.'; actions.appendChild(note);
    }
    div.appendChild(actions); host.appendChild(div);
  }
}

function renderUnknown() {
  const host = q('#admin-unknown-list'); host.replaceChildren();
  const people = state.data.people.filter((person) => norm(person.uncategorizedInstrumentText));
  if (!people.length) { host.textContent = 'No uncategorized instrument/section text was exported in this build.'; return; }
  const sections = Object.keys(state.data.sectionColors || {}).filter((section) => section !== 'unknown');
  for (const person of people) {
    const div = document.createElement('article'); div.className = 'admin-list-item';
    const title = document.createElement('h3'); title.textContent = person.displayName || person.name;
    const current = document.createElement('p'); current.textContent = `Current: ${person.instrumentRaw || '[blank]'} · Unknown text: ${person.uncategorizedInstrumentText}`;
    const actions = document.createElement('div'); actions.className = 'admin-item-actions';
    const select = document.createElement('select');
    select.innerHTML = '<option value="">Choose broad section…</option>' + sections.map((s) => `<option value="${htmlEscape(s)}">${htmlEscape(s)}</option>`).join('');
    const detail = document.createElement('input'); detail.type = 'text'; detail.value = person.uncategorizedInstrumentText; detail.placeholder = 'Preserved specific instrument/subsection';
    const save = document.createElement('button'); save.className = 'primary-button'; save.textContent = 'Map section';
    save.addEventListener('click', async () => {
      if (!select.value) { status('Choose a broad section first.', true); return; }
      const after = detail.value.trim() ? `${select.value} — ${detail.value.trim()}` : select.value;
      try {
        await adminApi('/admin/action', { method: 'POST', body: JSON.stringify({ payload: { kind: 'admin-patch', personId: person.id, changes: [{ label: 'Instrument', before: person.instrumentRaw || '', after }] } }) });
        status(`Section mapping queued for ${person.displayName || person.name}.`);
      } catch (error) { status(error.message, true); }
    });
    actions.append(select, detail, save); div.append(title, current, actions); host.appendChild(div);
  }
}

async function loadChangelog() {
  const host = q('#admin-changelog-list'); host.textContent = 'Loading encrypted changelog…';
  try {
    const result = await adminApi('/admin/changelog'); host.replaceChildren();
    const entries = result.entries || [];
    if (!entries.length) { host.textContent = 'No applied v17 changelog entries yet.'; return; }
    for (const entry of entries) {
      const div = document.createElement('article'); div.className = 'admin-list-item';
      const title = document.createElement('h3'); title.textContent = entry.summary || entry.id || 'Change';
      const meta = document.createElement('p'); meta.textContent = `${entry.appliedAt || ''} · ${entry.source || ''} · ${entry.kind || ''}`;
      const changes = document.createElement('details'); const cs = document.createElement('summary'); cs.textContent = `${entry.changes?.length || 0} cell change(s)`;
      const pre = document.createElement('pre'); pre.className = 'admin-code'; pre.textContent = JSON.stringify(entry.changes || [], null, 2); changes.append(cs, pre);
      const actions = document.createElement('div'); actions.className = 'admin-item-actions';
      if (entry.id && !entry.error) {
        const revert = document.createElement('button'); revert.className = 'danger-button'; revert.textContent = 'Revert this change';
        revert.addEventListener('click', async () => {
          if (!confirm('Queue a safe revert of this change? The revert will fail instead of overwriting any cell that has changed again since then.')) return;
          try {
            await adminApi('/admin/action', { method: 'POST', body: JSON.stringify({ payload: { kind: 'admin-revert', changeId: entry.id } }) });
            status('Revert queued. It will itself be recorded as a new changelog entry.');
          } catch (error) { status(error.message, true); }
        });
        actions.appendChild(revert);
      }
      div.append(title, meta, changes, actions); host.appendChild(div);
    }
  } catch (error) { host.textContent = error.message; }
}

function renderFeaturePreview() {
  const gallery = q('#admin-icon-gallery');
  if (!gallery) return;
  gallery.replaceChildren();
  const labels = [
    ['section-leader', 'Section Leader'], ['guard-captain', 'Guard Captain'], ['drum-major', 'Drum Major'],
    ['rat-parent', 'RAT Parent'], ['mcm', 'MCM'], ['libraries', 'Libraries'], ['uniforms', 'Uniforms'],
    ['informal-leadership', 'Informal leadership'], ['other-leadership', 'Other formal leadership'], ['band-club', 'Band Club'],
  ];
  for (const [kind, label] of labels) {
    const item = document.createElement('div'); item.className = 'admin-icon-sample';
    item.appendChild(adminCardIconElement(kind, true));
    const text = document.createElement('span'); text.textContent = label; item.appendChild(text);
    gallery.appendChild(item);
  }
}

function selectTab(name) {
  qa('.admin-tab').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.adminTab === name)));
  qa('[data-admin-panel]').forEach((panel) => { panel.hidden = panel.dataset.adminPanel !== name; });
  if (name === 'sheet') renderSpreadsheet();
  if (name === 'requests') loadRequests();
  if (name === 'reciprocity') renderReciprocity();
  if (name === 'unknown') renderUnknown();
  if (name === 'features') renderFeaturePreview();
  if (name === 'changelog') loadChangelog();
}

async function unlockAdmin() {
  const key = q('#admin-key').value;
  const authStatus = q('#admin-auth-status');
  if (!key) { authStatus.textContent = 'Enter the developer key.'; return; }
  try {
    state.adminKey = key;
    authStatus.textContent = 'Checking administrator authorization…';
    await adminApi('/admin/status');
    q('#admin-key').value = '';
    q('#admin-auth').hidden = true;
    q('#admin-workspace').hidden = false;
    q('#admin-export').hidden = false;
    renderAdminTree(); renderReciprocity(); renderUnknown();
    authStatus.textContent = '';
  } catch (error) {
    state.adminKey = '';
    authStatus.textContent = error.message;
  }
}

function bind() {
  q('#admin-unlock').addEventListener('click', unlockAdmin);
  q('#admin-reload-assets')?.addEventListener('click', reloadAdminAssets);
  q('#admin-key').addEventListener('keydown', (event) => { if (event.key === 'Enter') unlockAdmin(); });
  qa('.admin-tab').forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.adminTab)));
  q('#admin-person-search').addEventListener('input', renderAdminTree);
  q('#admin-refresh-tree').addEventListener('click', () => location.reload());
  q('#admin-add-person').addEventListener('click', openAddEditor);
  q('#admin-save-person').addEventListener('click', savePerson);
  q('#admin-delete-person').addEventListener('click', deletePerson);
  q('#admin-cancel-edit').addEventListener('click', () => { q('#admin-editor-wrap').hidden = true; });
  q('#admin-sheet-search').addEventListener('input', renderSpreadsheet);
  q('#admin-sheet-save').addEventListener('click', saveSpreadsheet);
  q('#admin-refresh-requests').addEventListener('click', loadRequests);
  q('#admin-refresh-reciprocity').addEventListener('click', renderReciprocity);
  q('#admin-refresh-unknown').addEventListener('click', renderUnknown);
  q('#admin-refresh-changelog').addEventListener('click', loadChangelog);
  q('#admin-preview-icons')?.addEventListener('change', (event) => { state.previewCardIcons = event.target.checked; renderAdminTree(); renderFeaturePreview(); });
  q('#admin-preview-icon-guides')?.addEventListener('change', (event) => { state.previewIconGuides = event.target.checked; renderAdminTree(); });
  q('#admin-export').addEventListener('click', async () => {
    try { status(`Downloaded ${await window.YJMBSecureData.downloadDeveloperWorkbook(state.adminKey)}.`); }
    catch (error) { status(error.message, true); }
  });
}

async function main() {
  bind();
  try {
    state.data = await window.YJMBSecureData.loadTreeData();
    state.people = new Map(state.data.people.map((person) => [person.id, person]));
    renderAdminTree();
  } catch (error) {
    console.error(error);
    if (error?.code === 'AUTH_REQUIRED') {
      sessionStorage.setItem('yjmbReturnTo', 'admin.html');
      location.replace('index.html');
      return;
    }
    q('#admin-auth-status').textContent = error.message;
    q('#admin-unlock').disabled = true;
  }
}

main();
