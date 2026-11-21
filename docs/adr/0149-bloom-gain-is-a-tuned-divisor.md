# The bloom strength is divided by a tuned gain, not the pyramid's

`Post.render` in `src/engine/post.ts` hands the final pass `p.bloom / BLOOM_GAIN`, with `BLOOM_GAIN = 3`.

The upsample chain adds each level's tent-filtered result to the level above it, so for a flat input `ups[0]` holds the sum of all `MIPS` (7) levels: the pyramid's own gain is 7, not 3. The 3 is not derived from it. The themes' `bloom` values (`film`: 0.55) were tuned by eye with the divisor at 3, so `bloom: 1` adds the thresholded light about 7/3 times, spread over the pyramid's radii.

Dividing by `MIPS` instead would make `bloom: 1` add the thresholded light once, but every theme and every project's `post` would need its value scaled by 7/3, and the demo would no longer render byte for byte as before. So the divisor stays a named constant. Changing `MIPS`, the upsample weights or `bloomRadius`'s range changes every theme's bloom strength: retune `BLOOM_GAIN` (or the themes) in the same change, and compare stills of the demo under `film` before and after.
