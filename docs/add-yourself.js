'use strict';

const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  data: null,
  config: {},
  people: new Map(),
  trees: new Map(),
  step: 1,
  maxStep: 5,
  vetMatch: null,
  vetRejectedIds: new Set(),
  vetFingerprint: '',
  selfIdentityKey: '',
  selfIdentityDecision: '', // '' until answered, 'merge' or 'create'
  selfMatchedPersonId: null,
  selfDifferentPersonIds: new Set(),
  previewConnectedToExisting: false,
  previewGraph: null,
  turnstileToken: '',
  turnstileWidgetId: null,
};

const ROLE_LABELS = {
  self: 'You',
  vet: 'Your VET',
};

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  })[char]);
}

function radioValue(name) {
  return q(`input[name="${name}"]:checked`)?.value || '';
}

function fullSubmittedName() {
  const given = q('#self-given').value.trim();
  const family = q('#self-family').value.trim();
  return [given, family].filter(Boolean).join(' ');
}

function sectionLabel(section) {
  const fixed = {
    'flute/piccolo': 'Flute/Piccolo',
    'saxophone': 'Saxophone',
    'battery': 'Battery/Drumline',
    'front ensemble': 'Front Ensemble/Pit',
    'golden girl': 'Golden Girl',
    'goldrush': 'Goldrush',
    'unknown': 'Unknown',
  };
  if (fixed[section]) return fixed[section];
  return String(section).replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferRepository() {
  const configured = String(state.config.githubRepository || '').trim();
  if (/^[^/\s]+\/[^/\s]+$/.test(configured)) return configured;
  const host = window.location.hostname.toLowerCase();
  if (!host.endsWith('.github.io')) return '';
  const owner = host.slice(0, -'.github.io'.length);
  const parts = window.location.pathname.split('/').filter(Boolean);
  const repo = parts.length && !/\.html?$/i.test(parts[0]) ? parts[0] : `${owner}.github.io`;
  return `${owner}/${repo}`;
}

function showStatus(message, kind = 'error') {
  const el = q('#questionnaire-status');
  el.textContent = message;
  el.dataset.kind = kind;
  el.hidden = false;
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function clearStatus() {
  q('#questionnaire-status').hidden = true;
}

function populateYearSelect(select, { includeBlank = true } = {}) {
  const currentYear = new Date().getFullYear();
  const currentValue = select.value;
  select.replaceChildren();
  if (includeBlank) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'RAT Year';
    select.appendChild(placeholder);
  }
  for (let year = 1908; year <= currentYear; year += 1) {
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = String(year);
    select.appendChild(option);
  }
  if (currentValue) select.value = currentValue;
}

function populateSectionSelect(select, { includeBlank = true } = {}) {
  const currentValue = select.value;
  select.replaceChildren();
  if (includeBlank) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Section';
    select.appendChild(placeholder);
  }
  for (const section of Object.keys(state.data.sectionColors || {})) {
    const option = document.createElement('option');
    option.value = section;
    option.textContent = sectionLabel(section);
    select.appendChild(option);
  }
  if (currentValue) select.value = currentValue;
}

function initializeSelects() {
  populateYearSelect(q('#self-rat-year'));
  populateYearSelect(q('#vet-year'));
  populateSectionSelect(q('#vet-section'));
  if (!q('#section-memberships').children.length) addSectionMembership();
}

function updateNicknameVisibility() {
  const hasNickname = radioValue('has-nickname') === 'yes';
  q('#nickname-details').hidden = !hasNickname;
  q('#self-nickname').required = hasNickname;
  if (!hasNickname) {
    q('#self-nickname').value = '';
    for (const input of qa('input[name="tree-name-preference"]')) input.checked = false;
  }
}

function sectionMembershipRows({ activeOnly = true } = {}) {
  const rows = qa('.section-membership-row', q('#section-memberships'));
  if (!activeOnly || radioValue('multiple-sections') === 'yes') return rows;
  return rows.slice(0, 1);
}

function primarySection() {
  const row = sectionMembershipRows()[0];
  return row ? q('.membership-section', row).value : '';
}

function sectionRequiresSpecificInstrument(section) {
  return section === 'front ensemble' || section === 'battery';
}

function updateSectionMembershipRow(row) {
  const section = q('.membership-section', row).value;
  const instrumentWrap = q('.specific-instrument-wrap', row);
  const instrumentInput = q('.specific-instrument', row);
  const label = q('.specific-instrument-label', row);
  const requiresInstrument = sectionRequiresSpecificInstrument(section);
  // v16 preserves subsection detail for every section instead of throwing it
  // away during broad section categorization. The field is optional except in
  // the two sections where v15 already required a specific instrument.
  instrumentWrap.hidden = !section;
  instrumentInput.required = requiresInstrument;
  label.textContent = 'Specific instrument / subsection (optional)';
  instrumentInput.placeholder = 'Optional detail';
  if (section === 'front ensemble') {
    label.textContent = 'What instrument did you play in Front Ensemble/Pit?';
    instrumentInput.placeholder = 'e.g., marimba, vibraphone, synth, rack percussion';
  } else if (section === 'battery') {
    label.textContent = 'What instrument did you play in Battery/Drumline?';
    instrumentInput.placeholder = 'e.g., snare, tenors/quads, bass drum, cymbals';
  } else if (section === 'saxophone') {
    label.textContent = 'Which saxophone/subsection? (optional)';
    instrumentInput.placeholder = 'e.g., alto, tenor, bari, soprano';
  } else if (section === 'guard') {
    label.textContent = 'Which guard equipment/subsection? (optional)';
    instrumentInput.placeholder = 'e.g., flag, rifle, saber';
  } else if (section === 'flute/piccolo') {
    label.textContent = 'Which instrument? (optional)';
    instrumentInput.placeholder = 'e.g., flute, piccolo';
  } else if (section === 'clarinet') {
    label.textContent = 'Which clarinet? (optional)';
    instrumentInput.placeholder = 'e.g., clarinet, bass clarinet';
  }

  const key = row.dataset.sectionKey;
  const hasSectionNickname = q(`input[name="section-nickname-${key}"]:checked`, row)?.value === 'yes';
  const nicknameWrap = q('.section-nickname-wrap', row);
  const nicknameInput = q('.section-nickname', row);
  nicknameWrap.hidden = !hasSectionNickname;
  nicknameInput.required = hasSectionNickname;
}

