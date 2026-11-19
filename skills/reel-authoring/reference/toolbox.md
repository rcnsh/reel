# The toolbox

Everything below is exported by `reel` (`import { … } from 'reel'`) unless it says otherwise. Coordinates are logical px, origin top left, unless noted.

## GL (`gl.ts`)

- `W`, `H`: the logical frame size; `FPS`; `SCALE`: physical px per logical px; `PW`, `PH`: the physical size.
- `FSPass(frag, uniforms?, { blending?, transparent? })`: a fullscreen GLSL ES 3.0 pass. `frag` declares its uniforms and `void main()` writing `fragColor`; `vUv` (0..1, origin bottom left) and `GLSL_COMMON` are provided. `pass.u.name.value = …`, then `pass.render(renderer, target)` (overwrites the target unless the material blends).
- `this.ctx.comp.draw(renderer, texture, target, { mode, opacity, tint, scale, offset, premult })`: draw a texture over a target. `mode`: `normal` (alpha over, premultiplied), `add`, `screen`, `multiply` (give a white-background texture, premult off), `max`, `replace`. `scale` > 1 zooms out, `offset` shifts in uv.
- `Layer2D(w = W, h = H, scale = SCALE)`: a Canvas2D surface uploaded as an sRGB texture. `layer.clear(color?)`, draw with `layer.ctx` in logical px, then `layer.upload()` returns the texture (2 to 4 ms per upload). The backing canvas is `SCALE` times larger and the context pre-scaled; `setTransform`, `getTransform`, `shadowBlur`, shadow offsets and `filter` lengths are patched to stay logical. Not patched: `canvas.width/height` and `getImageData`/`putImageData` (physical), and `drawImage(layer.canvas, x, y)` needs an explicit size. `new Layer2D(w, h, 1)` makes a deliberately low-res layer (a soft glow).
- `makeRT(w = W, h = H, opts?)`: an HDR (HalfFloat, linear) render target in logical px, allocated at `SCALE`; `{ pxScale: 1 }` for a data-sized target that must not follow the output scale. `clearRT(renderer, rt, [r, g, b], alpha = 1)`.
- Your own three.js scenes: the `reel-3d` skill's `Stage3D` renders one with anti-aliasing, depth of field and soft shadows that accumulate over sub-frames and keeps per-tile adaptive sampling working. A bare `renderer.render(scene, camera)` into `out` works too, but its depth test makes that clip render unmasked (see sampling.md). Prepend `GLSL_COMMON` (exported) to your own ShaderMaterials' fragment shaders to get the palette and helpers.

## GLSL helpers (`GLSL_COMMON`, prepended to every FSPass)

