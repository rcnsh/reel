# Frozen runs compare cell brightness and stop at unsampled gaps

`findingsOf` (`src/check.ts`) finds frozen stretches with `sameFrame`: two frames are the same when no cell of their brightness grid moved by a level or more. A 1-level tolerance is enough, because film grain averages out over a cell.

With `--only`, a run ends at a stretch no loaded clip covers, because those times were never sampled and cannot count as frozen. The coverage test allows 1e-6 s of slack before a clip's start, since `checkTimes` rounds starts to frames with that slack and a clip's first frame can sit a hair before its start.
