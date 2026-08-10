"""Portable font and name-card formatting helpers."""

from __future__ import annotations

from pathlib import Path
from PIL import ImageFont

from name_tools import normalize_spaces, propose_name_parts


def load_font(size: int, *, bold: bool = False):
    candidates = []
    if bold:
        candidates.extend(
            [
                Path("C:/Windows/Fonts/calibrib.ttf"),
                Path("C:/Windows/Fonts/arialbd.ttf"),
                Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
            ]
        )
    else:
        candidates.extend(
            [
                Path("C:/Windows/Fonts/calibri.ttf"),
                Path("C:/Windows/Fonts/arial.ttf"),
                Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            ]
        )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    # Pillow distributions commonly include DejaVuSans by font name.
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default()


def format_name_for_card(name: object) -> str:
    text = normalize_spaces(name)
    if not text:
        return ""
    if " RAT" in f" {text}" or " VET" in f" {text}" or text[:4].isdigit():
        first, separator, rest = text.partition(" ")
        return first + ("\n" + rest if separator else "")
    parts = propose_name_parts(text)
    if parts.family:
        return f"{parts.given}\n{parts.family}"
    return parts.given


def format_name_with_nickname(name: object, nickname: object) -> str:
    text = normalize_spaces(name)
    nick = normalize_spaces(nickname)
    if not nick:
        return text
    parts = propose_name_parts(text)
    if parts.family:
        return f'{parts.given} "{nick}" {parts.family}'
    return f'{parts.given} "{nick}"'
