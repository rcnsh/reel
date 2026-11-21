# A note's frame tolerates times typed as decimals

`frameOf` in `cli/notes.ts` adds 1e-4 frames before flooring `t * fps`. A time typed as a decimal (2.5 s, or a frame start like 0.1 at 30 fps) can land a hair below its frame boundary in floating point, and without the tolerance it would be pinned to the frame before.
