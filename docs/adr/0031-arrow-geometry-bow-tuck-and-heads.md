# Arrow geometry: the bow's control point, the tucked line and growing heads

`arrowTrack` in `src/kit/draw.ts` bows an arrow by `curve`, a share of its length, as a quadratic curve. A quadratic's middle lies halfway between the chord's midpoint and its control point, so the control point sits twice the bow out from the chord's midpoint; placing it at the bow itself would bend the arrow half as far as asked.

`Arrow`'s box is the line's bounds, at least 1 px across in each direction so `reel check` sees a horizontal or vertical straight arrow. While it draws, the line runs from behind the start's head to behind the end's (tucked by 0.7 of a head's length), so neither tip has the line poking through it. Each head scales up over its own length (`grow = s / hl`), so at the start of the draw it never reaches back past the arrow's start.
