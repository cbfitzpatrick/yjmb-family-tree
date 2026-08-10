# v15 data cleanup and debugging tools

All workbook-changing tools are **scan-only by default**. Add `--apply` only after reviewing the proposed changes. Every applying tool creates a timestamped copy under `backups/data_cleanup/` before writing.

## Normalize section names

Preview:

```powershell
python .\normalizeSectionNames.py
```

Apply deterministic canonicalizations:

```powershell
python .\normalizeSectionNames.py --apply
```

Canonical site sections are Flute/Piccolo, Clarinet, Sax/Saxophone, Trumpet, Mellophone, Trombone, Baritone, Sousaphone, Front Ensemble, Battery, Guard, Goldrush, and Golden Girl. Unexplained text is reported and left untouched rather than guessed.

## Classify leadership positions

Preview:

```powershell
python .\classifyLeadershipPositions.py
```

Apply:

```powershell
python .\classifyLeadershipPositions.py --apply
```

This preserves the existing structured fields and adds/updates `Leadership Position Classification`, for example:

```text
Formal: Drum Major; Formal: Section Leader; Informal: Hype Man
```

## Assign leadership from notes

Preview only:

```powershell
python .\assignLeadershipFromNotes.py
```

Apply high-confidence assignments:

```powershell
python .\assignLeadershipFromNotes.py --apply
```

To also scan `Favorite Tech Band Memory`:

```powershell
python .\assignLeadershipFromNotes.py --include-memory
```

The script only assigns explicit phrases such as Drum Major, Section Leader, RAT Parent, Props, Operations, MCM, Staff Assistant, and Hype Man variants. Generic words such as leader/captain/mentor are reported for review.

## Create a secret-safe debugging ZIP

Recommended default:

```powershell
python .\createSafeDebugBundle.py
```

The ZIP is written under `debug_bundles/` and includes a manifest of excluded files. It excludes actual secrets and also excludes plaintext workbook/member data by default.

If a future debugging chat specifically requires the workbook and you intentionally want to share its private member data:

```powershell
python .\createSafeDebugBundle.py --include-workbook
```

If rendered cards/tree images are also required:

```powershell
python .\createSafeDebugBundle.py --include-workbook --include-generated-images
```

`access_secrets.json`, `worker/.dev.vars`, `.env` files, private keys, and files containing known local secret values are excluded even with those opt-in switches.