- Palette: `C_BG`, `C_FG`, `C_ACCENT`, `C_ACCENT_HI`, `C_ACCENT_LO` and every key of the theme (`C_<KEY>`), linear RGB.
- Pixels: `FRAG_PX` (fragment position in logical px; use it instead of `gl_FragCoord.xy` with logical sizes), `PX_SCALE`.
- Maths: `sat`, `remap`, `luma`, `rot2(a)`, `PI`, `TAU`.
- Noise: `hash11 hash12 hash22 hash13 hash33`, `snoise(vec2|vec3)` (-1..1), `fbm(p, octaves)`, `curl2(p, t)`.
- SDFs: `sdCircle sdBox sdSegment` (2D), `sdSphere sdBox3 sdCapsule sdTorus` (3D), `smin smax`.
- Anti-aliased lines: `aaFill(d)`, `aaStroke(d, width)`, `pxLine(d, a, b)` (a hairline whose width comes from `fwidth`; holds its ink at 4K, unlike `1.0 - smoothstep(a, b, d / fwidth(u))`), `rampLine(d, hw, aa)`.
- Engraving: `hatch(u, darkness)`, `hatchD(u, darkness, du)` (give the derivative yourself where `fwidth` lies, such as an angle that wraps), `engrave(uv, darkness, freq, angle)`.
- Colour: `toSRGB`, `toLinear`, `heat(x)` (the theme's dark colour through the accent to white-hot).
- Supersampling within a pass: `rgss(k)` offsets; see sampling.md for `SS_TAP`.

## Lines (`lines.ts`)

`new LineBatch(capacity, { screen2D?, worldWidth?, blend?: 'add' | 'max' | 'normal', depthTest? })`: GPU capsule segments, 10k to 200k of them. Per frame: `lb.clear()`, then `lb.seg2(ax, ay, bx, by, width, [r, g, b], alpha)` (2D px, y down, with `screen2D: true`), `lb.seg(ax, ay, az, bx, by, bz, width, r, g, b, alpha)` (3D, with a camera), `lb.polyline(points, width, rgb, alpha)`, then `lb.render(renderer, target, camera?)`. Colours linear; over 1 glows. Widths stay logical; the edge feather and the hairline floor work in physical px, so hairlines stay crisp at 4K.

## Type (`type.ts`)

- Families: `F.archivo(width 62..125, weight 300..900)` (a grotesk in width steps 62, 75, 87.5, 100, 112.5, 125), `F.archivoItalic(width, weight)`, `F.serif(weight, italic)` (Cormorant Garamond), `F.mono(weight, italic)` (IBM Plex Mono). `font(family, px)` is the CSS font string for Canvas2D. The fonts are loaded before any scene's `init()`.
- `fitSize(text, family, maxWidth, max = 400)`: the largest size up to `max` at which the text fits `maxWidth`. `measure(text, family, size)`: its width.
- `layout(text, family, size, tracking)`: per-glyph x and advance with the font's kerning (draw glyph i at `glyphs[i].x`). `glyphX(text, i, family, size)`: where to start drawing `text[i..]` when a word is drawn in pieces (sung and unsung colours, wipes); never offset a piece by `measure(text.slice(0, i))`, which drops the kern between the pieces.
- Outlines: `textPath2D(text, family, size, x, y)` (a Path2D), `textPathCommands(…)`, `textPoints(text, family, size, step, seed)` (points filling the glyphs: text made of particles). Precompute these in `init()`.
- `smart(s)` turns typewriter quotes into typographic ones (’ “ ” …); `plain(s)` turns them back. Timed words already come through `smart()`; `words.get()` matches straight or curly quotes. Hard-coded display strings use ’ “ ” … – — × − too; mono text (the UI or terminal voice) keeps typewriter quotes.
- Whole strings drawn by Canvas2D get kerning for free. Adjacent runs in different fonts or sizes get none between them: set that gap by eye. No outlined or haloed type.

## Stroke fonts (`stroke.ts`)

Single-stroke plotter and engraving fonts that can be *written*: `script`, `hscript`, `sans`, `readable`, `tech`, `serif`, `osmotron`, `felix`. `const st = strokeText(text, 'script', size, tracking?, kern?)` in `init()` (`st.width`, `st.capHeight`, `st.total` length, `st.strokes`, `st.startLen`, `st.lens`); per frame `drawStrokeText(c, st, lengthPx)` strokes the first `lengthPx` of it (set `strokeStyle`, `lineWidth`, round caps first) and returns the pen head `{ x, y, angle }` or null. `writtenLength(st, charTimes, t)` syncs the writing to `[start, end]` per character (from word times). Pairs that leave a hole (To, Yo, We, AV) are kerned optically, except in the connected scripts. Stroke text is paths, not `fillText`: right after `drawStrokeText`, inside the same transform, call `reportStrokeText(c, st, lengthPx, text, { label })`, which reports the box of the part written so far with the stroke's colour. (Reporting the whole line's box while it is half written makes `reel check` call it invisible: most of that box is still empty.)

## Animation (`util.ts`)

`clamp`, `lerp`, `invLerp`, `remap(x, a, b, c, d)`, `smoothstep`, `smootherstep`, `fract`, `mod`, `TAU`; `window01(t, a, b, fadeIn, fadeOut)`: 0, ramp up, hold, ramp down; `pulse(t, t0, halfLife)`; `mulberry32(seed)`, `hash(...numbers)`, `noise1/2/3`, `fbm1/2`; `frameIdx(t)`; `polylineLengths`, `pointAtLength`; `hexToLinear`; `cue(kind, t)`; `sound({ file, at, … })` (a sound on the timeline for the mix).

Easing and motion, every one a pure function of time:

- `ease.*`: `linear` and the easings.net set, `in`/`out`/`inOut` × `Sine Quad Cubic Quart Quint Expo Circ Back Elastic Bounce` (`ease.outBack(t, s)` and `inBack`/`inOutBack` take the overshoot). Back and Elastic leave 0..1 on the way. Circ, and Expo and Elastic at their ends, hold 0 and 1 outside 0..1, so under `interpolate`'s `'extend'` they stop at the end value.
- `cubicBezier(x1, y1, x2, y2)`: an easing from CSS's `cubic-bezier()`, solved as browsers do (matches Chrome to 1e-6), so a curve from a design tool or a stylesheet moves the same here. `cubicBezier(0.25, 0.1, 0.25, 1)` is CSS `ease`. x1 and x2 must be in 0..1.
- `prog(x, a, b, ease)`: clamped eased progress of x through [a, b] (a step at a when a === b).
- `interpolate(x, [in…], [out…], { easing?, extrapolateLeft?, extrapolateRight? })`: piecewise-linear map (Remotion's): `interpolate(f.lt, [0, 0.4, 2, 2.4], [0, 1, 1, 0])` fades in, holds and out. `input` strictly increasing; `easing` shapes each segment. Outside the input: `'extend'` (default) continues the end segment, `'clamp'` holds the end value, `'identity'` returns x.
- `keys(t, [[t0, v0], [t1, v1, ease], …])`: keyframes in time order, two at one time for a step, out of order throws (the ease on a key shapes the segment ending there).
- `stagger(t, i, n, { at, each | total, dur, ease, order, seed })`: item i of n's eased progress, the items starting one after another (`order`: `start`, `end`, `center`, `edges`, `random`), and `staggerStart(i, n, o)` its start.
- `spring({ t, mass = 1, stiffness = 100, damping = 10, from = 0, to = 1, delay = 0, duration? })`: Remotion's spring in seconds, the exact solution rather than a simulation. Damping under `2·sqrt(stiffness·mass)` (20 with the defaults) overshoots and rings, at it settles fastest without overshoot, above it creeps in. `duration` stretches time so it settles (within 0.5%) exactly then; `springSettleTime(mass, stiffness, damping)` is its natural settling time.
- `springStep(t, freq, damping)`: a 0 to 1 step ringing at `freq` Hz; `damping` ≥ 0 sets its decay: under 1 it overshoots, at 1 and over it does not. It leaves 0 already moving (a kick); `spring` starts at rest.

Colour: `linearToHex([r, g, b])` is `hexToLinear`'s inverse. `mixColor(a, b, t)` mixes two colours in linear light (the way the GPU blends, so a fade between two colours does not dip dark halfway). `a` and `b` are palette keys, `#rrggbb`, or linear triplets; `t` is clamped to 0..1. It returns `{ lin, hex, rgba(alpha) }`: `lin` for GL uniforms and LineBatch, `rgba(a)` for Canvas2D, `hex` or `rgba(a)` for HTML/CSS (`layer.set('.title', { style: { color: mixColor('fg', 'accent', k).hex } })`).

## The spark (`spark.ts`)

A point of light for a pen, fuse or cursor head moving along a path, in the theme's `accent` and `accentHi`: `sparkHead(lineBatch, x, y, t, scale, intensity)` (white-hot core, glow and rays, drawn with an additive 2D LineBatch after the line it drags), `sparkParticles(lineBatch, t, headAt, opts)` (sputtering particles from a head whose position over time is `headAt(t)`; deterministic, born on a fixed clock), `sparkHead2D(ctx, x, y, t, scale)` for Canvas2D. The core is HDR and blooms under `film`.

## The HUD scene (`reel/scenes/hud`)

An ordinary scene for an upper track: crop marks (`marks: true`, flying in and out over `fly` seconds at the clip's ends; `fly: 0` keeps them still) and a caption bottom right (`caption: { fig, text }`, revealed from the clip's start, faded at its end), in the theme's colours for a light or dark picture (`tone`). Place it as a clip (`scene: () => import('reel/scenes/hud')`) or as a theme's `overlay`, which puts it over the whole video as a clip called `overlay`, loaded with any `--only`.
