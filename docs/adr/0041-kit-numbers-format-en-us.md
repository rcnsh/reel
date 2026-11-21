# Kit numbers are formatted in en-US on every machine

`formatNumber` in `src/kit/charts.ts` (used by the charts, counters, donut and their defaults) calls `toLocaleString('en-US', …)` rather than the machine's default locale. A frame must be the same wherever it is rendered, and the default locale changes digit grouping and decimal marks between machines (and between a dev machine and CI's container), which would change the text in a frame.
