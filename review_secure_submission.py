#!/usr/bin/env python3
from __future__ import annotations
import argparse, json
from pathlib import Path
from secure_submission import decrypt_file
ap=argparse.ArgumentParser(); ap.add_argument('file',type=Path); a=ap.parse_args()
print(json.dumps(decrypt_file(a.file),indent=2,ensure_ascii=False))
