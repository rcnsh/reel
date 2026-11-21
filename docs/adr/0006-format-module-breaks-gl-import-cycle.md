# The output format lives in its own module

`src/engine/format.ts` holds `W`, `H`, `FPS`, `SCALE`, `ALPHA` and `BITS`, read once from `__REEL_FORMAT__` and the page URL. `gl.ts` re-exports them, but they are defined apart from it so that `glsl/common.ts`, which `gl.ts` imports for `GLSL_COMMON` and which needs `SCALE` to bake `PX_SCALE` and pick the `pxLine` variant at import time, can import them without an import cycle through `gl.ts`.

## Consequences

Moving the format back into `gl.ts` makes `glsl/common.ts` read `SCALE` before it is initialised.
