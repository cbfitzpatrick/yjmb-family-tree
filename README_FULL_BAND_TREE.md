# Full-band tree builder — v13

`fullBandTreeGenerator.py` remains the authoritative local builder for card geometry, family-tree layout, section colors, duplicate-name row identities, website data, and encrypted GitHub Pages output.

Current public-site behavior is documented in `README.md`, `SECURITY.md`, and `GITHUB_SETUP.md`.

Important v13 difference: the builder no longer exports access-answer hashes or answer-derived key wraps. It encrypts `docs/data/tree_data.enc` with the random 256-bit key supplied by local `access_secrets.json` / `TREE_DATA_KEY_B64`. The deployed access Worker validates the three questions and supplies that key only to a valid signed session.

Typical local build:

```powershell
.\.venv\Scripts\Activate.ps1
.\build-site.ps1 -SkipAmbiguities
```

Direct generator equivalent:

```powershell
python .\fullBandTreeGenerator.py `
  --output-mode giant `
  --skip-png `
  --skip-svg `
  --skip-ambiguities
```

`build-site.ps1` additionally creates `secure/master_workbook.enc` and runs the public-repository privacy audit.
