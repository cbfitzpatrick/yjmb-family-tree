# v16 data cleanup tools

All workbook-mutating tools are **scan-only by default**. `--apply` is required to write, and applying tools create timestamped backups under `backups/data_cleanup/`.

## Recommended cumulative cleanup order from pre-v15

Run these scans first:

```powershell
python .\classifyLeadershipPositions.py
python .\normalizeSectionNames.py
python .\assignLeadershipFromNotes.py
python .\extractMarriedNamesFromNotes.py
```

After reviewing the output, apply in this order:

```powershell
python .\classifyLeadershipPositions.py --apply
python .\normalizeSectionNames.py --apply
python .\assignLeadershipFromNotes.py --apply
python .\classifyLeadershipPositions.py --apply
python .\extractMarriedNamesFromNotes.py --apply
```

The first classification pass protects legacy mixed values such as `Trumpet and Drum Major` or `Color Guard Captain` before section normalization removes leadership wording. The second classification pass refreshes the human-readable classification column after leadership found in notes has been added.

## Section normalization with subsection retention

Preview:

```powershell
python .\normalizeSectionNames.py
```

Apply:

```powershell
python .\normalizeSectionNames.py --apply
```

v16 retains known details in the normalized `Instrument` value. Examples include `Sax/Saxophone — Alto Saxophone`, `Battery — Snare`, and `Guard — Rifle`. Unknown extra wording is still left unchanged and reported for manual review.

## Leadership from notes

`Guard Captain` is now a high-confidence formal role alongside Drum Major, Section Leader, RAT Parent, Props, Operations, MCM, and Staff Assistant. An unqualified word such as `captain` remains ambiguous.

To include Favorite Tech Band Memory in a leadership scan:

```powershell
python .\assignLeadershipFromNotes.py --include-memory
```

## Married/current names from notes

Preview:

```powershell
python .\extractMarriedNamesFromNotes.py
```

Apply only high-confidence blank-field proposals:

```powershell
python .\extractMarriedNamesFromNotes.py --apply
```

Optionally include Favorite Tech Band Memory:

```powershell
python .\extractMarriedNamesFromNotes.py --include-memory
```

The script recognizes explicit wording such as `married name: Smith`, `married name is Jane Smith`, `current name: Jane Smith`, or `now known as Jane Smith`. It deliberately does not infer a person's surname from phrases such as `married to John Smith`.

`Married Name` remains the current/married surname field. The site derives and displays the person's full current name from Given/Preferred Name + Married Name.
