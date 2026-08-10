#!/usr/bin/env python3
"""Fail fast if privacy-sensitive plaintext artifacts are present in the public build/repo."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DOCS = ROOT / "docs"

PROHIBITED_PUBLIC_PATHS = [
    DOCS / "data" / "tree_data.json",
    DOCS / "assets" / "cards",
    DOCS / "access_config.js",
]
PROHIBITED_TRACKED_SUFFIXES = {".xlsx", ".xls", ".xlsm", ".csv"}
PROHIBITED_TRACKED_PARTS = {"backups", "cards", "trees", ".venv"}
PROHIBITED_TRACKED_NAMES = {"access_secrets.json", "process-tree-submission.yml", ".dev.vars", ".env", "access_config.js"}


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def tracked_files() -> list[Path]:
    try:
        result = subprocess.run(
            ["git", "ls-files"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return []
    return [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]




def local_secret_values() -> dict[str, str]:
    path = ROOT / "access_secrets.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"Local access_secrets.json is invalid JSON: {exc}")
    values: dict[str, str] = {}
    for key in ("treeDataKey", "submissionKey", "masterWorkbookKey", "sessionSigningKey", "developerExportKey"):
        value = str(data.get(key, ""))
        if len(value) >= 12:
            values[key] = value
    return values


def ensure_local_secrets_not_tracked() -> None:
    secrets = local_secret_values()
    if not secrets:
        return
    leaks: list[str] = []
    for path in tracked_files():
        full = ROOT / path
        if not full.is_file():
            continue
        try:
            text = full.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for name, value in secrets.items():
            if value in text:
                leaks.append(f"{path} contains local secret value {name}")
    if leaks:
        fail("Local secret material appears in tracked text files:\n  " + "\n  ".join(sorted(leaks)))

def main() -> int:
    for path in PROHIBITED_PUBLIC_PATHS:
        if path.exists():
            fail(f"Remove stale plaintext public artifact: {path.relative_to(ROOT)}")

    encrypted = DOCS / "data" / "tree_data.enc"
    if not encrypted.exists():
        fail("docs/data/tree_data.enc does not exist. Run fullBandTreeGenerator.py first.")
    try:
        envelope = json.loads(encrypted.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"Encrypted tree bundle is not valid JSON: {exc}")
    if envelope.get("format") != "yjmb-tree-encrypted-v3":
        fail("docs/data/tree_data.enc is not the expected encrypted format.")
    if envelope.get("cipher") != "AES-256-GCM":
        fail("Encrypted tree bundle does not report AES-256-GCM.")
    if not envelope.get("ciphertext"):
        fail("Encrypted tree bundle has no ciphertext.")
    if envelope.get("keyDelivery") != "authenticated-server-session":
        fail("Encrypted tree bundle must use authenticated-server-session key delivery.")
    if envelope.get("keyWraps") or envelope.get("wrappedKey"):
        fail("Public tree bundle must not contain answer-derived wrapped keys.")

    config_path = DOCS / "site_config.json"
    if not config_path.exists():
        fail("docs/site_config.json is missing.")
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"docs/site_config.json is invalid JSON: {exc}")
    if config.get("githubRepository") != "cbfitzpatrick/yjmb-family-tree":
        fail("docs/site_config.json must use githubRepository cbfitzpatrick/yjmb-family-tree.")
    worker = str(config.get("workerApiBase", ""))
    if "REPLACE-WITH" in worker or not worker.startswith("https://"):
        print("WARNING: docs/site_config.json workerApiBase is still a placeholder. Configure it before publishing.")

    bad_tracked: list[str] = []
    for path in tracked_files():
        lowered = {part.lower() for part in path.parts}
        if path.name.lower() in PROHIBITED_TRACKED_NAMES:
            bad_tracked.append(str(path))
        elif path.suffix.lower() in PROHIBITED_TRACKED_SUFFIXES:
            bad_tracked.append(str(path))
        elif lowered & PROHIBITED_TRACKED_PARTS:
            bad_tracked.append(str(path))
        elif str(path).replace('\\', '/') in {"docs/data/tree_data.json"}:
            bad_tracked.append(str(path))
        elif len(path.parts) >= 3 and path.parts[:3] == ("docs", "assets", "cards"):
            bad_tracked.append(str(path))
    if bad_tracked:
        fail("Privacy-sensitive files are tracked by Git:\n  " + "\n  ".join(sorted(bad_tracked)))

    ensure_local_secrets_not_tracked()

    print("Public-repository privacy check passed.")
    print("  - encrypted bundle present: docs/data/tree_data.enc")
    print("  - no plaintext docs/data/tree_data.json")
    print("  - no public name-bearing docs/assets/cards directory")
    print("  - no public access-answer fingerprints or answer-derived key wraps")
    print("  - no local cryptographic/developer export secret value found in tracked text files")
    if tracked_files(): print("  - no workbook/data/backups/cards/trees tracked by Git")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
