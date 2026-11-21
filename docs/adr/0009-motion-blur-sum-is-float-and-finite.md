# The motion-blur sum is Float32 and drops non-finite pixels

`Engine` in `src/engine/engine.ts` sums a frame's sub-frames into `sumRT` and `newRT`, which are `FloatType` targets while the scene targets are HalfFloat: a sum holds up to hundreds of sub-frames, past what half floats keep precisely.

The accumulating pass (`accum`) drops any pixel whose channel is not finite or exceeds 6e4 (about the half-float maximum, 65504), adding 0 instead. A stray NaN or infinity from some shader in one sub-frame out of hundreds would otherwise poison the average, and the bloom would spread it into a disc.
