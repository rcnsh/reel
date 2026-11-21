# img2webp frame durations follow the frame clock

img2webp takes each frame's duration in whole milliseconds. `webpArgs` in `cli/formats.ts` rounds each frame's end time instead of the frame period, so the running total stays on the frame clock: a 30 fps loop alternates 33 and 34 ms. Rounding `1000 / fps` per frame would make the loop drift and run fast or slow.
