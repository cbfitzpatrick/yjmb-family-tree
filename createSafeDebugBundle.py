#!/usr/bin/env python3
"""Create a ChatGPT/debug ZIP without authentication or encryption secrets.

Safe defaults exclude plaintext member workbooks and generated name-bearing card
images too. Use --include-workbook only when the workbook itself is required for
debugging and you intentionally want to share that private member data.

The script always excludes access_secrets.json, Worker .dev.vars/.env files,
private keys, Git metadata, virtual environments, node_modules, and common token
files. It also reads known local secret values (when available) and refuses to
include text files containing those exact values.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import zipfile
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = SCRIPT_DIR / "debug_bundles"

ALWAYS_EXCLUDE_NAMES = {
    "access_secrets.json", ".dev.vars", ".env", ".env.local", ".npmrc", ".pypirc",
    "id_rsa", "id_ed25519", "credentials", "credentials.json",
}
ALWAYS_EXCLUDE_DIRS = {
    ".git", ".venv", "venv", "node_modules", ".wrangler", "__pycache__", "debug_bundles",
}
PRIVATE_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".cer", ".crt"}
TEXT_SUFFIXES = {
    ".py", ".js", ".mjs", ".cjs", ".html", ".css", ".json", ".jsonc", ".md", ".txt",
    ".yml", ".yaml", ".toml", ".ini", ".cfg", ".ps1", ".sh", ".bat", ".cmd", ".xml",
    ".properties", ".gitignore",
}
TOKEN_PATTERNS = [
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
]


def load_known_secrets(root: Path) -> list[str]:
    path = root / "access_secrets.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    values: list[str] = []
    def walk(value):
        if isinstance(value, dict):
            for child in value.values(): walk(child)
        elif isinstance(value, list):
            for child in value: walk(child)
        elif isinstance(value, str) and len(value) >= 12:
            values.append(value)
    walk(data)
    return values


def text_contains_secret(path: Path, known: list[str]) -> str | None:
    if path.suffix.casefold() not in TEXT_SUFFIXES and path.name != ".gitignore":
        return None
    if path.stat().st_size > 5_000_000:
        return None
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return "could not safely inspect text"
    for value in known:
        if value and value in text:
            return "contains a value from access_secrets.json"
    for pattern in TOKEN_PATTERNS:
        if pattern.search(text):
            return f"matches secret/token pattern {pattern.pattern!r}"
    return None


def should_exclude(path: Path, root: Path, *, include_workbook: bool, include_generated_images: bool) -> str | None:
    rel = path.relative_to(root)
    parts = set(rel.parts[:-1])
    if parts & ALWAYS_EXCLUDE_DIRS:
        return "excluded directory"
    if path.name in ALWAYS_EXCLUDE_NAMES:
        return "secret/local credential filename"
    if path.suffix.casefold() in PRIVATE_SUFFIXES:
        return "private key/certificate file"
    rel_posix = rel.as_posix().casefold()
    if rel_posix.startswith("backups/"):
        return "local backup"
    if rel_posix.startswith(".secure_submissions/"):
        return "protected submission queue"
    if path.name.startswith("~$"):
        return "Excel temporary owner file"
    if path.suffix.casefold() in {".xlsx", ".xls", ".xlsm", ".csv"} and not include_workbook:
        return "plaintext workbook/data excluded by safe default"
    if not include_generated_images and (rel_posix.startswith("cards/") or rel_posix.startswith("trees/")):
        return "generated name-bearing image excluded by safe default"
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Create a secret-safe YJMB debugging ZIP.")
    ap.add_argument("--root", type=Path, default=SCRIPT_DIR)
    ap.add_argument("--output", type=Path, default=None)
    ap.add_argument("--include-workbook", action="store_true", help="Include plaintext spreadsheet/CSV data. This can contain private member information.")
    ap.add_argument("--include-generated-images", action="store_true", help="Include cards/trees folders, which can contain names in images.")
    args = ap.parse_args()

    root = args.root.expanduser().resolve()
    output_dir = DEFAULT_OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.output:
        output = args.output.expanduser().resolve()
    else:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = output_dir / f"yjmb_debug_bundle_{stamp}.zip"

    known = load_known_secrets(root)
    included: list[str] = []
    excluded: list[tuple[str, str]] = []

    candidates = sorted((p for p in root.rglob("*") if p.is_file()), key=lambda p: p.as_posix().casefold())
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=7) as zf:
        for path in candidates:
            if path.resolve() == output.resolve():
                continue
            reason = should_exclude(path, root, include_workbook=args.include_workbook, include_generated_images=args.include_generated_images)
            if reason is None:
                reason = text_contains_secret(path, known)
            rel = path.relative_to(root).as_posix()
            if reason:
                excluded.append((rel, reason))
                continue
            zf.write(path, arcname=rel)
            included.append(rel)

        manifest = [
            "YJMB SAFE DEBUG BUNDLE",
            f"Created: {datetime.now().isoformat(timespec='seconds')}",
            f"Root: {root}",
            f"Included files: {len(included)}",
            f"Excluded files: {len(excluded)}",
            "",
            "SECURITY NOTES",
            "- access_secrets.json and Worker local secret files are always excluded.",
            "- Text files are scanned against known local secret values and common token patterns.",
            f"- Plaintext workbook/data included: {'YES' if args.include_workbook else 'NO'}",
            f"- Generated name-bearing images included: {'YES' if args.include_generated_images else 'NO'}",
            "",
            "EXCLUDED FILES",
            *[f"{name} :: {reason}" for name, reason in excluded],
        ]
        zf.writestr("DEBUG_BUNDLE_MANIFEST.txt", "\n".join(manifest) + "\n")

    print(f"Created: {output}")
    print(f"Included files: {len(included)}")
    print(f"Excluded files: {len(excluded)}")
    if not args.include_workbook:
        print("Plaintext workbook/data was NOT included. Use --include-workbook only when intentionally sharing private member data.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
