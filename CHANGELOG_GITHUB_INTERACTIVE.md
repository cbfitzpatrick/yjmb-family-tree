> **v14 note:** For current GitHub/Cloudflare security, owner workbook export, and deployment instructions, use `README.md`, `SECURITY.md`, and `GITHUB_SETUP.md`. The developer-only export requires the Worker secrets `MASTER_WORKBOOK_KEY_B64` and `DEVELOPER_EXPORT_KEY`.

# Interactive site changelog

The current implementation is **v13**. See `CHANGELOG_V13.md` for active behavior.

v12's client-side answer fingerprints/PBKDF2 key wrapping are superseded. v13 validates access answers only in Worker secrets and uses authenticated server key delivery.

Earlier v3-v11 plaintext/public-card and public-Issue submission designs are also superseded and should not be used for the public deployment.

## v15

- leadership icons embedded into generated cards plus a Visualizer icon key;
- formal/informal leadership cleanup/classification scripts;
- section-name normalization script;
- high-confidence leadership-from-notes scanner;
- fixed, non-jittering RAT-year rail with a safe left content gutter;
- secret-safe debugging ZIP generator.

## v17

v17 moves public card rendering into the browser, adds the protected administrator workspace and encrypted revertible changelog, makes ordinary authenticated member corrections/additions automatic subject to workbook conflict safety, separates personal/section nicknames, expands leadership history/Band Club fields, adds single-section family packing/color mode, and adds UI-only publishing that preserves the deployed encrypted tree payload. See `CHANGELOG_V17.md`.
