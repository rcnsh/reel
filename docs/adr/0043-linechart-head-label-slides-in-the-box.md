# LineChart's value label slides from left- to right-aligned

`LineChart.update` in `src/kit/charts.ts` places the value label at the line's head and translates it by `-p * 100%` horizontally as progress p runs 0 to 1. At the start it is left-aligned to the head and at the end right-aligned, so it stays inside the box at both ends of the plot. Centring it on the head (`-50%`) would push half the label out of the box at the first and last points.