function addSectionMembership(initial = {}) {
  const container = q('#section-memberships');
  const row = document.createElement('div');
  row.className = 'section-membership-row';
  row.dataset.sectionKey = initial.key || `section-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const top = document.createElement('div');
  top.className = 'section-membership-top';
  const sectionField = document.createElement('label');
  sectionField.className = 'form-field';
  const sectionLabelEl = document.createElement('span');
  sectionLabelEl.textContent = 'Section';
  const select = document.createElement('select');
  select.className = 'membership-section';
  populateSectionSelect(select);
  select.value = initial.section || '';
  sectionField.append(sectionLabelEl, select);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove-row-button section-remove-button';
  remove.setAttribute('aria-label', 'Remove this section');
  remove.textContent = '×';
  remove.addEventListener('click', () => { row.remove(); refreshSectionMemberships(); updateExistingSelfWarning(); });
  top.append(sectionField, remove);

  const nicknameChoices = document.createElement('fieldset');
  nicknameChoices.className = 'choice-group compact-choice-group section-nickname-choice';
  const legend = document.createElement('legend');
  legend.textContent = 'Did you have a section nickname in this section?';
  nicknameChoices.appendChild(legend);
  for (const [value, label] of [['yes', 'Yes'], ['no', 'No']]) {
    const choice = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `section-nickname-${row.dataset.sectionKey}`;
    radio.value = value;
    if (initial.hasSectionNickname === (value === 'yes')) radio.checked = true;
    radio.addEventListener('change', () => updateSectionMembershipRow(row));
    choice.append(radio, document.createTextNode(` ${label}`));
    nicknameChoices.appendChild(choice);
  }

  const sectionNicknameWrap = document.createElement('label');
  sectionNicknameWrap.className = 'form-field section-nickname-wrap';
  sectionNicknameWrap.hidden = true;
  const sectionNicknameLabel = document.createElement('span');
  sectionNicknameLabel.textContent = 'What is your section nickname?';
  const sectionNickname = document.createElement('input');
  sectionNickname.type = 'text';
  sectionNickname.className = 'section-nickname';
  sectionNickname.placeholder = 'Section nickname';
  sectionNickname.value = initial.sectionNickname || '';
  sectionNicknameWrap.append(sectionNicknameLabel, sectionNickname);

  const instrumentWrap = document.createElement('label');
  instrumentWrap.className = 'form-field specific-instrument-wrap';
  instrumentWrap.hidden = true;
  const instrumentLabel = document.createElement('span');
  instrumentLabel.className = 'specific-instrument-label';
  const instrument = document.createElement('input');
  instrument.type = 'text';
  instrument.className = 'specific-instrument';
  instrument.value = initial.specificInstrument || '';
  instrumentWrap.append(instrumentLabel, instrument);

  select.addEventListener('change', () => {
    updateSectionMembershipRow(row);
    updateExistingSelfWarning();
  });
  row.append(top, nicknameChoices, sectionNicknameWrap, instrumentWrap);
  container.appendChild(row);
  updateSectionMembershipRow(row);
  refreshSectionMemberships();
  return row;
}

function refreshSectionMemberships() {
  const rows = qa('.section-membership-row', q('#section-memberships'));
  const multiple = radioValue('multiple-sections') === 'yes';
  rows.forEach((row, index) => {
    row.hidden = !multiple && index > 0;
    q('.section-remove-button', row).hidden = index === 0 || !multiple;
  });
  q('#add-section').hidden = !multiple;
}

function updateMultipleSectionsVisibility() {
  const multiple = radioValue('multiple-sections') === 'yes';
  if (multiple && qa('.section-membership-row', q('#section-memberships')).length < 2) addSectionMembership();
  refreshSectionMemberships();
  updateExistingSelfWarning();
}

function readSectionMemberships() {
  return sectionMembershipRows().map((row, index) => {
    const section = q('.membership-section', row).value;
    const key = row.dataset.sectionKey || `section-${index}`;
    const hasSectionNickname = q(`input[name="section-nickname-${key}"]:checked`, row)?.value === 'yes';
    return {
      key,
      section,
      sectionNickname: hasSectionNickname ? q('.section-nickname', row).value.trim() : '',
      specificInstrument: section ? q('.specific-instrument', row).value.trim() : '',
    };
  });
}

function treeCardGivenName() {
  const given = q('#self-given').value.trim();
  const nickname = q('#self-nickname').value.trim();
  if (radioValue('has-nickname') !== 'yes' || !nickname) return given;
  const preference = radioValue('tree-name-preference') || 'given';
  if (preference === 'nickname') return `"${nickname}"`;
  if (preference === 'both') return `${given} "${nickname}"`.trim();
  return given;
}

function treeCardFamilyName() {
  const maiden = q('#self-family').value.trim();
  const married = q('#self-married').value.trim();
  if (radioValue('changed-last-name') !== 'yes' || !married) return maiden || married;
  const preference = radioValue('tree-last-name-preference') || 'maiden';
  if (preference === 'married') return married;
  if (preference === 'both') {
    if (normalize(maiden) === normalize(married)) return maiden || married;
    return [maiden, married].filter(Boolean).join(' ');
  }
  return maiden || married;
}

function treeCardName() {
  return [treeCardGivenName(), treeCardFamilyName()].filter(Boolean).join(' ');
}

const FORMAL_LEADERSHIP_OPTIONS = [
  'Drum Major',
  'Section Leader',
  'Guard Captain',
  'Staff Assistant',
  'Operations',
  'Props',
  'Uniforms',
  'Libraries',
  'MCM',
  'RAT Parent',
  'Other',
];
const FORMAL_LEADERSHIP_LABELS = {
  'Staff Assistant': 'Staff Assistant (Staff Ass)',
  'Operations': 'Operations (Ops)',
  'RAT Parent': 'RAT Parent (RAT Mom / RAT Dad)',
};

function positionYearEntryText(title, years = '') {
  const cleanTitle = String(title || '').trim();
  const cleanYears = String(years || '').trim();
  if (!cleanTitle) return '';
  return cleanYears ? `${cleanYears} ${cleanTitle}` : cleanTitle;
}

function addLeadershipEntry(initial = {}) {
  const container = q('#leadership-entries');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'leadership-entry-row';

  const typeField = document.createElement('label');
  typeField.className = 'form-field';
  typeField.innerHTML = '<span>Type</span>';
  const type = document.createElement('select');
  type.className = 'leadership-type';
  type.innerHTML = '<option value="formal">Formal</option><option value="informal">Informal</option>';
  type.value = initial.type || 'formal';
  typeField.appendChild(type);

  const roleField = document.createElement('label');
  roleField.className = 'form-field leadership-role-field';
  const roleLabel = document.createElement('span');
  roleLabel.textContent = 'Position';
  const formal = document.createElement('select');
  formal.className = 'leadership-formal-role';
  for (const role of FORMAL_LEADERSHIP_OPTIONS) {
    const option = document.createElement('option');
    option.value = role;
    option.textContent = FORMAL_LEADERSHIP_LABELS[role] || role;
    formal.appendChild(option);
  }
  formal.value = FORMAL_LEADERSHIP_OPTIONS.includes(initial.role)
    ? initial.role
    : (initial.type === 'formal' && initial.role ? 'Other' : 'Drum Major');

  const freeText = document.createElement('input');
  freeText.className = 'leadership-free-role';
  freeText.type = 'text';
  freeText.placeholder = 'Position';
  freeText.value = initial.type === 'informal' || formal.value === 'Other' ? (initial.role || '') : '';
  roleField.append(roleLabel, formal, freeText);

  const yearsField = document.createElement('label');
  yearsField.className = 'form-field';
  yearsField.innerHTML = '<span>Year(s) (optional)</span>';
  const years = document.createElement('input');
  years.className = 'leadership-years';
  years.type = 'text';
  years.placeholder = 'e.g., 2021 or 2021–2022';
  years.value = initial.years || '';
  yearsField.appendChild(years);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove-row-button';
  remove.setAttribute('aria-label', 'Remove this leadership position');
  remove.textContent = '×';
  remove.addEventListener('click', () => {
    row.remove();
    updateCombinedPositionYearPreview();
  });

  function refresh() {
    const informal = type.value === 'informal';
    formal.hidden = informal;
    freeText.hidden = !informal && formal.value !== 'Other';
    roleLabel.textContent = informal ? 'Informal position' : 'Formal position';
    freeText.placeholder = informal
      ? 'e.g., Dohmeister, Hype Man, mentor'
      : 'Other formal position';
    updateCombinedPositionYearPreview();
  }
  type.addEventListener('change', refresh);
  formal.addEventListener('change', refresh);
  freeText.addEventListener('input', updateCombinedPositionYearPreview);
  years.addEventListener('input', updateCombinedPositionYearPreview);
  refresh();

  row.append(typeField, roleField, yearsField, remove);
  container.appendChild(row);
  updateCombinedPositionYearPreview();
}

function readLeadershipHistory() {
  const container = q('#leadership-entries');
  if (!container) return [];
  return qa('.leadership-entry-row', container).map((row) => {
    const type = q('.leadership-type', row).value;
    const formal = q('.leadership-formal-role', row).value;
    const free = q('.leadership-free-role', row).value.trim();
    const role = type === 'informal' ? free : (formal === 'Other' ? free : formal);
    return { type, role, years: q('.leadership-years', row).value.trim() };
  }).filter((entry) => entry.role);
}

function updateBandClubLeadershipVisibility() {
  const details = q('#band-club-leadership-details');
  if (!details) return;
  const yes = radioValue('band-club-leadership') === 'yes';
  details.hidden = !yes;
  if (yes && !q('#band-club-leadership-entries').children.length) addBandClubLeadershipEntry();
  if (!yes) q('#band-club-leadership-entries').replaceChildren();
  updateCombinedPositionYearPreview();
}

function addBandClubLeadershipEntry(initial = {}) {
  const container = q('#band-club-leadership-entries');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'band-club-entry-row';

  const positionField = document.createElement('label');
  positionField.className = 'form-field';
  positionField.innerHTML = '<span>Band Club position</span>';
  const position = document.createElement('input');
  position.className = 'band-club-position';
  position.type = 'text';
  position.placeholder = 'e.g., President, Treasurer, Social Chair';
  position.value = initial.position || '';
  positionField.appendChild(position);

  const yearsField = document.createElement('label');
  yearsField.className = 'form-field';
  yearsField.innerHTML = '<span>Year(s) (optional)</span>';
  const years = document.createElement('input');
  years.className = 'band-club-years';
  years.type = 'text';
  years.placeholder = 'e.g., 2022–2023';
  years.value = initial.years || '';
  yearsField.appendChild(years);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove-row-button';
  remove.setAttribute('aria-label', 'Remove this Band Club position');
  remove.textContent = '×';
  remove.addEventListener('click', () => {
    row.remove();
    updateCombinedPositionYearPreview();
  });
  position.addEventListener('input', updateCombinedPositionYearPreview);
  years.addEventListener('input', updateCombinedPositionYearPreview);
  row.append(positionField, yearsField, remove);
  container.appendChild(row);
  updateCombinedPositionYearPreview();
}

function readBandClubLeadershipHistory() {
  const container = q('#band-club-leadership-entries');
  if (!container || radioValue('band-club-leadership') !== 'yes') return [];
  return qa('.band-club-entry-row', container).map((row) => ({
    position: q('.band-club-position', row).value.trim(),
    years: q('.band-club-years', row).value.trim(),
  })).filter((entry) => entry.position);
}

function structuredPositionYearEntries() {
  const entries = [];
  for (const entry of readLeadershipHistory()) {
    let title = entry.role;
    if (entry.type === 'informal' && !/\binformal(?:\s+leadership)?\b/i.test(title)) {
      title = `Informal Leadership: ${title}`;
    }
    const rendered = positionYearEntryText(title, entry.years);
    if (rendered) entries.push(rendered);
  }
  for (const entry of readBandClubLeadershipHistory()) {
    let title = entry.position;
    if (!/\bband\s+club\b|\byjbc\b/i.test(title)) title = `Band Club ${title}`;
    const rendered = positionYearEntryText(title, entry.years);
    if (rendered) entries.push(rendered);
  }
  return entries;
}

function splitPositionYearEntries(value) {
  return String(value || '').split(/[;,|\n]+/).map((entry) => entry.trim()).filter(Boolean);
}

function combinedPositionYear() {
  const entries = [...structuredPositionYearEntries(), ...splitPositionYearEntries(q('#position-year')?.value)];
  const seen = new Set();
  return entries.filter((entry) => {
    const key = normalize(entry);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join('; ');
}

function updateCombinedPositionYearPreview() {
  const preview = q('#position-year-combined-preview');
  if (!preview) return;
  const value = combinedPositionYear();
  preview.textContent = value
    ? `Combined Position and Year: ${value}`
    : 'No leadership or position history entered yet.';
}

const PREVIEW_ROLE_ICON_ASSETS = Object.freeze({
  'section-leader': 'icons/section-leader-icon.png',
  'guard-captain': 'icons/guard-captain-icon.png',
  'drum-major': 'icons/drum-major-icon.png',
  'rat-parent': 'icons/rat-parent-icon.png',
  'mcm': 'icons/mcm-icon.png',
  'libraries': 'icons/libraries-icon.png',
  'uniforms': 'icons/uniforms-icon.png',
  'informal-leadership': 'icons/informal-leadership-icon.png',
  'other-leadership': 'icons/other-leadership-icon.png',
  'band-club': 'icons/band-club-icon.png',
});

function leadershipTitleKey(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, '');
}

function previewPositionTitle(entry) {
  return String(entry || '')
    .replace(/\b(?:spring|summer|fall|autumn|winter)?\s*(?:19|20)\d{2}(?:\s*(?:-|–|—|to|through|thru)\s*(?:19|20)?\d{2})?\b/gi, ' ')
    .replace(/^[\s\-–—:;,|/]+|[\s\-–—:;,|/]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function taxonomyCategoryForPreviewTitle(title) {
  const key = leadershipTitleKey(title);
  const direct = (state.data?.leadershipTaxonomy || []).find((item) =>
    leadershipTitleKey(item?.key || item?.title) === key
  );
  if (direct?.category) return String(direct.category);
  const indexed = (state.data?.leadershipTitleIndex || []).find((item) =>
    leadershipTitleKey(item?.key || item?.title) === key
  );
  return String(indexed?.overrideCategory || '');
}

function previewPositionYearIconKinds(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const out = [];
  const add = (kind) => { if (kind && kind !== 'none' && !out.includes(kind)) out.push(kind); };
  const entries = raw.split(/[;,|\n]+/).map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    const title = previewPositionTitle(entry) || entry;
    const override = taxonomyCategoryForPreviewTitle(title);
    if (override) {
      add(override);
      continue;
    }
    let recognized = false;
    const tests = [
      [/\bsection\s+leaders?\b/i, 'section-leader'],
      [/\b(?:color\s+guard\s+)?guard\s+captains?\b|\bcolor\s+guard\s+captains?\b/i, 'guard-captain'],
      [/\bdrum\s+majors?\b/i, 'drum-major'],
      [/\brat\s+(?:parents?|moms?|dads?)\b/i, 'rat-parent'],
      [/\bmcm\b/i, 'mcm'],
      [/\blibraries?\b|\blibrary\b/i, 'libraries'],
      [/\buniforms?\b/i, 'uniforms'],
    ];
    for (const [pattern, kind] of tests) {
      if (pattern.test(entry)) { add(kind); recognized = true; }
    }
    if (/\b(?:yellow\s+jacket\s+)?band\s+club\b|\byjbc\b/i.test(entry)) {
      add('band-club'); recognized = true;
    }
    if (/\bhype[\s-]*(?:man|men|person|people|woman|women|guy|girl)\b|\bhypeman\b|\bdoh[\s-]*meisters?\b|\binformal(?:\s+leadership)?\b/i.test(entry)) {
      add('informal-leadership'); recognized = true;
    }
    if (/\bstaff\s+(?:assistants?|ass(?:\.|\b))|\boperations?\b|\bops\b|\bprops?\b/i.test(entry)) {
      add('other-leadership'); recognized = true;
    }
    if (!recognized) {
      const residual = title
        .replace(/\b(?:position|positions|year|years|marching\s+band|leadership|served\s+as|serve(?:d)?\s+as)\b/gi, ' ')
        .replace(/[()\[\]{},:/+_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (/[A-Za-z]/.test(residual)) add('other-leadership');
    }
  }
  return out;
}

function createPreviewRoleIcon(kind) {
  const asset = PREVIEW_ROLE_ICON_ASSETS[kind];
  if (!asset) return null;
  const wrapper = document.createElement('span');
  wrapper.className = `card-status-icon card-role-icon icon-${kind}`;
  wrapper.dataset.iconKind = kind;
  wrapper.title = kind.replaceAll('-', ' ');
  const img = document.createElement('img');
  img.src = asset;
  img.alt = '';
  img.decoding = 'async';
  wrapper.appendChild(img);
  return wrapper;
}

function assignPreviewIconSlots(elements) {
  const candidates = elements.filter(Boolean);
  const shown = new Set();
  const drumMajor = candidates.find((el) => el.dataset.iconKind === 'drum-major');
  const sectionLeader = candidates.find((el) => el.dataset.iconKind === 'guard-captain')
    || candidates.find((el) => el.dataset.iconKind === 'section-leader');
  const place = (el, slot) => {
    if (!el || shown.size >= 4) return;
    el.dataset.roleSlot = slot;
    shown.add(el);
  };
  place(drumMajor, 'tl');
  place(sectionLeader, 'tr');
  const reservedKinds = new Set(['drum-major', 'section-leader', 'guard-captain']);
  const overflow = candidates.filter((el) => !reservedKinds.has(el.dataset.iconKind));
  const slots = ['bl', 'br'];
  if (!drumMajor) slots.push('tl');
  if (!sectionLeader) slots.push('tr');
  for (const el of overflow) {
    const slot = slots.shift();
    if (!slot || shown.size >= 4) break;
    place(el, slot);
  }
  return candidates.filter((el) => shown.has(el));
}

function validateLeadershipQuestionnaire() {
  const rows = qa('.leadership-entry-row', q('#leadership-entries'));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const type = q('.leadership-type', row).value;
    const formal = q('.leadership-formal-role', row).value;
    const free = q('.leadership-free-role', row).value.trim();
    if ((type === 'informal' || formal === 'Other') && !free) {
      showStatus(`Leadership row ${index + 1} needs a position name, or remove that row.`);
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return false;
    }
  }
  const clubAnswer = radioValue('band-club-leadership');
  if (!clubAnswer) {
    showStatus('Please answer whether you have held a Band Club leadership position.');
    q('.band-club-leadership-block')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return false;
  }
  if (clubAnswer === 'yes' && !readBandClubLeadershipHistory().length) {
    showStatus('Add at least one Band Club leadership position, or choose No.');
    q('#band-club-leadership-details')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return false;
  }
  return true;
}

function updateOtherGtEnsembleVisibility() {
  const hasOtherEnsembles = radioValue('other-gt-ensembles') === 'yes';
  q('#other-gt-ensemble-details').hidden = !hasOtherEnsembles;
  q('#other-gt-ensembles-list').required = hasOtherEnsembles;
  if (!hasOtherEnsembles) {
    q('#other-gt-ensembles-list').value = '';
    q('#other-gt-instruments').value = '';
    q('#other-gt-instruments-wrap').hidden = true;
    for (const input of qa('input[name="different-gt-instrument"]')) input.checked = false;
  }
  updateDifferentGtInstrumentVisibility();
}

function updateDifferentGtInstrumentVisibility() {
  const hasOtherEnsembles = radioValue('other-gt-ensembles') === 'yes';
  const differentInstrument = hasOtherEnsembles && radioValue('different-gt-instrument') === 'yes';
  q('#other-gt-instruments-wrap').hidden = !differentInstrument;
  q('#other-gt-instruments').required = differentInstrument;
  if (!differentInstrument) q('#other-gt-instruments').value = '';
}

function setStep(step, { scroll = true } = {}) {
  state.step = Math.max(1, Math.min(state.maxStep, step));
  for (const section of qa('.wizard-step')) {
    section.hidden = Number(section.dataset.step) !== state.step;
  }
  q('#wizard-progress-text').textContent = `Step ${state.step} of ${state.maxStep}`;
  q('#wizard-progress-bar').style.width = `${(state.step / state.maxStep) * 100}%`;
  clearStatus();
  if (state.step === 3) renderPreview();
  if (state.step === 4) renderNoteTargets();
  if (state.step === 5) { renderSubmissionSummary(); renderTurnstile(); }
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function changedLastNameUpdated() {
  const changed = radioValue('changed-last-name');
  const yes = changed === 'yes';
  q('#self-married-wrap').hidden = !yes;
  q('#married-name-guidance').hidden = !yes;
  q('#last-name-preference-details').hidden = !yes;
  q('#self-family-label').textContent = yes ? 'Family/Maiden Name' : 'Family/Last Name';
  q('#self-family').placeholder = yes ? 'Family/Maiden Name' : 'Family/Last Name';
  q('#self-married').required = yes;
  if (!yes) {
    q('#self-married').value = '';
    for (const input of qa('input[name="tree-last-name-preference"]')) input.checked = false;
  }
  updateExistingSelfWarning();
}

function pairSystemApplies() {
  const year = Number(q('#self-rat-year').value);
  if (!year) return false;
  if (year >= 1990) return true;
  return radioValue('legacy-system') === 'yes';
}

function updateRelationshipVisibility() {
  const year = Number(q('#self-rat-year').value);
  const pre1990 = Boolean(year && year < 1990);
  q('#legacy-system-group').hidden = !pre1990;
  if (!pre1990) {
    for (const input of qa('input[name="legacy-system"]')) input.checked = false;
  }

  const applies = year >= 1990 || (pre1990 && radioValue('legacy-system') === 'yes');
  const explicitlyNoLegacy = pre1990 && radioValue('legacy-system') === 'no';
  q('#relationship-questions').hidden = !applies || explicitlyNoLegacy;

  const currentlyRat = radioValue('currently-rat');
  q('#rats-question').hidden = !applies || currentlyRat !== 'no';
  if (applies && currentlyRat === 'no' && !q('#rat-rows').children.length) addRatRow();
  updateVetMatch();
  updateExistingSelfWarning();
}

function personSectionMatches(person, section) {
  if (!section) return true;
  return (person.instruments || []).includes(section);
}

function usefulPersonText(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^(?:\?+|unknown(?:\s+person)?|n\/a)$/i.test(text)) return '';
  return text;
}

function relationshipCandidateCanonicalName(person) {
  const source = person?.sourceFields || {};
  const fromFields = [
    usefulPersonText(person?.givenPreferredName || source['Given/Preferred Name']),
    usefulPersonText(person?.familyMaidenName || source['Family/Maiden Name'] || source['Family/Last Name']),
  ].filter(Boolean).join(' ').trim();
  if (fromFields) return fromFields;
  for (const value of [person?.currentName, person?.displayName, person?.name]) {
    const text = usefulPersonText(value);
    if (text) return text;
  }
  return 'Unknown person';
}

function relationshipCandidateDisplayName(person) {
  for (const value of [person?.displayName, person?.currentName, relationshipCandidateCanonicalName(person), person?.name]) {
    const text = usefulPersonText(value);
    if (text) return text;
  }
  return 'Unknown person';
}

function relationshipCandidateYearLabel(person) {
  const label = usefulPersonText(person?.ratYearLabel);
  if (label && !/^unknown\s+year$/i.test(label)) return label;
  const sourceYear = person?.sourceFields?.['RAT Year'];
  const year = Number(person?.ratYear || sourceYear);
  return Number.isInteger(year) && year >= 1908 ? String(year) : 'Unknown year';
}

function relationshipCandidateSectionText(person) {
  const raw = usefulPersonText(person?.instrumentRaw || person?.sourceFields?.Instrument);
  if (raw && !/^unknown(?:\s+section)?$/i.test(raw)) return raw;
  const first = Array.isArray(person?.instruments) ? person.instruments.find(Boolean) : '';
  return first ? sectionLabel(first) : 'Unknown section';
}

function relationshipCandidateLabel(person) {
  return `${relationshipCandidateDisplayName(person)} (${relationshipCandidateYearLabel(person)}) (${relationshipCandidateSectionText(person)})`;
}

function personNameAliases(person) {
  return [...new Set([
    person?.name,
    person?.displayName,
    person?.currentName,
    relationshipCandidateCanonicalName(person),
    [person?.givenPreferredName, person?.familyMaidenName].filter(Boolean).join(' '),
  ].map(usefulPersonText).filter(Boolean).map(normalize))];
}

function exactRelationshipCandidates(entry) {
  if (!entry?.name || !entry?.year) return [];
  const wanted = normalize(entry.name);
  const year = Number(entry.year);
  return (state.data?.people || []).filter((person) =>
    Number(person.ratYear) === year && personNameAliases(person).includes(wanted)
  );
}

function validateRelationshipIdentityConfirmation(entry, label, panel) {
  if (!entry?.name || !entry?.year || entry.matchedId) return true;
  const exact = exactRelationshipCandidates(entry);
  if (!exact.length) return true;
  const rejected = new Set((entry.rejectedIds || []).map(String));
  const unresolved = exact.filter((person) => !rejected.has(String(person.id)));
  if (!unresolved.length) return true;
  showStatus(
    `${label} matches an existing name/RAT year, but identity wasn't confirmed. ` +
    'Please confirm the correct person in the match prompt, or choose “No” for every listed match before continuing.'
  );
  if (panel) {
    panel.hidden = false;
    panel.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  return false;
}

