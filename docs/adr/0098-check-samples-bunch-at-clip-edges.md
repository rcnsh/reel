# Check bunches its samples at clip edges

`checkTimes` (`src/check.ts`) samples every `step` seconds and adds frames bunched at every clip's start and end (offsets of 0, 1, 3, 8 and 15 frames and a quarter and half second from each edge, its first and last frame always), because cuts, fades and entrances are where layouts go wrong. Every time is a frame's time.
