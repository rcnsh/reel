# ctx.capSamples counts only while the scene is made

`loadEntry` in `src/engine/engine.ts` accepts `ctx.capSamples(n)` only during the scene's constructor and `init()`; later calls (such as a `Stage3D` made on first use in `render()`) are ignored. An export splits its frames across workers, each its own page; a cap set lazily would depend on which frames a worker had rendered, so the same frame could get different sub-frame counts on different workers. Fixing the cap at load gives every frame the same cap whichever worker renders it.
