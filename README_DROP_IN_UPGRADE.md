# v14 drop-in upgrade

Copy the contents of this folder over the existing `fullbandtree` project.

This patch intentionally does **not** contain or overwrite:

- `YJMB Trees.xlsx`
- `access_secrets.json`
- `.venv/`
- `web_template/site_config.json` (keeps your Worker URL / Turnstile site key)
- `worker/wrangler.jsonc` (keeps your deployed Worker name, KV namespace ID, and variables)
- generated `docs/`
- `secure/master_workbook.enc`

After copying, run `python .\initialize_security.py`; it preserves existing secrets and adds `developerExportKey` only if missing. Then set Cloudflare secrets `MASTER_WORKBOOK_KEY_B64` and `DEVELOPER_EXPORT_KEY`, deploy the Worker, rebuild the site, commit, and push. See `GITHUB_SETUP.md`.
