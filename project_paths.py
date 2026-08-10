"""Shared paths for the split YJMB project layout.

New scripts, the master workbook, generated workbooks, cards, trees, reports, and
images live in ``fullbandtree``. Existing source assets and historical workbooks
may remain in the sibling ``trumpettree`` directory.
"""
from __future__ import annotations

import os
from pathlib import Path

FULLBAND_DIR = Path(__file__).resolve().parent
DEFAULT_TRUMPETTREE_DIR = FULLBAND_DIR.parent / "trumpettree"
SOURCE_DIR = Path(os.environ.get("YJMB_SOURCE_DIR", DEFAULT_TRUMPETTREE_DIR)).expanduser().resolve()


def existing_file(filename: str) -> Path:
    """Prefer a file in fullbandtree, then fall back to legacy trumpettree."""
    local = FULLBAND_DIR / filename
    if local.exists():
        return local
    legacy = SOURCE_DIR / filename
    if legacy.exists():
        return legacy
    return local


def required_file(filename: str) -> Path:
    path = existing_file(filename)
    if not path.exists():
        raise FileNotFoundError(
            f"Could not find {filename!r} in either {FULLBAND_DIR} or {SOURCE_DIR}."
        )
    return path


def generated_path(filename: str) -> Path:
    """Return a path for a newly generated file in fullbandtree."""
    FULLBAND_DIR.mkdir(parents=True, exist_ok=True)
    return FULLBAND_DIR / filename
