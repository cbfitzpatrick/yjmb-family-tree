# v15 — Leadership icons, cleanup tools, frozen year rail, safe debug bundles

## Leadership data and card icons

The existing questionnaire/workbook distinction is preserved:

- `Marching Band Leadership Role(s)` = formal leadership roles. Current questionnaire options are Drum Major, Section Leader, RAT Parent, Props, Operations, MCM, and Staff Assistant.
- `Served in Informal Leadership Position` = Yes/No flag.
- `Informal Leadership Position(s)` = free-text informal role description (for example Hype Man or mentor).

Generated cards now draw minimalist black-on-transparent leadership symbols:

- Section Leader — three chevrons, upper-left.
- Drum Major — conductor baton, upper-right.
- RAT Parent — family-tree branch, lower-left.
- Informal leadership — megaphone, lower-right.
- Other formal leadership — outline star, inset beside the lower-right icon.

The Visualizer menu includes an icon key. Proposed Add Yourself preview cards also show the applicable icons.

## New cleanup/data tools

- `normalizeSectionNames.py` — scan/canonicalize section-name variants throughout Instrument, VET/RAT reference sections, Section Nickname(s), and Specific Instrument(s). Default is scan-only; `--apply` backs up the workbook before deterministic changes.
- `classifyLeadershipPositions.py` — creates/updates `Leadership Position Classification` labels such as `Formal: Drum Major; Informal: Hype Man`. Default is scan-only.
- `assignLeadershipFromNotes.py` — scans note/comment fields for high-confidence formal/informal leadership phrases and can union those roles into structured fields. Generic wording such as "leader" or "captain" is reported instead of guessed.
- `createSafeDebugBundle.py` — creates a debugging ZIP while always excluding access secrets, Worker local secret files, private keys, Git metadata, virtual environments, protected submission queues, and backups. Plaintext workbook/member data and name-bearing rendered images are excluded by default and require explicit opt-in.
- `yjmb_taxonomy.py` — shared commit-safe section and leadership normalization rules.

## Year rail fixes

The RAT-year rail no longer follows horizontal scrolling with a JavaScript `translateX(scrollLeft)` transform. The rail is a fixed overlay bound to the viewport and only its inner track follows vertical scrolling. This eliminates horizontal-scroll jitter.

A measured, unscaled gutter is reserved beside the frozen year rail. Fit-to-tree logic uses the same safe area, preventing the leftmost card/name from being covered when zoomed far out.
