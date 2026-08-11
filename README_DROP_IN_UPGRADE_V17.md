# v17 cumulative drop-in

Use this package directly on the existing project even if v15 and v16 were never installed. Do not install v15/v16 first.

The drop-in intentionally excludes `YJMB Trees.xlsx`, `access_secrets.json`, `web_template/site_config.json`, Worker `.dev.vars`, Wrangler account/KV configuration, generated encrypted data, and Git metadata.

Recommended order:

```powershell
cd "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree"
.\.venv\Scripts\Activate.ps1

python .\migrateWorkbookV17.py
python .\classifyLeadershipPositions.py
python .\normalizeSectionNames.py
python .\assignLeadershipFromNotes.py
python .\extractMarriedNamesFromNotes.py
```

Review the scan output. Then apply the additive migration and desired cleanup passes:

```powershell
python .\migrateWorkbookV17.py --apply
python .\classifyLeadershipPositions.py --apply
python .\normalizeSectionNames.py --apply
python .\assignLeadershipFromNotes.py --apply
python .\classifyLeadershipPositions.py --apply
python .\extractMarriedNamesFromNotes.py --apply
```

Every workbook-mutating cleanup/migration tool creates a backup before writing.

The browser renders person cards from encrypted structured data; this normal site-build path does not render or save personalized card art locally.

Build the encrypted site/master workbook:

```powershell
.\build-site.ps1 -SkipAmbiguities
python .\verify_public_repo.py
```

v17 changes the Cloudflare Worker source, so deploy it after overlaying the files. Existing secrets are reused; no secret values need to be pasted into source:

```powershell
cd .\worker
npm install
npx wrangler deploy
cd ..
```

Then stage/verify/commit:

```powershell
git status
git add .
python .\verify_public_repo.py
git status
git commit -m "Upgrade YJMB family tree to v17"
git push
```

For a UI-only Pages change that must preserve the currently deployed encrypted tree data:

```powershell
.\publish-ui-only.ps1
python .\verify_public_repo.py
git add docs
python .\verify_public_repo.py
git commit -m "Update YJMB site UI"
git push
```
