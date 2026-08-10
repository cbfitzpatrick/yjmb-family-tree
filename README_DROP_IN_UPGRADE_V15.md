# v15 drop-in upgrade

This upgrade is designed to be copied over an already configured v14 project. It does not require changing access answers, Cloudflare secrets, GitHub Actions secrets, Worker routes, or encryption keys.

New source files:

- `yjmb_taxonomy.py`
- `normalizeSectionNames.py`
- `classifyLeadershipPositions.py`
- `assignLeadershipFromNotes.py`
- `createSafeDebugBundle.py`
- `README_V15_DATA_TOOLS.md`
- `CHANGELOG_V15.md`

Updated source/template files add leadership card icons, the icon key, a non-jittering frozen year rail, and a safe left gutter at small zoom levels.

After copying the upgrade into `fullbandtree`, rebuild and push normally:

```powershell
cd "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree"
.\.venv\Scripts\Activate.ps1
.\build-site.ps1 -SkipAmbiguities
python .\verify_public_repo.py
git add .
python .\verify_public_repo.py
git commit -m "Add leadership icons and data cleanup tools"
git push
```

No `wrangler deploy` is needed for v15 because the Worker API itself is unchanged.
