# v13

- Added 30-day remembered access using a signed opaque browser cookie/session token.
- Removed public answer hashes and all answer-derived key wraps.
- Moved all three access-answer checks to Cloudflare Worker secrets.
- Changed encrypted tree format from `yjmb-tree-encrypted-v2` to `yjmb-tree-encrypted-v3`.
- Tree AES key is now delivered only after authenticated Worker session validation.
- Added protected automatic Add Yourself submission endpoint.
- Added server-side abuse scoring, privacy-hashed rate counters, duplicate-submission detection, and optional Turnstile verification.
- Added encrypted `.secure_submissions/auto/` and `.secure_submissions/review/` queues.
- Added encrypted master workbook for protected GitHub Actions updates.
- Added safe auto-application script with fail-to-review behavior on duplicate/conflicting relationships.
- Added admin approval workflow for encrypted review submissions.
- Added local security/key initialization, encrypted-workbook, encrypted-submission, review, and privacy-audit utilities.
- Existing profile correction requests remain human-reviewed.
