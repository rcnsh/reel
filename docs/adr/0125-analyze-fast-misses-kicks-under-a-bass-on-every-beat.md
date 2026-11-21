# `reel analyze --fast` misses kicks under a bass note on every beat

`--fast` (librosa only) takes its kick onsets from the percussive part of the signal under 150 Hz. In 174 BPM drum and bass (`tools/synth_song.py` at 174 BPM) that band also holds a bass note on every beat, which leaves the kicks below the peak picking's threshold, so `--fast` finds too few of them. This is a known limit of the fast path, tuned per song with `--onset-delta`, not something the default path (Demucs stems) shares.

`tests/analyze.test.ts` therefore marks the drum-and-bass case `fastKicks: false`: its beats, downbeats and tempo are still checked on `--fast`, only its kicks are not.
