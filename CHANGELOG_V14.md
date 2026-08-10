# v14 — Developer-only current workbook export

- Adds an owner-only Excel export path from the deployed tree.
- Requires both a valid normal access session and a separate high-entropy `DEVELOPER_EXPORT_KEY`.
- Keeps the developer export key out of GitHub, cookies, localStorage, and public JavaScript.
- Adds `MASTER_WORKBOOK_KEY_B64` to Cloudflare because the Worker decrypts the latest `secure/master_workbook.enc` server-side for an authorized export.
- Hidden owner command on the tree page: `Ctrl+Alt+Shift+E`; optional console command: `YJMBDeveloperExport()`.
- Adds constant-time developer-key verification and KV-backed rate limiting.
- Returns `.xlsx` with `Cache-Control: no-store`.
- Updates `initialize_security.py`, `print_security_setup.py`, Worker local-secret example, setup documentation, security documentation, and privacy verification.
