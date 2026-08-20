'use strict';

const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  data: null,
  people: new Map(),
  trees: new Map(),
  rootByPerson: new Map(),
  scale: 1,
  baseScale: 1,
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
const TREE_VIEW_STORAGE_KEY = 'yjmbTreeViewV18_1';
const MOBILE_TREE_MEDIA = '(max-width: 820px), (pointer: coarse) and (max-width: 950px)';
const ASSET_RELOAD_FILES = ['styles.css', 'app.js', 'secure-data.js', 'developer-export.js', 'admin-mail.js', 'section-leader-icon.png', 'rat-parent-icon.png', 'band-club-icon.png'];

function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKD').toLowerCase().replace(/\s+/g, ' ').trim();
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const CONNECTOR_STROKE = '#000000';
const CONNECTOR_OUTLINE_COLOR = '#808080';
const CONNECTOR_OUTLINE_OPACITY = 0.50;
const CONNECTOR_OUTLINE_RADIUS = 4;

function connectorSegments(connector) {
  return [connector.parentStem, ...(connector.siblingBus ? [connector.siblingBus] : []), ...(connector.childStems || [])].filter(Boolean);
}

function connectorRootIds(connector) {
  const roots = [];
  for (const personId of [connector.parentId, ...(connector.childIds || [])]) {
    const rootId = state.rootByPerson.get(personId);
    if (rootId && !roots.includes(rootId)) roots.push(rootId);
  }
  return roots;
}

function connectorPathData(data, allowedRootIds = null) {
  const commands = [];
  for (const connector of data.connectors || []) {
    const rootIds = connectorRootIds(connector);
    // A focused/filtered tree must retain its own connectors.  Checking every
    // endpoint is intentionally more robust than checking only parentId: older
    // encrypted payloads can contain connector-parent/root metadata that was
    // generated before the current tree index format.
    let rootId = allowedRootIds
      ? rootIds.find((candidate) => allowedRootIds.has(candidate))
      : rootIds[0];
    if (allowedRootIds && !rootId) {
      const endpointVisible = [connector.parentId, ...(connector.childIds || [])]
        .some((personId) => state.visiblePeople.has(personId));
      if (!endpointVisible) continue;
      rootId = (state.focusedRootId && allowedRootIds.has(state.focusedRootId))
        ? state.focusedRootId
        : [...allowedRootIds][0];
    }
    const dx = state.rootShiftX.get(rootId || '') || 0;
    for (const segment of connectorSegments(connector)) {
      commands.push(`M ${segment.start.x + dx} ${segment.start.y} L ${segment.end.x + dx} ${segment.end.y}`);
    }
  }
  return commands.join(' ');
}

