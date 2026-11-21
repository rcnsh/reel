# Loudness: a linear gain where it fits, else loudnorm, measured on the finished file

The default target is -14 LUFS integrated and -1 dBTP (`STREAMING` in `tools/loudness.ts`), the level streaming platforms play at.

`linearGain` returns a plain gain only when the mix's true peak stays under the ceiling after the gain and its loudness range is within the target's. This is the same test that loudnorm's linear mode makes. Otherwise it returns null, and the mix gets loudnorm's dynamic mode. In the second pass (`loudnormFilter`), the measured values make loudnorm apply a linear gain where the ceiling allows, so there is no pumping, and fall back to its limiter where it does not. loudnorm works at 192 kHz, so its output is resampled to `sr`.

ffmpeg's ebur128 reports -70 for a file with nothing above its gate, and the true peak as a linear amplitude. `parseEbur128` turns these into -Infinity and dBTP. ebur128 prints a value every 100 ms of sound, so `ffmpegR128` (`tools/audio-io.ts`) keeps only the last 8 KB of its output, which holds the summary.

The loudness `reel mix` reports (`encode` in `tools/mix.ts`) is measured on the written file, not taken from the target, so it includes the encoder's overshoot.
