# Where reel analyze's beat thresholds come from

The constants in `tools/analyze.py` were measured against songs with known beats (`tools/synth_song.py`, `tests/analyze.test.ts`):

- `SMOOTH = 0.007` (`smooth_beats`): Beat This! places beats on 20 ms frames. Where the tempo is smooth, a line through 7 tracked beats leaves about 5 ms RMS from that rounding, so 7 ms is the most a "smooth" window may leave. A window's error is taken over all its beats: a window whose line only fits after half its beats are dropped does not count as a fit.
- `MAX_BPM = 200`, `SLOW_BPM = 82`: a doubled tempo must stay at or under `MAX_BPM`. Under `SLOW_BPM`, a tracked beat may be half the song's beat.
- `DOUBLE_SHARE = 0.36`, `SLOW_SHARE = 0.42`: the share of the beats' percussion that the midpoints between beats must carry before the beats are doubled. A backbeat gives 0.36. Under `SLOW_BPM` the bar is higher, because a slow song with even hats carries up to 0.37 on the midpoints.
- `downbeat_phase` measures low-end energy (under 200 Hz, in the 100 ms after each beat) raw, not normalised, so a louder kick on the one counts.
- On the model path, the tracker's beats come late by up to one 20 ms frame. They are moved onto the drum stem's hits (`drum_shift`), which measured more consistent where drums mark the beats. `--free-tempo` keeps the tracked beats where they are, at the tracked octave.
- After `octave()` locks or halves the beats, the tracked downbeats sit on the backbeat or on beats that were dropped. In that case the drums place the one (`downbeat_phase`), as on `--fast`.
- `take_turns()` is called only after the models have run. They take tens of seconds and do not need a turn.
