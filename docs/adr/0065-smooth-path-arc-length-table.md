# smoothPath mirrors phantom end points and walks an arc-length table

`smoothPath` in `src/three/camera.ts` builds a centripetal Catmull–Rom curve travelled at an even speed through a table of 64 steps per segment.

For an open path, the neighbour past each end is a phantom point mirrored through the end point (`ext`), which keeps the curve straight there instead of bending towards a repeated end point.

In `at(s)`, between two table entries of one segment `u` is interpolated from `a.u` to `b.u`; across a segment boundary the entry `b` belongs to the next segment and starts at `u = 1/STEPS`, so the start of the interpolation is taken as `u = 0` of `b`'s segment (`ua = 0`), not `a.u`, which belongs to the previous one.