function editDistance(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x) return y.length;
  if (!y) return x.length;
  const previous = Array.from({ length: y.length + 1 }, (_, index) => index);
  for (let i = 1; i <= x.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= y.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[y.length];
}

function vetCandidateScore(person, enteredName, section, year) {
  const entered = normalize(enteredName);
  const name = normalize(relationshipCandidateCanonicalName(person));
  if (!entered || entered.length < 3) return -Infinity;
  let score = 0;
  if (name === entered) score += 110;
  else if (name.startsWith(entered) || entered.startsWith(name)) score += 82;
  else {
    const enteredTokens = entered.split(' ');
    const allTokens = enteredTokens.every((token) => name.includes(token));
    if (allTokens) score += 68;
    const distance = editDistance(entered, name);
    const allowed = Math.max(1, Math.floor(Math.max(entered.length, name.length) * .18));
    if (distance <= allowed) score += 62 - distance * 4;
  }
  if (year && Number(person.ratYear) === Number(year)) score += 24;
  else if (year && person.ratYear) score -= Math.min(18, Math.abs(Number(person.ratYear) - Number(year)) * 4);
  if (section && personSectionMatches(person, section)) score += 18;
  else if (section) score -= 7;
  return score;
}

function bestRelationshipCandidate(enteredName, section, year, rejectedIds = new Set(), { requireClearWinner = true } = {}) {
  if (enteredName.trim().length < 3) return null;
  const ranked = state.data.people
    .filter((person) => !rejectedIds.has(person.id))
    .map((person) => ({ person, score: vetCandidateScore(person, enteredName, section, year) }))
    .filter((entry) => entry.score >= 62)
    .sort((a, b) => b.score - a.score || relationshipCandidateDisplayName(a.person).localeCompare(relationshipCandidateDisplayName(b.person)));
  if (!ranked.length) return null;
  if (requireClearWinner && ranked[1] && ranked[0].score - ranked[1].score < 4 && ranked[0].score < 100) return null;
  return ranked[0].person;
}

