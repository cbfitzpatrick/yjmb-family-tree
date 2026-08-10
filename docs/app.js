'use strict';

const state = {
  data: null,
  people: new Map(),
  trees: new Map(),
  rootByPerson: new Map(),
  scale: 1,
  focusedRootId: null,
  selectedSections: new Set(),
  selectedPersonId: null,
  visiblePeople: new Set(),
};

const q = (selector) => document.querySelector(selector);
const viewport = q('#viewport');
const scaledStage = q('#scaled-stage');
const stage = q('#stage');
const bands = q('#bands');
const cardsLayer = q('#cards');
const connectorSvg = q('#connectors');
const yearAxis = q('#year-axis');
const status = q('#status');

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
  for (const band of data.yearBands) {
    const el = document.createElement('div');
    el.className = 'year-band';
    el.style.top = `${band.y}px`;
    el.style.background = band.color;
    bands.appendChild(el);
  }
}


function renderYearAxis() {
  if (!state.data || !yearAxis) return;
  yearAxis.replaceChildren();
  yearAxis.style.height = `${state.data.height * state.scale}px`;
  yearAxis.style.width = 'auto';

  const labels = [];
  for (const band of state.data.yearBands || []) {
    const label = document.createElement('div');
    label.className = 'sticky-year-label';
    label.style.top = `${band.y * state.scale}px`;
    label.style.height = `${state.data.yearStripHeight * state.scale}px`;
    label.style.fontSize = `${Math.max(9, Math.min(25, 25 * state.scale))}px`;
    label.style.background = band.color;
    label.style.color = band.textColor;
    label.style.width = 'max-content';
    label.textContent = band.label;
    yearAxis.appendChild(label);
    labels.push(label);
  }

  // Size the sticky bar from the actual rendered year text instead of a fixed
  // 92/68 px value.  All labels use the widest rendered label so the left edge
  // remains a clean vertical strip, and the width responds to zoom/font size.
  const axisWidth = Math.max(
    0,
    ...labels.map(label => Math.ceil(label.getBoundingClientRect().width)),
  );
  if (axisWidth > 0) {
    yearAxis.style.width = `${axisWidth}px`;
    for (const label of labels) label.style.width = `${axisWidth}px`;
  }

  syncYearAxis();
}

function syncYearAxis() {
  if (!yearAxis || !viewport) return;
  // Keep the year strip fixed to the viewport's left edge while allowing it to
  // move vertically with the corresponding RAT-year rows.
  yearAxis.style.transform = `translateX(${viewport.scrollLeft}px)`;
}

function buildTreeIndexes(data) {
  state.trees.clear();
  state.rootByPerson.clear();

  if (Array.isArray(data.trees) && data.trees.length) {
    for (const tree of data.trees) {
      state.trees.set(tree.rootId, tree);
      for (const id of tree.memberIds) state.rootByPerson.set(id, tree.rootId);
    }
    return;
  }

  // Compatibility fallback for schemaVersion 1 data.
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
    const sections = [...new Set(memberIds.flatMap(id => state.people.get(id)?.instruments || []))];
    state.trees.set(rootId, { rootId, memberIds, sections });
  }
}

function renderConnectors(data) {
  connectorSvg.replaceChildren();
  connectorSvg.setAttribute('width', data.width);
  connectorSvg.setAttribute('height', data.height);
  connectorSvg.setAttribute('viewBox', `0 0 ${data.width} ${data.height}`);

  for (const connector of data.connectors) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('connector-group');
    group.dataset.parentId = connector.parentId;
    group.dataset.rootId = state.rootByPerson.get(connector.parentId) || '';
    group.appendChild(svgLine(connector.parentStem, data.connectorColor, data.connectorWidth));
    if (connector.siblingBus) group.appendChild(svgLine(connector.siblingBus, data.connectorColor, data.connectorWidth));
    for (const stem of connector.childStems) group.appendChild(svgLine(stem, data.connectorColor, data.connectorWidth));
    connectorSvg.appendChild(group);
  }
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
      person.nickname,
      person.familyMaidenName,
      person.marriedName,
      person.ratYearLabel,
      person.instrumentRaw,
      ...(person.instruments || []),
    ].filter(Boolean).join(' '));
    button.style.left = `${card.x}px`;
    button.style.top = `${card.y}px`;
    button.style.width = `${card.width}px`;
    button.style.height = `${card.height}px`;
    button.title = `${person.name} — ${person.ratYearLabel}`;
    button.setAttribute('aria-label', button.title);

    const image = document.createElement('img');
    image.src = card.image;
    image.alt = person.name;
    button.appendChild(image);
    button.addEventListener('click', () => selectPerson(person.id, { locate: false }));
    cardsLayer.appendChild(button);
  }
}

