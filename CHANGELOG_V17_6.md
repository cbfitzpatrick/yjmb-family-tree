# v17.6

- Added an Admin-only Feature Preview tab for testing prepared card icons and placement guides without enabling them for ordinary viewers or changing workbook data.
- Removed the duplicate bug emoji; the bug control now uses only the existing vector bug icon.
- Added an × close button to bug-report forms.
- Changed "Both" last-name display to render maiden/family and married/current surnames as normal adjacent name text, without a slash.
- Mobile tree toolbar now starts hidden and toggles on/off with a stationary tap on the tree; scrolling/panning does not toggle it.
- Replaced per-card section gradients with solid section colors arranged as light-to-dark ramps within each section family.
- Added cache-reloading circular-arrow controls to the tree toolbar and Admin header.
- Card text no longer reserves empty icon-corner space when the card has no rendered icons.
- When a person's canonical relationship identity (Given/Preferred + Family/Maiden name, RAT Year, or Instrument/Section) changes, VET/RAT cells that uniquely resolve to that row are rewritten to the new canonical relationship text and included in the encrypted changelog.
- Add Yourself preview uses the same solid section colors and slash-free last-name display behavior.
