# Downscaled PNGs reduce in halvings

`scaled` in `src/main.ts` makes the small copies `png()`, `grid()` and `lastGridPng()` return. A large reduction goes in halvings, each a 2x2 average, before the last step. One `drawImage` straight to the final size samples only a few source pixels per output pixel on a GPU canvas, so thin lines and text vanish or alias in a small copy, and differently on every backend.
