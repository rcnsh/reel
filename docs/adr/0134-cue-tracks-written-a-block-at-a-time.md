# Each cue kind is one summed track, written a block at a time

`buildMix` in `tools/mix-graph.ts` gives each cue kind a single ffmpeg input: a raw 48 kHz stereo f32 track of all that kind's cues summed. This is cheaper than one input per cue. `cueTrack` in `tools/mix.ts` decodes the kind's sound once and writes the track in 10 s blocks with `cueBlock`, adding the sound at each offset. A long video's cues therefore need no buffer as long as the video.

Cue offsets are rounded to whole milliseconds, the same rounding the music's `adelay` uses. Offsets are in time order, so the last offset plus the sound's length gives the track's length.
