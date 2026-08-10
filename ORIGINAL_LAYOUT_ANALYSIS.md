# Original YJMB tree layout: validated behavior

This document records the layout behavior traced from the original supplied
`trumpetTreeChartGenerator.py`, `baritoneTreeChartGenerator.py`,
`individualTreeGenerator.py`, and member sorter scripts.

## 1. Horizontal card placement

The original full-section generators do not place every card independently.
They first give an x coordinate only to terminal nodes (people with no RATs).

- The first terminal card starts at x = 200.
- Each subsequent terminal card advances by 170 pixels.
- The card template is 150 pixels wide, so adjacent terminal cards have a
  20-pixel clear gap.
- When traversal reaches a different disconnected tree, an additional 200
  pixels is inserted before that tree's first terminal card. This makes the
  visible inter-tree gap 220 pixels instead of 20 pixels.

After all terminal cards have x coordinates, the code repeatedly works upward.
A VET receives the rounded arithmetic mean of the left-edge x coordinates of
its direct RAT cards. Because every card is the same width, averaging left
edges is equivalent to averaging card centers.

**Nuance:** this is not a general-purpose subtree bounding-box layout. It
ensures terminal cards have distinct horizontal slots, and every parent sits at
the centroid of its direct children. With three or more children of very
unequal subtree widths, that centroid is not necessarily the midpoint between
the furthest descendant leaves. The supplied data nevertheless produces
non-overlapping year rows.

## 2. RAT-year rows

The original full-section charts use:

- 300-pixel header area.
- 100-pixel row for every RAT year from the minimum through maximum year.
- Row colors repeating: white, navy, white, gold.
- The color cycle starts at the minimum year in that generated chart; a
  particular calendar year is not permanently assigned one color.

A card's top y coordinate is:

`300 + 100 * (RAT year - minimum year) + (100 - card height) / 2`

The original card is 80 pixels high, so the card is vertically centered in the
100-pixel row with 10 pixels above and below it.

`individualTreeGenerator.py` uses the same 100-pixel year rows but a smaller
180-pixel header.

## 3. VET/RAT connectors

For one RAT, the original code draws a single vertical gray connector from the
bottom center of the VET card to the top center of the RAT card. Since a parent
with one child inherits that child's x coordinate, no horizontal leg is needed.

For multiple RATs, the original visual is:

1. A short vertical stem from the VET card's bottom center.
2. A horizontal gray bus spanning from the center of the leftmost direct RAT
   card to the center of the rightmost direct RAT card.
3. One vertical stem from that bus down to the top center of every RAT card.

The bus is positioned approximately midway between the VET card and the
nearest child row. The implementation uses filled rectangles rather than line
primitives, producing the thick gray elbow-connector appearance.

## 4. Sibling ordering

The old graph generator itself does **not** explicitly call a sort function on
siblings. `anytree.RenderTree` visits children in the order in which the nodes
were attached.

In the supplied sorted workbooks, that construction order already produces the
intended behavior:

1. Earlier RAT year to the left.
2. For same-year siblings, family/last name alphabetically.

The member sorter and the pre-existing RAT columns are doing part of the work
implicitly. This means the old result is correct for the supplied data but the
rule is not robustly encoded in the renderer.

The refactored full-band generator makes this rule explicit by sorting direct
children by:

`RAT year -> Family/Maiden Name -> Given/Preferred Name -> workbook row`

The source RAT-column order remains only a final relationship-resolution
reference, not the visual ordering mechanism.

## 5. Disconnected tree ordering

The original section generator explicitly sorts roots by the first four digits
of RAT year. Python's sort is stable, so roots tied on year retain their prior
workbook/construction order. It does not explicitly alphabetize same-year
roots.

The refactored generator preserves that behavior:

`root RAT year -> workbook row`

## 6. Refactored card geometry

Each generated card is now represented by `CardObject`.

For the current 150 x 80 template:

- `local_vet_connection = (75, 1)`
- `local_rat_connection = (75, 78)`

The y coordinates are intentionally one/two pixels inside the image boundary to
match the way the old thick connector rectangles touched the card edge.

When the card is placed in the complete full-band scene, `CardObject` records:

- `global_top_left`
- `global_vet_connection`
- `global_rat_connection`

For example, a card at `(200, 310)` has:

- global VET connection `(275, 311)`
- global RAT connection `(275, 388)`

Per-family tree placements are stored separately and do not overwrite these
full-tree global coordinates.
