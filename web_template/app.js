'use strict';

const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  data: null,
  people: new Map(),
  trees: new Map(),
  rootByPerson: new Map(),
  scale: 1,
  focusedRootId: null,
  selectedSections: new Set(),
  appliedSections: new Set(),
  selectedPersonId: null,
  visiblePeople: new Set(),
  yearAxisWidth: 0,
  contentOffsetX: 0,
  rootShiftX: new Map(),
  displayWidth: 0,
  sectionView: null,
};

const viewport = q('#viewport');
const scaledStage = q('#scaled-stage');
const stage = q('#stage');
const bands = q('#bands');
const cardsLayer = q('#cards');
const connectorSvg = q('#connectors');
const yearAxis = q('#year-axis');
const yearAxisTrack = q('#year-axis-track');
const status = q('#status');

const SPECIAL_SECTION_BLUE = '#d5defe';
const PACKED_TREE_GAP = 28;

function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKD').toLowerCase().replace(/\s+/g, ' ').trim();
}

function svgLine(segment, color, width) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', segment.start.x);
  line.setAttribute('y1', segment.start.y);
  line.setAttribute('x2', segment.end.x);
  line.setAttribute('y2', segment.end.y);
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', width);
  line.setAttribute('stroke-linecap', 'square');
  line.setAttribute('shape-rendering', 'crispEdges');
  return line;
}

function renderBands(data) {
  bands.replaceChildren();
  for (const band of data.yearBands || []) {
    const el = document.createElement('div');
    el.className = 'year-band';
    el.style.top = `${band.y}px`;
    el.style.background = band.color;
    bands.appendChild(el);
  }
}

function yearAxisFontSize() {
  return Math.max(9, Math.min(25, 25 * state.scale));
}

function measureYearAxisWidth() {
  if (!state.data) return 0;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const fontSize = yearAxisFontSize();
  if (!context) return Math.ceil(4.3 * fontSize);
  context.font = `800 ${fontSize}px Calibri, Arial, sans-serif`;
  const widest = Math.max(0, ...(state.data.yearBands || []).map((band) => context.measureText(String(band.label)).width));
  return Math.ceil(Math.max(widest + 18, fontSize * 3.6));
}

function renderYearAxis() {
  if (!state.data || !yearAxis || !yearAxisTrack) return;
  yearAxisTrack.replaceChildren();
  const fontSize = yearAxisFontSize();
  const axisWidth = measureYearAxisWidth();
  state.yearAxisWidth = axisWidth;
  // v17: no spacer is inserted between the frozen year rail and the stage.
  state.contentOffsetX = axisWidth;

  yearAxis.style.width = `${axisWidth}px`;
  yearAxisTrack.style.width = `${axisWidth}px`;
  yearAxisTrack.style.height = `${state.data.height * state.scale}px`;

  for (const band of state.data.yearBands || []) {
    const label = document.createElement('div');
    label.className = 'sticky-year-label';
    label.style.top = `${band.y * state.scale}px`;
    label.style.height = `${state.data.yearStripHeight * state.scale}px`;
    label.style.fontSize = `${fontSize}px`;
    label.style.background = band.color;
    label.style.color = band.textColor;
    label.style.width = `${axisWidth}px`;
    label.textContent = band.label;
    yearAxisTrack.appendChild(label);
  }

  stage.style.left = `${state.contentOffsetX}px`;
  scaledStage.style.width = `${state.contentOffsetX + state.displayWidth * state.scale}px`;
  scaledStage.style.height = `${state.data.height * state.scale}px`;
  syncYearAxisGeometry();
}

function syncYearAxisScroll() {
  if (!yearAxisTrack || !viewport || viewport.hidden) return;
  yearAxisTrack.style.transform = `translate3d(0, ${-viewport.scrollTop}px, 0)`;
}

function syncYearAxisGeometry() {
  if (!yearAxis || !viewport || viewport.hidden) return;
  const rect = viewport.getBoundingClientRect();
  yearAxis.style.left = `${Math.round(rect.left)}px`;
  yearAxis.style.top = `${Math.round(rect.top)}px`;
  yearAxis.style.height = `${Math.round(rect.height)}px`;
  syncYearAxisScroll();
}

