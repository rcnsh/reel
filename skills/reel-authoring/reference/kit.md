# The component kit

Ready-made pieces, imported from `reel`: text blocks, a title card, a lower third, captions, an image, a video clip, a Lottie animation, charts (bars, stacked bars, lines, donuts and pies), a table, a counter, a progress bar, a timer and a code block. Each is built on an HTML layer (the image, video and Lottie on GL), so it is in the theme's colours, sharp at every `--scale`, reported to `reel check`, and a pure function of time.

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

- Make components as fields of a scene (they belong to its clip) and call `draw(renderer, out, f, { opacity? })` in `render()`, in back-to-front order. On a track above 0, clear to transparent first.
- Options every component takes:
  - `box: { x, y, w, h }` in logical px. Each has a default laid out from `W` and `H` inside the safe margin (`safeBox(inset)` makes one), so it holds in 16:9, vertical and square. Sizes default to shares of `UNIT`, the frame's short side.
  - `at: [from, to]`: the seconds of the clip it shows in, counted from the clip's start (default the whole clip). Word times are video seconds, so take the clip's start off: `at: [this.ctx.words.get('the tide').start - this.ctx.start, 9]`.
  - `motion`: its entrance and exit, `{ from: 'up' | 'down' | 'left' | 'right' | 'fade' | 'scale' | 'none', in: 0.6, out: 0.4, delay: 0, distance }`, or `false` for none. Motion is drawn in GL per sub-frame, so it gets motion blur under `--samples auto`.
  - `css`: CSS added to its layer, to restyle it (each component lists its classes below).
  - `label`: its name in `reel check` findings.
- Values marked *Anim* take a value or a function of the frame, `(f) => …`, evaluated once per output frame: `text: (f) => f.lt < 2 ? 'Before' : 'After'`.
- Colours are palette keys (`'accent'`, `'accentHi'`, `'muted'`) or CSS colours.
- Content changes once per output frame; keep what is shown a function of `f` (`f.lt`, `f.t`, word times), never of what was shown before.

## Text

### TextBlock

Wraps, aligns, and shrinks until the text fits its box and `maxLines`.

```ts
body = new TextBlock({
  text: 'Colours mix in linear light and are encoded once, at the end.',
  box: { x: W * 0.08, y: H * 0.3, w: W * 0.4, h: H * 0.4 },
  size: 44, minSize: 26, maxLines: 4, align: 'left', valign: 'top', weight: 400, color: 'muted',
});
```

`text` or `html` (*Anim*), `size` (largest, default 7% of the short side), `minSize` (default 2.6%), `fit` (default true), `maxLines`, `align`, `valign`, `font` (a CSS family, default Archivo), `weight` (700), `lineHeight` (1.15), `color` (fg). Text that cannot fit even at `minSize` runs out of the box and `reel check` reports it. To reveal text as it is spoken without it reflowing, keep the unsaid part laid out but hidden: `html: (f) => esc(said) + '<span style="visibility: hidden">' + esc(rest) + '</span>'`. Class: `.tb`.

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

Charts and the table grow as their `progress` runs from 0 to 1: by default over 1.4 s from the start of their window (after a 0.2 s beat), eased; give `progress: (f) => …` to drive it yourself, for example from word times. Chart text is HTML, so `reel check` sees every label and value.

### BarChart

```ts
chart = new BarChart({
  title: 'Samples per frame',
  data: [{ label: 'Still', value: 1 }, { label: 'Pan', value: 9 }, { label: 'Whip', value: 24 }],
  highlight: 2, format: (v) => v.toFixed(0),
});
```

`data`, `max` (a full bar; default the largest value; a value past it fills its bar), `format`, `color` (accent), `highlight` (a bar's index, drawn in fg; an index that is not a bar is an error), `title`, `stagger`, `orientation` (`'vertical'`, the default, or `'horizontal'`: bars run right from an axis, labels on the left and values at their ends, which suits long labels and many bars). Bars grow one after another; with `stagger: false` they grow together, each in proportion, which a comparison needs (staggered, a small bar leads a large one for a moment and the chart says the opposite of its point). Markup: `.frame` (a column) > `.title`, `.bars` (a row) > `.bar` (a column, bottom aligned) > `.value`, `.fill`, `.label`; horizontal: `.bars` is a grid, `.bar` > `.label`, `.track` > `.fill`, `.value`.

### StackedBarChart

```ts
cost = new StackedBarChart({
  title: 'Seconds per export', orientation: 'horizontal',
  series: [{ label: 'Render' }, { label: 'Encode' }, { label: 'Mix', color: 'fg' }],
  data: [{ label: 'Demo', values: [30, 12, 4] }, { label: 'Music', values: [44, 16, 9] }],
  format: (v) => `${v.toFixed(0)} s`,
});
```

`series` (names for the legend, in the order of each bar's values, and colours), `data` (each bar's label and values, 0 or more, stacked bottom or left first), `legend` (default true), and BarChart's `max` (default the largest total), `format` (the total at each bar's end), `highlight` (that bar keeps its colours, the rest are dimmed), `title`, `stagger`, `orientation`. A bar grows as a whole with its segments in proportion. Series colours default to `seriesColor(i)`: accent, a light accent, fg, a light fg, accentHi, accentLo, in every theme. Markup as BarChart, with `.seg`s inside each `.fill` and `.legend` > `.key` under the title.

### LineChart

```ts
trend = new LineChart({
  title: 'Minutes to render one minute', series: [1, 1.2, 1.6, 2.4, 3.6, 5.2, 7.4, 10],
  labels: ['Nothing moves', 'Everything moves'], format: (v) => `${v.toFixed(1)} min`,
});
```