function bestVetCandidate() {
  return bestRelationshipCandidate(
    q('#vet-name').value.trim(),
    q('#vet-section').value,
    q('#vet-year').value,
    state.vetRejectedIds,
    { requireClearWinner: false },
  );
}

function clearVetMatch() {
  state.vetMatch = null;
  const panel = q('#vet-match-panel');
  panel.hidden = true;
  panel.replaceChildren();
}

function updateVetMatch() {
  const fingerprint = `${normalize(q('#vet-name').value)}|${q('#vet-section').value}|${q('#vet-year').value}`;
  if (fingerprint !== state.vetFingerprint) {
    state.vetRejectedIds.clear();
    state.vetFingerprint = fingerprint;
  }
  clearVetMatch();
  if (q('#relationship-questions').hidden) return;
  const candidate = bestVetCandidate();
  if (!candidate) return;

  const panel = q('#vet-match-panel');
  const prompt = document.createElement('p');
  prompt.textContent = `I think I found your VET in our system. Is your VET ${relationshipCandidateLabel(candidate)}?`;
  const actions = document.createElement('div');
  actions.className = 'inline-actions';
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'primary-button small-button';
  yes.textContent = 'Yes';
  yes.addEventListener('click', () => {
    state.vetMatch = candidate;
    state.vetRejectedIds.clear();
    q('#vet-name').value = relationshipCandidateCanonicalName(candidate);
    q('#vet-section').value = (candidate.instruments || [])[0] || q('#vet-section').value;
    if (candidate.ratYear) q('#vet-year').value = String(candidate.ratYear);
    state.vetFingerprint = `${normalize(q('#vet-name').value)}|${q('#vet-section').value}|${q('#vet-year').value}`;
    panel.classList.add('match-confirmed');
    panel.replaceChildren();
    const confirmed = document.createElement('p');
    confirmed.innerHTML = `<strong>Matched:</strong> ${escapeHtml(relationshipCandidateLabel(candidate))}`;
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'secondary-button small-button';
    undo.textContent = 'Not them';
    undo.addEventListener('click', () => {
      state.vetRejectedIds.add(candidate.id);
      clearVetMatch();
      updateVetMatch();
    });
    panel.append(confirmed, undo);
    panel.hidden = false;
  });
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'secondary-button small-button';
  no.textContent = 'No';
  no.addEventListener('click', () => {
    state.vetRejectedIds.add(candidate.id);
    clearVetMatch();
    updateVetMatch();
  });
  actions.append(yes, no);
  panel.append(prompt, actions);
  panel.hidden = false;
}

// Same names and RAT years are legal and intentionally remain separate people.
// NEVER infer a merge from name/year/section; a member must say Yes to the
// exact person.  'No' is recorded for EACH candidate before allowing creation.
function matchingSelfProfiles(name = fullSubmittedName(), year = q('#self-rat-year').value) {
  const normalizedName = normalize(name);
  if (!normalizedName || !year || !state.data?.people) return [];
  const section = primarySection();
  return state.data.people.filter((person) =>
    personNameAliases(person).includes(normalizedName) && Number(person.ratYear) === Number(year)
  ).sort((a, b) => Number(personSectionMatches(b, section)) - Number(personSectionMatches(a, section))
    || String(a.id).localeCompare(String(b.id)));
}

function resetSelfIdentityOnChange() {
  const key = `${normalize(fullSubmittedName())}|${q('#self-rat-year').value}`;
  if (key === state.selfIdentityKey) return;
  state.selfIdentityKey = key;
  state.selfIdentityDecision = '';
  state.selfMatchedPersonId = null;
  state.selfDifferentPersonIds = new Set();
}

function exactExistingPerson() {
  // This function exists for the preview graph, NOT for fuzzy matching.
  return state.selfIdentityDecision === 'merge'
    ? matchingSelfProfiles().find((person) => person.id === state.selfMatchedPersonId) || null
    : null;
}