function buildTreeIndexes(data) {
  state.trees.clear();
  state.rootByPerson.clear();
  if (Array.isArray(data.trees) && data.trees.length) {
    for (const tree of data.trees) {
      state.trees.set(tree.rootId, tree);
      for (const id of tree.memberIds || []) state.rootByPerson.set(id, tree.rootId);
    }
    return;
  }
  const rootOf = (person) => {
    let cursor = person;
    const seen = new Set();
    while (cursor?.parentId && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      cursor = state.people.get(cursor.parentId);
    }
    return cursor?.id ?? person.id;
  };
  const members = new Map();
  for (const person of data.people) {
    const rootId = rootOf(person);
    state.rootByPerson.set(person.id, rootId);
    if (!members.has(rootId)) members.set(rootId, []);
    members.get(rootId).push(person.id);
  }
  for (const [rootId, memberIds] of members) {
    const sections = [...new Set(memberIds.flatMap((id) => state.people.get(id)?.instruments || []))];
    state.trees.set(rootId, { rootId, memberIds, sections });
  }
}

function renderConnectors(data) {
  connectorSvg.replaceChildren();
  connectorSvg.setAttribute('height', data.height);
  for (const connector of data.connectors || []) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('connector-group');
    group.dataset.parentId = connector.parentId;
    group.dataset.rootId = state.rootByPerson.get(connector.parentId) || '';
    const segments = [connector.parentStem, ...(connector.siblingBus ? [connector.siblingBus] : []), ...(connector.childStems || [])];
    for (const segment of segments) {
      group.appendChild(svgLine(segment, '#777777', data.connectorWidth || 9));
    }
    connectorSvg.appendChild(group);
  }
}

