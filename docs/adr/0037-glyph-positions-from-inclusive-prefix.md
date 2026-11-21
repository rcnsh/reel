# Glyph positions come from the inclusive prefix, minus the glyph's advance

`layout` in `src/engine/type.ts` places glyph i at the Canvas2D width of `text[0..i]` (inclusive) minus the glyph's own advance, plus tracking. Kerning between a glyph and the one before it moves the later glyph, and only a measurement that includes both glyphs contains that pair's kern.

## Considered options

The obvious position, the width of `text[0..i)` alone, leaves out the pair between glyph i - 1 and glyph i, so every kern lands one glyph late: in "Your" the Y–o kern pushes the u into the o. `glyphX` uses the same inclusive-prefix rule for where a piece of a word starts.
