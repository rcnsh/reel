# SvgDraw draws on with pathLength dashes, and avoids non-scaling strokes

`SvgDraw` in `src/kit/draw.ts` draws a shape on by setting `pathLength="1"` and `stroke-dasharray: k 2`, so a dash of k draws k of the shape whatever its length. Three rules keep that correct.

Chrome scales a `pathLength`'s dashes wrongly under `vector-effect: non-scaling-stroke`. So widths given in logical px are divided by the scale the fit gives the viewBox (`k` in the constructor) instead of using a non-scaling stroke, and `partsOf` forces `vector-effect: none` on a file's shapes: a non-scaling stroke in the file then scales with the drawing.

A dash of 0 with round caps still draws a dot, so a shape not yet started is hidden (`visibility: hidden`), and its markers are switched off until it is drawn. Once drawn (k = 1) each shape gets back the inline styles and `pathLength` the file had, its own dashes and markers included.

`partsOf` collects the parts once and reads each one's computed styles (visibility, fill opacity, opacity) and inline overrides before `update` sets any style inline; recomputing them later would read the component's own overrides as the file's.
