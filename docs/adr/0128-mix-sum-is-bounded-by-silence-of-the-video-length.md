# The mix's sum ends with silence of the video's length

`buildMix` in `tools/mix.ts` makes the mixed track's length from an `anullsrc` source trimmed to the video's length, mixed in first with `amix=…:duration=first`, then trimmed again. The parts (cues, music, the track) do not decide where the sum ends.

## Considered options

- Padding the sum with `apad` until its end: a pad waiting for the sum's end can wait forever.
- A bounded pad: it ended the sound early.

`tests/mix.test.ts` ("the sum ends with silence of the video length, not with its parts") pins the filter and that it holds no `apad`.
