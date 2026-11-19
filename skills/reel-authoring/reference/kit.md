# The component kit

Ready-made pieces, imported from `reel`: text blocks, kinetic text, a title card, a lower third, captions, an image, a video clip, a Lottie animation, charts, a counter, a progress bar, a timer, a code block, drawn-on paths and arrows, and a waveform and spectrum of the song; and layout helpers that cut boxes from a box. Each component is built on an HTML layer (the image, video, Lottie, waveform and spectrum on GL), so it is in the theme's colours, sharp at every `--scale`, reported to `reel check`, and a pure function of time.

## How every component works

```ts
import type * as THREE from 'three';
import { Scene, type Frame, TextBlock, clearRT, LIN } from 'reel';

export default class Point extends Scene {
  text = new TextBlock({ text: 'One idea per clip', at: [0.5, 4], motion: { from: 'left' } });   // made once, as a field
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg);
    this.text.draw(this.ctx.renderer, out, f);           // draws nothing outside its window
  }
}
```

- Make components as fields of a scene (or in `init()`): that is how they belong to its clip. One made lazily in `prepare()` or `render()` (`this.x ??= new TextBlock(…)`) throws, and so does an HTML-based one (text, captions, charts, code) made at a module's top level: it belongs to no clip and would never draw. Call `draw(renderer, out, f, { opacity? })` in `render()`, in back-to-front order. On a track above 0, clear to transparent first.
- Options every component takes:
  - `box: { x, y, w, h }` in logical px. Each has a default laid out from `W` and `H` inside the safe margin (`safeBox(inset)` makes one), so it holds in 16:9, vertical and square. Sizes default to shares of `UNIT`, the frame's short side. To lay out several, cut their boxes from one with the [layout helpers](#layout).
  - `at: [from, to]`: the seconds of the clip it shows in, counted from the clip's start (default the whole clip). Word times are video seconds, so take the clip's start off: `at: [this.ctx.words.get('the tide').start - this.ctx.start, 9]`. A window in seconds that starts at or after the clip's end, or ends before it starts (video seconds given by mistake), throws.
  - `motion`: its entrance and exit, `{ from: 'up' | 'down' | 'left' | 'right' | 'fade' | 'scale' | 'none', in: 0.6, out: 0.4, delay: 0, distance }`, or `false` for none. Motion is drawn in GL per sub-frame, so it gets motion blur under `--samples auto`.
  - `css`: CSS added to its layer, to restyle it (each component lists its classes below).
  - `label`: its name in `reel check` findings.
