# v17.5

- Regular correction pages can create a missing RAT person row from `Name (RAT Year) (Section)` and immediately write the reciprocal VET on the new row. Existing people are never duplicated or silently overwritten.
- Added independent card surname preference: Family/Maiden, Married/Current, or Both.
- Personal and section nicknames remain separate; first-name card preference remains First/Preferred, Nickname, or Both.
- Removed the visible Admin tree-toolbar control. Admin Mode opens with `Ctrl+Alt+Shift+A` or `YJMBAdminMode()` and still requires the developer export key.
- Moved the tree-page bug control into the upper toolbar; other-page bug controls are unchanged.
- All card icons remain disabled. Prepared future icon mapping now treats the supplied cap as RAT Parent, with supplied Section Leader/Band Club assets plus Drum Major gloves, MCM camera, Libraries book, and Uniforms uniform glyphs.
- Replaced section fills with four non-red gradient families: aqua woodwinds, green brass, violet percussion, orchid visual groups; unknown remains gray.
- Tree view state now persists locally across navigation (zoom, scroll location, selected person, focused family, applied section view).
- Search selection clears the search query/dimming while keeping the selected card and sidebar active.
- Browser and Admin tree cards now approximate the original Python card typography: Arial regular, 22px starting size, centered two-line name layout.
- Data-entry Back to family tree navigation is sticky.
- UI-only publishing includes the new icon assets.
