# Spring maths: continuous heavy damping, a stable overdamped root and a bracketed settle time

`src/engine/util.ts` evaluates springs in closed form, which needs three numerical choices a straightforward transcription gets wrong.

`springStep` past `damping` 1 is a sum of a slow and a fast exponential decay, weighted (`a`) so that it leaves 0 at the speed it has at damping 1 (`w`). That keeps the curve continuous as damping crosses 1 and stops a heavy damping from jumping half way at once in its first instant.

`springAt` in the overdamped case needs `s - ζω0`, which cancels catastrophically when damping is high (s and ζω0 are nearly equal). It is written as `-ω0² / (ζω0 + s)`, the same value without the subtraction, so it keeps its precision.

`springSettleTime` (what `spring`'s `duration` stretches) finds when the spring last strays more than 0.5% (`SETTLE`) from its target by bisection over an interval `[lo, hi]` that is off at `lo`, settled from `hi` on, and holds one crossing. An underdamped spring rings: its distance from the target peaks at t = kπ/ω1 with height e^(-ζω0 t) and falls to 0 between peaks, so k is the last peak above the threshold and the crossing lies before the next peak, `[kπ/ω1, (k+1)π/ω1]`. A critically or overdamped spring's distance falls monotonically, so `hi` doubles from 1/ω0 until it is settled.

## Consequences

Bisecting over a plain time range would stop at any crossing of a ringing spring, not the last one, and give a `duration` that ends while it still visibly rings.