- Values marked *Anim* take a value or a function of the frame, `(f) => …`, evaluated once per output frame: `text: (f) => f.lt < 2 ? 'Before' : 'After'`.
- Colours are palette keys (`'accent'`, `'accentHi'`; `bg`, `fg`, `accent`, `accentHi` and `accentLo` are in every theme, the rest only in the theme that has them, such as neutral's `'muted'`) or CSS colours (`'#6f6f73'`, `'rgb(…)'`, `'white'`, `'var(--brand)'` for a custom property the component's `css` sets). A word that is neither a key of the project's theme nor a CSS colour throws, listing the keys.
- Content changes once per output frame; keep what is shown a function of `f` (`f.lt`, `f.t`, word times), never of what was shown before.

## Text

### TextBlock

Wraps, aligns, and shrinks until the text fits its box and `maxLines`.

```ts
body = new TextBlock({
  text: 'Colours mix in linear light and are encoded once, at the end.',
  box: { x: W * 0.08, y: H * 0.3, w: W * 0.4, h: H * 0.4 },
  size: 44, minSize: 26, maxLines: 4, align: 'left', valign: 'top', weight: 400, color: 'fg',
});
```

`text` or `html` (*Anim*), `size` (largest, default 7% of the short side), `minSize` (default 2.6%), `fit` (default true), `maxLines`, `align`, `valign`, `font` (a CSS family, default Archivo), `weight` (700), `lineHeight` (1.15), `color` (fg). Text that cannot fit even at `minSize` runs out of the box and `reel check` reports it. To reveal text as it is spoken without it reflowing, keep the unsaid part laid out but hidden: `html: (f) => esc(said) + '<span style="visibility: hidden">' + esc(rest) + '</span>'`. Class: `.tb`.

### KineticText

Text that enters a piece at a time: its words or letters fade, rise, scale, unblur or slide up from behind their baseline, one after another, or each word as it is said.

```ts
title = new KineticText({ text: 'Every frame is a function of time', by: 'word', enter: 'rise', each: 0.08, at: [0.3, 5] });
letters = new KineticText({ text: 'LOUD', by: 'letter', enter: 'scale', order: 'center', size: 160 });
line = new KineticText({ words: this.ctx.words.get('the tide turns'), enter: 'blur', highlight: true });   // each word as it is said
```

- `text` (*Anim*: the pieces are made again when it changes), `by`: `'word'` (default) or `'letter'` (graphemes; a word's letters stay together, so lines wrap between words only). Words break at ASCII white space only (a no-break space joins two), and a word never wraps inside, so text without spaces (CJK) needs spaces or shorter lines.
- `enter`: `'rise'` (default), `'drop'`, `'fade'`, `'scale'`, `'blur'`, `'clip'` (up from behind its word's baseline, at full opacity), or a function of the piece's progress giving its inline style: ``(k) => ({ opacity: k, transform: `rotate(${(1 - k) * 12}deg)` })``. `distance` (em) is how far `rise` and `drop` travel (0.6); `room` (em) is the room around the box pieces may move through on their way in (default what the entrance needs; 1 for a function).
- Timing, from the start of its window plus `delay`: `each` (seconds between pieces: 0.08 a word, 0.03 a letter) or `total` (the spread from first to last), `dur` (0.5 a word, 0.35 a letter), `ease` (`ease.outCubic`), `order` (`'start'`, `'end'`, `'center'`, `'edges'`, `'random'` with `seed`). This is `stagger()` (below) per piece. `kt.progress(f, i)` is piece i's progress, `kt.endAt(f)` the clip second the last is in (any frame of the clip will do, even one not yet drawn).
- `words`: a line of timed words (`this.ctx.words.get('…')`) or its `words`: each word enters at its start, its letters spread over its time, and the stagger options other than `dur` and `ease` are ignored. `text` defaults to the words and must have as many. `highlight`: the word being said in the accent (`true`) or a colour.
- Lays out as a TextBlock: `size`, `minSize`, `fit`, `maxLines`, `align` (`center`), `valign`, `font`, `weight`, `lineHeight`, `color`. It fits with every piece at rest; text that does not fit even so is cut off at the box, and `reel check` says so.
- The pieces move in the HTML layer, so their motion changes once per output frame and is not motion blurred; `motion` (default: no entrance of its own, a 0.4 s fade out) is drawn in GL as for any component.
- `reel check` sees each piece as part of one run of text (no overlaps between pieces) and measures a piece's contrast and margins once it is in. Classes: `.kt`, `.w` (a word), `.p` (a piece), `.now`, `.said` (with `highlight`).

### Staggering anything

`stagger(t, i, n, { at, each, total, dur, ease, order, seed })` is item i of n's eased progress at t, for any group: tiles of a grid, points of a chart, your own spans. `staggerStart(i, n, o)` is when item i starts.

```ts
tiles.forEach((tile, i) => { const k = stagger(f.lt, i, tiles.length, { at: 0.4, each: 0.05, order: 'center' }); /* draw tile at k */ });
```

### TitleCard

```ts
card = new TitleCard({ kicker: 'Part two', title: 'Where the time goes', subtitle: 'Render minutes, measured', align: 'center' });
```

`title` (plain text: tags in it are shown as typed) or `html` (markup: `<em>` is drawn in the accent colour, `<br>` breaks the line), `subtitle`, `kicker` (all *Anim*), `align` (`center` | `left`), `font`, `weight` (800), `rule` (the accent bar, default true). The title shrinks (to three lines at most) until the whole card fits its box, by default the safe area. Classes: `.kicker`, `.title`, `.rule`, `.subtitle`.

### LowerThird

```ts
who = new LowerThird({ name: 'Ada Lovelace', role: 'Analyst', at: [1, 6], side: 'left' });
```

`name`, `role` (*Anim*), `side`. A panel in the lower left (or right) of the safe area that slides in from its side. Give it room: a narrow `box` wraps the name, and lines past the box are cut off (check reports them as `clipped`). Classes: `.lt`, `.bar`, `.name`, `.role`.

## Captions

```ts
captions = new Captions({ words: this.ctx.words, style: 'highlight', position: 'bottom' });
```

- `words`: the project's timed words (`this.ctx.words`), or for a video without a voice `Words.timed([{ text, start, end }, …], pace)`, which spreads each line's words over its time by length.
- `style`: `'highlight'` (the page's words dimmed until said, the word being said in the accent), `'line'` (the page fades in whole), `'word'` (one word at a time, large).
- `position` (`bottom` | `top` | `middle`, inside the safe area), `size`, `lines` per page (2), `panel` and `panelOpacity` (a panel in the background colour behind the text), `hold` (seconds a page stays after its last word), `color`, `accent`, `font`, `weight`.
- Pages are runs of whole words that fit `lines` lines of the box (CJK and emoji count as two Latin characters; a run of CJK, which has no spaces, is split between pages); each shows from its first word to the next page. `captions.pages` lists them, `captionPages(words, maxChars)` makes them.
- Captions run on video time: put them in a clip that spans the narration, usually on a track above the scenes. Classes: `.cap` (the page), `.w` (a word), `.said`, `.now`.

## ImageBox

```ts
photo = new ImageBox({ src: 'assets/ridge.jpg', alt: 'ridge', box: { x: W * 0.5, y: H * 0.15, w: W * 0.42, h: H * 0.6 }, radius: 18,
  kenBurns: { from: { zoom: 1 }, to: { zoom: 1.15, x: 0.4, y: 0.2 } } });
```

`src` (a path in the project), `fit` (`cover`, the default, fills and crops; `contain` shows all of it), `radius`, `kenBurns` (`true` for a slow push in, or a move from one framing to another across the window: `zoom` 1 is fitted, `x` and `y` pan from -1 to 1 across the room the zoom leaves), `alt`. Drawn in GL from the source file, so the pan is smooth and motion blurred; it loads before the first frame, and a file that does not load is an error, unless `assets.json` declares it as a generated asset not made yet: then a labelled placeholder of its declared size stands in (and `reel check` reports it). Default motion: a fade.

Formats: PNG, JPEG, WebP, AVIF, GIF (its first frame) and SVG. An image with a colour profile (Display P3 from a phone, Adobe RGB) is converted to sRGB, so its colours match the file in any viewer. A 16-bit PNG keeps its 16 bits (a dark gradient or a sky stays smooth under the theme's grade). An SVG is rasterised at the size it is shown times `--scale` and the furthest Ken Burns zoom, so it is sharp at 4K; give it a `viewBox`.

## VideoClip

```ts
shot = new VideoClip({ src: 'assets/shot.mp4', box: { x: 0, y: 0, w: W, h: H }, trim: [2, 6.5], speed: 0.5, frames: 'blend' });
override async prepare(f: Frame) { await this.shot.prepare(f, this.ctx.renderer); }   // decodes what the frame shows
render(f: Frame, out: THREE.WebGLRenderTarget) { this.shot.draw(this.ctx.renderer, out, f); }
override dispose() { this.shot.dispose(); }
```

- A video file in a box, decoded frame by frame with WebCodecs from the file's own samples (never a `<video>` element's clock): every frame is decoded from the keyframe before it, so the frame at a time is the same whether reached by playing, by a seek or out of order. The scene must call `await clip.prepare(f, this.ctx.renderer)` in its `prepare(f)`; `draw` throws on a frame that was not prepared.
- `src`: an MP4 or MOV of H.264, HEVC, VP9 or AV1 (re-encode anything else, WebM included: `ffmpeg -i in.webm -c:v libx264 -crf 18 -g 30 -pix_fmt yuv420p -c:a aac out.mp4`). A keyframe every second or so (`-g` at the frame rate) keeps seeks quick. A phone video's rotation flag is not applied (an ffmpeg re-encode applies it).
- `trim: [from, to]` (source seconds; default all of it), `speed` (source seconds per clip second: 0.5 is slow motion), `loop` (play the trim again from its start; else hold its last frame), `fit`, `radius`, `kenBurns` (as ImageBox), `at` (its window in the clip; it starts at the window's start).
- `frames`: `'nearest'` (default) shows the frame on display at each output frame, as a player does: every sub-frame of an export shows that one frame (the source's own motion blur is in it), while the box's motion still blurs. `'blend'` mixes each frame into the next by how far the moment is between them: smooth slow motion from a low frame rate.
- `alpha: 'below' | 'right'`: stacked alpha, the colour in one half of the frame and a grey matte (white opaque) in the other, for transparent overlays (no codec WebCodecs decodes carries alpha).
- Sound: the file's own sound goes into the mix (`reel mix`, `reel video --mix`) under the clip, trimmed, at its speed (pitch kept), once per pass of a loop; `sound: false` leaves it out, `sound: { db: -6 }` sets its gain. The preview plays the project's track only.
- Memory: decoded frames stay on the GPU as textures with mipmaps, the least recently used dropped beyond `cacheMB` (default 384: about 35 frames of 1080p). A frame is 4 bytes a pixel (8 MB at 1080p, 33 MB at 4K).
- A file that is missing, not an MP4, or in a codec the browser cannot decode is an error of the clip that `reel check` reports. `clip.duration` is the file's length once loaded. Default motion: a fade.

## LottieBox

```ts
badge = new LottieBox({ src: 'assets/badge.json', box: { x: W / 2 - 200, y: 300, w: 400, h: 400 }, at: [1, 5] });
```

- A Lottie animation (JSON from After Effects through Bodymovin, or any tool that writes Lottie) drawn by lottie-web's canvas renderer at the exact moment each sub-frame asks for, so it is a pure function of time and gets motion blur. Its canvas is the animation's size on screen times `--scale`, so it is sharp at 4K.
- `trim: [from, to]` (animation seconds), `speed`, `loop` (else it holds its last frame), `fit` (`contain`, the default, or `cover`), `at` (its window; the animation starts at its start). Images the animation names are fetched beside its JSON; embedded (data URI) images work too.
- The light player has no expressions: an animation that uses them plays as if they were off. Text layers need their glyphs in the file.
- A missing or malformed file is an error of the clip. `badge.duration` is its length once loaded. Default motion: none.

## Charts and numbers

Charts grow as their `progress` runs from 0 to 1: by default over 1.4 s from the start of their window, eased; give `progress: (f) => …` to drive it yourself.

### BarChart

```ts
chart = new BarChart({
  title: 'Samples per frame',
  data: [{ label: 'Still', value: 1 }, { label: 'Pan', value: 9 }, { label: 'Whip', value: 24 }],
  highlight: 2, format: (v) => v.toFixed(0),
});
```

`data`, `max` (a full bar; default the largest value), `format`, `color` (accent), `highlight` (a bar's index, drawn in fg), `title`, `stagger`. Bars grow one after another; with `stagger: false` they grow together, each in proportion, which a comparison needs (staggered, a small bar leads a large one for a moment and the chart says the opposite of its point). Markup: `.frame` (a column) > `.title`, `.bars` (a row) > `.bar` (a column, bottom aligned) > `.value`, `.fill`, `.label`.

### LineChart

```ts
trend = new LineChart({
  title: 'Minutes to render one minute', series: [1, 1.2, 1.6, 2.4, 3.6, 5.2, 7.4, 10],
  labels: ['Nothing moves', 'Everything moves'], format: (v) => `${v.toFixed(1)} min`,
});
```

`series` (values evenly spaced along x, or several: `[{ values, color, label }]`), `labels` (the first and last are shown under the axis), `min`, `max`, `format`, `title`. The line is revealed left to right, with a dot and the value at its head (on the first series). Classes: `.title`, `.plot`, `.lines`, `.line`, `.head`, `.value`, `.axis`.

### Counter

```ts
count = new Counter({ to: 7.8, digits: 1, suffix: '×', caption: 'faster than a fixed 24 samples' });
```

`to`, `from` (0), `digits` or `format`, `prefix`, `suffix`, `caption`, `size`, `color`, `align` (`center` (default) | `left` | `right`: where the number and caption sit across the box). Tabular figures, so the number does not jitter as it counts. Markup: `.frame` (a column, centred vertically) > `.num`, `.cap`.

### ProgressBar and Timer

```ts
bar = new ProgressBar({ box: { x: W * 0.08, y: H * 0.06, w: W * 0.7, h: 40 } });               // the clip's progress, f.p
timer = new Timer({ format: 'm:ss', from: 30, to: 0 });                                          // counts down over the window
```

ProgressBar: `progress` (*Anim*, default `f.p`), `text` (*Anim*, beside the bar), `color`; along the bottom of the safe area by default. Timer: `from` and `to` (seconds shown at the start and end of the window; default counts up from 0), `format` (`'m:ss'`, `'mm:ss'`, `'ss'`, `'m:ss.t'`), `size`, `color`; top right of the safe area by default. Neither moves in or out unless given `motion`. `clock(s, format)` and `formatNumber(x, digits)` are the formatting they use. Classes: `.track`, `.fill`, `.label`; `.clock`.

## Drawn lines

### SvgDraw

```ts
wave = new SvgDraw({
  paths: ['M0 50 C50 0 100 0 150 50 S250 100 300 50', { d: 'M120 10 h40 v40 h-40 Z', color: 'fg', fill: 'accentHi' }],
  viewBox: [0, 0, 300, 100], box: { x: W * 0.3, y: H * 0.2, w: W * 0.4, h: H * 0.2 }, width: 6,
});
logo = new SvgDraw({ src: 'assets/logo.svg', box: center(safeBox(), 600, 400), progress: (f) => prog(f.lt, 0.5, 3) });
```

Strokes drawn on along their length as `progress` runs 0 to 1 (*Anim*; by default from 0.2 s to 1.6 s into the window, eased out), one after another with each overlapping the next (`stagger: false`: all together); a fill fades in as its stroke finishes.

- `paths`: path data (`d` strings, or `{ d, color, width, fill }`) in `viewBox` units (default the box's own px); `color` (accent), `width` (logical px whatever the viewBox, default 0.5% of the short side; with `fit: 'stretch'`, along the narrower scale), `fill` (none; `fill: 'none'` on one path turns the drawing's fill off for it). Round caps and joins.
- `src`: an SVG file in the project instead, put in the layer as markup: its shapes (paths, lines, polylines, polygons, rects, circles, ellipses; not those in `defs`, clip paths, masks, markers or symbols) draw on in document order with the file's own strokes (a non-scaling stroke scales with the drawing); their fills fade in, and their own dashes and markers show once they are drawn. A shape with no stroke only fades in, as `<use>`, `<text>` and `<image>` elements do in their turn; what the file hides (itself, or a group of it) stays hidden and takes no turn. Loaded before the first frame with the images it names (relative to the file); a missing or malformed file is an error of the clip (no placeholder for a declared asset not made yet, as ImageBox has). Scripts, event handlers, `foreignObject` and SMIL animation (`<animate>`, `<set>` and the like, which would run on the wall clock) are dropped; the files it names (`href`s) are relative to it, as in a browser, but `url()`s in its styles are relative to the project. Its text needs its fonts loaded, as any layer's does. Give it a `viewBox` (without one, its width and height in absolute units stand in).
- `fit`: `contain` (default), `cover` (cropped at the box), `stretch`, as `preserveAspectRatio`.
- Its layer reaches a little past its box, so strokes on the box's edge keep their caps. Default motion: it cuts in (drawing on is its entrance) and fades out over 0.3 s. Reported to `reel check` as a picture named by its `label` (default its `src`). Markup: `.host` > `svg.art` > the shapes (`.stroke` for `paths`).

### Arrow

```ts
a = new TextBlock({ text: 'Scene', box: cells[0] });
b = new TextBlock({ text: 'Engine', box: cells[1] });
link = new Arrow({ from: this.a.box, to: this.b.box, curve: 0.2, at: [1, 6] });     // met at the sides facing each other
point = new Arrow({ from: { x: W * 0.7, y: H * 0.8 }, to: this.b.box, toSide: 'bottom', heads: 'both', color: 'fg' });
```

An arrow drawn on from `from` to `to` as `progress` runs 0 to 1 (as SvgDraw), its head riding the end of the drawn line.

- `from`, `to`: points `{ x, y }` or boxes (a component's `box`). A box is met at `fromSide` / `toSide`: `'top' | 'right' | 'bottom' | 'left' | 'center'`, or `'auto'` (default), the side facing the other end (its side's point when that is fixed, else its centre). `gap`: px left clear of a box's side (default 12; 0 for a point).
- `curve`: a bow as a share of its length, positive bending left of the way it runs (on screen), negative right (default 0, straight). `heads`: `'end'` (default), `'start'`, `'both'`, `'none'`. `color` (accent), `width` (default 0.5% of the short side), `head` (its length, default 4.5 widths).
- Its `box` is the line's bounds (its layer reaches past them for the heads, and `reel check` sees the line's bounds); it is fixed when made, so make an arrow between boxes that do not move (an arrow to a moving component: draw it at the component's final place, or make it per layout). Same default motion as SvgDraw. Classes: `.art`, `.line`, `.head`, `.tail` (the start's head).
- `anchor(box, side, toward?)`, `arrowTrack(a, b, curve)` and `pointAlong(track, px)` are the geometry it uses, for drawings of your own.

## CodeBlock

```ts
code = new CodeBlock({
  code: SOURCE, lang: 'typescript', title: 'scenes/hello.ts', lineNumbers: true,
  reveal: (f) => (f.lt - 0.5) * 6,                     // lines shown: six a second
  highlight: (f) => (f.lt > 3 ? [6, 7, 8] : []),       // the rest dimmed
});
```

`code`, `lang` (one of `CODE_LANGUAGES`: bash, cpp, css, diff, glsl, go, javascript, json, python, rust, sql, typescript, xml, yaml, and their aliases ts, js, py, sh, html, c, rs, yml; an unknown language is an error), `size` (largest; the font shrinks so the longest line and every line fit, no line wraps), `lineNumbers`, `highlight` (1-based lines, *Anim*), `reveal` (how many lines show, *Anim*), `title` (a file name bar), `panel`. Highlighted by highlight.js in the theme's colours: keywords in the accent, strings between the accent and fg, comments dimmed. Classes: `.code`, `.ln`, `.no`, `.on`, `.hljs-*`.

## Layout

Boxes cut from a box, so a scene lays out in shares of the frame instead of sums. Each returns plain `Box`es, to give any component (or an `Arrow`, or your own drawing):

```ts
const area = safeBox(0.1);
const [left, right] = split(area, 'h', [2, 1], 60);          // a row: left twice as wide as right, 60 px between
const cells = grid(inset(left, 20), 3, 2, [24, 32]);          // 3 across, 2 down, row by row: cells[r * 3 + c]
const badge = center(right, 300, 300);                        // a 300 x 300 box in the middle of right
const corner = align(right, 200, 80, 'end', 'start');         // top right of right
const stacked = split(area, H > W ? 'v' : 'h', 2, 40);        // side by side, or one above the other in a vertical cut
```

- `split(box, 'h' | 'v', shares, gap = 0)`: `'h'` a row of parts left to right, `'v'` a column top to bottom; `shares` are relative (`[2, 1]`, `[0.56, 0.26]`), or a count of equal parts. Gaps go between parts only, so the parts fill the box.
- `grid(box, cols, rows, gap = 0)`: equal cells, `gap` one number or `[across, down]`. Gaps wider than the box can hold shrink, so parts never leave it.
- `inset(box, px)`: shrunk on every side, or per side `{ top, right, bottom, left }` (`x` and `y` set two at once); negative grows it.
- `align(box, w, h, x = 'center', y = 'center')` with `'start' | 'center' | 'end'`, and `center(box, w, h)`: a box of a size placed in another.

## Waveform and Spectrum

The analysed song drawn as a picture: levels from `reel analyze` (`audio.wave`, `audio.bands`; see the `reel-audio` skill), computed at every sub-frame's time, so they move smoothly and blur under `--samples auto`, and drawn by a shader in logical px (sharp at every `--scale`). Both need `audio: this.ctx.audio`; an analysis without a waveform or spectrum (narration, or one made before they were stored) is an error of the clip: run `reel analyze` again. Default motion: a fade. They report a `shape` to `reel check`.

```ts
overview = new Waveform({ audio: this.ctx.audio });                                         // the clip's span, played part in the accent
scope = new Waveform({ audio: this.ctx.audio, window: 3, style: 'line', playhead: 0.8 });    // 3 s scrolling past now
eq = new Spectrum({ audio: this.ctx.audio, count: 32, box: { x: W * 0.1, y: H * 0.55, w: W * 0.8, h: H * 0.3 } });
ring = new Spectrum({ audio: this.ctx.audio, style: 'radial', inner: 0.5 });
```

- `Waveform`: `window` (`'clip'`, the default: the clip's own span of video time, static, with what has played in `color` and the rest in `restColor` at `restOpacity`; `[from, to]` in video seconds, static; or a number of seconds that scrolls past the playhead, at `playhead` across the box, 0.5 by default, fading at the box's ends). `style` (`'bars'` or `'line'`, a line through the levels over a fill of opacity `fill`), `mirror` (about the middle, default true; false rises from the bottom), `count` (bars or points across the box; a static line runs edge to edge), `measure` (`'peak'` or `'rms'`), `gain`, `gap`, `round`, `lineWidth`, `color` (accent), `restColor` (fg), `restOpacity` (0.35). Default box: a band across the middle of the safe area. Scrolling bars stand for fixed spans of the song and slide, so they never flicker.
- `Spectrum`: `style` (`'bars'`, low to high across the box, or `'radial'`, round a circle with the lows at the top, mirrored down both sides unless `symmetric: false`), `count` (bars, or bars on each side of a symmetric ring; default the analysis' 24 bands; fewer show the loudest of the bands each covers, more interpolate between them), `mirror` (bars from the middle both ways), `inner` (the ring's inner radius, a share of the box's half short side, 0.45), `gain`, `gap`, `round`, `color`. Default box: a band below the middle of the safe area for bars, a centred square for the ring.
- Colours are palette keys or `'#rrggbb'`. Silent levels draw as a short stub (a dot for narrow round bars), so the shape stays readable in a break.

## Your own component

`HtmlComponent` is the base the kit's HTML components share: subclass it with the markup, the CSS and an `update(f)` that brings the markup up to date, and it gets `box`, `at`, `motion` and `draw()`. The defaults passed to `super` must include a `box` (the layer is made that size; `pad: px` makes it larger by that much on each side, for strokes on the box's edge, with the box at `pad` px in):

```ts
import { HtmlComponent, type ComponentOptions, safeBox, type Frame } from 'reel';

class Badge extends HtmlComponent {
  constructor(private text: string, o: ComponentOptions = {}) {
    super(o, { box: safeBox(0.1), label: 'badge', html: '<span class="b"></span>', css: '.b { font: 700 40px Archivo; color: var(--accent); }' });
  }
  protected update(f: Frame) { this.layer.text('.b', this.text); }
}
```

## Checking a layout

Every component reports its text to `reel check`: boxes, sizes, colours, overflow and clipping. Parts of one run of text (the words of a caption) never count as overlapping each other. Run `reel check` and `reel check --size 1080x1920` after laying out a scene.