`series` (values evenly spaced along x, or several: `[{ values, color, label }]`), `labels` (the first and last are shown under the axis), `min`, `max`, `format`, `title`. The line is revealed left to right, with a dot and the value at its head (on the first series). Classes: `.title`, `.plot`, `.lines`, `.line`, `.head`, `.value`, `.axis`.

### DonutChart

```ts
share = new DonutChart({
  title: 'Where the time goes',
  data: [{ label: 'Render', value: 52 }, { label: 'Encode', value: 21 }, { label: 'Mix', value: 18 }],
  highlight: 0,                                       // pulled out, the rest dimmed; its share counts up in the hole
});
pie = new DonutChart({ data, hole: 0, labels: 'around', show: 'both', format: (v) => `${v} s` });
```

Slices sweep in clockwise from 12 o'clock as progress runs 0 to 1, each slice's label appearing as the sweep reaches it. `data` (label, value 0 or more, `color`; default `seriesColor(i)`), `hole` (the hole's share of the radius, default 0.6; 0 is a pie), `labels` (`'legend'`, the default: beside the ring in a wide box, under it in a tall one; `'around'`: at each slice, for a few slices with room on both sides; `'none'`), `show` (`'share'`, the default, `'value'` or `'both'`), `format` (values), `shareDigits` (the percents' decimals; they always add up to 100), `center` (*Anim*, the text in the hole; default the highlighted slice's share, else the total, counting up; `''` for none), `caption` (under it; default the highlighted slice's name), `highlight`, `gap` (px between slices), `title`. The hole's text is sized to fit the hole: a small ring has small text, which `reel check` flags. `donutSlices(values)` and `percents(values, digits)` are its maths. Classes: `.title`, `.ring`, `.slice`, `.center` > `.num`, `.cap`; `.legend` > `.key` > `i`, `.name`, `.val`; `.tag`.

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

ProgressBar: `progress` (*Anim*, default `f.p`), `text` (*Anim*, beside the bar), `color`; along the bottom of the safe area by default. Timer: `from` and `to` (seconds shown at the start and end of the window; default counts up from 0), `format` (`'m:ss'`, `'mm:ss'`, `'ss'`, `'m:ss.t'`), `size`, `color`; top right of the safe area by default. Neither moves in or out unless given `motion`. `clock(s, format)` and `formatNumber(x, digits)` are the formatting they use. Charts grow item by item with `growth(p, i, n, stagger)` and take their default progress from `progressOf(options, f, seconds)`: use them in a component of your own to match. Classes: `.track`, `.fill`, `.label`; `.clock`.

## Table

```ts
table = new Table({
  title: 'Exports this week',
  columns: ['Project', 'Frames', { label: 'Cost', prefix: '$', digits: 2 }, { label: 'Change', suffix: '%', digits: 1 }],
  rows: [['Demo', 2100, 0.81, 12.5], ['Music', 5400, 2.4, -4.25]],
  highlight: (f) => (f.lt > 2.5 ? 1 : undefined),    // a row, several ([0, 2]) or none, changing over time
});
```

The header shows with the component; rows rise and fade in one after another as progress runs 0 to 1 (by default 0.2 s a row, at least 1.4 s, and done 0.6 s before the window ends however many rows there are; `stagger: false` brings them in together). `columns`: labels, or `{ label, align, digits, prefix, suffix, format, width }` (`width` a share of the table's width). `rows`: cells of numbers or text. A column of numbers aligns right unless told otherwise; numbers are grouped (`1,234.50`), with a true minus before the prefix (`−$1,200.50`) and no sign on a value that rounds to zero; `format: (v, row) => …` replaces that. `highlight` (*Anim*: a row index, an array of them, or undefined; an index that is not a row is an error) draws a tinted band with a bar in `color` (accent); the text is thickened with a stroke rather than set bold, so the columns do not move when the highlight does. `size` (font; it shrinks so the title, header and rows fit the box's height: many rows in a short box come out too small to read, which `reel check` flags, so split them over two tables or clips), `title`. Cells do not wrap: a table wider than its box is cut off and `reel check` reports it. `formatCell(v, column)` and `columnAlign(rows, i, column)` are its formatting. Markup: `.frame` > `.title`, `table` > `thead` > `tr` > `th`; `tbody` > `tr` (`.hi` when highlighted) > `td`.

## CodeBlock

```ts
code = new CodeBlock({
  code: SOURCE, lang: 'typescript', title: 'scenes/hello.ts', lineNumbers: true,
  reveal: (f) => (f.lt - 0.5) * 6,                     // lines shown: six a second
  highlight: (f) => (f.lt > 3 ? [6, 7, 8] : []),       // the rest dimmed
});
```

`code`, `lang` (one of `CODE_LANGUAGES`: bash, cpp, css, diff, glsl, go, javascript, json, python, rust, sql, typescript, xml, yaml, and their aliases ts, js, py, sh, html, c, rs, yml; an unknown language is an error), `size` (largest; the font shrinks so the longest line and every line fit, no line wraps), `lineNumbers`, `highlight` (1-based lines, *Anim*), `reveal` (how many lines show, *Anim*), `title` (a file name bar), `panel`. Highlighted by highlight.js in the theme's colours: keywords in the accent, strings between the accent and fg, comments dimmed. Classes: `.code`, `.ln`, `.no`, `.on`, `.hljs-*`.

## Your own component

`HtmlComponent` is the base the kit's HTML components share: subclass it with the markup, the CSS and an `update(f)` that brings the markup up to date, and it gets `box`, `at`, `motion` and `draw()`. The defaults passed to `super` must include a `box` (the layer is made that size):

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
