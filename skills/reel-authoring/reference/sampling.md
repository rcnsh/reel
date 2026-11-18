# Motion blur, sampling and 4K: what they ask of a scene

## Motion blur

The export renders each frame as the average of sub-frames spread over the shutter (`--shutter 0.5`: half the frame time, centred on the frame's time), before post-processing. `--samples N` takes N evenly spaced sub-frames; `--samples auto` picks the count per 32x32 px tile (4, 12, 36, 108, 324), adding sub-frames until a tile's average stops changing. A still frame stops at 12, ordinary motion at 36, whips and fast zooms at 108 or 324. Previews and stills default to one sample.

What that asks of a scene:

- Sub-frames are rendered out of time order and in any number: the output depends on `f.t` only. Nothing may count `render()` calls or carry state between them.
- Per-frame flicker and jitter use `frameIdx(t)`, which is constant over the frame's shutter. `Math.floor(t * FPS)` switches at the frame's own time and double-exposes two states in every frame.
- Noise seeded by continuous `t` is resampled in every sub-frame: it averages out, slowly, and makes the sampler work harder (and the export slower). Seed it with `frameIdx(t)` unless it is meant to smooth out.
- A particle emitter whose rate changes over time takes the rate as a function of each particle's birth time; a rate read at the current `t` re-times every particle between sub-frames.
- Post parameters a scene returns (shake, flash, zoom, fades) are read at one point of the shutter, 1/8 of it after the frame's time; grain and dither are drawn once per frame.
- A clip with slowly converging noise can cap its sub-frames: `maxSamples` on the clip.

## Stateful scenes

Simulation (particles integrated over time, feedback buffers) sets `stateful = true`, resets in `reset()` and integrates with `f.dt`. After a seek the engine resets it and fast-forwards from up to `prerollMax` seconds (default 6) before `t` (`f.preroll` is true then: skip work that only matters on screen). Such a video exports with a fixed `--samples N`, never `auto`, and on one worker.

## Transitions

Clips overlapping on one track make a transition over the overlap, named by the incoming clip's `transition` in the config: `crossfade` (the default), `wipe` (an edge travels across, `softness` its blur as a share of the frame), `slide` (the incoming clip pushes the outgoing one off), `zoom` (the outgoing clip grows as it fades into the incoming one), `dip` (through `color`, a palette key or `#rrggbb`, default `bg` on track 0 and transparent on the tracks above, so a title dipping out does not cover what is below it); `direction` (`left`, the default, `right`, `up`, `down`) is the way a wipe's edge or a slide moves. Each is a pure function of the overlap's progress, so it gets motion blur. A scene with `handlesTransition = true` draws the transition itself: `f.under` is the outgoing clip's texture this frame and `f.tin` runs 0 to 1 over the overlap (`f.tout` likewise into the next clip). Most cuts should be hard cuts on a beat or a word: clips whose windows touch.

## Jitter across sub-frames

`SUB_FRAME.index` is the sub-frame being drawn (0, 1, 2 … in sampling order; -1 in a render of one sample). Index a low-discrepancy sequence with it for anything that should average out over the shutter: `subPixel(k)` (a sub-pixel offset), `lensSample(k)` (a point on a unit disk, for a lens), `lightSample(k)` (another, for an area light), `halton(i, base)`. Every prefix of the sub-frames is then evenly spread, which is what adaptive sampling stops at. Never index jitter by time.

## Supersampling inside a shader

A shader that supersamples with the 4 rotated-grid taps takes `ssTap: SS_TAP` in its uniforms and `${SS_TAP_GLSL}` in its source, loops `for (int k = ssK0(); k < ssK1(); k++) col += shade(px + rgss(k));` and multiplies by `ssWeight()`. The engine then hands each sub-frame one tap, cycling them: the same image for a quarter of the cost. Previews and single-sample stills take all four.

## Tile masking (scene targets)

With `--samples auto`, tiles that have converged stop taking sub-frames, and where it saves time (software rendering, such as Linux without a GPU) they are masked out of the later sub-frames themselves (rejected before shading). That covers `out` and the engine's targets. A scene's own render target is drawn in full unless the scene lists it in `tileMasked: [{ rt, margin: 0 | 1, moving? }]`: only for a target with a depth buffer whose texels are read back at their own screen position or within a few px (`margin: 1` widens the mask by a tile), or, with `moving: true`, through a zoom or pan the scene gives before each sub-frame's draws with `this.ctx.mapTileMask(rt, map)` (null while it is read through a warp). A target read through a warp or a wide blur must not be listed. A draw that depth-tests its own 3D into a masked target makes the engine draw that clip unmasked; draw 3D into a target of your own instead, call `this.ctx.maskDepth(rt)` in place of clearing its depth (converged tiles go to the near plane, so your depth test skips them), then composite it into `out`. The `Stage3D` of the `reel-3d` skill does all of this.

## Output scale (4K)

`--scale 2` renders every logical px as 2x2 physical px: a true 3840x2160 frame from a 1920x1080 project. Scenes keep laying out in logical px; `W`, `H`, `ctx.W`, `ctx.H` do not change with the scale.

- `out`, the engine's targets and `makeRT()` are physical. `makeRT(w, h)` takes logical px; `{ pxScale: 1 }` keeps a data-sized target at its own resolution.
- `Layer2D` is pre-scaled (see toolbox.md); `getImageData`/`putImageData` and `canvas.width` are physical.
- `LineBatch` coordinates and widths stay logical.
- GLSL: `gl_FragCoord`, `fwidth` and `dFdx` are physical. Use `FRAG_PX` wherever the fragment position meets logical sizes, `PX_SCALE` to convert, and `pxLine` / `rampLine` for hairlines (`hatch`, `engrave` and `aaStroke` already do). Express LOD thresholds and supersampling offsets in logical px (`fwidth(u) * PX_SCALE`, offsets `/ PX_SCALE`).
- Offscreen canvases used as textures (atlases, text planes) keep their own size: make them `SCALE` times larger (with `ctx.scale(SCALE, SCALE)`) if they are shown large, or they look soft at 4K.
- Post-processing scales by itself.