function regularCardBackground(person) {
  const colors = person.card?.sectionColors?.length ? person.card.sectionColors : ['#D3D3D3'];
  if (colors.length === 1) return colors[0];
  const stop = 100 / colors.length;
  const parts = [];
  colors.forEach((color, index) => {
    parts.push(`${color} ${index * stop}%`, `${color} ${(index + 1) * stop}%`);
  });
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

function sectionViewCardBackground(person) {
  const selected = state.sectionView;
  if (!selected) return regularCardBackground(person);
  const sections = (person.instruments || []).filter((section) => section && section !== 'unknown');
  const inSection = sections.includes(selected);
  if (!inSection) return SPECIAL_SECTION_BLUE;
  const inAnotherSection = sections.some((section) => section !== selected);
  return inAnotherSection
    ? `linear-gradient(90deg, #FFFFFF 0 50%, ${SPECIAL_SECTION_BLUE} 50% 100%)`
    : '#FFFFFF';
}

function bandClubIconSvg() {
  return '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.1" fill="rgba(255,255,255,.88)" stroke="currentColor" stroke-width="1.4"/><path d="M11.4 5.1v7.1c-.8-.5-2.2-.4-3 .2-.9.7-1 1.8-.2 2.4.8.7 2.2.5 3.1-.2.6-.5.8-1.1.7-1.7V8.1l4-1V5.4Z" fill="currentColor"/></svg>';
}

function renderCards(data) {
  cardsLayer.replaceChildren();
  for (const person of data.people) {
    const card = person.card;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card-button';
    button.dataset.personId = person.id;
    button.dataset.rootId = state.rootByPerson.get(person.id) || '';
    button.dataset.search = normalizeSearch([
      person.name,
      person.displayName,
      person.currentName,
      person.givenPreferredName,
      person.personalNickname || person.nickname,
      person.sectionNicknames,
      person.familyMaidenName,
      person.marriedName,
      person.ratYearLabel,
      person.instrumentRaw,
      ...(person.instruments || []),
    ].filter(Boolean).join(' '));
    button.style.width = `${card.width}px`;
    button.style.height = `${card.height}px`;
    button.title = `${person.name} — ${person.ratYearLabel}`;
    button.setAttribute('aria-label', button.title);

    const builtCard = document.createElement('span');
    builtCard.className = 'site-card';
    builtCard.style.background = regularCardBackground(person);

    const name = document.createElement('span');
    name.className = 'site-card-name';
    name.textContent = person.displayName || person.name;
    builtCard.appendChild(name);

    if (person.currentlyRat) {
      const icon = document.createElement('img');
      icon.className = 'card-status-icon rat-cap-icon';
      icon.src = 'rat-cap-icon.png';
      icon.alt = '';
      icon.title = 'Current RAT';
      builtCard.appendChild(icon);
    }
    if (person.bandClubLeadership) {
      const icon = document.createElement('span');
      icon.className = 'card-status-icon band-club-icon';
      icon.title = 'Band Club leadership';
      icon.innerHTML = bandClubIconSvg();
      builtCard.appendChild(icon);
    }

    button.appendChild(builtCard);
    button.addEventListener('click', () => selectPerson(person.id, { locate: false }));
    cardsLayer.appendChild(button);
  }
  applyDisplayPositions();
}

function displayXForPerson(person) {
  return person.card.x + (state.rootShiftX.get(state.rootByPerson.get(person.id)) || 0);
}

function applyDisplayPositions() {
  if (!state.data) return;
  stage.style.width = `${state.displayWidth}px`;
  connectorSvg.setAttribute('width', state.displayWidth);
  connectorSvg.setAttribute('viewBox', `0 0 ${state.displayWidth} ${state.data.height}`);
  for (const button of qa('.card-button')) {
    const person = state.people.get(button.dataset.personId);
    if (!person) continue;
    button.style.left = `${displayXForPerson(person)}px`;
    button.style.top = `${person.card.y}px`;
    q('.site-card', button).style.background = sectionViewCardBackground(person);
  }
  for (const group of qa('.connector-group')) {
    const dx = state.rootShiftX.get(group.dataset.rootId) || 0;
    group.setAttribute('transform', dx ? `translate(${dx} 0)` : '');
  }
  renderYearAxis();
}

function restoreOriginalLayout() {
  state.rootShiftX.clear();
  state.displayWidth = state.data.width;
  applyDisplayPositions();
}

function packRoots(rootIds) {
  const roots = [...rootIds]
    .map((rootId) => state.trees.get(rootId))
    .filter(Boolean)
    .sort((a, b) => (a.bounds?.minX ?? 0) - (b.bounds?.minX ?? 0));
  state.rootShiftX.clear();
  let cursor = 0;
  for (const tree of roots) {
    const bounds = tree.bounds || boundsForPeople(new Set(tree.memberIds || []), { original: true });
    if (!bounds) continue;
    state.rootShiftX.set(tree.rootId, cursor - bounds.minX);
    cursor += Math.max(1, bounds.maxX - bounds.minX) + PACKED_TREE_GAP;
  }
  state.displayWidth = Math.max(1, cursor ? cursor - PACKED_TREE_GAP : state.data.width);
  applyDisplayPositions();
}

function captureViewportFocus() {
  const anchorX = viewport.clientWidth / 2;
  const anchorY = viewport.clientHeight / 2;
  const logicalX = Math.max(0, (viewport.scrollLeft + anchorX - state.contentOffsetX) / Math.max(state.scale, .001));
  const logicalY = Math.max(0, (viewport.scrollTop + anchorY) / Math.max(state.scale, .001));
  return { anchorX, anchorY, logicalX, logicalY };
}

function setScale(next, { preserveFocus = true } = {}) {
  if (!state.data) return;
  const focus = preserveFocus ? captureViewportFocus() : null;
  state.scale = Math.max(.12, Math.min(3, next));
  stage.style.transform = `scale(${state.scale})`;
  q('#zoom-label').textContent = `${Math.round(state.scale * 100)}%`;
  renderYearAxis();
  if (focus) {
    viewport.scrollLeft = Math.max(0, state.contentOffsetX + focus.logicalX * state.scale - focus.anchorX);
    viewport.scrollTop = Math.max(0, focus.logicalY * state.scale - focus.anchorY);
    syncYearAxisScroll();
  }
}

function treeMatchesSections(tree) {
  const totalSections = Object.keys(state.data.sectionColors || {}).length;
  if (state.appliedSections.size === totalSections) return true;
  if (state.appliedSections.size === 0) return false;
  return (tree.sections || []).some((section) => state.appliedSections.has(section));
}

function visibleRootIds() {
  if (state.focusedRootId) return new Set([state.focusedRootId]);
  const roots = new Set();
  for (const [rootId, tree] of state.trees) {
    if (treeMatchesSections(tree)) roots.add(rootId);
  }
  return roots;
}

function applyVisibility({ fit = false } = {}) {
  const roots = visibleRootIds();
  state.visiblePeople = new Set();
  for (const rootId of roots) {
    const tree = state.trees.get(rootId);
    for (const id of tree?.memberIds || []) state.visiblePeople.add(id);
  }

  for (const button of qa('.card-button')) button.classList.toggle('is-hidden', !state.visiblePeople.has(button.dataset.personId));
  for (const group of qa('.connector-group')) group.classList.toggle('is-hidden', !roots.has(group.dataset.rootId));

  const summary = q('#filter-summary');
  if (state.focusedRootId) {
    const root = state.people.get(state.focusedRootId);
    summary.textContent = 'Section filters are paused while one connected tree is focused.';
    q('#view-description').textContent = `Connected tree containing ${root?.name || 'selected person'}`;
    q('#show-all-trees').hidden = false;
  } else {
    q('#show-all-trees').hidden = true;
    if (state.sectionView) {
      q('#view-description').textContent = `${state.sectionView} family-tree view`;
      summary.textContent = `${roots.size} connected famil${roots.size === 1 ? 'y' : 'ies'} contain at least one ${state.sectionView} member. White = selected section; blue = outside the section; split = both.`;
    } else {
      q('#view-description').textContent = 'Full-band family-tree visualizer';
      summary.textContent = `${roots.size} of ${state.trees.size} family trees visible.`;
    }
  }

  applySearchHighlight();
  if (fit) fitVisible();
}

function renderSectionFilter() {
  const container = q('#section-options');
  container.replaceChildren();
  const sections = Object.keys(state.data.sectionColors || {});
  state.selectedSections = new Set(sections);
  state.appliedSections = new Set(sections);

  for (const [section, color] of Object.entries(state.data.sectionColors || {})) {
    const label = document.createElement('label');
    label.className = 'section-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = section;
    checkbox.checked = true;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedSections.add(section);
      else state.selectedSections.delete(section);
      q('#filter-summary').textContent = 'Selection changed. Choose Apply to load this view.';
    });
    const swatch = document.createElement('span');
    swatch.className = 'section-swatch';
    swatch.style.background = color;
    const text = document.createElement('span');
    text.textContent = section;
    label.append(checkbox, swatch, text);
    container.appendChild(label);
  }
}

