# SvgDraw scopes its CSS to its own root

`SvgDraw` in `src/kit/draw.ts` puts an SVG file's markup inline in its HTML layer, next to its own rules for `.art` and `.stroke`. Those rules are written as `.host > .art` and `.host > .art > .stroke`, so a file whose own elements use the class names `art` or `stroke` is left alone. Strokes may reach past the box into the layer's pad; only `fit: 'cover'` crops at the box (`overflow: hidden`).
