---
name: reel-authoring
description: Write and change videos made with reel, the deterministic WebGL video engine (TypeScript, three.js, Canvas2D). Use when creating or editing a reel project's reel.config.ts, its scenes/*.ts, its theme, narration timing or music cues, or when a scene renders wrong, flickers, breaks under motion blur or does not fit a frame size.
---

# Writing a reel video

reel renders a video from code: every frame is a pure function of the time `t`, so the browser preview, a still and the final export produce the same pixels, at any frame size and rate, up to 4K, with adaptive motion blur. You author by editing files; you look with `reel still`, `reel strip`, `reel check` (see the `reel-review-loop` skill).

## A project

```
reel.config.ts      the edit: format, theme, every clip on the timeline
scenes/<name>.ts    one Scene class per file (default export); shared helpers as scenes/_<name>.ts
narration.txt       (narrated) plates: "# name" then its lines
data/words.json     (generated) every word with its time      audio/narration.flac (generated)
data/audio.json     (generated) beats, envelopes, waveform, spectrum, sections, the track to mux
mix.json            music beds, cue sounds and loudness for the mix
assets.json         images and sounds to generate (`reel assets`)
out/                renders (not committed)
```

In a project made by `reel init`, `bun run reel <command>` runs the CLI and `bun run typecheck` checks scenes against the engine. Generated files come from their tool (`reel narrate`, `reel align`, `reel analyze`); never edit them by hand.

## The config

```ts
import { defineVideo, extendTheme } from 'reel/config';

export default defineVideo({
  size: [1920, 1080],          // logical px; width a multiple of 4, height even
  fps: 60,
  theme: 'print',              // 'print' | 'film' | 'neutral' (default) | a theme object
  // duration: 12,             // default: the audio's length, else the last clip's end
  // export: { crf: 22, noaudio: true },  // this project's reel video defaults (crf, preset, noaudio, samples); flags override
  // props: { title: 'Hello' } as Props,  // defaults for --props (variants of one project): src.props, ctx.props
  timeline: (src) => [         // src.words, src.audio: the project's timing (empty when it has none); src.props
    { id: 'bg', scene: () => import('./scenes/wash'), start: 0, end: 12, params: { from: 'bg', to: 'accentLo' } },
    { id: 'title', scene: () => import('./scenes/title'), start: 0.5, end: 4, track: 1, params: { text: 'Hello' } },
    { id: 'fig', scene: () => import('reel/scenes/hud'), start: 6, end: 10, track: 2, params: { caption: { fig: 'FIG. 1', text: 'Population over 65' } } },
  ],
});
```

