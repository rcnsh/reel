# DonutChart: no tag for an empty slice, a fixed-width gap, a centre sized by its final text

Three choices in `DonutChart` (`src/kit/donut.ts`) keep the chart readable while it sweeps.

With `labels: 'around'`, a slice with a share of 0 gets no tag: its tag would sit on its neighbour's edge.

The gap between slices is a fixed width in px at the outer edge (`gap`, default 0.4% of the short side), converted to turns by the outer circumference, with half of it taken off each end of every slice. A lone slice (or one with the whole share) has no gap, so a single slice is a closed ring.

The number in the hole counts up with the sweep, but its font size (`numSize`) is fitted to the length of its final text (the highlighted share or the total at p = 1), not to the text on screen, so it does not jump in size as digits are added while it counts.