function updateExistingSelfWarning() {
  const panel = q('#existing-self-warning');
  resetSelfIdentityOnChange();
  const candidates = matchingSelfProfiles();
  panel.replaceChildren();
  if (!candidates.length) {
    state.selfIdentityDecision = 'create';
    state.selfMatchedPersonId = null;
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const intro = document.createElement('p');
  intro.textContent = `${candidates.length} existing profile${candidates.length > 1 ? 's' : ''} share your name and RAT year. Is this you? Review the details before choosing.`;
  panel.appendChild(intro);
  if (state.selfIdentityDecision === 'merge') {
    const confirmed = candidates.find((p) => p.id === state.selfMatchedPersonId);
    if (confirmed) {
      const message = document.createElement('p');
      message.textContent = `Yes — merge into ${relationshipCandidateLabel(confirmed)}.`;
      const restart = document.createElement('button');
      restart.type = 'button'; restart.className = 'secondary-button small-button';
      restart.textContent = 'Change my answer';
      restart.addEventListener('click', () => {
        state.selfIdentityDecision = ''; state.selfMatchedPersonId = null;
        state.selfDifferentPersonIds.clear(); updateExistingSelfWarning();
      });
      panel.append(message, restart);
      return;
    }
    state.selfIdentityDecision = '';
    state.selfMatchedPersonId = null;
  }
  if (state.selfIdentityDecision === 'create') {
    const message = document.createElement('p');
    message.textContent = 'You confirmed that none of these profiles is you. Your submission will create a separate person with the same name and RAT year.';
    const restart = document.createElement('button');
    restart.type = 'button'; restart.className = 'secondary-button small-button';
    restart.textContent = 'Review matching profiles again';
    restart.addEventListener('click', () => {
      state.selfIdentityDecision = ''; state.selfDifferentPersonIds.clear(); updateExistingSelfWarning();
    });
    panel.append(message, restart);
    return;
  }
  const pending = candidates.filter((person) => !state.selfDifferentPersonIds.has(person.id));
  if (!pending.length) {
    state.selfIdentityDecision = 'create';
    updateExistingSelfWarning();
    return;
  }
  const list = document.createElement('div');
  list.className = 'identity-choice-list';
  // Display one candidate at a time, including all workbook-backed profile fields.
  const person = pending[0];
  const card = document.createElement('div');
  card.className = 'identity-candidate';
  const title = document.createElement('strong');
  title.textContent = `${relationshipCandidateDisplayName(person)} — ${relationshipCandidateYearLabel(person)}`;
  card.appendChild(title);
  const details = document.createElement('dl');
  const fields = Array.isArray(person.sourceFields) && person.sourceFields.length
    ? person.sourceFields
    : [
      {label: 'RAT Year', value: person.ratYearLabel},
      {label: 'Instrument / Section', value: person.instrumentRaw},
      {label: 'Personal Nickname', value: person.personalNickname},
      {label: 'Family/Maiden Name', value: person.familyMaidenName},
      {label: 'Married Name', value: person.marriedName},
    ];
  for (const field of fields) {
    if (field.value == null || !String(field.value).trim()) continue;
    const dt = document.createElement('dt'); dt.textContent = field.label;
    const dd = document.createElement('dd'); dd.textContent = String(field.value);
    details.append(dt, dd);
  }
  card.appendChild(details);
  const actions = document.createElement('div');
  actions.className = 'inline-actions';
  const yes = document.createElement('button');
  yes.type = 'button'; yes.className = 'primary-button small-button'; yes.textContent = 'Yes';
  yes.addEventListener('click', () => {
    state.selfIdentityDecision = 'merge';
    state.selfMatchedPersonId = person.id;
    updateExistingSelfWarning();
  });
  const no = document.createElement('button');
  no.type = 'button'; no.className = 'secondary-button small-button';
  no.textContent = "No, I'm a different person";
  no.addEventListener('click', () => {
    state.selfDifferentPersonIds.add(person.id);
    if (candidates.every((candidate) => state.selfDifferentPersonIds.has(candidate.id))) {
      state.selfIdentityDecision = 'create';
      state.selfMatchedPersonId = null;
    }
    updateExistingSelfWarning();
  });
  actions.append(yes, no);
  card.appendChild(actions);
  list.appendChild(card);
  if (pending.length > 1) {
    const remaining = document.createElement('p');
    remaining.textContent = `${pending.length - 1} more matching profile(s) will be checked if you choose No.`;
    list.appendChild(remaining);
  }
  panel.appendChild(list);
}

function createRelationshipSelect(kind, className) {
  const select = document.createElement('select');
  select.className = className;
  if (kind === 'section') populateSectionSelect(select);
  else populateYearSelect(select);
  return select;
}

function addRatRow(initial = {}) {
  const container = q('#rat-rows');
  const row = document.createElement('div');
  row.className = 'relationship-entry rat-entry';
  row.dataset.ratKey = initial.key || `rat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  row.dataset.matchedId = initial.matchedId || '';
  row._ratRejectedIds = new Set();
  row._ratMatch = null;
  row._ratFingerprint = '';
  row._suppressRatMatchUpdate = false;

  const nameLabel = document.createElement('label');
  const name = document.createElement('input');
  name.type = 'text';
  name.placeholder = 'RAT Name';
  name.className = 'rat-name';
  name.value = initial.name || '';
  nameLabel.append(name);

  const sectionLabelEl = document.createElement('label');
  const section = createRelationshipSelect('section', 'rat-section');
  section.value = initial.section || '';
  sectionLabelEl.append(section);

  const yearLabel = document.createElement('label');
  const year = createRelationshipSelect('year', 'rat-year');
  year.value = initial.year || '';
  yearLabel.append(year);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove-row-button';
  remove.setAttribute('aria-label', 'Remove this RAT');
  remove.textContent = '×';
  remove.addEventListener('click', () => {
    row.remove();
    refreshRatRemoveButtons();
  });

  const matchPanel = document.createElement('div');
  matchPanel.className = 'match-panel rat-match-panel';
  matchPanel.hidden = true;

  const renderConfirmedMatch = (candidate) => {
    row._ratMatch = candidate;
    row.dataset.matchedId = candidate.id;
    matchPanel.classList.add('match-confirmed');
    matchPanel.replaceChildren();
    const confirmed = document.createElement('p');
    confirmed.innerHTML = `<strong>Matched RAT:</strong> ${escapeHtml(relationshipCandidateLabel(candidate))}`;
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'secondary-button small-button';
    undo.textContent = 'Not them';
    undo.addEventListener('click', () => {
      row._ratRejectedIds.add(candidate.id);
      row._ratMatch = null;
      row.dataset.matchedId = '';
      matchPanel.classList.remove('match-confirmed');
      updateRatMatch();
    });
    matchPanel.append(confirmed, undo);
    matchPanel.hidden = false;
  };

  const updateRatMatch = () => {
    if (row._suppressRatMatchUpdate) return;
    const fingerprint = `${normalize(name.value)}|${section.value}|${year.value}`;
    if (fingerprint !== row._ratFingerprint) {
      row._ratFingerprint = fingerprint;
      row._ratRejectedIds.clear();
      row._ratMatch = null;
      row.dataset.matchedId = '';
    }
    matchPanel.classList.remove('match-confirmed');
    matchPanel.replaceChildren();
    matchPanel.hidden = true;

    const candidate = bestRelationshipCandidate(name.value.trim(), section.value, year.value, row._ratRejectedIds, { requireClearWinner: false });
    if (!candidate) return;

    const prompt = document.createElement('p');
    prompt.textContent = `I think I found your RAT in our system. Is your RAT ${relationshipCandidateLabel(candidate)}?`;
    const actions = document.createElement('div');
    actions.className = 'inline-actions';

    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'primary-button small-button';
    yes.textContent = 'Yes';
    yes.addEventListener('click', () => {
      row._suppressRatMatchUpdate = true;
      name.value = relationshipCandidateCanonicalName(candidate);
      section.value = (candidate.instruments || [])[0] || section.value;
      if (candidate.ratYear) year.value = String(candidate.ratYear);
      row._ratFingerprint = `${normalize(name.value)}|${section.value}|${year.value}`;
      row._ratRejectedIds.clear();
      row._suppressRatMatchUpdate = false;
      renderConfirmedMatch(candidate);
    });

    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'secondary-button small-button';
    no.textContent = 'No';
    no.addEventListener('click', () => {
      row._ratRejectedIds.add(candidate.id);
      row.dataset.matchedId = '';
      row._ratMatch = null;
      updateRatMatch();
    });

    actions.append(yes, no);
    matchPanel.append(prompt, actions);
    matchPanel.hidden = false;
  };

  name.addEventListener('input', updateRatMatch);
  section.addEventListener('change', updateRatMatch);
  year.addEventListener('change', updateRatMatch);

  row.append(nameLabel, sectionLabelEl, yearLabel, remove, matchPanel);
  container.appendChild(row);
  updateRatMatch();
  refreshRatRemoveButtons();
}

function refreshRatRemoveButtons() {
  const rows = qa('.rat-entry', q('#rat-rows'));
  rows.forEach((row, index) => {
    q('.remove-row-button', row).hidden = index === 0;
  });
}

function readRats() {
  return qa('.rat-entry', q('#rat-rows')).map((row, index) => ({
    key: row.dataset.ratKey || `rat-${index}`,
    name: q('.rat-name', row).value.trim(),
    section: q('.rat-section', row).value,
    year: q('.rat-year', row).value ? Number(q('.rat-year', row).value) : null,
    matchedId: row.dataset.matchedId || null,
    rejectedIds: [...row._ratRejectedIds],
  })).filter((rat) => rat.name || rat.section || rat.year);
}

function validateStep1() {
  if (!q('#self-given').value.trim() || !q('#self-family').value.trim()) {
    showStatus('Enter both your First/Preferred Name and your family name.');
    return false;
  }
  const changed = radioValue('changed-last-name');
  if (!changed) {
    showStatus('Please answer whether you have changed your last name since being in the band.');
    return false;
  }
  if (changed === 'yes' && !q('#self-married').value.trim()) {
    showStatus('Enter your current Last/Married Name, or choose “No” if your surname has not changed.');
    return false;
  }
  if (changed === 'yes' && !radioValue('tree-last-name-preference')) {
    showStatus('Choose whether your tree card should show your Family/Maiden Name, Married/Current Name, or both.');
    return false;
  }
  const hasNickname = radioValue('has-nickname');
  if (!hasNickname) {
    showStatus('Please answer whether you have a nickname.');
    return false;
  }
  if (hasNickname === 'yes') {
    if (!q('#self-nickname').value.trim()) {
      showStatus('Enter your nickname.');
      return false;
    }
    if (!radioValue('tree-name-preference')) {
      showStatus('Choose whether your tree card should use your First/Preferred Name, your Personal Nickname, or both.');
      return false;
    }
  }
  return true;
}

function validateRelationshipRow(entry, label, { optional = false } = {}) {
  const any = Boolean(entry.name || entry.section || entry.year);
  if (!any && optional) return true;
  if (!entry.name || !entry.section || !entry.year) {
    showStatus(`${label} needs a name, section, and RAT year if you enter any part of that row.`);
    return false;
  }
  return true;
}

function readVet() {
  return {
    name: q('#vet-name').value.trim(),
    section: q('#vet-section').value,
    year: q('#vet-year').value ? Number(q('#vet-year').value) : null,
    matchedId: state.vetMatch?.id || null,
    rejectedIds: [...state.vetRejectedIds],
  };
}

function validateStep2() {
  if (!radioValue('currently-rat')) {
    showStatus('Please answer whether you are currently a RAT.');
    return false;
  }
  const year = Number(q('#self-rat-year').value);
  if (!year) {
    showStatus('Select your RAT year.');
    return false;
  }
  if (!radioValue('multiple-sections')) {
    showStatus('Please answer whether you have been in multiple sections.');
    return false;
  }
  updateExistingSelfWarning();
  if (matchingSelfProfiles().length && !state.selfIdentityDecision) {
    showStatus('Please answer “Is this you?” for each matching profile before continuing.');
    return false;
  }
  const memberships = readSectionMemberships();
  if (!memberships.length || !memberships[0].section) {
    showStatus('Select your section.');
    return false;
  }
  if (radioValue('multiple-sections') === 'yes' && memberships.length < 2) {
    showStatus('You said you have been in multiple sections. Add at least two section entries.');
    return false;
  }
  const seenSections = new Set();
  for (let index = 0; index < memberships.length; index += 1) {
    const membership = memberships[index];
    if (!membership.section) {
      showStatus(`Section entry ${index + 1} needs a section.`);
      return false;
    }
    if (seenSections.has(membership.section)) {
      showStatus(`${sectionLabel(membership.section)} is listed more than once. Keep each section only once.`);
      return false;
    }
    seenSections.add(membership.section);
    const row = sectionMembershipRows()[index];
    const nicknameAnswer = q(`input[name="section-nickname-${row.dataset.sectionKey}"]:checked`, row)?.value || '';
    if (!nicknameAnswer) {
      showStatus(`Please answer the section-nickname question for ${sectionLabel(membership.section)}.`);
      return false;
    }
    if (nicknameAnswer === 'yes' && !membership.sectionNickname) {
      showStatus(`Enter your section nickname for ${sectionLabel(membership.section)}.`);
      return false;
    }
    if (sectionRequiresSpecificInstrument(membership.section) && !membership.specificInstrument) {
      showStatus(`Specify the instrument you played in ${sectionLabel(membership.section)}.`);
      return false;
    }
  }
  if (!radioValue('other-gt-ensembles')) {
    showStatus('Please answer whether you have played in Georgia Tech ensembles outside marching band.');
    return false;
  }
  if (radioValue('other-gt-ensembles') === 'yes') {
    if (!q('#other-gt-ensembles-list').value.trim()) {
      showStatus('List the other Georgia Tech ensemble or ensembles you participated in.');
      return false;
    }
    if (!radioValue('different-gt-instrument')) {
      showStatus('Please answer whether you played a different instrument in those other Georgia Tech ensembles.');
      return false;
    }
    if (radioValue('different-gt-instrument') === 'yes' && !q('#other-gt-instruments').value.trim()) {
      showStatus('List the other instrument or instruments you played in Georgia Tech ensembles.');
      return false;
    }
  }
  if (!validateLeadershipQuestionnaire()) return false;
  if (year < 1990 && !radioValue('legacy-system')) {
    showStatus('Please answer whether the RAT/VET pair system applied while you were in band.');
    return false;
  }
  if (!pairSystemApplies()) return true;

  const vet = readVet();
  if (!validateRelationshipRow(vet, 'Your VET')) return false;
  if (!validateRelationshipIdentityConfirmation(vet, 'Your VET', q('#vet-match-panel'))) return false;
  if (radioValue('currently-rat') === 'no') {
    const rats = readRats();
    const ratRows = qa('.rat-entry', q('#rat-rows')).filter((row) => {
      return Boolean(
        q('.rat-name', row).value.trim()
        || q('.rat-section', row).value
        || q('.rat-year', row).value
      );
    });
    for (let index = 0; index < rats.length; index += 1) {
      if (!validateRelationshipRow(rats[index], `RAT row ${index + 1}`, { optional: true })) return false;
      const panel = ratRows[index] ? q('.rat-match-panel', ratRows[index]) : null;
      if (!validateRelationshipIdentityConfirmation(rats[index], `RAT row ${index + 1}`, panel)) return false;
    }
  }
  return true;
}

function validateStep4() {
  if (!radioValue('add-notes')) {
    showStatus('Please answer whether you want to add notes to any of the entries you included.');
    return false;
  }
  return true;
}

function validateCurrentStep() {
  if (state.step === 1) return validateStep1();
  if (state.step === 2) return validateStep2();
  if (state.step === 4) return validateStep4();
  return true;
}

function proposedSubmission() {
  const usePairSystem = pairSystemApplies();
  const currentlyRat = radioValue('currently-rat') === 'yes';
  const rats = usePairSystem && !currentlyRat ? readRats() : [];
  const vet = usePairSystem ? readVet() : null;
  const notes = {};
  for (const target of qa('.note-target')) {
    const checkbox = q('input[type="checkbox"]', target);
    const textarea = q('textarea', target);
    if (checkbox.checked && textarea.value.trim()) notes[target.dataset.targetKey] = textarea.value.trim();
  }
  return {
    version: 7,
    submittedAt: new Date().toISOString(),
    identityDecision: state.selfIdentityDecision || (matchingSelfProfiles().length ? 'unresolved' : 'create'),
    differentPersonIds: [...state.selfDifferentPersonIds],
    existingPersonId: exactExistingPerson()?.id || null,
    self: {
      givenPreferredName: q('#self-given').value.trim(),
      hasNickname: radioValue('has-nickname') === 'yes',
      nickname: radioValue('has-nickname') === 'yes' ? q('#self-nickname').value.trim() : '',
      treeNamePreference: radioValue('has-nickname') === 'yes' ? (radioValue('tree-name-preference') || 'given') : 'given',
      familyMaidenName: q('#self-family').value.trim(),
      marriedName: radioValue('changed-last-name') === 'yes' ? q('#self-married').value.trim() : '',
      changedLastName: radioValue('changed-last-name') === 'yes',
      lastNamePreference: radioValue('changed-last-name') === 'yes' ? (radioValue('tree-last-name-preference') || 'maiden') : 'maiden',
      ratYear: Number(q('#self-rat-year').value),
      section: primarySection(),
      multipleSections: radioValue('multiple-sections') === 'yes',
      sections: readSectionMemberships(),
      currentlyRat,
      otherGtEnsembles: radioValue('other-gt-ensembles') === 'yes',
      otherGtEnsemblesList: radioValue('other-gt-ensembles') === 'yes' ? q('#other-gt-ensembles-list').value.trim() : '',
      playedDifferentGtInstrument: radioValue('other-gt-ensembles') === 'yes' && radioValue('different-gt-instrument') === 'yes',
      otherGtInstruments: radioValue('other-gt-ensembles') === 'yes' && radioValue('different-gt-instrument') === 'yes' ? q('#other-gt-instruments').value.trim() : '',
      positionYear: combinedPositionYear(),
    },
    pairSystem: {
      applies: usePairSystem,
      legacyQuestionAsked: Number(q('#self-rat-year').value) < 1990,
      legacyAnswer: Number(q('#self-rat-year').value) < 1990 ? radioValue('legacy-system') : null,
    },
    vet,
    rats,
    notes,
    favoriteTechBandMemory: q('#favorite-memory').value.trim(),
  };
}

function notePeople() {
  const targets = [{ key: 'self', label: fullSubmittedName(), meta: 'Your entry' }];
  if (pairSystemApplies()) {
    const vet = readVet();
    if (vet.name) targets.push({ key: 'vet', label: vet.name, meta: 'VET' });
    if (radioValue('currently-rat') === 'no') {
      readRats().forEach((rat, index) => {
        if (rat.name) targets.push({ key: rat.key || `rat-${index}`, label: rat.name, meta: 'RAT' });
      });
    }
  }
  return targets;
}

function renderNoteTargets() {
  const container = q('#note-targets');
  const existing = new Map(qa('.note-target', container).map((target) => [target.dataset.targetKey, {
    checked: q('input[type="checkbox"]', target)?.checked,
    note: q('textarea', target)?.value || '',
  }]));
  container.replaceChildren();
  for (const target of notePeople()) {
    const wrapper = document.createElement('div');
    wrapper.className = 'note-target';
    wrapper.dataset.targetKey = target.key;
    const head = document.createElement('label');
    head.className = 'note-target-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const prior = existing.get(target.key);
    checkbox.checked = Boolean(prior?.checked);
    const text = document.createElement('span');
    text.innerHTML = `<strong>${escapeHtml(target.label)}</strong><small>${escapeHtml(target.meta)}</small>`;
    head.append(checkbox, text);
    const textarea = document.createElement('textarea');
    textarea.rows = 3;
    textarea.placeholder = `Add a note to ${target.label}’s entry`;
    textarea.value = prior?.note || '';
    textarea.hidden = !checkbox.checked;
    checkbox.addEventListener('change', () => { textarea.hidden = !checkbox.checked; });
    wrapper.append(head, textarea);
    container.appendChild(wrapper);
  }
  q('#note-targets').hidden = radioValue('add-notes') !== 'yes';
}

function positionAndYearFromPerson(person) {
  if (String(person?.positionAndYear || '').trim()) return String(person.positionAndYear).trim();
  const field = (person?.sourceFields || []).find((item) => String(item?.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '') === 'positionandyear');
  return String(field?.value || '').trim();
}

function canonicalNodeFromPerson(person) {
  return {
    id: person.id,
    name: person.name,
    year: person.ratYear ? Number(person.ratYear) : null,
    section: (person.instruments || [])[0] || 'unknown',
    sections: person.instruments || ['unknown'],
    parentId: person.parentId || null,
    existing: true,
    sourcePerson: person,
    currentlyRat: Boolean(person.currentlyRat),
    positionAndYear: positionAndYearFromPerson(person),
  };
}

function collectExistingTreeNodes(rootId, nodes) {
  const tree = state.trees.get(rootId);
  if (!tree) return;
  for (const id of tree.memberIds || []) {
    const person = state.people.get(id);
    if (person) nodes.set(id, canonicalNodeFromPerson(person));
  }
}

function proposedGraph() {
  const submission = proposedSubmission();
  const nodes = new Map();
  const connectedRoots = new Set();

  const relationIds = [];
  if (submission.existingPersonId) relationIds.push(submission.existingPersonId);
  if (submission.vet?.matchedId) relationIds.push(submission.vet.matchedId);
  for (const rat of submission.rats) if (rat.matchedId) relationIds.push(rat.matchedId);
  for (const id of relationIds) {
    const person = state.people.get(id);
    if (person?.rootId) connectedRoots.add(person.rootId);
  }
  for (const rootId of connectedRoots) collectExistingTreeNodes(rootId, nodes);

  const existingSelf = submission.existingPersonId ? state.people.get(submission.existingPersonId) : null;
  const selfId = existingSelf?.id || 'proposed-self';
  const selfNode = existingSelf ? canonicalNodeFromPerson(existingSelf) : { id: selfId, parentId: null, existing: false };
  selfNode.name = treeCardName();
  selfNode.year = submission.self.ratYear;
  selfNode.section = submission.self.section;
  selfNode.sections = submission.self.sections.map((entry) => entry.section);
  selfNode.role = 'self';
  selfNode.currentlyRat = Boolean(submission.self.currentlyRat) || Boolean(selfNode.currentlyRat);
  selfNode.positionAndYear = submission.self.positionYear || selfNode.positionAndYear || '';
  nodes.set(selfId, selfNode);

  if (submission.pairSystem.applies && submission.vet) {
    let vetId = submission.vet.matchedId;
    if (!vetId) {
      vetId = 'proposed-vet';
      nodes.set(vetId, {
        id: vetId,
        name: submission.vet.name,
        year: submission.vet.year,
        section: submission.vet.section,
        sections: [submission.vet.section],
        parentId: null,
        existing: false,
        role: 'vet',
      });
    }
    selfNode.parentId = vetId;
  }

  submission.rats.forEach((rat, index) => {
    let id = rat.matchedId;
    if (!id) {
      id = `proposed-rat-${index}`;
      nodes.set(id, {
        id,
        name: rat.name,
        year: rat.year,
        section: rat.section,
        sections: [rat.section],
        parentId: selfId,
        existing: false,
        role: 'rat',
      });
    } else {
      const existing = nodes.get(id) || canonicalNodeFromPerson(state.people.get(id));
      existing.parentId = selfId;
      nodes.set(id, existing);
    }
  });

  // Keep only valid parent links. Build children from parentId so proposed edits
  // take precedence over stale childrenIds in the exported tree data.
  for (const node of nodes.values()) {
    if (node.parentId && !nodes.has(node.parentId)) node.parentId = null;
    node.children = [];
  }
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) nodes.get(node.parentId).children.push(node.id);
  }

  state.previewConnectedToExisting = connectedRoots.size > 0;
  return { nodes, connectedRoots, selfId };
}

function nodeOrder(a, b) {
  return (a.year ?? 9999) - (b.year ?? 9999)
    || normalize(a.name.split(' ').slice(-1)[0]).localeCompare(normalize(b.name.split(' ').slice(-1)[0]))
    || normalize(a.name).localeCompare(normalize(b.name));
}

function layoutPreview(graph) {
  const CARD_W = 150;
  const CARD_H = 80;
  const LEAF_GAP = 20;
  const FAMILY_GAP = 120;
  const LEFT = 80;
  const RIGHT = 80;
  const HEADER = 90;
  const ROW_H = 100;
  const nodes = graph.nodes;
  const roots = [...nodes.values()].filter((node) => !node.parentId).sort(nodeOrder);
  const x = new Map();
  let cursor = LEFT;
  const visiting = new Set();

  const place = (node) => {
    if (x.has(node.id)) return;
    if (visiting.has(node.id)) {
      x.set(node.id, cursor);
      cursor += CARD_W + LEAF_GAP;
      return;
    }
    visiting.add(node.id);
    const children = (node.children || []).map((id) => nodes.get(id)).filter(Boolean).sort(nodeOrder);
    if (!children.length) {
      x.set(node.id, cursor);
      cursor += CARD_W + LEAF_GAP;
    } else {
      children.forEach(place);
      x.set(node.id, Math.round(children.reduce((sum, child) => sum + x.get(child.id), 0) / children.length));
    }
    visiting.delete(node.id);
  };
  roots.forEach((root) => { place(root); cursor += FAMILY_GAP; });
  for (const node of nodes.values()) if (!x.has(node.id)) place(node);

  const years = [...nodes.values()].map((node) => node.year).filter(Number.isFinite);
  const minYear = years.length ? Math.min(...years) : new Date().getFullYear();
  const maxYear = years.length ? Math.max(...years) : minYear;
  const y = new Map();
  for (const node of nodes.values()) {
    const index = Number.isFinite(node.year) ? node.year - minYear : maxYear - minYear + 1;
    y.set(node.id, HEADER + index * ROW_H + Math.round((ROW_H - CARD_H) / 2));
  }
  const width = Math.max(600, cursor - FAMILY_GAP + RIGHT);
  const height = HEADER + (maxYear - minYear + 1) * ROW_H;
  return { x, y, width, height, minYear, maxYear, CARD_W, CARD_H, ROW_H, HEADER };
}

function previewBandStyle(year, layout) {
  const exported = (state.data.yearBands || []).find((band) => Number(band.label) === Number(year));
  if (exported) return { color: exported.color, textColor: exported.textColor };
  const known = (state.data.yearBands || []).filter((band) => /^\d{4}$/.test(String(band.label)));
  if (known.length) {
    const base = known[0];
    const palette = known.slice(0, 4);
    const index = ((year - Number(base.label)) % 4 + 4) % 4;
    const sample = palette[index] || base;
    return { color: sample.color, textColor: sample.textColor };
  }
  return { color: '#FFFFFF', textColor: '#111827' };
}

function sectionGradient(sections) {
  const list = (sections || []).length ? sections : ['unknown'];
  const colors = list.map((section) => state.data.sectionColors?.[section] || state.data.sectionGradients?.[section]?.[0] || '#D3D3D3');
  if (colors.length === 1) return colors[0];
  const stops = [];
  colors.forEach((color, index) => {
    const start = (index / colors.length) * 100;
    const end = ((index + 1) / colors.length) * 100;
    stops.push(`${color} ${start}%`, `${color} ${end}%`);
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function addPreviewConnectorSegment(commands, x1, y1, x2, y2) {
  commands.push(`M ${x1} ${y1} L ${x2} ${y2}`);
}

function appendPreviewConnectorPath(svg, commands, width = 6) {
  if (!commands.length) return;
  const ns = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(ns, 'defs');
  const filter = document.createElementNS(ns, 'filter');
  filter.id = 'preview-connector-outline-filter';
  filter.setAttribute('x', '-10%'); filter.setAttribute('y', '-10%');
  filter.setAttribute('width', '120%'); filter.setAttribute('height', '120%');
  const dilate = document.createElementNS(ns, 'feMorphology');
  dilate.setAttribute('in', 'SourceAlpha'); dilate.setAttribute('operator', 'dilate');
  dilate.setAttribute('radius', '4'); dilate.setAttribute('result', 'expanded');
  const ring = document.createElementNS(ns, 'feComposite');
  ring.setAttribute('in', 'expanded'); ring.setAttribute('in2', 'SourceAlpha');
  ring.setAttribute('operator', 'out'); ring.setAttribute('result', 'outlineMask');
  const flood = document.createElementNS(ns, 'feFlood');
  flood.setAttribute('flood-color', '#808080'); flood.setAttribute('flood-opacity', '0.50');
  flood.setAttribute('result', 'outlineColor');
  const mask = document.createElementNS(ns, 'feComposite');
  mask.setAttribute('in', 'outlineColor'); mask.setAttribute('in2', 'outlineMask');
  mask.setAttribute('operator', 'in'); mask.setAttribute('result', 'outline');
  const merge = document.createElementNS(ns, 'feMerge');
  const outlineNode = document.createElementNS(ns, 'feMergeNode'); outlineNode.setAttribute('in', 'outline');
  const sourceNode = document.createElementNS(ns, 'feMergeNode'); sourceNode.setAttribute('in', 'SourceGraphic');
  merge.append(outlineNode, sourceNode);
  filter.append(dilate, ring, flood, mask, merge); defs.appendChild(filter); svg.appendChild(defs);

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', commands.join(' '));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#000000');
  path.setAttribute('stroke-width', String(width));
  path.setAttribute('stroke-linecap', 'square');
  path.setAttribute('stroke-linejoin', 'miter');
  path.setAttribute('filter', 'url(#preview-connector-outline-filter)');
  svg.appendChild(path);
}

function submissionMergeDescription() {
  const duplicate = exactExistingPerson(fullSubmittedName(), q('#self-rat-year').value, primarySection());
  if (duplicate) return 'You confirmed that this is your existing profile. New people/relationships use dashed outlines and will be merged into it.';
  return 'Existing cards come from the current tree. Cards with a dashed outline are the new people/relationships you entered.';
}

function renderPreview() {
  const graph = proposedGraph();
  state.previewGraph = graph;
  const layout = layoutPreview(graph);
  const host = q('#preview-tree');
  host.replaceChildren();

  const stage = document.createElement('div');
  stage.className = 'preview-stage';
  stage.style.width = `${layout.width}px`;
  stage.style.height = `${layout.height}px`;

  for (let year = layout.minYear; year <= layout.maxYear; year += 1) {
    const band = document.createElement('div');
    band.className = 'preview-year-band';
    band.style.top = `${layout.HEADER + (year - layout.minYear) * layout.ROW_H}px`;
    band.style.height = `${layout.ROW_H}px`;
    const colors = previewBandStyle(year, layout);
    band.style.background = colors.color;
    const label = document.createElement('span');
    label.textContent = String(year);
    label.style.color = colors.textColor;
    band.appendChild(label);
    stage.appendChild(band);
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('preview-connectors');
  svg.setAttribute('width', layout.width);
  svg.setAttribute('height', layout.height);
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  stage.appendChild(svg);

  const connectorCommands = [];
  for (const parent of graph.nodes.values()) {
    const children = (parent.children || []).map((id) => graph.nodes.get(id)).filter(Boolean).sort(nodeOrder);
    if (!children.length) continue;
    const px = layout.x.get(parent.id) + layout.CARD_W / 2;
    const py = layout.y.get(parent.id) + layout.CARD_H - 2;
    const childPoints = children.map((child) => ({
      x: layout.x.get(child.id) + layout.CARD_W / 2,
      y: layout.y.get(child.id) + 1,
    }));
    if (children.length === 1 && childPoints[0].x === px) {
      addPreviewConnectorSegment(connectorCommands, px, py, childPoints[0].x, childPoints[0].y);
    } else {
      const nearestY = Math.min(...childPoints.map((point) => point.y));
      const junctionY = py + Math.max(10, Math.floor((nearestY - py) / 2));
      addPreviewConnectorSegment(connectorCommands, px, py, px, junctionY);
      addPreviewConnectorSegment(connectorCommands, Math.min(...childPoints.map((point) => point.x)), junctionY, Math.max(...childPoints.map((point) => point.x)), junctionY);
      childPoints.forEach((point) => addPreviewConnectorSegment(connectorCommands, point.x, junctionY, point.x, point.y));
    }
  }
  appendPreviewConnectorPath(svg, connectorCommands);

  for (const node of graph.nodes.values()) {
    const card = document.createElement('div');
    card.className = `preview-card ${node.existing ? 'existing' : 'proposed'}`;
    if (node.id === graph.selfId) card.classList.add('preview-self');
    card.style.left = `${layout.x.get(node.id)}px`;
    card.style.top = `${layout.y.get(node.id)}px`;
    card.style.width = `${layout.CARD_W}px`;
    card.style.height = `${layout.CARD_H}px`;
    card.style.background = sectionGradient(node.sections);
    const name = document.createElement('span');
    name.textContent = node.sourcePerson?.displayName || node.name;
    card.appendChild(name);

    const iconKinds = Array.isArray(node.sourcePerson?.leadershipIcons)
      ? [...node.sourcePerson.leadershipIcons]
      : previewPositionYearIconKinds(node.positionAndYear || '');
    if (node.sourcePerson?.bandClubLeadership && !iconKinds.includes('band-club')) iconKinds.push('band-club');
    const roleIcons = assignPreviewIconSlots(iconKinds.map(createPreviewRoleIcon).filter(Boolean));
    for (const icon of roleIcons) card.appendChild(icon);

    stage.appendChild(card);
  }

  host.appendChild(stage);
  const question = q('#preview-question');
  const description = q('#preview-description');
  if (state.previewConnectedToExisting) {
    question.textContent = 'I connected you to a larger tree. Does this look right?';
    description.textContent = submissionMergeDescription();
  } else {
    question.textContent = 'Does this look right?';
    description.textContent = 'This preview contains the people and relationships you entered. Cards with a dashed outline are new entries.';
  }

  const duplicate = exactExistingPerson();
  const warning = q('#preview-warning');
  if (duplicate) {
    warning.innerHTML = `A record for <strong>${escapeHtml(relationshipCandidateDisplayName(duplicate))}</strong> (${escapeHtml(relationshipCandidateYearLabel(duplicate))}) already exists. This preview represents information that will be merged into the existing profile rather than creating a duplicate card.`;
    warning.hidden = false;
  } else {
    if (state.selfIdentityDecision === 'create' && matchingSelfProfiles().length) {
      warning.textContent = 'You confirmed this is a different person. A separate card will be created, even though the name and RAT year match.';
      warning.hidden = false;
    } else {
      warning.hidden = true;
    }
  }

  requestAnimationFrame(() => {
    const available = Math.max(320, host.clientWidth - 20);
    if (layout.width > available) {
      const scale = Math.max(.32, Math.min(1, available / layout.width));
      stage.style.transform = `scale(${scale})`;
      stage.style.transformOrigin = 'top left';
      host.style.setProperty('--preview-scaled-height', `${layout.height * scale}px`);
    } else {
      stage.style.transform = '';
      host.style.setProperty('--preview-scaled-height', `${layout.height}px`);
    }
  });
}

function summaryRow(label, value) {
  if (value === null || value === undefined || String(value).trim() === '') return '';
  return `<div class="summary-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`;
}

function renderSubmissionSummary() {
  const data = proposedSubmission();
  const container = q('#submission-summary');
  const rats = data.rats.map((rat) => `${rat.name} (${rat.year}) (${sectionLabel(rat.section)})`).join('; ') || 'None';
  const vet = data.vet ? `${data.vet.name} (${data.vet.year}) (${sectionLabel(data.vet.section)})` : 'Not applicable';
  const notesCount = Object.keys(data.notes).length;
  container.innerHTML = [
    summaryRow('Name', `${data.self.givenPreferredName} ${data.self.familyMaidenName}`),
    summaryRow('Nickname', data.self.nickname),
    summaryRow('Tree card name', treeCardName()),
    summaryRow('Married Name', data.self.marriedName),
    summaryRow('Card last name', data.self.changedLastName ? data.self.lastNamePreference : 'Family/Last Name'),
    summaryRow('RAT Year', data.self.ratYear),
    summaryRow('Sections', data.self.sections.map((entry) => {
      const details = [];
      if (entry.sectionNickname) details.push(`section nickname: ${entry.sectionNickname}`);
      if (entry.specificInstrument) details.push(`instrument: ${entry.specificInstrument}`);
      return `${sectionLabel(entry.section)}${details.length ? ` (${details.join(', ')})` : ''}`;
    }).join('; ')),
    summaryRow('Other GT ensembles', data.self.otherGtEnsembles ? data.self.otherGtEnsemblesList : 'No'),
    summaryRow('Different instrument in other GT ensembles', data.self.otherGtEnsembles ? (data.self.playedDifferentGtInstrument ? `Yes — ${data.self.otherGtInstruments}` : 'No') : 'Not applicable'),
    summaryRow('Position and Year', data.self.positionYear || 'None reported'),
    summaryRow('Currently a RAT', data.self.currentlyRat ? 'Yes' : 'No'),
    summaryRow('RAT/VET system', data.pairSystem.applies ? 'Yes' : 'No / not applicable'),
    summaryRow('VET', vet),
    summaryRow('RATs', rats),
    summaryRow('Additional notes', notesCount ? `${notesCount} entr${notesCount === 1 ? 'y' : 'ies'}` : 'None'),
    summaryRow('Favorite Tech Band Memory', data.favoriteTechBandMemory || 'No memory entered'),
  ].join('');

  q('#submission-github-note').innerHTML = 'Your authenticated submission is placed in the protected update queue after required-field and abuse checks. <strong>Existing people must be explicitly confirmed when the site finds a matching VET/RAT identity.</strong> Confirmed VET/RAT relationships are mirrored automatically, and missing related people can be created when safe. Every applied change is recorded in the protected admin changelog. Changes may take a few minutes to appear on the live tree.';
}

function renderTurnstile() {
  const host = q('#turnstile-container');
  if (!host) return;
  const sitekey = String(state.config.turnstileSiteKey || '').trim();
  if (!sitekey) { host.hidden = true; return; }
  host.hidden = false;
  const tryRender = () => {
    if (!window.turnstile?.render) { setTimeout(tryRender, 150); return; }
    if (state.turnstileWidgetId !== null) return;
    state.turnstileWidgetId = window.turnstile.render(host, {
      sitekey,
      theme: 'auto',
      callback: (token) => { state.turnstileToken = token; },
      'expired-callback': () => { state.turnstileToken = ''; },
      'error-callback': () => { state.turnstileToken = ''; },
    });
  };
  tryRender();
}

function buildIssueBody(payload) {
  const selfName = `${payload.self.givenPreferredName} ${payload.self.familyMaidenName}`.trim();
  const lines = [
    '# YJMB family-tree addition',
    '',
    `**Person:** ${selfName}`,
    `**Nickname:** ${payload.self.nickname || 'None'}`,
    `**Tree card name preference:** ${payload.self.treeNamePreference}`,
    `**RAT year:** ${payload.self.ratYear}`,
    `**Sections:** ${payload.self.sections.map((entry) => {
      const extras = [];
      if (entry.sectionNickname) extras.push(`section nickname: ${entry.sectionNickname}`);
      if (entry.specificInstrument) extras.push(`instrument: ${entry.specificInstrument}`);
      return `${sectionLabel(entry.section)}${extras.length ? ` (${extras.join(', ')})` : ''}`;
    }).join('; ')}`,
    `**Other GT ensembles:** ${payload.self.otherGtEnsembles ? payload.self.otherGtEnsemblesList : 'No'}`,
    `**Different instrument in other GT ensembles:** ${payload.self.otherGtEnsembles ? (payload.self.playedDifferentGtInstrument ? `Yes — ${payload.self.otherGtInstruments}` : 'No') : 'Not applicable'}`,
    `**Position and Year:** ${payload.self.positionYear || 'None reported'}`,
    `**Currently a RAT:** ${payload.self.currentlyRat ? 'Yes' : 'No'}`,
    `**RAT/VET system applies:** ${payload.pairSystem.applies ? 'Yes' : 'No'}`,
    '',
    '> If a submitted VET or RAT does not yet exist, the protected updater can create that person’s row/card and reciprocate the new relationship. Existing related profiles are not silently overwritten.',
  ];
  if (payload.self.marriedName) lines.push(`**Married name:** ${payload.self.marriedName}`);
  if (payload.vet) lines.push(`**VET:** ${payload.vet.name} (${payload.vet.year}) (${sectionLabel(payload.vet.section)})`);
  if (payload.rats.length) {
    lines.push('', '## RATs');
    payload.rats.forEach((rat) => lines.push(`- ${rat.name} (${rat.year}) (${sectionLabel(rat.section)})`));
  }
  if (payload.favoriteTechBandMemory) lines.push('', '## Favorite Tech Band Memory', '', payload.favoriteTechBandMemory);
  if (Object.keys(payload.notes).length) {
    lines.push('', '## Notes supplied for included entries');
    for (const [target, note] of Object.entries(payload.notes)) lines.push(`- **${target}:** ${note}`);
  }
  lines.push(
    '',
    '---',
    'The machine-readable block below is preserved for administrator processing. Please do not edit it.',
    '',
    '<!-- YJMB_TREE_SUBMISSION_JSON_BEGIN',
    JSON.stringify(payload),
    'YJMB_TREE_SUBMISSION_JSON_END -->',
  );
  return lines.join('\n');
}

async function submitRequest() {
  clearStatus();
  if (!validateStep1() || !validateStep2() || !validateStep4()) return;
  updateExistingSelfWarning();
  if (matchingSelfProfiles().length && !state.selfIdentityDecision) {
    showStatus('Confirm whether an existing profile is yours before submitting.');
    return;
  }
  const payload = proposedSubmission();
  const button = q('#submit-tree-request');
  button.disabled = true;
  showStatus('Checking the authenticated submission and abuse safeguards…', 'info');
  try {
    const result = await window.YJMBSecureData.apiFetch('/submit', {
      method: 'POST',
      body: JSON.stringify({ payload, turnstileToken: state.turnstileToken || '' }),
    });
    if (result.status === 'local-preview') {
      showStatus('Local dry run successful. Nothing was submitted, saved, or published.', 'info');
      button.textContent = 'Local test complete';
    } else if (result.status === 'auto') {
      showStatus('Submission accepted. Your confirmed identity choice will be honored; missing related people are added only when safe. Changes may take a few minutes to appear.', 'info');
      button.textContent = 'Accepted';
    } else {
      showStatus('The protected updater found a structural conflict and held this submission for administrator review. Changes that are approved may take a few minutes to appear.', 'info');
      button.textContent = 'Held for review';
    }
    button.disabled = true;
  } catch (error) {
    console.error(error);
    if (error?.code === 'AUTH_REQUIRED') {
      sessionStorage.setItem('yjmbReturnTo', 'add-yourself.html');
      window.location.replace('index.html');
      return;
    }
    showStatus(`Could not submit the tree addition: ${error.message}`);
    button.disabled = false;
    if (state.turnstileWidgetId !== null && window.turnstile?.reset) {
      window.turnstile.reset(state.turnstileWidgetId);
      state.turnstileToken = '';
    }
  }
}

function bindEvents() {
  qa('[data-next]').forEach((button) => button.addEventListener('click', () => {
    if (!validateCurrentStep()) return;
    setStep(state.step + 1);
  }));
  qa('[data-back]').forEach((button) => button.addEventListener('click', () => setStep(state.step - 1)));

  qa('input[name="changed-last-name"]').forEach((input) => input.addEventListener('change', changedLastNameUpdated));
  qa('input[name="has-nickname"]').forEach((input) => input.addEventListener('change', updateNicknameVisibility));
  qa('input[name="multiple-sections"]').forEach((input) => input.addEventListener('change', updateMultipleSectionsVisibility));
  qa('input[name="other-gt-ensembles"]').forEach((input) => input.addEventListener('change', updateOtherGtEnsembleVisibility));
  qa('input[name="different-gt-instrument"]').forEach((input) => input.addEventListener('change', updateDifferentGtInstrumentVisibility));
  qa('input[name="currently-rat"]').forEach((input) => input.addEventListener('change', updateRelationshipVisibility));
  qa('input[name="legacy-system"]').forEach((input) => input.addEventListener('change', updateRelationshipVisibility));
  q('#self-rat-year').addEventListener('change', updateRelationshipVisibility);
  q('#add-section').addEventListener('click', () => addSectionMembership());
  q('#add-leadership').addEventListener('click', () => addLeadershipEntry());
  qa('input[name="band-club-leadership"]').forEach((input) => input.addEventListener('change', updateBandClubLeadershipVisibility));
  q('#add-band-club-leadership').addEventListener('click', () => addBandClubLeadershipEntry());
  q('#position-year').addEventListener('input', updateCombinedPositionYearPreview);
  q('#self-given').addEventListener('input', updateExistingSelfWarning);
  q('#self-family').addEventListener('input', updateExistingSelfWarning);

  ['#vet-name', '#vet-section', '#vet-year'].forEach((selector) => {
    q(selector).addEventListener(selector === '#vet-name' ? 'input' : 'change', () => {
      if (state.vetMatch) {
        state.vetRejectedIds.clear();
        state.vetMatch = null;
      }
      updateVetMatch();
    });
  });
  q('#add-rat').addEventListener('click', () => addRatRow());

  qa('input[name="add-notes"]').forEach((input) => input.addEventListener('change', () => {
    renderNoteTargets();
    q('#note-targets').hidden = radioValue('add-notes') !== 'yes';
  }));

  q('#preview-no').addEventListener('click', () => setStep(1));
  q('#preview-yes').addEventListener('click', () => setStep(4));
  q('#submit-tree-request').addEventListener('click', submitRequest);
}

async function main() {
  try {
    const [data, configResponse] = await Promise.all([
      window.YJMBSecureData.loadTreeData(),
      fetch('site_config.json').catch(() => null),
    ]);
    state.data = data;
    state.people = new Map(state.data.people.map((person) => [person.id, person]));
    state.trees = new Map((state.data.trees || []).map((tree) => [tree.rootId, tree]));
    if (configResponse?.ok) state.config = await configResponse.json();
    initializeSelects();
    addRatRow();
    bindEvents();
    changedLastNameUpdated();
    updateNicknameVisibility();
    updateOtherGtEnsembleVisibility();
    updateBandClubLeadershipVisibility();
    updateCombinedPositionYearPreview();
    refreshSectionMemberships();
    updateRelationshipVisibility();
    setStep(1, { scroll: false });
  } catch (error) {
    console.error(error);
    if (error?.code === 'AUTH_REQUIRED') { sessionStorage.setItem('yjmbReturnTo', 'add-yourself.html'); window.location.replace('index.html'); return; }
    showStatus(`${error.message} Run a local HTTP server instead of opening this HTML file directly.`);
    qa('button, input, select, textarea').forEach((control) => { control.disabled = true; });
  }
}

main();