function setAllSectionCheckboxes(checked) {
  state.selectedSections.clear();
  for (const input of qa('#section-options input[type="checkbox"]')) {
    input.checked = checked;
    if (checked) state.selectedSections.add(input.value);
  }
  q('#filter-summary').textContent = 'Selection changed. Choose Apply to load this view.';
}

function applySectionSelection() {
  state.focusedRootId = null;
  state.appliedSections = new Set(state.selectedSections);
  state.sectionView = state.appliedSections.size === 1 ? [...state.appliedSections][0] : null;
  if (state.sectionView) {
    const roots = new Set([...state.trees].filter(([, tree]) => (tree.sections || []).includes(state.sectionView)).map(([rootId]) => rootId));
    packRoots(roots);
  } else {
    restoreOriginalLayout();
  }
  applyVisibility({ fit: true });
}

function loadFullTree() {
  setAllSectionCheckboxes(true);
  state.appliedSections = new Set(state.selectedSections);
  state.sectionView = null;
  state.focusedRootId = null;
  restoreOriginalLayout();
  applyVisibility({ fit: true });
}

function personSearchText(person) {
  return normalizeSearch([
    person.name, person.displayName, person.currentName, person.givenPreferredName,
    person.personalNickname || person.nickname, person.sectionNicknames,
    person.familyMaidenName, person.marriedName, person.ratYearLabel,
    person.instrumentRaw, person.favoriteTechBandMemory,
  ].filter(Boolean).join(' '));
}

function matchingPeople(term) {
  const normalized = normalizeSearch(term);
  if (!normalized) return [];
  const tokens = normalized.split(' ').filter(Boolean);
  return state.data.people.filter((person) => {
    const haystack = personSearchText(person);
    return tokens.every((token) => haystack.includes(token));
  }).sort((a, b) => {
    const aName = normalizeSearch(a.name);
    const bName = normalizeSearch(b.name);
    const aPrefix = aName.startsWith(normalized) ? 0 : 1;
    const bPrefix = bName.startsWith(normalized) ? 0 : 1;
    return aPrefix - bPrefix || (a.ratYear ?? 9999) - (b.ratYear ?? 9999) || a.name.localeCompare(b.name);
  });
}

