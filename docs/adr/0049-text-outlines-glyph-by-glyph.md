# Text outlines are built glyph by glyph at Canvas2D positions

`textPathCommands` in `src/engine/type.ts` (and `textPath2D` on top of it) asks opentype.js for each glyph's path separately (`font.charToGlyph(ch).getPath`) and places it at the x that `layout` measured with Canvas2D, rather than calling `font.getPath(text)` on the whole string.

Placing glyphs at Canvas2D's positions makes an outline line up exactly with the same text drawn by `fillText`. It also avoids opentype.js's shaping: its unsupported GSUB lookups, such as Archivo's `ccmp`, crash `font.getPath()`. The cost is that the outline gets no GSUB substitutions (ligatures and the like), only the kerning Canvas2D measured.
