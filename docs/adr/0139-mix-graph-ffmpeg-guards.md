# The mix graph guards against ffmpeg's fade and end-of-stream behaviour

In `buildMix` (`tools/mix-graph.ts`), a music segment's fades are capped at half its length. Longer fades would overlap, or would start before the segment, and ffmpeg refuses a negative `st`.

Everything is summed over silence of the video's length (`anullsrc` trimmed to `dur`, `amix` with `duration=first`), and that silence ends the mix. A graph that waits for the sum's own end can wait forever: several cues of a kind are split copies of one sound, and their end may never reach loudnorm.
