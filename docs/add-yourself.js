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
  vetRejectedId: null,
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
    'sax/saxophone': 'Sax/Saxophone',
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

function sectionNeedsSpecificInstrument(section) {
  return section === 'front ensemble' || section === 'battery';
}

function updateSectionMembershipRow(row) {
  const section = q('.membership-section', row).value;
  const instrumentWrap = q('.specific-instrument-wrap', row);
  const instrumentInput = q('.specific-instrument', row);
  const label = q('.specific-instrument-label', row);
  const needsInstrument = sectionNeedsSpecificInstrument(section);
  instrumentWrap.hidden = !needsInstrument;
  instrumentInput.required = needsInstrument;
  if (section === 'front ensemble') {
    label.textContent = 'What instrument did you play in Front Ensemble/Pit?';
    instrumentInput.placeholder = 'e.g., marimba, vibraphone, synth, rack percussion';
  } else if (section === 'battery') {
    label.textContent = 'What instrument did you play in Battery/Drumline?';
    instrumentInput.placeholder = 'e.g., snare, tenors/quads, bass drum, cymbals';
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
      specificInstrument: sectionNeedsSpecificInstrument(section) ? q('.specific-instrument', row).value.trim() : '',
    };
  });
}

function treeCardGivenName() {
  const nickname = q('#self-nickname').value.trim();
  return radioValue('has-nickname') === 'yes' && radioValue('tree-name-preference') === 'nickname' && nickname
    ? nickname
    : q('#self-given').value.trim();
}

function treeCardName() {
  return [treeCardGivenName(), q('#self-family').value.trim()].filter(Boolean).join(' ');
}

function selectedLeadershipRoles() {
  return qa('input[name="leadership-role"]:checked').map((input) => input.value);
}

function leadershipIconKinds(formalRoles, hasInformal) {
  const roles = new Set(formalRoles || []);
  const kinds = [];
  if (roles.has('Section Leader')) kinds.push('section-leader');
  if (roles.has('Drum Major')) kinds.push('drum-major');
  if (roles.has('RAT Parent')) kinds.push('rat-parent');
  if (hasInformal) kinds.push('informal-leadership');
  if ([...roles].some((role) => !['Section Leader', 'Drum Major', 'RAT Parent'].includes(role))) kinds.push('other-leadership');
  return kinds;
}

