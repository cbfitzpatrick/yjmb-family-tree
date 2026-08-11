#!/usr/bin/env python3
"""Shared section and leadership normalization rules for the YJMB tree tools.

This module contains *taxonomy*, not user data. It is safe to commit.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Iterable


def norm(value: object) -> str:
    text = "" if value is None else str(value)
    text = unicodedata.normalize("NFKC", text).replace("\u00a0", " ").replace("’", "'")
    return re.sub(r"\s+", " ", text).strip()


def key(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", norm(value).casefold())


SECTION_DISPLAY = {
    "flute/piccolo": "Flute/Piccolo",
    "clarinet": "Clarinet",
    "sax/saxophone": "Sax/Saxophone",
    "trumpet": "Trumpet",
    "mellophone": "Mellophone",
    "trombone": "Trombone",
    "baritone": "Baritone",
    "sousaphone": "Sousaphone",
    "front ensemble": "Front Ensemble",
    "battery": "Battery",
    "guard": "Guard",
    "goldrush": "Goldrush",
    "golden girl": "Golden Girl",
}

# Intentionally conservative aliases. The cleanup script reports unmatched text
# instead of guessing it into a section.
SECTION_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("front ensemble", re.compile(r"\bfront\s+en(?:s|c)emble\b|\bfront\s+ensemble\b|\bpit\b|\bmarimbas?\b|\bvibraphones?\b|\bvibes?\b|\bxylophones?\b|\bglockenspiels?\b|\bbells?\b|\btimpani\b|\bkettledrums?\b|\brack\b|\baux(?:iliary)?\s+percussion\b|\bkeyboards?\b|\bsynth(?:esizer)?s?\b", re.I)),
    ("golden girl", re.compile(r"\bgolden\s+girls?\b", re.I)),
    ("goldrush", re.compile(r"\bgold\s*rush\b|\bgoldrush\b", re.I)),
    ("guard", re.compile(r"\bcolor\s*guard\b|\bcolour\s*guard\b|\bcolorguard\b|\bguard\b|\bflags?\b|\brifles?\b|\bsab(?:er|re)s?\b", re.I)),
    ("battery", re.compile(r"\bbattery\b|\bdrum\s*line\b|\bdrumline\b|\bsnares?\b|\btenors\b|\btenor\s+drums?\b|\bquads?\b|\bquints?\b|\bbass\s+drums?\b|\bcymbals?\b", re.I)),
    ("sax/saxophone", re.compile(r"\b(?:(?:alto|tenor|baritone|bari|soprano)\s+)?sax(?:ophone)?s?\b", re.I)),
    ("flute/piccolo", re.compile(r"\bflutes?\b|\bpiccolos?\b", re.I)),
    ("clarinet", re.compile(r"\b(?:bass\s+)?clarinets?\b", re.I)),
    ("trumpet", re.compile(r"\btrumpets?\b|\bhorns?\b(?=\s*(?:,|/|;|$))", re.I)),
    ("mellophone", re.compile(r"\bmellophones?\b|\bmellos?\b", re.I)),
    ("trombone", re.compile(r"\btrombones?\b|\bbones?\b", re.I)),
    ("baritone", re.compile(r"\bbaritones?\b|\beuphoniums?\b|\beuphs?\b", re.I)),
    ("sousaphone", re.compile(r"\bsousaphones?\b|\btubas?\b", re.I)),
)

# Meaningful subsection/instrument detail that should survive broad section
# normalization.  The workbook's Instrument field remains human-readable while
# the generator still colors cards by the canonical section keys above.
SECTION_DETAIL_PATTERNS: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    ("flute/piccolo", "Flute", re.compile(r"\bflutes?\b", re.I)),
    ("flute/piccolo", "Piccolo", re.compile(r"\bpiccolos?\b", re.I)),
    ("clarinet", "Bass Clarinet", re.compile(r"\bbass\s+clarinets?\b", re.I)),
    ("sax/saxophone", "Alto Saxophone", re.compile(r"\balto(?:\s+sax(?:ophone)?s?)?\b", re.I)),
    ("sax/saxophone", "Tenor Saxophone", re.compile(r"\btenor(?:\s+sax(?:ophone)?s?)?\b", re.I)),
    ("sax/saxophone", "Baritone Saxophone", re.compile(r"\b(?:baritone|bari)(?:\s+sax(?:ophone)?s?)?\b", re.I)),
    ("sax/saxophone", "Soprano Saxophone", re.compile(r"\bsoprano(?:\s+sax(?:ophone)?s?)?\b", re.I)),
    ("baritone", "Euphonium", re.compile(r"\beuphoniums?\b|\beuphs?\b", re.I)),
    ("sousaphone", "Tuba", re.compile(r"\btubas?\b", re.I)),
    ("battery", "Snare", re.compile(r"\bsnares?\b", re.I)),
    ("battery", "Tenors/Quads", re.compile(r"\btenors\b|\btenor\s+drums?\b|\bquads?\b|\bquints?\b", re.I)),
    ("battery", "Bass Drum", re.compile(r"\bbass\s+drums?\b", re.I)),
    ("battery", "Cymbals", re.compile(r"\bcymbals?\b", re.I)),
    ("guard", "Flag", re.compile(r"\bflags?\b", re.I)),
    ("guard", "Rifle", re.compile(r"\brifles?\b", re.I)),
    ("guard", "Saber", re.compile(r"\bsab(?:er|re)s?\b", re.I)),
    ("front ensemble", "Marimba", re.compile(r"\bmarimbas?\b", re.I)),
    ("front ensemble", "Vibraphone", re.compile(r"\bvibraphones?\b|\bvibes?\b", re.I)),
    ("front ensemble", "Xylophone", re.compile(r"\bxylophones?\b", re.I)),
    ("front ensemble", "Glockenspiel/Bells", re.compile(r"\bglockenspiels?\b|\bbells?\b", re.I)),
    ("front ensemble", "Timpani", re.compile(r"\btimpani\b|\bkettledrums?\b", re.I)),
    ("front ensemble", "Rack/Auxiliary Percussion", re.compile(r"\brack\b|\baux(?:iliary)?\s+percussion\b", re.I)),
    ("front ensemble", "Keyboard/Synth", re.compile(r"\bkeyboards?\b|\bsynth(?:esizer)?s?\b", re.I)),
)


def recognized_sections(text: object) -> list[str]:
    """Return canonical section keys in left-to-right order, without duplicates."""
    raw = norm(text)
    matches: list[tuple[int, int, str]] = []
    for canonical, pattern in SECTION_PATTERNS:
        for match in pattern.finditer(raw):
            matches.append((match.start(), -(match.end() - match.start()), canonical))
    matches.sort()
    result: list[str] = []
    for _, __, canonical in matches:
        if canonical not in result:
            result.append(canonical)
    return result


def canonical_section_text(text: object) -> str | None:
    """Return broad canonical section labels only."""
    sections = recognized_sections(text)
    if not sections:
        return None
    return ", ".join(SECTION_DISPLAY[item] for item in sections)


def section_details(text: object, canonical: str) -> list[str]:
    """Return recognized subsection/instrument details in source order.

    The exact canonical broad label is removed first so an already-normalized
    value such as ``Flute/Piccolo — Piccolo`` does not accidentally interpret
    the words inside ``Flute/Piccolo`` as two subsection answers.
    """
    raw = norm(text)
    broad_label = SECTION_DISPLAY.get(canonical, "")
    if broad_label:
        # Remove the broad label only when it is an already-normalized prefix.
        # Never remove a word merely because it appears inside a detail such as
        # "Bass Clarinet".
        normalized_prefix = re.compile(
            rf"^\s*{re.escape(broad_label)}(?:\s*[—–:-]\s*|\s*$)",
            re.I,
        )
        raw = normalized_prefix.sub(" ", raw, count=1)
    matches: list[tuple[int, str]] = []
    for section, label, pattern in SECTION_DETAIL_PATTERNS:
        if section != canonical:
            continue
        for match in pattern.finditer(raw):
            matches.append((match.start(), label))
    matches.sort(key=lambda item: item[0])
    return _dedupe(label for _, label in matches)


def canonical_section_text_with_details(text: object) -> str | None:
    """Canonicalize broad section names without throwing away known details.

    Examples:
      Alto Sax -> Sax/Saxophone — Alto Saxophone
      Snare -> Battery — Snare
      Color Guard / Rifle -> Guard — Rifle
    """
    sections = recognized_sections(text)
    if not sections:
        return None
    parts: list[str] = []
    for section in sections:
        label = SECTION_DISPLAY[section]
        details = section_details(text, section)
        if details:
            label += " — " + ", ".join(details)
        parts.append(label)
    return "; ".join(parts)


def canonical_section_entry(section: object, detail: object = "") -> str | None:
    """Format one broad section plus an optional specific answer.

    Known detail wording is canonicalized; unknown detail is preserved verbatim
    rather than discarded. This is used for new questionnaire submissions.
    """
    section_raw = norm(section)
    canonical = section_raw.casefold() if section_raw.casefold() in SECTION_DISPLAY else None
    if canonical is None:
        recognized = recognized_sections(section_raw)
        canonical = recognized[0] if len(recognized) == 1 else None
    if canonical is None:
        return None
    broad = SECTION_DISPLAY[canonical]
    detail_raw = norm(detail)
    if not detail_raw:
        return broad
    details = section_details(detail_raw, canonical)
    return f"{broad} — {', '.join(details) if details else detail_raw}"


# Formal leadership vocabulary. Section Leader and Guard Captain remain formal
# section leadership roles; the remaining roles are the full-band formal
# positions supplied for v17. Aliases are normalized without changing the
# original free-text source field unless a cleanup/apply path explicitly runs.
FORMAL_ROLE_ORDER = (
    "Drum Major",
    "Section Leader",
    "Guard Captain",
    "Staff Assistant",
    "Operations",
    "Props",
    "Uniforms",
    "Libraries",
    "MCM",
    "RAT Parent",
)

FORMAL_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("Drum Major", re.compile(r"\bdrum\s+majors?\b", re.I)),
    ("Section Leader", re.compile(r"\bsection\s+leaders?\b", re.I)),
    ("Guard Captain", re.compile(r"\b(?:color\s+guard\s+)?guard\s+captains?\b|\bcolor\s+guard\s+captains?\b", re.I)),
    ("Staff Assistant", re.compile(r"\bstaff\s+(?:assistants?|ass(?:\.|\b))", re.I)),
    ("Operations", re.compile(r"\boperations?\b|\bops\b", re.I)),
    ("Props", re.compile(r"\bprops?\b", re.I)),
    ("Uniforms", re.compile(r"\buniforms?\b", re.I)),
    ("Libraries", re.compile(r"\blibraries?\b|\blibrary\b", re.I)),
    ("MCM", re.compile(r"\bmcm\b", re.I)),
    ("RAT Parent", re.compile(r"\brat\s+parents?\b|\brat\s+(?:moms?|dads?)\b", re.I)),
)

INFORMAL_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("Hype Man", re.compile(r"\bhype[\s-]*(?:man|men|person|people|woman|women|guy|girl)\b|\bhypeman\b", re.I)),
)

_SPLIT_ROLES = re.compile(r"\s*(?:,|;|\||/|\band\b)\s*", re.I)


def _dedupe(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        clean = norm(value)
        k = key(clean)
        if clean and k and k not in seen:
            seen.add(k)
            out.append(clean)
    return out


def canonical_formal_roles(text: object) -> list[str]:
    """Canonicalize recognized formal roles and preserve unknown formal labels."""
    raw = norm(text)
    if not raw:
        return []
    found: list[str] = []
    consumed_spans: list[tuple[int, int]] = []
    for canonical, pattern in FORMAL_PATTERNS:
        for match in pattern.finditer(raw):
            found.append(canonical)
            consumed_spans.append(match.span())
    # Preserve role tokens from a field that is already formally classified.
    for token in _SPLIT_ROLES.split(raw):
        token = norm(token)
        if not token:
            continue
        if any(pattern.fullmatch(token) for _, pattern in FORMAL_PATTERNS):
            continue
        # Ignore simple yes/no flags accidentally passed here.
        if key(token) in {"yes", "no", "true", "false"}:
            continue
        found.append(token)
    # Return known roles in stable order, then unknown labels in source order.
    known = [role for role in FORMAL_ROLE_ORDER if role in found]
    unknown = [role for role in _dedupe(found) if role not in FORMAL_ROLE_ORDER]
    return known + unknown


def informal_roles_from_text(text: object) -> list[str]:
    raw = norm(text)
    if not raw:
        return []
    found: list[str] = []
    for canonical, pattern in INFORMAL_PATTERNS:
        if pattern.search(raw):
            found.append(canonical)
    # Preserve the original free-text description as an informal label when it
    # is not just a yes/no flag and no canonical role was recognized.
    if not found and key(raw) not in {"yes", "no", "true", "false"}:
        found.append(raw)
    return _dedupe(found)


def truthy(value: object) -> bool:
    return key(value) in {"yes", "y", "true", "1", "x"}


def leadership_icon_flags(formal_text: object, informal_text: object, informal_flag: object = "") -> list[str]:
    """Return future card-icon categories for the person's leadership roles.

    Card icons are deliberately disabled in the v17.5 browser renderer, but the
    role-specific flags remain in protected structured data so the prepared icon
    assets can be enabled later without another workbook migration.
    """
    formal = canonical_formal_roles(formal_text)
    flags: list[str] = []
    explicit = (
        ("Section Leader", "section-leader"),
        ("Guard Captain", "guard-captain"),
        ("Drum Major", "drum-major"),
        ("RAT Parent", "rat-parent"),
        ("MCM", "mcm"),
        ("Libraries", "libraries"),
        ("Uniforms", "uniforms"),
    )
    for role, flag in explicit:
        if role in formal:
            flags.append(flag)
    if informal_roles_from_text(informal_text) or truthy(informal_flag):
        flags.append("informal-leadership")
    explicit_roles = {role for role, _ in explicit}
    if any(role not in explicit_roles for role in formal):
        flags.append("other-leadership")
    return flags


def extract_roles_from_notes(text: object) -> tuple[list[str], list[str]]:
    """Return high-confidence (formal, informal) role mentions found in note text."""
    raw = norm(text)
    formal: list[str] = []
    informal: list[str] = []
    for canonical, pattern in FORMAL_PATTERNS:
        if pattern.search(raw):
            formal.append(canonical)
    for canonical, pattern in INFORMAL_PATTERNS:
        if pattern.search(raw):
            informal.append(canonical)
    return _dedupe(formal), _dedupe(informal)

SECTION_RESIDUAL_STOPWORDS = {
    "and", "or", "the", "a", "an", "section", "sections", "line", "member", "members",
    "marching", "primary", "secondary", "former", "current", "then", "later", "also", "plus",
}


def section_residual_words(text: object) -> list[str]:
    """Words not explained by known section aliases/separators.

    A non-empty result means a cleanup script should not rewrite the cell
    automatically because doing so could discard meaningful text.
    """
    residual = norm(text)
    for _, pattern in SECTION_PATTERNS:
        residual = pattern.sub(" ", residual)
    for _, __, pattern in SECTION_DETAIL_PATTERNS:
        residual = pattern.sub(" ", residual)
    residual = re.sub(r"[,&;/|+()\[\]{}:_—–-]+", " ", residual)
    words = [w.casefold() for w in re.findall(r"[A-Za-z0-9']+", residual)]
    return [w for w in words if w not in SECTION_RESIDUAL_STOPWORDS]


def formal_roles_in_text(text: object) -> list[str]:
    raw = norm(text)
    found = [canonical for canonical, pattern in FORMAL_PATTERNS if pattern.search(raw)]
    return _dedupe(found)


def strip_formal_role_phrases(text: object) -> str:
    raw = norm(text)
    for role, pattern in FORMAL_PATTERNS:
        # "Guard Captain" can itself contain the section name (for example,
        # "Color Guard Captain"). Preserve Guard as section data while removing
        # the leadership title.
        raw = pattern.sub(" Guard " if role == "Guard Captain" else " ", raw)
    raw = re.sub(r"\s*(?:,|;|/|\||\band\b)\s*(?=(?:,|;|/|\||$))", " ", raw, flags=re.I)
    raw = re.sub(r"^(?:\s*(?:,|;|/|\||and)\s*)+|(?:\s*(?:,|;|/|\||and)\s*)+$", "", raw, flags=re.I)
    return norm(raw)
