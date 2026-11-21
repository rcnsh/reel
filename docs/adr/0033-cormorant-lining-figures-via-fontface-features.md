# Cormorant is loaded with lining figures, set on the FontFace

Cormorant Garamond defaults to old-style figures, and at display sizes "10" reads as "IO". The engine switches its lining figures on (`"lnum" 1`) for every Cormorant face it loads: the Canvas2D static instances in `DEFS` (`src/engine/type.ts`) and the HTML layers' variable faces in `ENGINE_HTML_FONTS`.

Canvas2D has no `font-feature-settings`, so the feature cannot be asked for when drawing. `FontDef.features` carries it and `loadFonts` passes it as the `FontFace`'s `featureSettings` descriptor, so the face itself draws lining figures wherever it is used.
