# Sequence times are rounded to the microsecond

`sequence` and `clipsFromSections` in `src/config.ts` work clip windows out by adding and subtracting lengths and overlaps. Floating-point sums leave tails such as `4.4 - 0.4 = 4.000000000000001`, which would put a clip's start a hair off where the author wrote it (and off the frame grid a cut is meant to land on).

Every start and end they produce goes through `us()`, which rounds to 1e-6 s. That is far below a frame at any supported rate (240 fps at most), so it changes no frame, and the windows come out as the numbers the author would write by hand.
