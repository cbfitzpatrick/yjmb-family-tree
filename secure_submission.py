#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

FORMAT = "yjmb-secure-submission-v1"
CIPHER = "AES-256-GCM"


def load_key() -> bytes:
    raw = os.environ.get("SUBMISSION_KEY_B64", "").strip()
    if not raw:
        path = Path(__file__).resolve().parent / "access_secrets.json"
        if path.exists():
            raw = json.loads(path.read_text(encoding="utf-8")).get("submissionKey", "")
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise ValueError("SUBMISSION_KEY_B64/submissionKey must decode to 32 bytes.")
    return key


def encrypt_value(value: Any) -> dict[str, str]:
    iv = os.urandom(12)
    plaintext = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ciphertext = AESGCM(load_key()).encrypt(iv, plaintext, None)
    return {
        "format": FORMAT,
        "cipher": CIPHER,
        "iv": base64.b64encode(iv).decode("ascii"),
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
    }


def encrypt_file(value: Any, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(encrypt_value(value), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def decrypt_value(envelope: dict[str, Any]) -> Any:
    if envelope.get("format") != FORMAT:
        raise ValueError("Unsupported secure submission format.")
    if envelope.get("cipher") not in {None, CIPHER}:
        raise ValueError("Unsupported secure submission cipher.")
    plaintext = AESGCM(load_key()).decrypt(
        base64.b64decode(envelope["iv"]),
        base64.b64decode(envelope["ciphertext"]),
        None,
    )
    return json.loads(plaintext)


def decrypt_file(path: Path) -> Any:
    return decrypt_value(json.loads(path.read_text(encoding="utf-8")))


def main() -> None:
    ap = argparse.ArgumentParser(description="Encrypt/decrypt protected YJMB submission envelopes.")
    sub = ap.add_subparsers(dest="command")
    dec = sub.add_parser("decrypt")
    dec.add_argument("input", type=Path)
    dec.add_argument("--output", type=Path)
    enc = sub.add_parser("encrypt")
    enc.add_argument("input", type=Path, help="Plain JSON input")
    enc.add_argument("--output", type=Path, required=True)
    # Backward-compatible old invocation: secure_submission.py FILE [--output FILE]
    ap.add_argument("legacy_input", nargs="?", type=Path)
    ap.add_argument("--output", dest="legacy_output", type=Path)
    args = ap.parse_args()

    if args.command == "encrypt":
        value = json.loads(args.input.read_text(encoding="utf-8"))
        encrypt_file(value, args.output)
        return
    if args.command == "decrypt":
        data = decrypt_file(args.input)
        text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        if args.output:
            args.output.write_text(text, encoding="utf-8")
        else:
            print(text, end="")
        return
    if args.legacy_input:
        data = decrypt_file(args.legacy_input)
        text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        if args.legacy_output:
            args.legacy_output.write_text(text, encoding="utf-8")
        else:
            print(text, end="")
        return
    ap.print_help()


if __name__ == "__main__":
    main()
