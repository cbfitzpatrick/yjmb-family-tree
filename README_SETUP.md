# YJMB Full-Band Tree Tools — Four Name Columns

This version uses four name columns, in this exact order:

1. `Given/Preferred Name`
2. `Nickname`
3. `Family/Maiden Name`
4. `Married Name`

`Married Name` must remain blank unless the person is married and adopted their spouse's surname. It is not a general "current last name" or alternate-name field.

## Directory layout

The master workbook, scripts, generated spreadsheets, reports, cards, and tree images belong in:

```text
C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree
```

Existing templates, historical files, and section workbooks may remain in:

```text
C:\Users\Chris Fitz\Documents\Fun\Trumpet History\trumpettree
```

## Upgrade after completing the original steps 1–3

### 1. Close Excel and Python scripts

Close `YJMB Trees.xlsx` and any generated workbook before replacing the scripts. Excel lock files beginning with `~$` are skipped automatically.

### 2. Replace the toolkit files

Extract the supplied ZIP. Copy every file from the extracted folder into:

```text
C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree
```

Choose **Replace the files in the destination** when Windows asks. Do not delete:

```text
YJMB Trees.xlsx
.venv
```

### 3. Open the project and reactivate the existing environment

```powershell
cd "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree"

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1

python -m pip install -r .\requirements.txt
```

### 4. Preview upgrading the master workbook

This supports either the original one-column workbook or a workbook already changed to the earlier two-column format.

```powershell
python .\migrate_name_columns.py `
  --root "." `
  --dry-run
```

The script asks for confirmation when it sees possible nicknames, maiden/current-name annotations, unusual capitalization, spacing, or likely typographical matches.

Examples of the intended results:

```text
Anais El Akkad
Given/Preferred Name: Anais
Nickname:
Family/Maiden Name: El Akkad
Married Name:
```

```text
Anne Marie (Hutchinson) Milner
Given/Preferred Name: Anne Marie
Nickname:
Family/Maiden Name: Hutchinson
Married Name: Milner
```

The second result is not accepted silently in interactive mode; the script asks you to confirm that `Milner` is a spouse surname the person adopted.

### 5. Apply the master-workbook upgrade

```powershell
python .\migrate_name_columns.py `
  --root "."
```

A timestamped backup is created below:

```text
fullbandtree\backups\before_four_name_column_migration_YYYYMMDD_HHMMSS
```

### 6. Upgrade existing workbooks still in `trumpettree`

Preview:

```powershell
python .\migrate_name_columns.py `
  --root "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\trumpettree" `
  --cache ".\.name_resolution_cache.json" `
  --dry-run
```

Apply:

```powershell
python .\migrate_name_columns.py `
  --root "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\trumpettree" `
  --cache ".\.name_resolution_cache.json"
```

Using the same cache allows confirmed decisions to be reused in both directories.

## Prepare the form-response workbook

This creates a new workbook in `fullbandtree`; it never overwrites the downloaded source export.

```powershell
python .\prepare_form_responses.py `
  --input "C:\Users\Chris Fitz\Downloads\Copy of YJMB RAT_VET Trees Form (Responses) - Names Not Separated.xlsx" `
  --output ".\Copy of YJMB RAT_VET Trees Form (Responses) - Four Name Columns.xlsx" `
  --project-root "."
```

The `Cleaned Responses` worksheet begins with the same four name columns as the master workbook.

## Preview importing form responses

```powershell
python .\import_form_responses.py `
  --responses ".\Copy of YJMB RAT_VET Trees Form (Responses) - Four Name Columns.xlsx" `
  --project-root "." `
  --master ".\YJMB Trees.xlsx" `
  --dry-run
```

Apply after reviewing the preview:

```powershell
python .\import_form_responses.py `
  --responses ".\Copy of YJMB RAT_VET Trees Form (Responses) - Four Name Columns.xlsx" `
  --project-root "." `
  --master ".\YJMB Trees.xlsx"
```

To update standalone trumpet and baritone source workbooks at the same time, add:

```powershell
--sync-legacy
```

## Validate the result

```powershell
python .\validate_tree_data.py ".\YJMB Trees.xlsx"
```

Validation flags:

- Missing required name fields
- A married surname that duplicates the family/maiden surname
- Parenthetical or explanatory text left inside a surname field
- Quotation marks stored inside the Nickname field
- Invalid RAT years
- Duplicate person/year records
- Malformed or unresolved tree relationships

## Generate sorted workbooks and images

```powershell
python .\trumpetTreeMemberSorter.py
python .\baritoneTreeMemberSorter.py
python .\trumpetTreeChartGenerator.py
python .\baritoneTreeChartGenerator.py
python .\individualTreeGenerator.py
```

New outputs remain in `fullbandtree`.

## Name behavior in tree visualizations

The family/maiden surname remains the stable name used by existing VET/RAT relationship strings. This prevents a marriage-related surname change from breaking the tree links. `Married Name` is stored separately and is also considered when checking whether an imported response matches an existing person.

Nicknames continue to appear on cards using the existing quoted display format, but the spreadsheet stores the nickname without quote marks.

## Non-interactive testing

For automated testing only, suspicious automatic proposals can be accepted with:

```powershell
python .\migrate_name_columns.py `
  --root "." `
  --non-interactive `
  --accept-auto
```

Interactive review is recommended for the real data, especially for three-word names and any name containing parentheses, commas, slashes, `née`, `formerly`, or `married name`.