function updateSearchResults() {
  const input = q('#search');
  const results = q('#search-results');
  const term = input.value.trim();
  applySearchHighlight();
  if (!term) {
    results.hidden = true;
    results.replaceChildren();
    return;
  }
  const people = matchingPeople(term).slice(0, 12);
  results.replaceChildren();
  if (!people.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = 'No matching people found.';
    results.appendChild(empty);
    results.hidden = false;
    return;
  }
  for (const person of people) {
    const row = document.createElement('div');
    row.className = 'search-result';
    row.setAttribute('role', 'option');
    const personButton = document.createElement('button');
    personButton.type = 'button';
    personButton.className = 'search-person-button';
    const name = document.createElement('span');
    name.className = 'search-person-name';
    name.textContent = person.displayName || person.name;
    const meta = document.createElement('span');
    meta.className = 'search-person-meta';
    meta.textContent = `${person.ratYearLabel} · ${person.instrumentRaw || 'Unknown section'}`;
    personButton.append(name, meta);
    personButton.addEventListener('click', () => {
      selectPerson(person.id, { locate: true });
      results.hidden = true;
    });
    const treeButton = document.createElement('button');
    treeButton.type = 'button';
    treeButton.className = 'search-tree-button';
    treeButton.textContent = 'Show tree';
    treeButton.addEventListener('click', () => {
      focusTreeForPerson(person.id);
      selectPerson(person.id, { locate: true });
      results.hidden = true;
    });
    row.append(personButton, treeButton);
    results.appendChild(row);
  }
  results.hidden = false;
}

function applySearchHighlight() {
  const term = normalizeSearch(q('#search').value);
  for (const button of qa('.card-button')) {
    const visible = !button.classList.contains('is-hidden');
    const match = Boolean(term) && visible && button.dataset.search.includes(term);
    button.classList.toggle('search-match', match);
    button.classList.toggle('search-dimmed', Boolean(term) && visible && !match);
  }
}

function appendLinkedText(container, value) {
  const text = String(value ?? '');
  const urlPattern = /(https?:\/\/[^\s,;]+)/gi;
  let cursor = 0;
  for (const match of text.matchAll(urlPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) container.append(document.createTextNode(text.slice(cursor, index)));
    const link = document.createElement('a');
    link.href = match[0];
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = match[0];
    container.appendChild(link);
    cursor = index + match[0].length;
  }
  if (cursor < text.length) container.append(document.createTextNode(text.slice(cursor)));
}

