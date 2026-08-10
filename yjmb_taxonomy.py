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
    ("front ensemble", re.compile(r"\bfront\s+en(?:s|c)emble\b|\bfront\s+ensemble\b|\bpit\b", re.I)),
    ("golden girl", re.compile(r"\bgolden\s+girls?\b", re.I)),
    ("goldrush", re.compile(r"\bgold\s*rush\b|\bgoldrush\b", re.I)),
    ("guard", re.compile(r"\bcolor\s*guard\b|\bcolour\s*guard\b|\bcolorguard\b|\bguard\b", re.I)),
    ("battery", re.compile(r"\bbattery\b|\bdrum\s*line\b|\bdrumline\b|\bsnares?\b|\b(?:marching\s+)?tenors?\b|\bquads?\b|\bquints?\b|\bbass\s+drums?\b|\bcymbals?\b", re.I)),
    ("sax/saxophone", re.compile(r"\b(?:(?:alto|tenor|baritone|bari|soprano)\s+)?sax(?:ophone)?s?\b", re.I)),
    ("flute/piccolo", re.compile(r"\bflutes?\b|\bpiccolos?\b", re.I)),
    ("clarinet", re.compile(r"\b(?:bass\s+)?clarinets?\b", re.I)),
    ("trumpet", re.compile(r"\btrumpets?\b|\bhorns?\b(?=\s*(?:,|/|;|$))", re.I)),
    ("mellophone", re.compile(r"\bmellophones?\b|\bmellos?\b", re.I)),
    ("trombone", re.compile(r"\btrombones?\b|\bbones?\b", re.I)),
    ("baritone", re.compile(r"\bbaritones?\b|\beuphoniums?\b|\beuphs?\b", re.I)),
    ("sousaphone", re.compile(r"\bsousaphones?\b|\btubas?\b", re.I)),
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
    sections = recognized_sections(text)
    if not sections:
        return None
    return ", ".join(SECTION_DISPLAY[item] for item in sections)


FORMAL_ROLE_ORDER = (
    "Drum Major",
    "Section Leader",
    "RAT Parent",
    "Props",
    "Operations",
    "MCM",
    "Staff Assistant",
)

FORMAL_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("Drum Major", re.compile(r"\bdrum\s+majors?\b", re.I)),
    ("Section Leader", re.compile(r"\bsection\s+leaders?\b", re.I)),
    ("RAT Parent", re.compile(r"\brat\s+parents?\b|\brat\s+(?:moms?|dads?)\b", re.I)),
    ("Props", re.compile(r"\bprops?\b", re.I)),
    ("Operations", re.compile(r"\boperations?\b|\bops\b", re.I)),
    ("MCM", re.compile(r"\bmcm\b", re.I)),
    ("Staff Assistant", re.compile(r"\bstaff\s+assistants?\b", re.I)),
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
    formal = canonical_formal_roles(formal_text)
    flags: list[str] = []
    if "Section Leader" in formal:
        flags.append("section-leader")
    if "Drum Major" in formal:
        flags.append("drum-major")
    if "RAT Parent" in formal:
        flags.append("rat-parent")
    if informal_roles_from_text(informal_text) or truthy(informal_flag):
        flags.append("informal-leadership")
    if any(role not in {"Section Leader", "Drum Major", "RAT Parent"} for role in formal):
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
    residual = re.sub(r"[,&;/|+()\[\]{}:_-]+", " ", residual)
    words = [w.casefold() for w in re.findall(r"[A-Za-z0-9']+", residual)]
    return [w for w in words if w not in SECTION_RESIDUAL_STOPWORDS]


def formal_roles_in_text(text: object) -> list[str]:
    raw = norm(text)
    found = [canonical for canonical, pattern in FORMAL_PATTERNS if pattern.search(raw)]
    return _dedupe(found)


def strip_formal_role_phrases(text: object) -> str:
    raw = norm(text)
    for _, pattern in FORMAL_PATTERNS:
        raw = pattern.sub(" ", raw)
    raw = re.sub(r"\s*(?:,|;|/|\||\band\b)\s*(?=(?:,|;|/|\||$))", " ", raw, flags=re.I)
    raw = re.sub(r"^(?:\s*(?:,|;|/|\||and)\s*)+|(?:\s*(?:,|;|/|\||and)\s*)+$", "", raw, flags=re.I)
    return norm(raw)
