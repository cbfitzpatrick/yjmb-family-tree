#!/usr/bin/env python3

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SECRETS_FILE = ROOT / "access_secrets.json"
WORKER_DIR = ROOT / "worker"


def load_secrets() -> dict:
    if not SECRETS_FILE.exists():
        raise FileNotFoundError(
            f"Missing local secrets file:\n{SECRETS_FILE}"
        )

    return json.loads(SECRETS_FILE.read_text(encoding="utf-8"))


def wrangler_secret_value(data: dict, key: str) -> str:
    value = data[key]

    if isinstance(value, list):
        return json.dumps(value, separators=(",", ":"))

    return str(value)


def put_worker_secret(name: str, value: str) -> None:
    print(f"Setting Cloudflare Worker secret: {name}")

    result = subprocess.run(
        [
            "npx",
            "wrangler",
            "secret",
            "put",
            name,
        ],
        cwd=WORKER_DIR,
        input=value + "\n",
        text=True,
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"Wrangler failed while setting {name}."
        )


def main() -> int:
    data = load_secrets()

    worker_secrets = [
        ("ACCESS_STAGE_1_JSON", "stage1"),
        ("ACCESS_STAGE_2_JSON", "stage2"),
        ("ACCESS_STAGE_3_JSON", "stage3"),
        ("SESSION_SIGNING_KEY", "sessionSigningKey"),
        ("TREE_DATA_KEY_B64", "treeDataKey"),
        ("SUBMISSION_KEY_B64", "submissionKey"),
    ]

    print("This script will upload Worker secrets without printing their values.")
    print()

    for secret_name, json_key in worker_secrets:
        value = wrangler_secret_value(data, json_key)
        put_worker_secret(secret_name, value)

    print()
    print("Cloudflare Worker secrets configured successfully.")
    print()
    print("The following values still need to be entered manually")
    print("as GitHub Actions repository secrets:")
    print()
    print("  TREE_DATA_KEY_B64")
    print("  SUBMISSION_KEY_B64")
    print("  MASTER_WORKBOOK_KEY_B64")
    print()
    print("Their values remain in access_secrets.json and were not printed.")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)