function previewLeadershipIconSvg(kind) {
  const attrs = 'viewBox="0 0 18 18" aria-hidden="true"';
  if (kind === 'section-leader') return `<svg ${attrs}><path d="M2 4.5 9 1.5l7 3M2 9 9 6l7 3M2 13.5l7-3 7 3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
  if (kind === 'drum-major') return `<svg ${attrs}><path d="M4 15 14.5 3.5M2 6l4-3M2 10l5-3" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="15" cy="3" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
  if (kind === 'rat-parent') return `<svg ${attrs}><circle cx="9" cy="3.5" r="2" fill="currentColor"/><circle cx="4" cy="14" r="2" fill="currentColor"/><circle cx="14" cy="14" r="2" fill="currentColor"/><path d="M9 5.5v4M4 9.5h10M4 9.5V12M14 9.5V12" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
  if (kind === 'informal-leadership') return `<svg ${attrs}><path d="M2 8.5 10 4v9L2 9.5Zm8-.8h2.5v1.8H10M5 10l2 5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M14 5.5 17 4M14 9h3.5M14 12.5l3 1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;
  return `<svg ${attrs}><path d="m9 1.5 2.1 4.4 4.9.7-3.5 3.4.8 4.9L9 12.6l-4.3 2.3.8-4.9L2 6.6l4.9-.7Z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
}

function appendPreviewLeadershipIcons(card, kinds) {
  for (const kind of kinds || []) {
    const icon = document.createElement('span');
    icon.className = `preview-leadership-icon leadership-${kind}`;
    icon.innerHTML = previewLeadershipIconSvg(kind);
    card.appendChild(icon);
  }
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

function updateInformalLeadershipVisibility() {
  const informal = radioValue('informal-leadership') === 'yes';
  q('#informal-leadership-wrap').hidden = !informal;
  q('#informal-leadership-description').required = informal;
  if (!informal) q('#informal-leadership-description').value = '';
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
  q('#self-family-label').textContent = yes ? 'Family/Maiden Name' : 'Family/Last Name';
  q('#self-family').placeholder = yes ? 'Family/Maiden Name' : 'Family/Last Name';
  q('#self-married').required = yes;
  if (!yes) q('#self-married').value = '';
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
  const name = normalize(person.name);
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
    .sort((a, b) => b.score - a.score || a.person.name.localeCompare(b.person.name));
  if (!ranked.length) return null;
  if (requireClearWinner && ranked[1] && ranked[0].score - ranked[1].score < 4 && ranked[0].score < 100) return null;
  return ranked[0].person;
}

function bestVetCandidate() {
  return bestRelationshipCandidate(
    q('#vet-name').value.trim(),
    q('#vet-section').value,
    q('#vet-year').value,
    state.vetRejectedId ? new Set([state.vetRejectedId]) : new Set(),
  );
}

function clearVetMatch() {
  state.vetMatch = null;
  const panel = q('#vet-match-panel');
  panel.hidden = true;
  panel.replaceChildren();
}

function updateVetMatch() {
  clearVetMatch();
  if (q('#relationship-questions').hidden) return;
  const candidate = bestVetCandidate();
  if (!candidate || candidate.id === state.vetRejectedId) return;

  const panel = q('#vet-match-panel');
  const prompt = document.createElement('p');
  prompt.textContent = `I think I found your VET in our system. Is your VET ${candidate.name} (${candidate.ratYearLabel}, ${candidate.instrumentRaw || 'Unknown section'})?`;
  const actions = document.createElement('div');
  actions.className = 'inline-actions';
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'primary-button small-button';
  yes.textContent = 'Yes';
  yes.addEventListener('click', () => {
    state.vetMatch = candidate;
    state.vetRejectedId = null;
    q('#vet-name').value = candidate.name;
    q('#vet-section').value = (candidate.instruments || [])[0] || q('#vet-section').value;
    if (candidate.ratYear) q('#vet-year').value = String(candidate.ratYear);
    panel.classList.add('match-confirmed');
    panel.replaceChildren();
    const confirmed = document.createElement('p');
    confirmed.innerHTML = `<strong>Matched:</strong> ${escapeHtml(candidate.name)} (${escapeHtml(candidate.ratYearLabel)})`;
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'secondary-button small-button';
    undo.textContent = 'Not them';
    undo.addEventListener('click', () => {
      state.vetRejectedId = candidate.id;
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
    state.vetRejectedId = candidate.id;
    clearVetMatch();
  });
  actions.append(yes, no);
  panel.append(prompt, actions);
  panel.hidden = false;
}

function exactExistingPerson(name, year, section = '') {
  const normalizedName = normalize(name);
  if (!normalizedName) return null;
  const candidates = state.data.people.filter((person) => normalize(person.name) === normalizedName);
  const byYear = year ? candidates.filter((person) => Number(person.ratYear) === Number(year)) : candidates;
  const bySection = section ? byYear.filter((person) => personSectionMatches(person, section)) : byYear;
  if (bySection.length === 1) return bySection[0];
  if (byYear.length === 1) return byYear[0];
  if (!year && candidates.length === 1) return candidates[0];
  return null;
}

function updateExistingSelfWarning() {
  const panel = q('#existing-self-warning');
  const name = fullSubmittedName();
  const year = q('#self-rat-year').value;
  if (!name || !year) {
    panel.hidden = true;
    return;
  }
  const match = exactExistingPerson(name, year, primarySection());
  if (!match) {
    panel.hidden = true;
    return;
  }
  panel.innerHTML = `A record for <strong>${escapeHtml(match.name)}</strong> (${escapeHtml(match.ratYearLabel)}) already exists. If this is you, use the correction link on your existing profile instead of submitting a duplicate.`;
  panel.hidden = false;
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
    confirmed.innerHTML = `<strong>Matched RAT:</strong> ${escapeHtml(candidate.name)} (${escapeHtml(candidate.ratYearLabel)}, ${escapeHtml(candidate.instrumentRaw || 'Unknown section')})`;
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
    prompt.textContent = `I think I found your RAT in our system. Is your RAT ${candidate.name} (${candidate.ratYearLabel}, ${candidate.instrumentRaw || 'Unknown section'})?`;
    const actions = document.createElement('div');
    actions.className = 'inline-actions';

    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'primary-button small-button';
    yes.textContent = 'Yes';
    yes.addEventListener('click', () => {
      row._suppressRatMatchUpdate = true;
      name.value = candidate.name;
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
      showStatus('Choose whether your tree card should use your First/Preferred Name or your Nickname.');
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
    if (sectionNeedsSpecificInstrument(membership.section) && !membership.specificInstrument) {
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
  if (!radioValue('informal-leadership')) {
    showStatus('Please answer whether you have served in any informal leadership positions in marching band.');
    return false;
  }
  if (radioValue('informal-leadership') === 'yes' && !q('#informal-leadership-description').value.trim()) {
    showStatus('Describe the informal leadership position or responsibilities you served in.');
    return false;
  }
  if (year < 1990 && !radioValue('legacy-system')) {
    showStatus('Please answer whether the RAT/VET pair system applied while you were in band.');
    return false;
  }
  if (!pairSystemApplies()) return true;

  const vet = readVet();
  if (!validateRelationshipRow(vet, 'Your VET')) return false;
  if (radioValue('currently-rat') === 'no') {
    const rats = readRats();
    for (let index = 0; index < rats.length; index += 1) {
      if (!validateRelationshipRow(rats[index], `RAT row ${index + 1}`, { optional: true })) return false;
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
    version: 3,
    submittedAt: new Date().toISOString(),
    self: {
      givenPreferredName: q('#self-given').value.trim(),
      hasNickname: radioValue('has-nickname') === 'yes',
      nickname: radioValue('has-nickname') === 'yes' ? q('#self-nickname').value.trim() : '',
      treeNamePreference: radioValue('has-nickname') === 'yes' ? (radioValue('tree-name-preference') || 'given') : 'given',
      familyMaidenName: q('#self-family').value.trim(),
      marriedName: radioValue('changed-last-name') === 'yes' ? q('#self-married').value.trim() : '',
      changedLastName: radioValue('changed-last-name') === 'yes',
      ratYear: Number(q('#self-rat-year').value),
      section: primarySection(),
      multipleSections: radioValue('multiple-sections') === 'yes',
      sections: readSectionMemberships(),
      currentlyRat,
      otherGtEnsembles: radioValue('other-gt-ensembles') === 'yes',
      otherGtEnsemblesList: radioValue('other-gt-ensembles') === 'yes' ? q('#other-gt-ensembles-list').value.trim() : '',
      playedDifferentGtInstrument: radioValue('other-gt-ensembles') === 'yes' && radioValue('different-gt-instrument') === 'yes',
      otherGtInstruments: radioValue('other-gt-ensembles') === 'yes' && radioValue('different-gt-instrument') === 'yes' ? q('#other-gt-instruments').value.trim() : '',
      marchingBandLeadershipRoles: selectedLeadershipRoles(),
      informalLeadership: radioValue('informal-leadership') === 'yes',
      informalLeadershipDescription: radioValue('informal-leadership') === 'yes' ? q('#informal-leadership-description').value.trim() : '',
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

function canonicalNodeFromPerson(person) {
  return {
    id: person.id,
    name: person.name,
    year: person.ratYear ? Number(person.ratYear) : null,
    section: (person.instruments || [])[0] || 'unknown',
    sections: person.instruments || ['unknown'],
    parentId: person.parentId || null,
    existing: true,
    image: person.card?.image || null,
    sourcePerson: person,
    leadershipIcons: person.leadershipIcons || [],
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
  if (submission.vet?.matchedId) relationIds.push(submission.vet.matchedId);
  for (const rat of submission.rats) if (rat.matchedId) relationIds.push(rat.matchedId);
  for (const id of relationIds) {
    const person = state.people.get(id);
    if (person?.rootId) connectedRoots.add(person.rootId);
  }
  for (const rootId of connectedRoots) collectExistingTreeNodes(rootId, nodes);

  const selfId = 'proposed-self';
  const selfNode = {
    id: selfId,
    name: treeCardName(),
    year: submission.self.ratYear,
    section: submission.self.section,
    sections: submission.self.sections.map((entry) => entry.section),
    parentId: null,
    existing: false,
    role: 'self',
    leadershipIcons: leadershipIconKinds(submission.self.marchingBandLeadershipRoles, submission.self.informalLeadership),
  };
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
  const colors = list.map((section) => state.data.sectionColors?.[section] || '#D3D3D3');
  if (colors.length === 1) return colors[0];
  const stops = [];
  colors.forEach((color, index) => {
    const start = (index / colors.length) * 100;
    const end = ((index + 1) / colors.length) * 100;
    stops.push(`${color} ${start}%`, `${color} ${end}%`);
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function line(svg, x1, y1, x2, y2, width = 6) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  el.setAttribute('x1', x1);
  el.setAttribute('y1', y1);
  el.setAttribute('x2', x2);
  el.setAttribute('y2', y2);
  el.setAttribute('stroke', state.data.connectorColor || '#777777');
  el.setAttribute('stroke-width', width);
  el.setAttribute('stroke-linecap', 'square');
  svg.appendChild(el);
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
      line(svg, px, py, childPoints[0].x, childPoints[0].y);
    } else {
      const nearestY = Math.min(...childPoints.map((point) => point.y));
      const junctionY = py + Math.max(10, Math.floor((nearestY - py) / 2));
      line(svg, px, py, px, junctionY);
      line(svg, Math.min(...childPoints.map((point) => point.x)), junctionY, Math.max(...childPoints.map((point) => point.x)), junctionY);
      childPoints.forEach((point) => line(svg, point.x, junctionY, point.x, point.y));
    }
  }

  for (const node of graph.nodes.values()) {
    const card = document.createElement('div');
    card.className = `preview-card ${node.existing ? 'existing' : 'proposed'}`;
    if (node.id === graph.selfId) card.classList.add('preview-self');
    card.style.left = `${layout.x.get(node.id)}px`;
    card.style.top = `${layout.y.get(node.id)}px`;
    card.style.width = `${layout.CARD_W}px`;
    card.style.height = `${layout.CARD_H}px`;
    if (node.existing && node.image) {
      const image = document.createElement('img');
      image.src = node.image;
      image.alt = node.name;
      card.appendChild(image);
    } else {
      card.style.background = sectionGradient(node.sections);
      const name = document.createElement('span');
      name.textContent = node.name;
      card.appendChild(name);
    }
    appendPreviewLeadershipIcons(card, node.leadershipIcons || []);
    stage.appendChild(card);
  }

  host.appendChild(stage);
  const question = q('#preview-question');
  const description = q('#preview-description');
  if (state.previewConnectedToExisting) {
    question.textContent = 'I connected you to a larger tree. Does this look right?';
    description.textContent = 'Existing cards come from the current tree. Cards with a dashed outline are the new people/relationships you entered.';
  } else {
    question.textContent = 'Does this look right?';
    description.textContent = 'This preview contains the people and relationships you entered. Cards with a dashed outline are new entries.';
  }

  const duplicate = exactExistingPerson(fullSubmittedName(), q('#self-rat-year').value, primarySection());
  const warning = q('#preview-warning');
  if (duplicate) {
    warning.innerHTML = `A record for <strong>${escapeHtml(duplicate.name)}</strong> (${escapeHtml(duplicate.ratYearLabel)}) already exists. Submitting another copy will be rejected by the database updater; use the correction page if this is the same person.`;
    warning.hidden = false;
  } else {
    warning.hidden = true;
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
  const rats = data.rats.map((rat) => `${rat.name} (${rat.year}, ${sectionLabel(rat.section)})`).join('; ') || 'None';
  const vet = data.vet ? `${data.vet.name} (${data.vet.year}, ${sectionLabel(data.vet.section)})` : 'Not applicable';
  const notesCount = Object.keys(data.notes).length;
  container.innerHTML = [
    summaryRow('Name', `${data.self.givenPreferredName} ${data.self.familyMaidenName}`),
    summaryRow('Nickname', data.self.nickname),
    summaryRow('Tree card name', treeCardName()),
    summaryRow('Married Name', data.self.marriedName),
    summaryRow('RAT Year', data.self.ratYear),
    summaryRow('Sections', data.self.sections.map((entry) => {
      const details = [];
      if (entry.sectionNickname) details.push(`section nickname: ${entry.sectionNickname}`);
      if (entry.specificInstrument) details.push(`instrument: ${entry.specificInstrument}`);
      return `${sectionLabel(entry.section)}${details.length ? ` (${details.join(', ')})` : ''}`;
    }).join('; ')),
    summaryRow('Other GT ensembles', data.self.otherGtEnsembles ? data.self.otherGtEnsemblesList : 'No'),
    summaryRow('Different instrument in other GT ensembles', data.self.otherGtEnsembles ? (data.self.playedDifferentGtInstrument ? `Yes — ${data.self.otherGtInstruments}` : 'No') : 'Not applicable'),
    summaryRow('Marching band leadership roles', data.self.marchingBandLeadershipRoles.length ? data.self.marchingBandLeadershipRoles.join(', ') : 'None reported'),
    summaryRow('Informal leadership', data.self.informalLeadership ? `Yes — ${data.self.informalLeadershipDescription}` : 'No'),
    summaryRow('Currently a RAT', data.self.currentlyRat ? 'Yes' : 'No'),
    summaryRow('RAT/VET system', data.pairSystem.applies ? 'Yes' : 'No / not applicable'),
    summaryRow('VET', vet),
    summaryRow('RATs', rats),
    summaryRow('Additional notes', notesCount ? `${notesCount} entr${notesCount === 1 ? 'y' : 'ies'}` : 'None'),
    summaryRow('Favorite Tech Band Memory', data.favoriteTechBandMemory || 'No memory entered'),
  ].join('');

  q('#submission-github-note').innerHTML = 'Your authenticated submission is checked for automated-abuse indicators. <strong>Low-risk additions enter the automatic encrypted update queue.</strong> Suspicious, conflicting, or unusually frequent submissions are diverted to administrator review instead of being applied automatically.';
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
    `**Tree card name preference:** ${payload.self.treeNamePreference === 'nickname' ? 'Nickname' : 'First/Preferred Name'}`,
    `**RAT year:** ${payload.self.ratYear}`,
    `**Sections:** ${payload.self.sections.map((entry) => {
      const extras = [];
      if (entry.sectionNickname) extras.push(`section nickname: ${entry.sectionNickname}`);
      if (entry.specificInstrument) extras.push(`instrument: ${entry.specificInstrument}`);
      return `${sectionLabel(entry.section)}${extras.length ? ` (${extras.join(', ')})` : ''}`;
    }).join('; ')}`,
    `**Other GT ensembles:** ${payload.self.otherGtEnsembles ? payload.self.otherGtEnsemblesList : 'No'}`,
    `**Different instrument in other GT ensembles:** ${payload.self.otherGtEnsembles ? (payload.self.playedDifferentGtInstrument ? `Yes — ${payload.self.otherGtInstruments}` : 'No') : 'Not applicable'}`,
    `**Marching band leadership roles:** ${payload.self.marchingBandLeadershipRoles.length ? payload.self.marchingBandLeadershipRoles.join(', ') : 'None reported'}`,
    `**Informal leadership:** ${payload.self.informalLeadership ? `Yes — ${payload.self.informalLeadershipDescription}` : 'No'}`,
    `**Currently a RAT:** ${payload.self.currentlyRat ? 'Yes' : 'No'}`,
    `**RAT/VET system applies:** ${payload.pairSystem.applies ? 'Yes' : 'No'}`,
    '',
    '> **Admin review rule:** Naming a VET or RAT is a relationship claim, not permission to change that person’s profile. The automatic first-stage update adds only the submitter. These relationships and any notes for other people remain pending until a repository admin confirms them.',
  ];
  if (payload.self.marriedName) lines.push(`**Married name:** ${payload.self.marriedName}`);
  if (payload.vet) lines.push(`**VET:** ${payload.vet.name} (${payload.vet.year}, ${sectionLabel(payload.vet.section)})`);
  if (payload.rats.length) {
    lines.push('', '## RATs');
    payload.rats.forEach((rat) => lines.push(`- ${rat.name} (${rat.year}, ${sectionLabel(rat.section)})`));
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
  const duplicate = exactExistingPerson(fullSubmittedName(), q('#self-rat-year').value, primarySection());
  if (duplicate) {
    showStatus(`A matching record already exists for ${duplicate.name} (${duplicate.ratYearLabel}). Use the correction page on that profile instead of creating a duplicate.`);
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
    if (result.status === 'auto') {
      showStatus('Submission accepted for automatic encrypted update. It will be applied by the protected GitHub workflow unless the workbook detects a relationship conflict.', 'info');
      button.textContent = 'Accepted';
    } else {
      showStatus('Submission was safely diverted to administrator review. No automatic tree change was applied.', 'info');
      button.textContent = 'Sent for review';
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
  qa('input[name="informal-leadership"]').forEach((input) => input.addEventListener('change', updateInformalLeadershipVisibility));
  qa('input[name="currently-rat"]').forEach((input) => input.addEventListener('change', updateRelationshipVisibility));
  qa('input[name="legacy-system"]').forEach((input) => input.addEventListener('change', updateRelationshipVisibility));
  q('#self-rat-year').addEventListener('change', updateRelationshipVisibility);
  q('#add-section').addEventListener('click', () => addSectionMembership());
  q('#self-given').addEventListener('input', updateExistingSelfWarning);
  q('#self-family').addEventListener('input', updateExistingSelfWarning);

  ['#vet-name', '#vet-section', '#vet-year'].forEach((selector) => {
    q(selector).addEventListener(selector === '#vet-name' ? 'input' : 'change', () => {
      if (state.vetMatch) {
        state.vetRejectedId = null;
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
    updateInformalLeadershipVisibility();
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
