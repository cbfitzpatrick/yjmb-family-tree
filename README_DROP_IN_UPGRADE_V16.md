# v16 cumulative drop-in upgrade (includes v15)

This package is intended for a configured project that has **not yet applied v15**. It contains the required v15 files plus the v16 revisions, so do **not** install the old v15 drop-in first.

It does not contain or replace:

- `YJMB Trees.xlsx`
- `access_secrets.json`
- Worker `.dev.vars`
- your real secret values
- Git metadata

No Cloudflare Worker secret, GitHub secret, access-answer, encryption-key, route, or KV changes are required for v15/v16.

## 1. Close Excel and overlay the v16 files

Assuming the ZIP was extracted to Downloads:

```powershell
cd "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree"

Copy-Item `
  "$env:USERPROFILE\Downloads\yjmb_v16_cumulative_drop_in_upgrade\*" `
  "." `
  -Recurse `
  -Force
```

If your extracted folder is somewhere else, replace only the source path in that command.

## 2. Activate the existing virtual environment

```powershell
cd "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree"
.\.venv\Scripts\Activate.ps1
```

## 3. Scan the workbook cleanup changes first

```powershell
python .\classifyLeadershipPositions.py
python .\normalizeSectionNames.py
python .\assignLeadershipFromNotes.py
python .\extractMarriedNamesFromNotes.py
```

Nothing is written by these commands.

## 4. Apply only after reviewing the scan output

```powershell
python .\classifyLeadershipPositions.py --apply
python .\normalizeSectionNames.py --apply
python .\assignLeadershipFromNotes.py --apply
python .\classifyLeadershipPositions.py --apply
python .\extractMarriedNamesFromNotes.py --apply
```

Each applying cleanup tool creates a timestamped workbook backup under `backups\data_cleanup\` before modifying the master workbook.

If you want the note scanners to inspect `Favorite Tech Band Memory` too, run the corresponding scan/apply with `--include-memory`.

## 5. Build the v16 encrypted site

```powershell
.\build-site.ps1 -SkipAmbiguities
```

This rebuilds the GitHub Pages output and re-encrypts the protected master workbook using your existing local security configuration.

## 6. Verify before staging

```powershell
python .\verify_public_repo.py
```

v16 intentionally fails closed if it cannot inspect the Git index.

## 7. Review and stage

```powershell
git status
git diff --stat
git add .
```

## 8. Verify the staged repository again

```powershell
python .\verify_public_repo.py
git status
```

Do not commit if the verifier reports any sensitive/plaintext artifact.

## 9. Commit and push

```powershell
git commit -m "Upgrade YJMB family tree to v16"
git push
```

No `wrangler deploy` is needed because neither v15 nor v16 changes the Worker API implementation.
