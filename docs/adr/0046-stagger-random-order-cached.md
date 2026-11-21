# stagger's random order is shuffled once per item count and seed

`staggerRank` in `src/engine/util.ts` gives each item its rank for `order: 'random'` from a Fisher–Yates shuffle seeded by `mulberry32(seed)`. Callers ask for every item's progress every frame, so shuffling per call would cost O(n) per item and O(n²) per frame. The ranks are computed once per `n:seed` key and kept in the module's `shuffles` map, cleared when it passes 64 entries. The shuffle depends only on n and the seed, so the cache keeps `stagger` a pure function of its arguments.
