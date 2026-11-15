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
data/audio.json     (generated) beats, envelopes, sections, the track to mux
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
  timeline: (src) => [         // src.words, src.audio: the project's timing (empty when it has none)
    { id: 'bg', scene: () => import('./scenes/wash'), start: 0, end: 12, params: { from: 'bg', to: 'accentLo' } },
    { id: 'title', scene: () => import('./scenes/title'), start: 0.5, end: 4, track: 1, params: { text: 'Hello' } },
    { id: 'fig', scene: () => import('reel/scenes/hud'), start: 6, end: 10, track: 2, params: { caption: { fig: 'FIG. 1', text: 'Population over 65' } } },
  ],
});
```

- The config's top level is plain data (the CLI reads it outside the browser). Scenes are lazy imports; anything that touches the engine goes inside `timeline()`.
- A **clip** places a scene: `id` (unique; `--only` and findings use it), `scene`, `start`/`end` in seconds, `track` (default 0), `params` (handed to the scene as `ctx.params`, so one module serves many clips), `transition` (how it comes in over the clip before it on its track: `'crossfade'` (default), `'wipe'`, `'slide'`, `'zoom'`, `'dip'`, or `{ kind, direction: 'left'|'right'|'up'|'down', softness, color }`), `blend` (`normal`, `add`, `screen`, `multiply`, `max`), `opacity`, `post` (post-processing defaults while it shows), `maxSamples` (cap adaptive motion blur), `check: { exempt: [...] }`.
- **Tracks** stack in number order. Clips that overlap on one track make a transition over the overlap (the incoming clip's `transition`, a crossfade by default; or the incoming scene composites it itself); clips that touch cut. A scene on a track above 0 must clear to transparent and draw over it.
- Narrated video: `timeline: (src) => clipsFromSections(src, import.meta.glob('./scenes/*.ts'))` makes one clip per plate of `narration.txt` that has a scene of the same name.
- Music: snap starts with `src.audio.beatBefore(t)` or `src.audio.nearestDownbeat(t)`.

## A scene

Common pieces come ready-made from the **component kit**: a title card, text fitted to a box, captions from timed words, a lower third, an image with a Ken Burns move, a video clip decoded frame by frame, a Lottie animation, bar and line charts, a counter, a progress bar, a timer and a code block, each in the theme's colours, laid out from the frame, reported to `reel check` and pure in time (reference/kit.md):

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

`render(f, out)` must fully overwrite `out`, a HalfFloat **linear HDR** target. On track 0 draw it opaque; on a higher track start with `clearRT(renderer, out, [0, 0, 0], 0)` and draw premultiplied over it.

A video exported with alpha (`reel video --format prores4444`, `webm`, or `--alpha` with `png`, `png16`, `exr`, `webp`; `reel still --alpha` to look) leaves the theme's background out: `clearRT(renderer, out, LIN.bg)` clears to transparent, a `Stage3D` with the default `'bg'` background is transparent, a dip goes through transparent, and the frame is written with straight alpha. So paint the background with `clearRT(…, LIN.bg)`, never as a full-frame shape in `bg`, and a scene works in both. A fade (`post.fade`) fades to transparent there; glow past an object's edge becomes translucent light.

What a scene gets:

- `this.ctx`: `renderer`, `comp` (the compositor), `words`, `audio`, `params`, `id`, `start`, `end`, `W`, `H`.
- `f` (Frame): `t` (video time), `lt` (time since the clip's start), `p` (0..1 through the clip), `start`, `end`, `dt`, `beat`, `bar`, `beatPhase`, `barPhase`, `a` (audio features: `rms low mid high vocal drums bass other`, pulses `kick snare hat vonset`), `exposure` (the span of time the frame's sub-frames cover: 0 in previews and stills), and in a transition `under` (the outgoing clip's texture), `tin`, `tout`.
- Lifecycle: `init()` once (async; load and precompute here), `prepare(f)` once per output frame before its sub-frames (optional, may be async; HTML layers update then), `render()` per frame and per motion-blur sub-frame (synchronous), `reset()` for stateful scenes, `dispose()`.
- Flags: `stateful = true` for simulation state, `handlesTransition = true` to composite `f.under` with `f.tin` yourself, `tileMasked` (see reference/sampling.md).

## Rules that keep a video correct

1. **Pure in `f.t`.** Same `t`, same pixels, in any order: the export renders sub-frames out of order and any number of times. No `Math.random()`, `Date.now()`, `performance.now()` for visuals, no counting `render()` calls, no state carried between calls (unless `stateful`, which then cannot use `--samples auto`). Randomness: `mulberry32(seed)`, `hash(a, b, …)`, `noise1/2/3`, seeded by indices.
2. **Per-frame jitter uses `frameIdx(t)`**, constant over a frame's shutter; `Math.floor(t * FPS)` double-exposes two states. Step frames by `1 / FPS`, never `1 / 60`.
3. **Anchor to words, not numbers.** `this.ctx.words.get('some words')` finds a line by its text (and throws if it is gone, so a script edit fails loudly); use its `start`, `end` and `words[i].start`. A typed time breaks when the voice is re-timed.
4. **Lay out from `W` and `H`** (logical px). In HTML, use widths in % of the layer and sizes in `vmin` or `clamp()`; in Canvas2D, size text with `fitSize` to a width derived from `W`; never from 1920 or 1080. Check the layout at `--size 1080x1920`. Logical px hold at every output scale; `PW`/`PH`, `gl_FragCoord` and canvas backing sizes are physical (reference/sampling.md, "Output scale").
5. **Colours from the theme**, linear: `C_<KEY>` in GLSL (`accentHi` is `C_ACCENT_HI`), `LIN.<key>` for GL uniforms, `rgba('<key>', alpha)` for Canvas2D. `bg`, `fg`, `accent`, `accentHi`, `accentLo` exist in every theme; a theme's own keys tie the scene to it. A missing key throws (and fails the command).
6. **Report what you draw.** HTML layers report their text and images by themselves (`data-label`, `data-exempt` on elements). Text you draw yourself: after `fillText`, `reportText(c, text, x, y, { label })`; for stroke fonts, glyph atlases, images and shapes, `report({ kind, x, y, w, h, text?, size?, color?, alpha?, label? })` in logical frame px. Free outside `reel check`; guard extra work with `if (reporting())`. Mark intended rule breaks: `exempt: ['offFrame']` on a box, `check: { exempt: ['blank'] }` on a clip (rules: `blank frozen offFrame safeArea overlap minSize contrast overflow clipped tiny empty`).
7. **Sound by cue.** `cue(kind, t)` in `init()` (from word times); `mix.json` maps kinds to files. Scenes never play audio.
8. **Values over ~0.85 bloom** under themes with bloom (`film`). Keep text below that unless it should glow.

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
