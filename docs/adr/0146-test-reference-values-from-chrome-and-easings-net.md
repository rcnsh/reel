# Easing tests check against outside reference values

`tests/util.test.ts` pins `cubicBezier` and the easing set to numbers taken from outside reel, not from its own output. The `cubicBezier matches Chrome` table is Chrome 157's Web Animations progress for each `cubic-bezier(...)` at 0.1, 0.25, 0.5, 0.75 and 0.9, so the engine's curves match what CSS draws. `ease.outBounce(0.5) = 0.765625` is the value easings.net publishes.

## Consequences

Regenerating these numbers from reel's own functions would turn the tests into self-checks. Take new reference values from the same sources.
