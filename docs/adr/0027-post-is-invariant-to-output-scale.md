# Post-processing looks the same at every output scale

`Post` in `src/engine/post.ts` keeps its look independent of `--scale`:

- The bloom pyramid's targets are made at the logical resolution (`pxScale: 1`), starting at half of `W x H`, so bloom radii and the look are the same at every output scale.
- At scale 1 the prefilter is a 4-tap box downsample. Above 1 it averages the same 4x4-logical-px box from the larger source with `SCALE * 2` squared bilinear taps, each covering 2x2 texels.
- The fine grain is drawn per physical px with its amplitude multiplied by `PX_SCALE`, so its power per logical px (what survives a downscale) matches 1x; the coarse grain keeps cells of 2x2 logical px.

The pyramid downsamples with the 13-tap filter of Jimenez 2014 and upsamples with a 9-tap tent filter of the smaller level added to the current one.
