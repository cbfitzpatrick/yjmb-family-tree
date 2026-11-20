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
const yearRail = q('#year-rail');
const cardsLayer = q('#cards');
const connectorSvg = q('#connectors');
const status = q('#status');

const SPECIAL_SECTION_BLUE = '#d5defe';
const PACKED_TREE_GAP = 28;
const TREE_VIEW_STORAGE_KEY = 'yjmbTreeViewV18_1';
const MOBILE_TREE_MEDIA = '(max-width: 820px), (pointer: coarse) and (max-width: 950px)';
const ROLE_ICON_ASSETS = Object.freeze({
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
const RETIRED_LEADERSHIP_FIELD_KEYS = new Set([
  'marchingbandleadershiproles',
  'servedininformalleadershipposition',
  'informalleadershippositions',
  'marchingbandleadershiphistory',
  'servedinbandclubleadershipposition',
  'bandclubleadershippositions',
  'bandclubleadershiphistory',
  'leadershippositionclassification',
]);

function normalizedFieldKey(label) {
  return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function positionAndYearValue(person) {
  if (String(person?.positionAndYear || '').trim()) return String(person.positionAndYear).trim();
  const field = (person?.sourceFields || []).find((item) => normalizedFieldKey(item?.label) === 'positionandyear');
  return String(field?.value || '').trim();
}

function positionYearIconKinds(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const out = [];
  const add = (kind) => { if (!out.includes(kind)) out.push(kind); };
  const entries = raw.split(/[;|\n]+/).map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
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
    if (/\bhype[\s-]*(?:man|men|person|people|woman|women|guy|girl)\b|\bhypeman\b|\binformal(?:\s+leadership)?\b/i.test(entry)) {
      add('informal-leadership'); recognized = true;
    }
    if (/\bstaff\s+(?:assistants?|ass(?:\.|\b))|\boperations?\b|\bops\b|\bprops?\b/i.test(entry)) {
      add('other-leadership'); recognized = true;
    }
    if (!recognized) {
      const residual = entry
        .replace(/\b(?:spring|summer|fall|autumn|winter)?\s*(?:19|20)\d{2}(?:\s*(?:-|–|—|to|through|thru)\s*(?:19|20)?\d{2})?\b/gi, ' ')
        .replace(/\b(?:position|positions|year|years|marching\s+band|leadership|served\s+as|serve(?:d)?\s+as)\b/gi, ' ')
        .replace(/[()\[\]{},:/+_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (/[A-Za-z]/.test(residual)) add('other-leadership');
    }
  }
  return out;
}

const ASSET_RELOAD_FILES = ['shako_buzz_transparent.png', 'favicon.ico', 'styles.css', 'app.js', 'secure-data.js', 'developer-export.js', 'admin-mail.js', ...Object.values(ROLE_ICON_ASSETS)];

function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKD').toLowerCase().replace(/\s+/g, ' ').trim();
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const CONNECTOR_STROKE = '#000000';
const CONNECTOR_OUTLINE_COLOR = '#D6D6D6';
const CONNECTOR_OUTLINE_OPACITY = 0.65;
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

function nearlySamePoint(left, right, tolerance = 1.5) {
  return Boolean(left && right)
    && Math.abs(Number(left.x) - Number(right.x)) <= tolerance
    && Math.abs(Number(left.y) - Number(right.y)) <= tolerance;
}

function connectorGeometryPersonIds(connector) {
  // Older/generated payloads can occasionally have incomplete connector owner
  // metadata.  Recover ownership from the actual card attachment points so a
  // perfectly vertical one-RAT chain is not lost when its tree is isolated.
  const points = [];
  for (const segment of connectorSegments(connector)) {
    if (segment?.start) points.push(segment.start);
    if (segment?.end) points.push(segment.end);
  }
  const ids = [];
  for (const person of state.people.values()) {
    const card = person?.card;
    if (!card) continue;
    const centerX = Number(card.x) + Number(card.width) / 2;
    const top = { x: centerX, y: Number(card.y) };
    const bottom = { x: centerX, y: Number(card.y) + Number(card.height) };
    if (points.some((point) => nearlySamePoint(point, top) || nearlySamePoint(point, bottom))) {
      ids.push(person.id);
    }
  }
  return ids;
}

function connectorEndpointIds(connector) {
  const ids = [connector.parentId, ...(connector.childIds || [])].filter(Boolean);
  for (const id of connectorGeometryPersonIds(connector)) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function connectorPathData(data, allowedRootIds = null) {
  const commands = [];
  for (const connector of data.connectors || []) {
    const endpointIds = connectorEndpointIds(connector);
    const visibleEndpointIds = allowedRootIds
      ? endpointIds.filter((personId) => state.visiblePeople.has(personId))
      : endpointIds;

    // Tree isolation is a visibility operation, not a connector-metadata
    // operation.  If either endpoint belongs to the visible connected tree,
    // retain the connector.  This is particularly important for straight
    // one-parent/one-child chains whose historical connector records may lack
    // complete parent/root ownership metadata.
    if (allowedRootIds && !visibleEndpointIds.length) continue;

    const rootIds = [];
    for (const personId of visibleEndpointIds.length ? visibleEndpointIds : endpointIds) {
      const candidate = state.rootByPerson.get(personId);
      if (candidate && !rootIds.includes(candidate)) rootIds.push(candidate);
    }
    for (const candidate of connectorRootIds(connector)) {
      if (!rootIds.includes(candidate)) rootIds.push(candidate);
    }

    let rootId = allowedRootIds
      ? rootIds.find((candidate) => allowedRootIds.has(candidate))
      : rootIds[0];
    if (allowedRootIds && !rootId) {
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

function updateConnectorStrokeWidths() {
  if (!state.data || !connectorSvg) return;
  const baseWidth = Math.max(1, Number(state.data.connectorWidth || 9));
  const outlineExtra = CONNECTOR_OUTLINE_RADIUS * 2;
  let blackWidth = baseWidth;
  let outlineWidth = baseWidth + outlineExtra;

  // v18.5: at the new full-height 100% view, phone screens can reduce the
  // entire tree enough that a normal 9-unit SVG stroke becomes sub-pixel.
  // Keep a small minimum *screen-space* width on mobile/coarse-pointer devices.
  // We do this numerically instead of relying on vector-effect so iOS Safari,
  // Android Chromium, and desktop browsers use the same SVG geometry model.
  if (isMobileTree()) {
    const scale = Math.max(0.001, Number(state.scale || state.baseScale || 1));
    blackWidth = Math.max(baseWidth, 2.25 / scale);
    outlineWidth = Math.max(baseWidth + outlineExtra, 6.25 / scale);
  }

  for (const path of qa('.connector-outline-path', connectorSvg)) {
    path.setAttribute('stroke-width', String(outlineWidth));
  }
  for (const path of qa('.connector-path', connectorSvg)) {
    path.setAttribute('stroke-width', String(blackWidth));
  }
}

// Year backgrounds and frozen labels share a single scaled coordinate system.
// The year rail stays in horizontal view via sticky-left positioning, but takes
// ZERO vertical layout height. Each absolute label cell gets the same top/height
// as its background strip, so labels cannot drift while cards remain at Y=0.
// Do NOT add sticky top:0 or a nonzero rail height (v18.6.1 regression).
function yearAxisFontSize() {
  return Math.max(9, Math.min(25, 25 * state.scale));
}

function measureYearAxisWidth() {
  if (!state.data) return 0;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const size = yearAxisFontSize();
  if (!context) return Math.ceil(4.3 * size);
  context.font = `800 ${size}px Calibri, Arial, sans-serif`;
  const widest = Math.max(0, ...(state.data.yearBands || []).map((b) => context.measureText(String(b.label)).width));
  return Math.ceil(Math.max(widest + 18, size * 3.6));
}

function renderYearAxis() {
  if (!state.data) return;
  const data = state.data;
  const fontSize = yearAxisFontSize();
  state.yearAxisWidth = measureYearAxisWidth();
  state.contentOffsetX = state.yearAxisWidth;
  const totalWidth = state.contentOffsetX + state.displayWidth * state.scale;
  scaledStage.style.width = `${totalWidth}px`;
  scaledStage.style.height = `${data.height * state.scale}px`;
  stage.style.left = `${state.contentOffsetX}px`;

  // Full-width year-color strips remain behind the cards/connectors, while a
  // separate frozen left rail reuses the exact same geometry so the labels
  // cannot drift away from their rows at high zoom.
  bands.replaceChildren();
  bands.style.width = `${totalWidth}px`;
  bands.style.height = `${data.height * state.scale}px`;
  yearRail.replaceChildren();
  yearRail.style.width = `${state.yearAxisWidth}px`;
  // A sticky element participates in normal layout.  It MUST have zero flow
  // height: giving it the entire tree height shifts the absolutely positioned
  // stage's static Y position by one full tree (the v18.6.1 regression).
  // The independently positioned year-rail-band children still cover the
  // entire scaled tree, using precisely the same Y coordinates as #bands.
  yearRail.style.height = '0px';

  const bandFragment = document.createDocumentFragment();
  const railFragment = document.createDocumentFragment();
  for (const band of data.yearBands || []) {
    const top = `${Number(band.y) * state.scale}px`;
    const height = `${Number(data.yearStripHeight) * state.scale}px`;

    const strip = document.createElement('div');
    strip.className = 'year-band';
    strip.style.top = top;
    strip.style.height = height;
    strip.style.background = band.color;
    bandFragment.appendChild(strip);

    const railBand = document.createElement('div');
    railBand.className = 'year-rail-band';
    railBand.style.top = top;
    railBand.style.height = height;
    railBand.style.background = band.color;

    const label = document.createElement('span');
    label.className = 'sticky-year-label';
    label.style.width = `${state.yearAxisWidth}px`;
    label.style.fontSize = `${fontSize}px`;
    label.style.color = band.textColor;
    label.textContent = band.label;
    railBand.appendChild(label);
    railFragment.appendChild(railBand);
  }
  bands.appendChild(bandFragment);
  yearRail.appendChild(railFragment);
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

  const d = connectorPathData(data, allowedRootIds);
  if (!d) return;

  // v18.5: render the complete visible relationship network as two paint
  // passes of the same single combined path geometry.  This avoids SVG filter
  // bugs on mobile Safari/Chromium while still avoiding per-segment line DOM.
  const outline = document.createElementNS(SVG_NS, 'path');
  outline.classList.add('connector-outline-path');
  outline.setAttribute('d', d);
  outline.setAttribute('fill', 'none');
  outline.setAttribute('stroke', CONNECTOR_OUTLINE_COLOR);
  outline.setAttribute('stroke-opacity', String(CONNECTOR_OUTLINE_OPACITY));
  outline.setAttribute('stroke-linecap', 'square');
  outline.setAttribute('stroke-linejoin', 'miter');
  outline.setAttribute('shape-rendering', 'geometricPrecision');

  const path = document.createElementNS(SVG_NS, 'path');
  path.classList.add('connector-path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', CONNECTOR_STROKE);
  path.setAttribute('stroke-linecap', 'square');
  path.setAttribute('stroke-linejoin', 'miter');
  path.setAttribute('shape-rendering', 'geometricPrecision');

  connectorSvg.append(outline, path);
  updateConnectorStrokeWidths();
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

function cardIconElement(kind) {
  const wrapper = document.createElement('span');
  wrapper.className = `card-status-icon card-role-icon icon-${kind}`;
  wrapper.dataset.iconKind = kind;
  wrapper.title = kind.replaceAll('-', ' ');
  const asset = ROLE_ICON_ASSETS[kind];
  if (!asset) { wrapper.hidden = true; return wrapper; }
  const img = document.createElement('img');
  img.src = asset;
  img.alt = '';
  img.decoding = 'async';
  wrapper.appendChild(img);
  return wrapper;
}

function assignCardIconSlots(elements) {
  // v19.0: cards show at most four role icons, one per true corner.
  // Drum Major permanently owns the upper-left corner. Section Leader /
  // Guard Captain permanently owns the upper-right corner. Other roles fill
  // the lower corners first and can overflow upward only into an unreserved
  // corner. Extra roles remain available in the member details.
  const candidates = elements.filter((el) => el && !el.hidden);
  for (const el of elements) {
    delete el.dataset.roleSlot;
    el.hidden = true;
  }

  const drumMajor = candidates.find((el) => el.dataset.iconKind === 'drum-major');
  // Guard Captain is the section-leader equivalent for Color Guard. If bad
  // legacy data contains both roles, show the Guard Captain badge rather than
  // stacking two badges in the same reserved corner.
  const sectionLeader = candidates.find((el) => el.dataset.iconKind === 'guard-captain')
    || candidates.find((el) => el.dataset.iconKind === 'section-leader');

  const shown = new Set();
  const place = (el, slot) => {
    if (!el || shown.size >= 4) return;
    el.dataset.roleSlot = slot;
    el.hidden = false;
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
  // The text block is anchored at the card's geometric center, not sized by
  // CSS grid's intrinsic minimum width.  Fit the longest *individual* line
  // within that centered block (including the border/safety inset).  This
  // avoids a long first or last name pushing the whole block toward the right.
  const sourceWidth = Math.max(40, Number(cardWidth) || 150);
  const usable = Math.max(20, sourceWidth - (hasIcons ? 42 : 18));
  const fitted = base * usable / maxMeasured;
  return Math.max(8.5, Math.min(base, Math.floor(fitted * 10) / 10));
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
    const hasCardIcons = Boolean(data.cardIconsEnabled && positionYearIconKinds(positionAndYearValue(person)).length);
    name.style.fontSize = `${cardNameFontSize(parts, card.width, hasCardIcons)}px`;
    builtCard.classList.toggle('has-card-icons', hasCardIcons);
    builtCard.appendChild(name);

    // All card icons remain disabled for normal viewers for now. The role-specific icon assets and
    // SVG definitions are prepared so they can be enabled later without another
    // data migration. RAT Parent uses the supplied cap artwork; current RAT is
    // deliberately not represented by that icon.
    if (data.cardIconsEnabled) {
      const iconKinds = positionYearIconKinds(positionAndYearValue(person));
      const icons = iconKinds.map(cardIconElement);
      assignCardIconSlots(icons);
      for (const icon of icons) builtCard.appendChild(icon);
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
  updateConnectorStrokeWidths();
  renderYearAxis();
  if (focus) {
    viewport.scrollLeft = Math.max(0, state.contentOffsetX + focus.logicalX * state.scale - focus.anchorX);
    viewport.scrollTop = Math.max(0, focus.logicalY * state.scale - focus.anchorY);
  
  }
}

function resetZoomToFullHeight() {
  if (!state.data) return;
  state.baseScale = fullHeightBaseScale();
  setScale(state.baseScale, { preserveFocus: false });
  viewport.scrollTop = 0;
  viewport.scrollLeft = 0;

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
    if (RETIRED_LEADERSHIP_FIELD_KEYS.has(normalizedFieldKey(field.label))) continue;
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
window.addEventListener('pagehide', saveTreeView);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveTreeView(); });
window.addEventListener('resize', () => { if (!isMobileTree()) setMobileToolbarVisible(true); refreshBaseScaleForViewport(); }, { passive: true });
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
