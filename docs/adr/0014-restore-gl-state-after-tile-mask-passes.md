# GL state is restored after every tile-mask pass

Per-tile refinement (`src/engine/engine.ts`) writes the tile mask into targets' depth buffers with passes that have `colorWrite` off (`maskPass` in `drawMask`, `nearPass` in `maskDepth`). three.js's `clear()` does not set the colour mask, so left off after such a pass, the next colour clear of that target (a scene's own clear) would do nothing. Both functions therefore set `renderer.state.buffers.color.setMask(true)` after drawing.

Likewise, when a clip has to be drawn unmasked in a masked step (a draw that depth-tests its own 3D), its sub-frame clears and draws into the masked targets' depth, so `writeTileMask` runs again after it before masking resumes.
