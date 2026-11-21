# Adaptive sampling steps the sub-frame count by thirds

`--samples auto` (`Engine.render` in `src/engine/engine.ts`) adds sub-frames in nested sets until the estimated remaining error is below `tol` levels. `ternaryOffsets` orders the shutter offsets: 4 evenly spread, then each step splits every interval in three, adding a sub-frame either side of each old one. Every prefix of 4·3^l is then evenly spread and centred on the frame's time, and so is each step's new set, so comparing the new set's average with the old one's measures sampling error, not a shift in time.

The error is measured per block of 2x2 logical px (`B = 2 * SCALE` physical) as how far the displayed average moves when the step's 2n new sub-frames are merged with the n before them: the merged average moves 2/3 of the gap between the two sets' averages, hence the factor 170 (255 × 2/3) in `errPass` and `errTilePass`, on display values (through the tone shoulder and sRGB). Stepped copies of a moving edge shrink as 1/count, so when a step changes the frame by e, what is left is about e/2 (e·(1/3 + 1/9 + …)), which is why the step's error is halved before it is compared with `tol`. A still frame stops at 3 × min; a whip pan goes on until its streaks are continuous instead of stepped copies.

## Considered options

Doubling the count each step: the new half then sits half a step later in the shutter, and any motion at all would read as sampling error.
