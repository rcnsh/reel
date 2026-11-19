# HTML layers

The default way to put text and layout in a scene: write HTML and CSS, and reel renders it into a texture at the output resolution (sharp at `--scale 2`), in the theme's colours, with fonts you name in CSS, and reports every text element to `reel check`. GL and Canvas2D stay for shaders, particles, geometry and drawn strokes. The component kit (reference/kit.md) is built on HTML layers.

```ts
import type * as THREE from 'three';
import { Scene, type Frame, HtmlLayer, clearRT, prog, ease, H } from 'reel';

export default class Card extends Scene {
  html = new HtmlLayer({
    html: `<div class="card"><p class="kicker">Chapter one</p><h1>Every frame is a function of time</h1><p class="n">0</p></div>`,
    css: `
      .card { position: absolute; left: 8%; top: 22%; width: min(900px, 84%); padding: 40px; background: var(--bg); border-radius: 24px; }
      .kicker { font: 600 22px 'IBM Plex Mono'; letter-spacing: .2em; text-transform: uppercase; color: var(--accent); animation: rise .8s ease-out both; }
      h1 { font: 600 72px/1.05 'Cormorant Garamond'; }
      .n { font: 800 64px Archivo; font-stretch: 75%; font-variant-numeric: tabular-nums; }
      @keyframes rise { from { opacity: 0; transform: translateY(30px); } }`,
    // once per output frame while the clip shows: a pure function of f
    update: (f, l) => l.text('.n', Math.round(prog(f.lt, 0.5, 3, ease.outCubic) * 1000).toLocaleString('en-US')),
  });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, [0, 0, 0], 0);                  // (an upper track; on track 0 draw a background first)
    const k = prog(f.lt, 0, 0.8, ease.outCubic);
    this.html.draw(this.ctx.renderer, out, { y: (1 - k) * H * 0.1, opacity: k });   // per sub-frame: blurs
  }
}
```

## How it runs

- Make layers as fields of a scene (or in its constructor or `init()`): a layer belongs to the clip whose scene made it, shows while that clip is on screen and is hidden otherwise. One made anywhere else (a module's top level, lazily in `prepare()` or `render()`) belongs to no clip, so making it throws.
- **Content changes once per output frame**, before the frame's sub-frames render: the layer's `update(f, layer)`, or the scene's `prepare(f)` (optional, may be async). A DOM change needs a browser paint before it can be uploaded; the engine waits for one paint per frame for all layers that changed, and skips it when none did. A layer that never changes uploads once.
- **Motion that should blur comes from `draw()`**: `layer.draw(renderer, out, { x, y, scale, rotate, anchor, opacity, blend })` is evaluated per sub-frame, so a slide, zoom or fade drawn there gets motion blur under `--samples auto`. A CSS animation of position changes once per frame: fine for slow motion, stepped for fast motion.
- Everything is a pure function of time. `update` and `prepare` compute what to show from `f` (`f.t`, `f.lt`, words, audio), never from what they showed last frame.
- `layer.root` is the layer's shadow root and `layer.el` its host element. Its CSS is scoped to it; `:host` is the layer box, `W` x `H` logical px (or `width`/`height` in the options), clipped at its edges.

## Changing a layer

- `layer.$(sel)` / `layer.$$(sel)`: elements (`$` throws when nothing matches: a typo fails loudly).
- `layer.set(sel, { text, html, class: { on: true }, style: { left: '40%' }, vars: { p: 0.4 }, attr: { 'data-at': 2 } })`: writes only what differs. `layer.text(sel, s)`. `layer.vars({ p: 0.4 })`: custom properties on the layer itself, read by any rule (`width: calc(var(--p) * 100%)`).
- Plain DOM works too (`layer.$('.n').textContent = …`); the engine notices any change.

## CSS animations

`@keyframes` and `animation` work as written, on the clip's clock: every animation in a layer is paused and set to the time since the clip's start, so `animation: rise .8s .3s both` starts 0.3 s into the clip, in previews, stills and exports alike, and a seek backwards shows the same frame. An animation started later by a class you add (a word lighting up when it is said) begins at its element's `data-at` (clip-local seconds; on the element or an ancestor): set it together with the class, from `f`. The engine owns these animations: a layer that changes is laid out again from scratch, which replaces its `Animation` objects and fires `animationstart`/`animationcancel`, so don't keep the objects or drive anything from those events; state comes from `f`.

CSS transitions jump to their end at once: when a style changed is not a function of `t`. Animate with `@keyframes`, or set the value from `f` in `update`.

## Colours, fonts, images

- The theme's colours are custom properties: `--bg`, `--fg`, `--accent`, `--accent-hi`, `--accent-lo` and every other palette key in kebab case (`--ink2`, `--graphite`). `--frame-w` and `--frame-h` are the frame size in px. Text defaults to `var(--fg)` in Archivo.
- Fonts by family name: `Archivo` (variable: weights 100 to 900, `font-stretch` 62% to 125%, and italic), `Cormorant Garamond` (300 to 700, italic, lining figures), `IBM Plex Mono` (300 to 700, italic 400), and every font file in the project's `fonts/` folder under its own family name (ttf, otf, woff, woff2; `reel font add "Space Grotesk"` downloads a Google Fonts family there with its licence). A family that is not loaded is an error that names it, never a silent fallback; generic families (`sans-serif`) are system fonts and count as not loaded. A character the font lacks still falls back to a system font, and a family without an italic or bold file gets a slanted or thickened imitation: use characters and styles the font has.
- Images: `<img src="assets/photo.jpg">` and CSS `background-image: url(assets/…)` load from the project folder; inline `<svg>` works. They are decoded before the first frame that shows them; one that does not load is an error.
- Rendered in linear light like everything else: colours composite in linear space, so antialiased edges come out a touch different from a browser page (thin dark text on a light ground looks slightly lighter). Bloom applies to bright HTML under themes with bloom.

## What `reel check` sees

Every element with text of its own is reported with the box of its text, its computed font size, colour and opacity; `<img>`, `<svg>` and elements with a background image as images. Two more rules apply to HTML text:

- `overflow` (error): text runs out of its own box (a fixed width with an unbreakable word, `white-space: nowrap`).
- `clipped` (warning): an ancestor with `overflow: hidden`, or the edge of the layer itself, cuts it off; with `text-overflow: ellipsis` or a line clamp it is a note (`info`), since that is deliberate. A clipped element's box is its visible part.

The parts of one run of text (a `<span>` in a paragraph, the words of a caption) are reported separately, so each keeps its own colour, and never count as overlapping each other.

Pieces of text moved one by one as `inline-block`s (each its own run otherwise) are one run under an ancestor marked `data-flow`, so a word rising through the line below is not an overlap.

`data-label="title"` names an element in findings; `data-exempt="offFrame safeArea"` (or `data-exempt` alone: every rule) marks rules it is meant to break, on the element or an ancestor. The layer's draw transform and opacity apply to the boxes.

## Cost

A layer that does not change costs nothing per frame after its first upload. One whose content changes every frame costs about a millisecond per frame for the paint and upload (more for a big DOM), at any output scale. Keep big static parts and fast-changing parts in separate layers when a layer is large.

## Own shaders

`layer.texture` is premultiplied and sRGB-encoded, row 0 at the top. Sample it with `HTML_TEXEL_GLSL` (`vec4 htmlTexel(sampler2D tex, vec2 uvTopDown)`, linear premultiplied) to warp or distort it in your own `FSPass`.