function setScale(next) {
  if (!state.data) return;
  state.scale = Math.max(.12, Math.min(3, next));
  stage.style.transform = `scale(${state.scale})`;
  scaledStage.style.width = `${state.data.width * state.scale}px`;
  scaledStage.style.height = `${state.data.height * state.scale}px`;
  q('#zoom-label').textContent = `${Math.round(state.scale * 100)}%`;
  renderYearAxis();
}

function treeMatchesSections(tree) {
  const totalSections = Object.keys(state.data.sectionColors || {}).length;
  if (state.selectedSections.size === totalSections) return true;
  if (state.selectedSections.size === 0) return false;
  return (tree.sections || []).some(section => state.selectedSections.has(section));
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

  for (const button of document.querySelectorAll('.card-button')) {
    button.classList.toggle('is-hidden', !state.visiblePeople.has(button.dataset.personId));
  }
  for (const group of document.querySelectorAll('.connector-group')) {
    group.classList.toggle('is-hidden', !roots.has(group.dataset.rootId));
  }

  const totalTrees = state.trees.size;
  const summary = q('#filter-summary');
  if (state.focusedRootId) {
    const root = state.people.get(state.focusedRootId);
    summary.textContent = 'Section filters are paused while one connected tree is focused.';
    q('#view-description').textContent = `Connected tree containing ${root?.name || 'selected person'}`;
    q('#show-all-trees').hidden = false;
  } else {
    q('#show-all-trees').hidden = true;
    q('#view-description').textContent = 'Full-band family-tree visualizer';
    summary.textContent = `${roots.size} of ${totalTrees} family trees visible.`;
  }

  applySearchHighlight();
  if (fit) fitVisible();
}

