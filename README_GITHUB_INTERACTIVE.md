> **v14 note:** For current GitHub/Cloudflare security, owner workbook export, and deployment instructions, use `README.md`, `SECURITY.md`, and `GITHUB_SETUP.md`. The developer-only export requires the Worker secrets `MASTER_WORKBOOK_KEY_B64` and `DEVELOPER_EXPORT_KEY`.

# Protected GitHub Pages viewer — v13

The frontend remains publicly hostable on GitHub Pages, but sensitive tree content is published only as AES-256-GCM ciphertext.

v13 uses a Cloudflare Worker for:

- server-side validation of the three knowledge questions;
- signed 30-day remembered access sessions;
- delivery of the tree AES key only after session validation;
- optional Turnstile validation;
- server-side abuse/rate scoring;
- encryption and routing of Add Yourself submissions;
- protected automatic member updates, encrypted conflict review, and administrator changelog/revert controls.

The public repo contains no accepted answers, answer hashes, answer lengths, or answer-derived key wraps.

See `GITHUB_SETUP.md` for deployment and `SECURITY.md` for the threat model.
