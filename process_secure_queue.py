#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from apply_secure_submission import ReviewRequired, apply
from secure_submission import decrypt_file, encrypt_file


def main() -> None:
    ap = argparse.ArgumentParser(description="Apply encrypted YJMB web updates and write an encrypted revertible changelog.")
    ap.add_argument("--workbook", type=Path, required=True)
    ap.add_argument("--queue", type=Path, default=Path(".secure_submissions/auto"))
    ap.add_argument("--review-dir", type=Path, default=Path(".secure_submissions/review"))
    ap.add_argument("--changelog-dir", type=Path, default=Path("secure/changelog"))
    ap.add_argument("--result", type=Path, default=Path("queue_result.json"))
    args = ap.parse_args()
    args.review_dir.mkdir(parents=True, exist_ok=True)
    args.changelog_dir.mkdir(parents=True, exist_ok=True)
    result = {"applied": [], "review": []}

    for encrypted_path in sorted(args.queue.glob("*.enc.json")):
        submission_id = encrypted_path.name.removesuffix(".enc.json")
        temp = Path(f".secure-submission-{submission_id}.json")
        try:
            protected = decrypt_file(encrypted_path)
            temp.write_text(json.dumps(protected, ensure_ascii=False), encoding="utf-8")
            try:
                info = apply(args.workbook, temp, changelog_dir=args.changelog_dir)
                applied_at = datetime.now(timezone.utc)
                change_id = f"{applied_at.strftime('%Y%m%dT%H%M%S%fZ')}_{submission_id}"
                changelog = {
                    "id": change_id,
                    "submissionId": submission_id,
                    "appliedAt": applied_at.isoformat(),
                    "receivedAt": protected.get("receivedAt"),
                    "kind": info.get("kind"),
                    "summary": info.get("summary"),
                    "row": info.get("row"),
                    "name": info.get("name"),
                    "changes": info.get("changes") or [],
                    "source": "admin" if str(info.get("kind", "")).startswith("admin-") else "member",
                }
                encrypt_file(changelog, args.changelog_dir / f"{change_id}.enc.json")
                result["applied"].append({
                    "id": submission_id,
                    "row": info.get("row"),
                    "kind": info.get("kind"),
                    "summary": info.get("summary"),
                    "changes": len(info.get("changes") or []),
                    "changeId": change_id,
                })
                encrypted_path.unlink()
            except ReviewRequired as exc:
                destination = args.review_dir / encrypted_path.name
                if destination.exists():
                    destination.unlink()
                shutil.move(str(encrypted_path), str(destination))
                result["review"].append({
                    "id": submission_id,
                    "path": str(destination).replace("\\", "/"),
                    "reason": str(exc),
                })
        except Exception as exc:
            destination = args.review_dir / encrypted_path.name
            if encrypted_path.exists():
                if destination.exists():
                    destination.unlink()
                shutil.move(str(encrypted_path), str(destination))
            result["review"].append({
                "id": submission_id,
                "path": str(destination).replace("\\", "/"),
                "reason": f"Queue processing error: {type(exc).__name__}: {exc}",
            })
        finally:
            temp.unlink(missing_ok=True)

    args.result.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