- The config's top level is plain data (the CLI reads it outside the browser). Scenes are lazy imports; anything that touches the engine goes inside `timeline()`.
- A **clip** places a scene: `id` (unique; `--only` and findings use it), `scene`, `start`/`end` in seconds, `track` (default 0), `params` (handed to the scene as `ctx.params`, so one module serves many clips), `transition` (how it comes in over the clip before it on its track: `'crossfade'` (default), `'wipe'`, `'slide'`, `'zoom'`, `'dip'`, `'iris'`, `'clock'`, `'whip'`, `'flash'`, `{ kind, ease, …that kind's options }`, or `{ glsl, uniforms }` for a shader of your own; reference/sampling.md, "Transitions"), `blend` and `opacity` (how its track is drawn over the tracks below), `grade` and `matte` ("Tracks" below), `post` (post-processing defaults for the whole frame while it shows), `maxSamples` (cap adaptive motion blur), `check: { exempt: [...] }`.
- **Tracks** stack in number order. Clips that overlap on one track make a transition over the overlap (the incoming clip's `transition`, a crossfade by default; or the incoming scene composites it itself); clips that touch cut, and a `transition` set on a clip that overlaps nothing is a `timeline` warning in `reel check`. A scene on a track above 0 must clear to transparent and draw over it.
- A **track's own settings**: the config's `tracks: { 1: { blend, opacity, grade, matte } }` sets a track's defaults; a clip's own values go over them while it is the top clip of its track.
- Clips back to back: `sequence([{ id, scene, dur, transition?, overlap? }, …], { start?, track?, transition?, overlap? })` from `reel/config` places each clip where the one before ends, so the edit is written as lengths. A clip with a transition overlaps the one before by its `overlap` (default the sequence's, else 0.5 s), and the transition plays over it; one without cuts (or crossfades, given an `overlap`). No clip may overlap two before it. The rest of a clip's fields (`params`, `post`, `blend` …) pass through:

  ```ts
  timeline: () => {
    const story = sequence([
      { id: 'title', scene: () => import('./scenes/title'), dur: 4 },
      { id: 'chart', scene: () => import('./scenes/chart'), dur: 6, transition: 'slide' },                 // 3.6 to 9.6
      { id: 'close', scene: () => import('./scenes/close'), dur: 5, transition: { kind: 'dip', color: 'bg' }, overlap: 0.8 },
    ], { overlap: 0.4 });
    return [...story, { id: 'hud', scene: () => import('reel/scenes/hud'), start: 0, end: story.at(-1)!.end, track: 1 }];
  },
  ```
- Narrated video: `timeline: (src) => clipsFromSections(src, import.meta.glob('./scenes/*.ts'))` makes one clip per plate of `narration.txt` that has a scene of the same name, cutting at each plate. `clipsFromSections(src, glob, { transition: 'crossfade', overlap: 0.6, params })` overlaps neighbouring clips by `overlap` (default 0.5 s with a transition) centred on the cut; `transition` and `params` may be functions of the plate's name (`(name) => name === 'outro' ? 'dip' : undefined`: a dip into the outro, cuts elsewhere).
- Music: snap starts with `src.audio.beatBefore(t)` or `src.audio.nearestDownbeat(t)`.
- **Props** make one project render as variants (a title, a colour, a list of items, a length). Give defaults in `props` and export their type (`export interface Props { title: string; seconds: number }`, `props: { … } as Props`); a render replaces them with `--props '{"title":"Q3"}'` or `--props variant.json` (MCP tools: `props: {…}`). `timeline()` reads `src.props` (typed from the defaults) to choose clips, lengths and params; a scene reads `this.ctx.props as Props` (`import type { Props } from '../reel.config'`). A key the defaults lack, or a value of another kind, fails the render; an optional prop gets a default of `undefined` or `null`, which takes anything. Props are fixed for the whole render, so scenes stay a function of `f.t`. Look at each variant: `reel still --props …`, `reel check --props …`.

## Tracks: grades, mattes, blends

Each track is composited on its own (its clips and their transitions), then graded and matted, then drawn over the tracks below:

- **`grade`** changes only its track: `{ exposure: 1.5, saturation: 0.2, contrast: 1.3, tint: 'accent' | '#rrggbb' | [r, g, b], fade: 0..1, flash: 0..1+, blur: σ in logical px }`. `fade` goes to transparent (to black on track 0), `flash` adds the theme's light colour only where the track has coverage, `contrast` pivots on mid-grey. Set it on the track, on the clip (data, or `(f) => ({ fade: f.p })` of the clip's `t`, `lt`, `p`), or return `{ grade }` from `render()` for one that follows the scene; each goes over the one before, field by field, and it moves from clip to clip across a transition. A clip's `post` (and what render() returns besides `grade`) still grades the whole frame.
- **`matte`**: `'alpha'` shows the track only where the next track above has coverage, `'luma'` where it is bright (as displayed: sRGB mid-grey keeps half), `'alpha-inverted'`/`'luma-inverted'` the opposite; `{ mode, from: 'below' }` reads the track below. The matte track is not drawn (nor its `post`): for the whole video when the matte is the track's (`tracks`), while the clip is on top when it is a clip's. Mattes may chain (a matte track matted in turn), not go round in a circle. `reel check` ignores a matte track's text; a matted track's text is reported whole, so where the matte cuts it check may measure what shows through instead (mark it `data-exempt="contrast"` if so). A clip cannot opt out of its track's matte or grade: put it on another track. `tracks` may only name tracks that have clips.
- **`blend`**: `normal`, `add`, `screen`, `multiply`, `max`, and reading the tracks below `overlay`, `soft-light`, `hard-light`, `difference`, `color-dodge`. Frames are linear HDR: overlay, soft-light and hard-light work on display values (sRGB mid-grey is neutral as in an image editor, and light above 1 is cut to 1, so a glow under them loses its bloom); `difference` is linear and keeps HDR; `color-dodge` is linear and capped at 16.

```ts
tracks: { 1: { matte: 'alpha' }, 3: { blend: 'overlay', opacity: 0.6 } },
timeline: () => [
  { id: 'bg', scene: () => import('./scenes/sky'), start: 0, end: 8, grade: { saturation: 0.3, blur: 6 } },
  { id: 'fill', scene: () => import('./scenes/stripes'), start: 0, end: 8, track: 1 },   // shows only inside…
  { id: 'word', scene: () => import('./scenes/word'), start: 0, end: 8, track: 2 },      // …this word's letters
  { id: 'grain', scene: () => import('./scenes/paper'), start: 0, end: 8, track: 3 },
],
```

## A scene

Common pieces come ready-made from the **component kit**: a title card, text fitted to a box, kinetic text (words or letters entering one after another, or as they are said), captions from timed words, a lower third, an image with a Ken Burns move, a video clip decoded frame by frame, a Lottie animation, bar and line charts, a counter, a progress bar, a timer, a code block, and SVG paths and arrows drawn on over time, a waveform and spectrum of the song, each in the theme's colours, laid out from the frame, reported to `reel check` and pure in time; and layout helpers (`split`, `grid`, `inset`, `center`) that cut boxes from a box (reference/kit.md):

```ts
import type * as THREE from 'three';
import { Scene, type Frame, TitleCard, Captions, clearRT, LIN } from 'reel';

export default class Opening extends Scene {
  card = new TitleCard({ kicker: 'Chapter one', title: 'How a frame is made', at: [0.3, 4] });
  captions = new Captions({ words: this.ctx.words });
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg);
    this.card.draw(this.ctx.renderer, out, f);
    this.captions.draw(this.ctx.renderer, out, f);
  }
}
```

Other text and layout go in an **HTML layer** (HTML and CSS rendered to a texture, theme colours as CSS variables, fonts by family name, reported to `reel check` by itself): see reference/html.md. GL (`FSPass`, three.js) and Canvas2D (`Layer2D`) are for pictures, shaders, particles and drawn strokes. A scene mixing both:

```ts
import type * as THREE from 'three';
import { Scene, type Frame, FSPass, HtmlLayer, prog, ease, H } from 'reel';

export default class Intro extends Scene {
  bg = new FSPass(/* glsl */ `void main() { fragColor = vec4(mix(C_BG, C_ACCENT_LO, vUv.y * 0.2), 1.0); }`);
  title = new HtmlLayer({
    html: `<h1></h1>`,
    css: `h1 { position: absolute; inset: 0; display: grid; place-items: center; padding: 0 8%; text-align: center;
                font: 800 clamp(48px, 9vmin, 140px)/1 Archivo; }`,
    update: (f, l) => l.text('h1', String(this.ctx.params.text)),   // once per frame, a pure function of f
  });
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.bg.render(this.ctx.renderer, out);
    const k = prog(f.lt, 0, 0.9, ease.outExpo);
    this.title.draw(this.ctx.renderer, out, { y: (1 - k) * H * 0.05, opacity: k });   // per sub-frame: motion blurs
  }
}
```

The same title drawn with Canvas2D, for comparison (text you draw yourself must be reported by hand):

```ts
import type * as THREE from 'three';
import { Scene, type Frame, FSPass, Layer2D, W, H, F, font, fitSize, rgba, ease, prog, window01, reportText } from 'reel';

export default class Title extends Scene {
  // a fullscreen shader: GLSL ES 3.0 body with vUv, writing fragColor; C_BG etc. are the theme's colours
  bg = new FSPass(/* glsl */ `uniform float t;
    void main() { fragColor = vec4(mix(C_BG, C_ACCENT_LO, vUv.y * 0.2 + 0.05 * snoise(vec3(vUv * 3.0, t * 0.1))), 1.0); }`,
    { t: { value: 0 } });
  text = new Layer2D();                       // a frame-sized Canvas2D, in logical px

  async init() { /* precompute: geometry, text outlines, word times; cue() sounds */ }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp, params } = this.ctx;
    this.bg.u.t!.value = f.t;
    this.bg.render(renderer, out);            // overwrites out
    const label = String(params.text), fam = F.archivo(87.5, 800);
    const size = fitSize(label, fam, W * 0.8, Math.min(W, H) * 0.12);   // fits any frame size
    const a = window01(f.t, f.start, f.end, 0.4, 0.6), rise = prog(f.lt, 0, 0.9, ease.outExpo);
    const c = this.text.ctx, y = H / 2 + (1 - rise) * size * 0.4;
    this.text.clear();
    c.font = font(fam, size); c.textAlign = 'center'; c.fillStyle = rgba('fg', a);
    c.fillText(label, W / 2, y);
    reportText(c, label, W / 2, y, { label: 'title' });              // what `reel check` sees
    comp.draw(renderer, this.text.upload(), out);                    // alpha-over onto out
    return { bloom: 0.6 };                    // optional post overrides
  }
}
```

`render(f, out)` draws into `out`, a HalfFloat **linear HDR** target that the engine clears to transparent before every `render()` (what a scene leaves undrawn is transparent, never what an earlier frame left). On track 0 draw it opaque; on a higher track draw premultiplied over the transparent (`clearRT(renderer, out, [0, 0, 0], 0)` first is harmless).

A video exported with alpha (`reel video --format prores4444`, `webm`, or `--alpha` with `png`, `png16`, `exr`, `webp`; `reel still --alpha` to look) leaves the theme's background out: `clearRT(renderer, out, LIN.bg)` clears to transparent, a `Stage3D` with the default `'bg'` background is transparent, a dip through the background goes through transparent (one through another colour shows that colour), and the frame is written with straight alpha. So paint the background with `clearRT(…, LIN.bg)`, never as a full-frame shape in `bg`, and a scene works in both. A fade (`post.fade`) fades to transparent there; glow past an object's edge becomes translucent light.

What a scene gets:

- `this.ctx`: `renderer`, `comp` (the compositor), `words`, `audio`, `params`, `props` (the render's, the same for every clip), `id`, `start`, `end`, `W`, `H`, and `clip(id)`: another clip's `{ start, end, track }` (throws when the id is gone), for a clip that follows another's timing.
- `f` (Frame): `t` (video time), `lt` (time since the clip's start), `p` (0..1 through the clip), `start`, `end`, `dt` (the step since the last frame rendered, for stateful scenes only: 0 after a seek, which a stateless scene's export chunks start with), `beat`, `bar`, `beatPhase`, `barPhase`, `a` (audio features: `rms low mid high vocal drums bass other`, pulses `kick snare hat vonset`), `exposure` (the span of time the frame's sub-frames cover: 0 in previews and stills), and in a transition `under` (the outgoing clip's texture), `tin`, `tout`.
- Lifecycle: `init()` once (async; load and precompute here), `prepare(f)` once per output frame before its sub-frames (optional, may be async; HTML layers update then), `render()` per frame and per motion-blur sub-frame (synchronous), `reset()` for stateful scenes, `dispose()`.
- Flags: `stateful = true` for simulation state, `handlesTransition = true` to composite `f.under` with `f.tin` yourself, `tileMasked` (see reference/sampling.md).

## Rules that keep a video correct

1. **Pure in `f.t`.** Same `t`, same pixels, in any order: the export renders sub-frames out of order and any number of times. No `Math.random()`, `Date.now()`, `performance.now()` for visuals, no counting `render()` calls, no state carried between calls (unless `stateful`, which then cannot use `--samples auto`). Randomness: `mulberry32(seed)`, `hash(a, b, …)`, `noise1/2/3`, seeded by indices.
2. **Per-frame jitter uses `frameIdx(t)`**, constant over a frame's shutter; `Math.floor(t * FPS)` double-exposes two states. Step frames by `1 / FPS`, never `1 / 60`.
3. **Anchor to words, not numbers.** `this.ctx.words.get('some words')` finds a line by its text (and throws if it is gone, so a script edit fails loudly); use its `start`, `end` and `words[i].start`. A typed time breaks when the voice is re-timed.
4. **Lay out from `W` and `H`** (logical px). In HTML, use widths in % of the layer and sizes in `vmin` or `clamp()`; in Canvas2D, size text with `fitSize` to a width derived from `W`; never from 1920 or 1080. Check the layout at `--size 1080x1920` ("Two aspect ratios" below). Logical px hold at every output scale; `PW`/`PH`, `gl_FragCoord` and canvas backing sizes are physical (reference/sampling.md, "Output scale").
5. **Colours from the theme**, linear: `C_<KEY>` in GLSL (`accentHi` is `C_ACCENT_HI`), `LIN.<key>` for GL uniforms, `rgba('<key>', alpha)` for Canvas2D. `bg`, `fg`, `accent`, `accentHi`, `accentLo` exist in every theme; a theme's own keys tie the scene to it. A missing key throws (and fails the command), in `LIN`, `rgba()` and the kit's `color` options alike; in your own HTML layer CSS the theme's colours are `var(--accent-hi)` and so on, and a `var()` the theme lacks is not caught.
6. **Report what you draw.** HTML layers report their text and images by themselves (`data-label`, `data-exempt` on elements). Text you draw yourself: after `fillText`, `reportText(c, text, x, y, { label })`; after `drawStrokeText`, `reportStrokeText(c, st, len, text, { label })`; for glyph atlases, images and shapes, `report({ kind, x, y, w, h, text?, size?, color?, alpha?, label? })` in logical frame px. Free outside `reel check`; guard extra work with `if (reporting())`. Mark intended rule breaks: `exempt: ['offFrame']` on a box, `check: { exempt: ['blank'] }` on a clip (rules: `blank frozen offFrame safeArea overlap minSize contrast overflow clipped tiny empty unreported nondeterministic timeline`). A clip that calls `fillText` or `strokeText` in `render()` and reports no text at all gets an `unreported` warning; text drawn only on a scratch canvas (rasterised into particles, say) goes inside `uncounted(() => …)`. Check also renders some times a second time, out of order, and a frame that comes out different is a `nondeterministic` error (rule 1), naming any `Math.random()`, `Date.now()` or `performance.now()` the clip called while drawing.
7. **Sound by cue.** `cue(kind, t)` in `init()` (from word times); `mix.json` maps kinds to files. Scenes never play audio.
8. **Values over ~0.85 bloom** under themes with bloom (`film`). Keep text below that unless it should glow.

## Two aspect ratios from one project

Every render command takes `--size WxH` (and the MCP tools `size`), so a 16:9 project also delivers 9:16 or 1:1 without a second config: `reel video --size 1080x1920 --out out/vertical.mp4`. `W` and `H` are that size while it renders, so one scene lays out both:

- Let proportions do most of it: boxes from `W`, `H` and `UNIT` (the short side), cut with `split` and `grid` (`split(area, PORTRAIT ? 'v' : 'h', 2, 40)` stacks in a vertical cut), kit components' default boxes, HTML in % and `vmin`.
- Where the composition must change (side by side becomes stacked, a 3D subject moves up to leave room for text), branch once at module level, `const PORTRAIT = H > W;`, and pick boxes, camera framing and font sizes from it. Keep the timing identical: both cuts share the narration.
- Captions and lower thirds default to the safe area of whatever size is rendered; give a vertical cut more room at the bottom for a platform's own interface if it is going to one.
- Check each: `reel check` and `reel check --size 1080x1920`, a `reel sheet` of both, and name the outputs yourself with `--out` (the default name is the same for every size).

## Themes in one paragraph

A theme is data: a palette (`bg`, `fg`, `accent`, optional `accentHi`/`accentLo` and its own keys; values `#rrggbb` or another key's name), default post-processing, and an optional overlay (the HUD scene over everything: `{ marks: true }`). `print` is ink on paper, `film` a dark grade with bloom, halation, grain and crop marks, `neutral` clean greys with a blue accent. Make one with `extendTheme('print', { palette: { accent: '#1F6F5C' }, post: { grain: 0 } })` or a full object. `--theme film` tries another built-in one for one command. Details: reference/themes.md.

## Performance

Aim under 25 ms a frame (`reel perf --from a --to b`). Precompute in `init()`. An HTML layer that does not change is free after its first upload; one that changes every frame costs about 1 ms. Each `Layer2D.upload()` costs 2 to 4 ms; use at most two or three per scene, and skip redrawing a layer whose content did not change (cache a key of what it shows, as `reel/scenes/hud` does). Text as geometry (`textPath2D`, `textPoints`) is precomputed, not rebuilt per frame.

## Where to look next

- `reference/kit.md`: the component kit, one example per component: options, layout, motion, timing. Media (images in any colour profile, 16-bit PNG, SVG, video files, Lottie) is there too.
- `reference/html.md`: HTML layers: markup, CSS, per-frame updates, CSS animations on the clip's clock, theme variables, fonts, images, what check sees.
- `reference/toolbox.md`: FSPass, Compositor, Layer2D, render targets, the GLSL helpers (noise, SDFs, hatching, `pxLine`), LineBatch, fonts and type layout, stroke fonts, easing and keyframes, the spark, the HUD scene.
- `reference/sampling.md`: motion blur, adaptive sampling and what it asks of scenes; 4K output scale; stateful scenes; supersampling shaders.
- `reference/themes.md`: palettes, post parameters, overlays, custom themes.
- `reference/timing.md`: words (narration, lyrics), audio analysis and beat helpers, narration and music workflows, the sound mix.
- The `reel-3d` skill: 3D with three.js: a stage, models and environments, lighting rigs, camera rigs, depth of field, soft shadows, glTF animation, text on planes.
- The `reel-audio` skill: voicing and aligning narration, analysing songs, the mix and its loudness, subtitles, generated assets.
- The engine's source (where the project's `tsconfig.json` maps `reel`): `src/engine/*.ts` when the reference is not enough.