function appendConnectorOutlineFilter(svg) {
  const defs = document.createElementNS(SVG_NS, 'defs');
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.id = 'connector-outline-filter';
  filter.setAttribute('x', '-10%');
  filter.setAttribute('y', '-10%');
  filter.setAttribute('width', '120%');
  filter.setAttribute('height', '120%');

  const dilate = document.createElementNS(SVG_NS, 'feMorphology');
  dilate.setAttribute('in', 'SourceAlpha');
  dilate.setAttribute('operator', 'dilate');
  dilate.setAttribute('radius', String(CONNECTOR_OUTLINE_RADIUS));
  dilate.setAttribute('result', 'expanded');

  const ring = document.createElementNS(SVG_NS, 'feComposite');
  ring.setAttribute('in', 'expanded');
  ring.setAttribute('in2', 'SourceAlpha');
  ring.setAttribute('operator', 'out');
  ring.setAttribute('result', 'outlineMask');

  const flood = document.createElementNS(SVG_NS, 'feFlood');
  flood.setAttribute('flood-color', CONNECTOR_OUTLINE_COLOR);
  flood.setAttribute('flood-opacity', String(CONNECTOR_OUTLINE_OPACITY));
  flood.setAttribute('result', 'outlineColor');

  const mask = document.createElementNS(SVG_NS, 'feComposite');
  mask.setAttribute('in', 'outlineColor');
  mask.setAttribute('in2', 'outlineMask');
  mask.setAttribute('operator', 'in');
  mask.setAttribute('result', 'outline');

  const merge = document.createElementNS(SVG_NS, 'feMerge');
  const outlineNode = document.createElementNS(SVG_NS, 'feMergeNode');
  outlineNode.setAttribute('in', 'outline');
  const sourceNode = document.createElementNS(SVG_NS, 'feMergeNode');
  sourceNode.setAttribute('in', 'SourceGraphic');
  merge.append(outlineNode, sourceNode);

  filter.append(dilate, ring, flood, mask, merge);
  defs.appendChild(filter);
  svg.appendChild(defs);
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

function renderConnectors(data, allowedRootIds = null) {
  connectorSvg.replaceChildren();
  connectorSvg.setAttribute('height', data.height);
  appendConnectorOutlineFilter(connectorSvg);

  const d = connectorPathData(data, allowedRootIds);
  if (!d) return;
  const path = document.createElementNS(SVG_NS, 'path');
  path.classList.add('connector-path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', CONNECTOR_STROKE);
  path.setAttribute('stroke-width', String(data.connectorWidth || 9));
  path.setAttribute('stroke-linecap', 'square');
  path.setAttribute('stroke-linejoin', 'miter');
  path.setAttribute('shape-rendering', 'geometricPrecision');
  path.setAttribute('filter', 'url(#connector-outline-filter)');
  connectorSvg.appendChild(path);
}

function gradientPairForSection(section) {
  const pair = state.data?.sectionGradients?.[section];
  if (Array.isArray(pair) && pair.length >= 2) return [pair[0], pair[1]];
  const fallback = state.data?.sectionColors?.[section] || '#D3D3D3';
  return [fallback, fallback];
}

function solidColorForSection(section) {
  return state.data?.sectionColors?.[section] || gradientPairForSection(section)[0] || '#D3D3D3';
}

function regularCardBackground(person) {
  const sections = (person.instruments || []).filter(Boolean);
  if (!sections.length) return '#D3D3D3';
  if (sections.length === 1) return solidColorForSection(sections[0]);
  const stops = [];
  sections.forEach((section, index) => {
    const color = solidColorForSection(section);
    const left = 100 * index / sections.length;
    const right = 100 * (index + 1) / sections.length;
    stops.push(`${color} ${left}%`, `${color} ${right}%`);
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
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

function inlineRoleIconSvg(kind) {
  const icons = {
    'drum-major': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c1.7-.8 3.2.2 3.6 1.7l.6 2.3.8-4.6c.2-1.2 2-1 1.9.3l-.4 5.2.9-4.3c.3-1.2 2.1-.8 1.8.4l-.9 4.3.9-3.3c.3-1.1 2-.6 1.7.5l-1.1 4.2c-.6 2.4-2 4-4 4.7l-2.8 1-2.3-6.1L4 5.5Zm16 0c-1.7-.8-3.2.2-3.6 1.7l-.6 2.3-.8-4.6c-.2-1.2-2-1-1.9.3l.4 5.2-.9-4.3c-.3-1.2-2.1-.8-1.8.4l.9 4.3-.9-3.3c-.3-1.1-2-.6-1.7.5l1.1 4.2c.6 2.4 2 4 4 4.7l2.8 1 2.3-6.1L20 5.5Z" fill="currentColor"/></svg>',
    'mcm': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l1.3-2h5.4L16 7h4v12H4Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13" r="4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    'libraries': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5.5c3.2-.8 6-.2 9 1.8v12c-3-2-5.8-2.6-9-1.8Zm18 0c-3.2-.8-6-.2-9 1.8v12c3-2 5.8-2.6 9-1.8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    'uniforms': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 4 2 4-2 4 4-3 3v9H7v-9L4 8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 6v14M9.5 10h5" stroke="currentColor" stroke-width="1.4"/></svg>',
    'guard-captain': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v18M8 4l10 3-10 4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    'informal-leadership': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h4l8-4v12l-8-4H4Zm4 4 2 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    'other-leadership': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  };
  return icons[kind] || '';
}

function cardIconElement(kind) {
  const wrapper = document.createElement('span');
  wrapper.className = `card-status-icon card-role-icon icon-${kind}`;
  wrapper.dataset.iconKind = kind;
  wrapper.title = kind.replaceAll('-', ' ');
  const imageAssets = {
    'section-leader': 'section-leader-icon.png',
    'rat-parent': 'rat-parent-icon.png',
    'band-club': 'band-club-icon.png',
  };
  if (imageAssets[kind]) {
    const img = document.createElement('img');
    img.src = imageAssets[kind];
    img.alt = '';
    wrapper.appendChild(img);
  } else {
    wrapper.innerHTML = inlineRoleIconSvg(kind);
  }
  return wrapper;
}

function cardNameParts(person) {
  const family = String(person.cardFamilyName || person.familyMaidenName || '').trim();
  const given = String(person.cardGivenName || '').trim();
  if (given || family) return { given: given || person.givenPreferredName || person.displayName || person.name, family };
  const display = String(person.displayName || person.name || '').trim();
  const words = display.split(/\s+/);
  return words.length > 1 ? { given: words.slice(0, -1).join(' '), family: words.at(-1) } : { given: display, family: '' };
}

function cardNameFontSize(parts, cardWidth, hasIcons = false) {
  const canvas = cardNameFontSize.canvas || (cardNameFontSize.canvas = document.createElement('canvas'));
  const context = canvas.getContext('2d');
  const base = 22;
  if (!context) return base;
  context.font = `${base}px Arial, Helvetica, sans-serif`;
  const maxMeasured = Math.max(context.measureText(parts.given || '').width, context.measureText(parts.family || '').width, 1);
  // Do not reserve empty icon corners. Normal cards need only a modest edge
  // margin; icon-bearing cards reserve additional room for the prepared badges.
  const reserved = hasIcons ? 44 : 24;
  const usable = Math.max(70, Number(cardWidth || 150) - reserved);
  return Math.max(13, Math.min(base, Math.floor(base * usable / maxMeasured)));
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
    const parts = cardNameParts(person);
    const firstLine = document.createElement('span');
    firstLine.className = 'site-card-name-line site-card-given';
    firstLine.textContent = parts.given;
    name.appendChild(firstLine);
    if (parts.family) {
      const secondLine = document.createElement('span');
      secondLine.className = 'site-card-name-line site-card-family';
      secondLine.textContent = parts.family;
      name.appendChild(secondLine);
    }
    const hasCardIcons = Boolean(data.cardIconsEnabled && ((person.leadershipIcons || []).length || person.bandClubLeadership));
    name.style.fontSize = `${cardNameFontSize(parts, card.width, hasCardIcons)}px`;
    builtCard.classList.toggle('has-card-icons', hasCardIcons);
    builtCard.appendChild(name);

    // All card icons remain disabled for normal viewers for now. The role-specific icon assets and
    // SVG definitions are prepared so they can be enabled later without another
    // data migration. RAT Parent uses the supplied cap artwork; current RAT is
    // deliberately not represented by that icon.
    if (data.cardIconsEnabled) {
      for (const kind of person.leadershipIcons || []) builtCard.appendChild(cardIconElement(kind));
      if (person.bandClubLeadership) builtCard.appendChild(cardIconElement('band-club'));
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
  // v18.1 renders every visible relationship segment as one SVG path, so
  // packed-family x offsets are baked into the path rather than applied to
  // many independent connector elements.
  renderConnectors(state.data);
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

function fullHeightBaseScale() {
  if (!state.data || !viewport) return 1;
  const availableHeight = Math.max(1, viewport.clientHeight - 4);
  return Math.min(1, Math.max(0.02, availableHeight / Math.max(1, state.data.height)));
}

function zoomPercent() {
  return Math.max(100, (state.scale / Math.max(state.baseScale, 0.0001)) * 100);
}

function setScale(next, { preserveFocus = true } = {}) {
  if (!state.data) return;
  const focus = preserveFocus ? captureViewportFocus() : null;
  const minimum = Math.max(0.02, state.baseScale || fullHeightBaseScale());
  const maximum = Math.max(minimum, Math.min(3, minimum * 12));
  state.scale = Math.max(minimum, Math.min(maximum, next));
  stage.style.transform = `scale(${state.scale})`;
  q('#zoom-label').textContent = `${Math.round(zoomPercent())}%`;
  renderYearAxis();
  if (focus) {
    viewport.scrollLeft = Math.max(0, state.contentOffsetX + focus.logicalX * state.scale - focus.anchorX);
    viewport.scrollTop = Math.max(0, focus.logicalY * state.scale - focus.anchorY);
    syncYearAxisScroll();
  }
}

function resetZoomToFullHeight() {
  if (!state.data) return;
  state.baseScale = fullHeightBaseScale();
  setScale(state.baseScale, { preserveFocus: false });
  viewport.scrollTop = 0;
  viewport.scrollLeft = 0;
  syncYearAxisScroll();
}

function refreshBaseScaleForViewport() {
  if (!state.data || viewport.hidden) return;
  const oldBase = Math.max(0.0001, state.baseScale || 1);
  const relativeZoom = Math.max(1, state.scale / oldBase);
  state.baseScale = fullHeightBaseScale();
  setScale(state.baseScale * relativeZoom);
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
  renderConnectors(state.data, roots);

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

function clearSearchAfterSelection() {
  const input = q('#search');
  const results = q('#search-results');
  input.value = '';
  results.hidden = true;
  results.replaceChildren();
  applySearchHighlight();
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
      clearSearchAfterSelection();
    });
    const treeButton = document.createElement('button');
    treeButton.type = 'button';
    treeButton.className = 'search-tree-button';
    treeButton.textContent = 'Show tree';
    treeButton.addEventListener('click', () => {
      focusTreeForPerson(person.id);
      selectPerson(person.id, { locate: true });
      clearSearchAfterSelection();
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
  const scale = Math.min(1.45, availableWidth / width, (viewport.clientHeight - 24) / height);
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

function saveTreeView() {
  if (!state.data || viewport.hidden) return;
  try {
    localStorage.setItem(TREE_VIEW_STORAGE_KEY, JSON.stringify({
      schemaVersion: state.data.schemaVersion || null,
      scale: state.scale,
      zoomPercent: zoomPercent(),
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      selectedPersonId: state.selectedPersonId,
      focusedRootId: state.focusedRootId,
      appliedSections: [...state.appliedSections],
      savedAt: Date.now(),
    }));
  } catch { /* local persistence is optional */ }
}

function readSavedTreeView() {
  try {
    const raw = localStorage.getItem(TREE_VIEW_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return null;
    return saved;
  } catch { return null; }
}

function restoreTreeView() {
  const saved = readSavedTreeView();
  if (!saved) return false;
  const validSections = new Set(Object.keys(state.data.sectionColors || {}));
  const savedSections = Array.isArray(saved.appliedSections)
    ? saved.appliedSections.filter((section) => validSections.has(section))
    : [];
  if (savedSections.length) {
    state.selectedSections = new Set(savedSections);
    state.appliedSections = new Set(savedSections);
    for (const input of qa('#section-options input[type="checkbox"]')) input.checked = state.selectedSections.has(input.value);
    state.sectionView = state.appliedSections.size === 1 ? [...state.appliedSections][0] : null;
    if (state.sectionView) {
      const roots = new Set([...state.trees].filter(([, tree]) => (tree.sections || []).includes(state.sectionView)).map(([rootId]) => rootId));
      packRoots(roots);
    } else {
      restoreOriginalLayout();
    }
  }
  state.focusedRootId = saved.focusedRootId && state.trees.has(saved.focusedRootId) ? saved.focusedRootId : null;
  applyVisibility();
  const savedPercent = Number(saved.zoomPercent);
  const relativeZoom = Number.isFinite(savedPercent) ? Math.max(100, savedPercent) / 100 : 1;
  setScale(state.baseScale * relativeZoom, { preserveFocus: false });
  requestAnimationFrame(() => {
    viewport.scrollLeft = Math.max(0, Number(saved.scrollLeft) || 0);
    viewport.scrollTop = Math.max(0, Number(saved.scrollTop) || 0);
    syncYearAxisScroll();
    if (saved.selectedPersonId && state.people.has(saved.selectedPersonId)) {
      selectPerson(saved.selectedPersonId, { locate: false });
    }
  });
  return true;
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

function isMobileTree() {
  return window.matchMedia(MOBILE_TREE_MEDIA).matches;
}

function setMobileToolbarVisible(visible) {
  if (!isMobileTree()) {
    document.body.classList.remove('mobile-toolbar-hidden');
    return;
  }
  document.body.classList.toggle('mobile-toolbar-hidden', !visible);
  requestAnimationFrame(syncYearAxisGeometry);
}

function bindMobileToolbarToggle() {
  if (!viewport) return;
  let start = null;
  viewport.addEventListener('pointerdown', (event) => {
    if (!isMobileTree() || event.pointerType === 'mouse') return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }, { passive: true });
  viewport.addEventListener('pointerup', (event) => {
    if (!start || start.id !== event.pointerId || !isMobileTree()) return;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    start = null;
    if (distance > 10) return;
    setMobileToolbarVisible(document.body.classList.contains('mobile-toolbar-hidden'));
  }, { passive: true });
  viewport.addEventListener('pointercancel', () => { start = null; }, { passive: true });
}

async function reloadPageAssets() {
  const button = q('#reload-assets');
  if (button) button.disabled = true;
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => /yjmb|github|pages/i.test(key)).map((key) => caches.delete(key)));
    }
    const stamp = Date.now();
    await Promise.all(ASSET_RELOAD_FILES.map(async (file) => {
      try {
        const url = new URL(file, window.location.href);
        url.searchParams.set('_assetReload', String(stamp));
        await fetch(url, { cache: 'reload', credentials: 'same-origin' });
      } catch { /* one unavailable optional asset should not block the reload */ }
    }));
    const next = new URL(window.location.href);
    next.searchParams.set('_assetReload', String(stamp));
    window.location.replace(next.toString());
  } finally {
    if (button) button.disabled = false;
  }
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
    state.baseScale = fullHeightBaseScale();
    if (!restoreTreeView()) {
      setScale(state.baseScale, { preserveFocus: false });
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      applyVisibility();
    }
    if (isMobileTree()) setMobileToolbarVisible(false);
    requestAnimationFrame(syncYearAxisGeometry);
  } catch (error) {
    console.error(error);
    if (error?.code === 'AUTH_REQUIRED') { window.location.replace('index.html'); return; }
    status.textContent = `Could not load the encrypted tree: ${error.message}. Run a local HTTP server instead of opening this HTML file directly.`;
  }
}

q('#zoom-in').addEventListener('click', () => setScale(state.scale * 1.15));
q('#zoom-out').addEventListener('click', () => setScale(state.scale / 1.15));
q('#zoom-reset').addEventListener('click', resetZoomToFullHeight);
q('#zoom-fit')?.addEventListener('click', fitVisible);
q('#reload-assets')?.addEventListener('click', reloadPageAssets);
bindMobileToolbarToggle();
viewport.addEventListener('scroll', syncYearAxisScroll, { passive: true });
window.addEventListener('pagehide', saveTreeView);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveTreeView(); });
window.addEventListener('resize', () => { if (!isMobileTree()) setMobileToolbarVisible(true); refreshBaseScaleForViewport(); syncYearAxisGeometry(); }, { passive: true });
q('#search').addEventListener('input', updateSearchResults);
q('#search').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    const first = matchingPeople(q('#search').value)[0];
    if (first) {
      event.preventDefault();
      selectPerson(first.id, { locate: true });
      clearSearchAfterSelection();
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