function renderSectionFilter() {
  const container = q('#section-options');
  container.replaceChildren();
  state.selectedSections = new Set(Object.keys(state.data.sectionColors || {}));

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
      state.focusedRootId = null;
      applyVisibility({ fit: true });
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

function setAllSections(checked) {
  state.focusedRootId = null;
  state.selectedSections.clear();
  for (const input of document.querySelectorAll('#section-options input[type="checkbox"]')) {
    input.checked = checked;
    if (checked) state.selectedSections.add(input.value);
  }
  applyVisibility({ fit: true });
}

function personSearchText(person) {
  return normalizeSearch([
    person.name,
    person.displayName,
    person.currentName,
    person.givenPreferredName,
    person.nickname,
    person.familyMaidenName,
    person.marriedName,
    person.ratYearLabel,
    person.instrumentRaw,
  ].filter(Boolean).join(' '));
}

function matchingPeople(term) {
  const normalized = normalizeSearch(term);
  if (!normalized) return [];
  const tokens = normalized.split(' ').filter(Boolean);
  return state.data.people
    .filter(person => {
      const haystack = personSearchText(person);
      return tokens.every(token => haystack.includes(token));
    })
    .sort((a, b) => {
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
    name.textContent = person.name;
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
    treeButton.title = `Show the complete connected family tree containing ${person.name}`;
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
  for (const button of document.querySelectorAll('.card-button')) {
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
  q('#details-name').textContent = person.name;
  const fields = q('#details-fields');
  fields.replaceChildren();

  const sourceFields = Array.isArray(person.sourceFields) && person.sourceFields.length
    ? person.sourceFields
    : [
        { label: 'Given/Preferred Name', value: person.givenPreferredName },
        { label: 'Nickname', value: person.nickname },
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
    label.textContent = familyField && !String(person.marriedName || '').trim()
      ? 'Family/Last Name'
      : field.label;
    const value = document.createElement('div');
    value.className = 'detail-value';
    appendLinkedText(value, field.value);
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
    return {
      role,
      id,
      name: related?.name || id,
      reciprocated: true,
      status: 'Reciprocated / legacy relationship',
      tooltip: '',
    };
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
      control.title = claim.tooltip || "This relationship has not been reciprocated in this user's profile submission.";
      control.setAttribute('aria-label', `${control.textContent}. ${control.title}`);
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
    if (!claimList.length) {
      row.append(document.createTextNode(emptyText));
    } else {
      for (const claim of claimList) addClaimButton(row, claim);
    }
    relationships.appendChild(row);
  };

  const vetClaims = submittedVet
    ? [submittedVet]
    : (person.parentId ? [fallbackClaim(person.parentId, 'VET')] : []);
  const ratClaims = submittedRats.length
    ? submittedRats
    : (person.childrenIds || []).map(id => fallbackClaim(id, 'RAT'));

  addRelationshipClaims('VET', vetClaims, 'None / root');
  addRelationshipClaims('RATs', ratClaims, 'None');

  const unreciprocated = [...vetClaims, ...ratClaims].filter(claim => claim.reciprocated === false);
  if (unreciprocated.length) {
    const pendingRow = document.createElement('div');
    pendingRow.className = 'relationship-row unreciprocated-list';
    const pendingLabel = document.createElement('strong');
    pendingLabel.textContent = 'Unreciprocated connections';
    pendingRow.appendChild(pendingLabel);
    const help = document.createElement('p');
    help.className = 'relationship-help';
    help.textContent = 'These connections were submitted on this profile but have not yet been reciprocated on the other profile.';
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
  for (const button of document.querySelectorAll('.card-button')) {
    button.classList.toggle('is-selected', button.dataset.personId === personId);
  }
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

function boundsForPeople(ids) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const person = state.people.get(id);
    const card = person?.card;
    if (!card) continue;
    minX = Math.min(minX, card.x);
    minY = Math.min(minY, card.y);
    maxX = Math.max(maxX, card.x + card.width);
    maxY = Math.max(maxY, card.y + card.height);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function fitVisible() {
  const bounds = boundsForPeople(state.visiblePeople);
  if (!bounds) return;
  const padding = 90;
  const width = Math.max(1, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
  const scale = Math.min(
    1.45,
    Math.max(.12, (viewport.clientWidth - 30) / width),
    Math.max(.12, (viewport.clientHeight - 30) / height),
  );
  setScale(scale);
  viewport.scrollLeft = Math.max(0, (bounds.minX - padding) * state.scale);
  viewport.scrollTop = Math.max(0, (bounds.minY - padding) * state.scale);
}

function locatePerson(personId, { ensureVisible = false } = {}) {
  if (ensureVisible && !state.visiblePeople.has(personId)) {
    focusTreeForPerson(personId);
  }
  const button = document.querySelector(`.card-button[data-person-id="${CSS.escape(personId)}"]`);
  if (!button || button.classList.contains('is-hidden')) return;
  button.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
}

async function main() {
  try {
    const data = await window.YJMBSecureData.loadTreeData();
    state.data = data;
    state.people = new Map(data.people.map(person => [person.id, person]));
    buildTreeIndexes(data);

    stage.style.width = `${data.width}px`;
    stage.style.height = `${data.height}px`;
    renderBands(data);
    renderConnectors(data);
    renderCards(data);
    renderSectionFilter();
    setScale(1);
    applyVisibility();

    status.hidden = true;
    viewport.hidden = false;
  } catch (error) {
    console.error(error);
    if (error?.code === 'AUTH_REQUIRED') { window.location.replace('index.html'); return; }
    status.textContent = `Could not load the encrypted tree: ${error.message}. Run a local HTTP server instead of opening the HTML file directly.`;
  }
}

q('#zoom-in').addEventListener('click', () => setScale(state.scale * 1.15));
q('#zoom-out').addEventListener('click', () => setScale(state.scale / 1.15));
q('#zoom-reset').addEventListener('click', () => setScale(1));
viewport.addEventListener('scroll', syncYearAxis, { passive: true });
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
q('#sections-all').addEventListener('click', () => setAllSections(true));
q('#sections-none').addEventListener('click', () => setAllSections(false));
q('#show-all-trees').addEventListener('click', showAllTrees);
q('#details-close').addEventListener('click', () => {
  q('#details').hidden = true;
  state.selectedPersonId = null;
  for (const button of document.querySelectorAll('.card-button')) button.classList.remove('is-selected');
});

main();
