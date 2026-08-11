# YJMB Family Tree v16

v16 is a cumulative refinement of v15. It does **not** change the Cloudflare Worker secret model, tree encryption model, GitHub Pages deployment target, workbook identity rules, or historical connected-tree placement rules.

## Section categorization now preserves subsection detail

`normalizeSectionNames.py` still canonicalizes broad site sections, but it no longer treats known subsection/instrument detail as disposable text.

Examples:

- `Alto Sax` -> `Sax/Saxophone — Alto Saxophone`
- `Tenor Saxophone` -> `Sax/Saxophone — Tenor Saxophone`
- `Snare` -> `Battery — Snare`
- `Quads` -> `Battery — Tenors/Quads`
- `Bass Drum` -> `Battery — Bass Drum`
- `Rifle` -> `Guard — Rifle`
- `Saber` / `Sabre` -> `Guard — Saber`
- `Piccolo` -> `Flute/Piccolo — Piccolo`
- `Bass Clarinet` -> `Clarinet — Bass Clarinet`
- `Marimba` -> `Front Ensemble — Marimba`

The broad canonical category is still what controls card color. Recognized details remain in the human-readable `Instrument` text. Unrecognized residual text is still reported rather than deleted.

The Add Yourself questionnaire now offers an optional specific instrument/subsection field for every selected section, with targeted prompts for saxophone and guard. Front Ensemble and Battery retain their existing required-detail behavior. Automatic secure submission application stores both the broad section and supplied detail while also keeping `Specific Instrument(s)`.

A v15 alias collision where `Tenor Saxophone` could also match Battery's `tenor` wording is fixed; Battery now recognizes `tenors` or `tenor drums` without misclassifying tenor saxophone.

## Smartphone tree UI

Desktop behavior remains unchanged outside requested v16 features. Under the phone breakpoint:

- the tree toolbar is compact and sticky;
- search stays prominent and search results use a phone-sized overlay;
- toolbar actions are horizontally scrollable instead of wrapping into a tall block;
- zoom controls use larger touch targets;
- a phone-only **Fit** control was added;
- phones start the tree at 80% instead of 100%;
- the tree viewport uses dynamic viewport height and touch-friendly scrolling;
- the Visualizer opens as a large scrollable phone panel;
- person details behave as a taller bottom sheet with sticky close/action areas;
- the leadership legend becomes single-column on narrow screens.

The desktop tree still starts at 100% and retains the existing toolbar/layout behavior.

## Bug report control

The visible `Report a bug` control is now a compact bug icon. Activating it opens the same bug/problem report form and sends the same administrator report payload as before.

## Compact spacing for isolated people

Connected family trees retain the historical `FAMILY_GAP = 200` separation. A person with **neither a VET nor a RAT** is treated as an isolated card and uses a much smaller inter-tree gap (`ISOLATED_PERSON_GAP = 55`). This avoids giving isolated records the whitespace reserved for full connected trees while preserving normal family geometry.

## Guard Captain leadership

`Guard Captain` is now a recognized formal leadership role and is treated as the color guard analogue of Section Leader.

- It can be classified from structured leadership data and high-confidence note wording.
- `Color Guard Captain` in a legacy Instrument cell classifies as formal `Guard Captain` while preserving `Guard` as the section during cleanup.
- Cards use a black color-guard flag icon inset beside the upper-left Section Leader area.
- The Visualizer leadership key and Add Yourself preview include the new icon.
- The Add Yourself formal leadership checklist includes Guard Captain.

## Married-name note cleanup

New `extractMarriedNamesFromNotes.py` scans note/comment fields for explicit current/married-name wording.

- scan-only by default;
- `--apply` writes only high-confidence proposals into blank `Married Name` cells;
- creates a timestamped backup before applying;
- reports conflicts and spouse-style wording such as `married to ...` for manual review;
- preserves the existing workbook schema: `Married Name` stores the changed/current surname;
- prints the derived full current name for each proposal.

The website person detail panel now displays the derived full `Current/Married Name`, and search already includes that current-name alias.

## Repository privacy hardening

`verify_public_repo.py` now fails closed if `git ls-files` cannot run or returns no tracked files. It no longer treats a failed Git index inspection as an empty/safe repository.

## Deployment

No Worker API route or secret changes are required for v16. Rebuild the encrypted site and encrypted master workbook, run the privacy verifier before and after staging, then commit/push normally.
