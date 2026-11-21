# Sub-frame times are clamped at 0

`sub()` in `Engine.render` (`src/engine/engine.ts`) renders each sub-frame at `max(0, t + dt * shutter * u)`. Before the video starts no clip is active, so frame 0's early sub-frames would be empty and frame 0 would come out half black; clamped, they render the video's first moment.
