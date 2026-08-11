# v17

Cumulative release; install directly over the pre-v15 project.

- Browser-rendered person cards; normal site builds create only card geometry locally and no longer render/save personalized card art or depend on local card PNG generation.
- Personal nickname display preference: given name, nickname, or both; section nicknames remain separate fields.
- Additive v17 workbook schema migration, including guaranteed Favorite Tech Band Memory storage.
- Marching-band leadership history rows with Formal/Informal selector, optional years, canonical formal-role dropdown, and Other.
- Separate Band Club leadership history and status icon.
- Current-RAT GT cap icon supplied by the project owner; older section/formal/informal corner icons disabled.
- Black RAT/VET connectors with a 2px white outline.
- Single-section Apply/Load view: complete matching families packed side-by-side; selected section white, relatives #d5defe, mixed-section members split white/blue.
- Protected Admin Mode using normal access + DEVELOPER_EXPORT_KEY: tree/card editor, spreadsheet editor, protected request queue, unreciprocated relationship validation, uncategorized-instrument mapping, encrypted changelog/revert, workbook export.
- Ordinary authenticated member additions/corrections enter automatic protected processing; structural workbook conflicts are held instead of overwritten.
- Applied updates create encrypted cell-level changelog entries; safe revert refuses to overwrite cells changed again later.
- Conservative married-name notes scanner continues to write only blank Married Name cells and never Family/Maiden Name.
- UI-only publishing script preserves/retrieves the currently deployed encrypted tree payload instead of rebuilding it.
- Favorite Tech Band Memory is an explicit additive workbook field and survives website generation plus protected workbook encrypt/decrypt/export round trips.
- Frozen year rail meets the tree stage without an added black gutter; zoom buttons preserve the viewport focus point.
- Root README reduced to a minimal operator summary; user-facing detail moved to the tree-page info dialog.
- Public-repository verifier remains fail-closed.
