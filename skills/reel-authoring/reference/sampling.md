# Motion blur, sampling and 4K: what they ask of a scene

## Motion blur

The export renders each frame as the average of sub-frames spread over the shutter (`--shutter 0.5`: half the frame time, centred on the frame's time), before post-processing. `--samples N` takes N evenly spaced sub-frames; `--samples auto` picks the count per 32x32 px tile (4, 12, 36, 108, 324), adding sub-frames until a tile's average stops changing. A still frame stops at 12, ordinary motion at 36, whips and fast zooms at 108 or 324. Previews and stills default to one sample.

What that asks of a scene:

- Sub-frames are rendered out of time order and in any number: the output depends on `f.t` only. Nothing may count `render()` calls or carry state between them.
- Per-frame flicker and jitter use `frameIdx(t)`, which is constant over the frame's shutter. `Math.floor(t * FPS)` switches at the frame's own time and double-exposes two states in every frame.
- Noise seeded by continuous `t` is resampled in every sub-frame: it averages out, slowly, and makes the sampler work harder (and the export slower). Seed it with `frameIdx(t)` unless it is meant to smooth out.
- A particle emitter whose rate changes over time takes the rate as a function of each particle's birth time; a rate read at the current `t` re-times every particle between sub-frames.
- Post parameters a scene returns (shake, flash, zoom, fades) are read at one point of the shutter, 1/8 of it after the frame's time; grain and dither are drawn once per frame.
- A clip with slowly converging noise can cap its sub-frames: `maxSamples` on the clip. A scene can ask for a default cap itself with `this.ctx.capSamples(n)` from its constructor or `init()` (later calls are ignored; a `Stage3D` made there asks for 108); the clip's `maxSamples` wins.

## Stateful scenes

Simulation (particles integrated over time, feedback buffers) sets `stateful = true`, resets in `reset()` and integrates with `f.dt`. After a seek the engine resets it and fast-forwards from up to `prerollMax` seconds (default 6) before `t` (`f.preroll` is true then: skip work that only matters on screen). Such a video exports with a fixed `--samples N`, never `auto`, and on one worker.

## Transitions

Clips overlapping on one track make a transition over the overlap, named by the incoming clip's `transition` in the config. It lasts exactly as long as the overlap. The kinds, with the options each takes (any other key is an error):

| kind | what it does | options |
|---|---|---|
| `crossfade` (default) | mixes the two | |
| `wipe` | an edge travels across | `direction`, `softness` (share of the frame, default 0.08) |
| `slide` | the incoming clip pushes the outgoing one off | `direction` |
| `whip` | a slide with `inOutExpo` timing: almost all the motion in the middle few frames, which the export's motion blur turns into a streak (a preview or a 1-sample still shows a crisp push; keep the overlap short, 0.2 to 0.4 s, and do not cap the clip's `maxSamples`) | `direction` |
| `zoom` | the outgoing clip grows as it fades into the incoming one | |
| `dip` | through a colour and out | `color`: palette key or `#rrggbb` (default `bg` on track 0, transparent on the tracks above, so a title dipping out does not cover what is below it) |
| `iris` | a circle opens from `center` onto the incoming clip | `center: [x, y]` (shares of the frame from its top left, default the middle), `softness` (share of the full radius, default 0.02), `close: true` (the outgoing clip shrinks into the circle instead) |
| `clock` | a hand sweeps round `center` from 12 o'clock | `center`, `softness` (share of a turn, default 0.01), `clockwise: false` |
| `flash` | cuts at the middle through the theme's light colour, overexposed so it burns to white and blooms | |

`direction` (`left`, the default, `right`, `up`, `down`) is the way the edge or the clips move. Every kind takes `ease`, a name from the `ease` set (`'outQuad'`, `'inOutQuart'`, `'outBack'`, …) the overlap's progress runs through; the default is `linear` for crossfade, dip and flash, `inOutExpo` for whip, `inOutCubic` for the rest. Each is a pure function of the overlap's progress, so it gets motion blur.

A transition of your own is `{ glsl, uniforms?, ease? }` (no `kind`). `glsl` is either a whole `vec4 transition(vec2 uv) { … }` (the [gl-transitions](https://gl-transitions.com) shape: theirs paste in, with their uniforms' values given in `uniforms`), or that function's body (with `return`), or one expression. In scope: `getFromColor(uv)` (the outgoing clip; transparent outside the frame), `getToColor(uv)` (the incoming one), `progress` (eased, 0 to 1; `p` in a body or expression), `ratio` (width over height), the palette's `C_<KEY>`, and each of `uniforms` (a number is a `float`, an array of 2 to 4 a `vec2`–`vec4`; declared for you unless the source declares it, when it may also be an `int`, `ivec`, `bool` or `bvec` of the same size). The engine's other GLSL helpers (`PI`, `luma`, `hash12`, …) are not in scope, so a pasted shader's own do not clash: define what you use. A uniform the source declares and `uniforms` leaves out is 0. Colours are linear and premultiplied. Each distinct source compiles once, when the video loads; one that does not compile is a load error naming the clip, `[<id>: its transition's glsl] shader failed to compile: …`, with the offending line.

```ts
{ id: 'next', scene: …, start: 9.4, end: 14, transition: { kind: 'iris', center: [0.7, 0.4], ease: 'outQuart' } },
{ id: 'last', scene: …, start: 13.4, end: 18, transition: { glsl: 'mix(getFromColor(uv), getToColor(uv), step(fract(uv.x * n), p))', uniforms: { n: 8 } } },
```

A scene with `handlesTransition = true` draws the transition itself: `f.under` is the outgoing clip's texture this frame and `f.tin` runs 0 to 1 over the overlap (`f.tout` likewise into the next clip). Most cuts should be hard cuts on a beat or a word: clips whose windows touch.

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
