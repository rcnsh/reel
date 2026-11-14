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

Single-stroke plotter and engraving fonts that can be *written*: `script`, `hscript`, `sans`, `readable`, `tech`, `serif`, `osmotron`, `felix`. `const st = strokeText(text, 'script', size, tracking?, kern?)` in `init()` (`st.width`, `st.capHeight`, `st.total` length, `st.strokes`, `st.startLen`, `st.lens`); per frame `drawStrokeText(c, st, lengthPx)` strokes the first `lengthPx` of it (set `strokeStyle`, `lineWidth`, round caps first) and returns the pen head `{ x, y, angle }` or null. `writtenLength(st, charTimes, t)` syncs the writing to `[start, end]` per character (from word times). Pairs that leave a hole (To, Yo, We, AV) are kerned optically, except in the connected scripts. Stroke text is paths, not `fillText`: report its box with `report({ kind: 'text', … })` (examples/demo/scenes/written.ts in the engine does).

## Animation (`util.ts`)

`clamp`, `lerp`, `invLerp`, `remap(x, a, b, c, d)`, `smoothstep`, `smootherstep`, `fract`, `mod`, `TAU`; `ease.*` (`linear`, `in/out/inOut` × `Quad Cubic Quart Expo`, `outQuint`, `outBack`, `inBack`, `outElastic`); `prog(x, a, b, ease)`: clamped eased progress of x through [a, b]; `window01(t, a, b, fadeIn, fadeOut)`: 0, ramp up, hold, ramp down; `keys(t, [[t0, v0], [t1, v1, ease], …])`: keyframes (the ease on a key shapes the segment ending there); `springStep(t, freq, damping)`; `pulse(t, t0, halfLife)`; `mulberry32(seed)`, `hash(...numbers)`, `noise1/2/3`, `fbm1/2`; `frameIdx(t)`; `polylineLengths`, `pointAtLength`; `hexToLinear`; `cue(kind, t)`; `sound({ file, at, … })` (a sound on the timeline for the mix).

## The spark (`spark.ts`)

A point of light for a pen, fuse or cursor head moving along a path, in the theme's `accent` and `accentHi`: `sparkHead(lineBatch, x, y, t, scale, intensity)` (white-hot core, glow and rays, drawn with an additive 2D LineBatch after the line it drags), `sparkParticles(lineBatch, t, headAt, opts)` (sputtering particles from a head whose position over time is `headAt(t)`; deterministic, born on a fixed clock), `sparkHead2D(ctx, x, y, t, scale)` for Canvas2D. The core is HDR and blooms under `film`.

## The HUD scene (`reel/scenes/hud`)

An ordinary scene for an upper track: crop marks (`marks: true`, flying in and out over `fly` seconds at the clip's ends; `fly: 0` keeps them still) and a caption bottom right (`caption: { fig, text }`, revealed from the clip's start, faded at its end), in the theme's colours for a light or dark picture (`tone`). Place it as a clip (`scene: () => import('reel/scenes/hud')`) or as a theme's `overlay`, which puts it over the whole video as a clip called `overlay`, loaded with any `--only`.
