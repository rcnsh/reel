# HTML overflow and clipping allow slack, more of it vertically

`domBoxes` in `src/engine/html.ts` decides whether an element's text runs out of its own box or is cut off by a clipping ancestor (or by the layer's edge). Horizontally it allows 1 px. Vertically it allows `ty = max(2, 0.2 × font size)` px, because a line box shorter than the font's ascent and descent, as with `line-height: 1`, puts the glyphs' extent slightly outside the element although nothing is cut off. Without the slack every tightly set heading would be reported as an `overflow` or `clipped` finding.
