# v12 changes

- Removed the full-band in-scene title banner; the first RAT-year band begins at y=0.
- Rotated RAT-year colors so the earliest displayed year is gold: Gold / White / Blue / White.
- Retained dynamic left-side year-label width from v11.
- Retained duplicate display-name support using row-backed person IDs.
- Retained context-sensitive Family/Last Name vs Family/Maiden Name website labels.
- Added three-screen full-page knowledge gate with requested fade transitions.
- Added encrypted loading/progress screen before the tree.
- Added AES-256-GCM encryption for the complete published tree payload, including card image bytes.
- Added local-only `access_secrets.json`; public JavaScript receives SHA-256 answer fingerprints rather than plaintext accepted answers.
- Added random data-key wrapping for each accepted answer combination using PBKDF2-SHA-256 + AES-256-GCM.
- Removed public plaintext `tree_data.json` and per-person `docs/assets/cards` output.
- Changed Add Yourself final submission from public GitHub Issues to private administrator email review.
- Removed the GitHub Issue workbook-update workflow from the public-repo package.
- Added public-repository safety verification and PowerShell build helper.
- Added GitHub-ready README and security notes.