function renderDetails(person) {
  q('#details-name').textContent = person.displayName || person.name;
  const fields = q('#details-fields');
  fields.replaceChildren();
  const sourceFields = Array.isArray(person.sourceFields) && person.sourceFields.length
    ? person.sourceFields
    : [
        { label: 'Given/Preferred Name', value: person.givenPreferredName },
        { label: 'Nickname', value: person.personalNickname || person.nickname },
        { label: person.marriedName ? 'Family/Maiden Name' : 'Family/Last Name', value: person.familyMaidenName },
        { label: 'Married Name', value: person.marriedName },
        { label: 'RAT Year', value: person.ratYearLabel },
        { label: 'Instrument', value: person.instrumentRaw },
      ];

  for (const field of sourceFields) {
    if (field.value === null || field.value === undefined || String(field.value).trim() === '') continue;
    const row = document.createElement('div');
    row.className = 'detail-row';
    const label = document.createElement('div');
    label.className = 'detail-label';
    const normalizedLabel = normalizeSearch(field.label).replace(/[^a-z0-9]/g, '');
    const familyField = ['familymaidenname', 'familyname', 'maidenname', 'lastname', 'surname'].includes(normalizedLabel);
    const personalNickField = ['nickname', 'personalnickname'].includes(normalizedLabel);
    label.textContent = personalNickField
      ? 'Personal Nickname'
      : (familyField && !String(person.marriedName || '').trim() ? 'Family/Last Name' : field.label);
    const value = document.createElement('div');
    value.className = 'detail-value';
    const marriedField = ['marriedname', 'marriedsurname', 'currentsurname', 'currentlastname'].includes(normalizedLabel);
    if (marriedField && String(person.marriedName || '').trim()) {
      label.textContent = 'Current/Married Name';
      appendLinkedText(value, person.currentName || `${person.givenPreferredName || ''} ${person.marriedName || ''}`.trim());
    } else {
      appendLinkedText(value, field.value);
    }
    row.append(label, value);
    fields.appendChild(row);
  }

  const relationships = q('#details-relationships');
  relationships.replaceChildren();
  const claims = person.relationshipClaims || {};
  const submittedVet = claims.vet || null;
  const submittedRats = Array.isArray(claims.rats) ? claims.rats : [];
  const fallbackClaim = (id, role) => {
    const related = state.people.get(id);
    return { role, id, name: related?.name || id, reciprocated: true, status: 'Reciprocated / legacy relationship', tooltip: '' };
  };

  const addClaimButton = (row, claim, { showStatus = true } = {}) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'relationship-person-wrap';
    if (claim.reciprocated === false) wrapper.classList.add('is-unreciprocated');
    let control;
    if (claim.id && state.people.has(claim.id)) {
      control = document.createElement('button');
      control.type = 'button';
      control.className = 'person-link-button';
      control.textContent = claim.name || state.people.get(claim.id)?.name || claim.id;
      control.addEventListener('click', () => selectPerson(claim.id, { locate: true }));
    } else {
      control = document.createElement('span');
      control.className = 'person-link-button person-link-unavailable';
      control.textContent = claim.name || 'Unknown person';
    }
    if (claim.reciprocated === false) {
      control.classList.add('unreciprocated-person');
      control.title = claim.tooltip || 'This relationship has not been reciprocated on the other profile.';
    }
    wrapper.appendChild(control);
    if (showStatus && claim.reciprocated === false) {
      const badge = document.createElement('span');
      badge.className = 'relationship-status-badge';
      badge.textContent = 'Unreciprocated';
      wrapper.appendChild(badge);
    }
    row.appendChild(wrapper);
  };

  const addRelationshipClaims = (labelText, claimList, emptyText) => {
    const row = document.createElement('div');
    row.className = 'relationship-row';
    const label = document.createElement('strong');
    label.textContent = labelText;
    row.appendChild(label);
    if (!claimList.length) row.append(document.createTextNode(emptyText));
    else for (const claim of claimList) addClaimButton(row, claim);
    relationships.appendChild(row);
  };

  const vetClaims = submittedVet ? [submittedVet] : (person.parentId ? [fallbackClaim(person.parentId, 'VET')] : []);
  const ratClaims = submittedRats.length ? submittedRats : (person.childrenIds || []).map((id) => fallbackClaim(id, 'RAT'));
  addRelationshipClaims('VET', vetClaims, 'None / root');
  addRelationshipClaims('RATs', ratClaims, 'None');

  const unreciprocated = [...vetClaims, ...ratClaims].filter((claim) => claim.reciprocated === false);
  if (unreciprocated.length) {
    const pendingRow = document.createElement('div');
    pendingRow.className = 'relationship-row unreciprocated-list';
    const pendingLabel = document.createElement('strong');
    pendingLabel.textContent = 'Unreciprocated connections';
    pendingRow.appendChild(pendingLabel);
    const help = document.createElement('p');
    help.className = 'relationship-help';
    help.textContent = 'These connections are present on one profile but have not been confirmed on the other profile.';
    pendingRow.appendChild(help);
    for (const claim of unreciprocated) {
      const item = document.createElement('div');
      item.className = 'unreciprocated-item';
      const role = document.createElement('span');
      role.className = 'relationship-role-label';
      role.textContent = `${claim.role}:`;
      item.appendChild(role);
      addClaimButton(item, claim, { showStatus: false });
      pendingRow.appendChild(item);
    }
    relationships.appendChild(pendingRow);
  }

  q('#correction-link').href = `correction.html?person=${encodeURIComponent(person.id)}`;
  q('#details-show-tree').onclick = () => focusTreeForPerson(person.id);
  q('#details-locate').onclick = () => locatePerson(person.id, { ensureVisible: true });
  q('#details').hidden = false;
}

function selectPerson(personId, { locate = false } = {}) {
  const person = state.people.get(personId);
  if (!person) return;
  state.selectedPersonId = personId;
  for (const button of qa('.card-button')) button.classList.toggle('is-selected', button.dataset.personId === personId);
  renderDetails(person);
  if (locate) locatePerson(personId, { ensureVisible: false });
}

function focusTreeForPerson(personId) {
  const rootId = state.rootByPerson.get(personId);
  if (!rootId) return;
  state.focusedRootId = rootId;
  applyVisibility({ fit: true });
}

function showAllTrees() {
  state.focusedRootId = null;
  applyVisibility({ fit: true });
}

