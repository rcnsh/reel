# Instances are never frustum culled

`Instances` in `src/three/animate.ts` sets `frustumCulled = false`. Its instances move every sub-frame by `place(i, t, p)`, and three.js would cull against bounds computed earlier, which go stale and drop instances that have moved into view.