function boundsForPeople(ids, { original = false } = {}) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const person = state.people.get(id);
    const card = person?.card;
    if (!card) continue;
    const x = original ? card.x : displayXForPerson(person);
    minX = Math.min(minX, x);
    minY = Math.min(minY, card.y);
    maxX = Math.max(maxX, x + card.width);
    maxY = Math.max(maxY, card.y + card.height);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function fitVisible() {
  const bounds = boundsForPeople(state.visiblePeople);
  if (!bounds) return;
  const padding = 45;
  const width = Math.max(1, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
  const availableWidth = Math.max(120, viewport.clientWidth - state.yearAxisWidth - 18);
  const scale = Math.min(1.45, Math.max(.12, availableWidth / width), Math.max(.12, (viewport.clientHeight - 24) / height));
  setScale(scale, { preserveFocus: false });
  viewport.scrollLeft = Math.max(0, state.contentOffsetX + (bounds.minX - padding) * state.scale - state.yearAxisWidth);
  viewport.scrollTop = Math.max(0, (bounds.minY - padding) * state.scale);
  syncYearAxisScroll();
}

function locatePerson(personId, { ensureVisible = false } = {}) {
  if (ensureVisible && !state.visiblePeople.has(personId)) focusTreeForPerson(personId);
  const person = state.people.get(personId);
  if (!person || !state.visiblePeople.has(personId)) return;
  const card = person.card;
  const centerX = state.contentOffsetX + (displayXForPerson(person) + card.width / 2) * state.scale;
  const centerY = (card.y + card.height / 2) * state.scale;
  const visibleCenterX = state.yearAxisWidth + (viewport.clientWidth - state.yearAxisWidth) / 2;
  viewport.scrollTo({
    left: Math.max(0, centerX - visibleCenterX),
    top: Math.max(0, centerY - viewport.clientHeight / 2),
    behavior: 'smooth',
  });
}

function bindInfoPanel() {
  const open = q('#info-button');
  const dialog = q('#info-dialog');
  const close = q('#info-close');
  if (!open || !dialog) return;
  open.addEventListener('click', () => dialog.showModal());
  close?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

async function main() {
  try {
    const data = await window.YJMBSecureData.loadTreeData();
    state.data = data;
    state.people = new Map(data.people.map((person) => [person.id, person]));
    state.displayWidth = data.width;
    buildTreeIndexes(data);
    stage.style.height = `${data.height}px`;
    renderBands(data);
    renderConnectors(data);
    renderCards(data);
    renderSectionFilter();
    status.hidden = true;
    viewport.hidden = false;
    setScale(window.matchMedia('(max-width: 820px), (pointer: coarse) and (max-width: 950px)').matches ? 0.8 : 1, { preserveFocus: false });
    applyVisibility();
    requestAnimationFrame(syncYearAxisGeometry);
  } catch (error) {
    console.error(error);
    if (error?.code === 'AUTH_REQUIRED') { window.location.replace('index.html'); return; }
    status.textContent = `Could not load the encrypted tree: ${error.message}. Run a local HTTP server instead of opening this HTML file directly.`;
  }
}

q('#zoom-in').addEventListener('click', () => setScale(state.scale * 1.15));
q('#zoom-out').addEventListener('click', () => setScale(state.scale / 1.15));
q('#zoom-reset').addEventListener('click', () => setScale(1));
q('#zoom-fit')?.addEventListener('click', fitVisible);
viewport.addEventListener('scroll', syncYearAxisScroll, { passive: true });
window.addEventListener('resize', () => { syncYearAxisGeometry(); renderYearAxis(); }, { passive: true });
q('#search').addEventListener('input', updateSearchResults);
q('#search').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    const first = matchingPeople(q('#search').value)[0];
    if (first) {
      event.preventDefault();
      selectPerson(first.id, { locate: true });
      q('#search-results').hidden = true;
    }
  }
  if (event.key === 'Escape') q('#search-results').hidden = true;
});
q('#search').addEventListener('focus', updateSearchResults);
document.addEventListener('click', (event) => {
  if (!event.target.closest('.search-wrap')) q('#search-results').hidden = true;
});
q('#sections-all').addEventListener('click', () => setAllSectionCheckboxes(true));
q('#sections-none').addEventListener('click', () => setAllSectionCheckboxes(false));
q('#sections-apply').addEventListener('click', applySectionSelection);
q('#sections-load-full').addEventListener('click', loadFullTree);
q('#show-all-trees').addEventListener('click', showAllTrees);
q('#details-close').addEventListener('click', () => {
  q('#details').hidden = true;
  state.selectedPersonId = null;
  for (const button of qa('.card-button')) button.classList.remove('is-selected');
});
bindInfoPanel();
main();
