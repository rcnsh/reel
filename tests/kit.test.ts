// The component kit: its pure helpers, and a rendered project of components that `reel check` passes, that renders
// the same frame after a seek backwards, and whose faults (text cut off at a layer's edge, text overflowing a
// block that does not fit it) check names.
import { afterAll, describe, expect, test } from 'bun:test';
import { arcPath, captionPages, clock, columnAlign, donutSlices, formatCell, growth, percents, polar, stackBars, textWidth, cssColor, esc, formatNumber, kineticPieces, motionAt, splitHighlighted, windowOf } from '../src/kit';
import { LOADING } from '../src/engine/scene';
import { clipTime } from '../src/engine/cliptime';
import { ease, stagger, staggerStart } from '../src/engine/util';
import { Words } from '../src/engine/words';
import { fixture, hasChrome, reel } from './helpers';

// (the clip being loaded, without time remapping)
const loading = (start: number, end: number) => ({ id: 'c', start, end, time: clipTime({ id: 'c', start, end }, 30) });

describe('helpers', () => {
  test('splitHighlighted closes spans at line ends and reopens them on the next line', () => {
    expect(splitHighlighted('<span class="c">/* a\nb */</span> x\ny')).toEqual(['<span class="c">/* a</span>', '<span class="c">b */</span> x', 'y']);
    expect(splitHighlighted('<span class="a"><span class="b">1\n2</span>3</span>')).toEqual(['<span class="a"><span class="b">1</span></span>', '<span class="a"><span class="b">2</span>3</span>']);
  });

  test('captionPages splits lines into runs of whole words, each shown until the next', () => {
    const words = Words.timed([{ text: 'one two three four five six', start: 0, end: 6 }, { text: 'seven', start: 8, end: 9 }], 1);
    const pages = captionPages(words, 9, 0.5);
    expect(pages.map((p) => p.text)).toEqual(['one two', 'three', 'four five', 'six', 'seven']);
    for (let i = 0; i + 1 < pages.length; i++) expect(pages[i]!.end).toBeLessThanOrEqual(pages[i + 1]!.start);
    expect(pages.at(-2)!.end).toBeCloseTo(6.5); // held half a second after its last word
  });

  test('captionPages counts CJK and emoji twice and splits a line of CJK, which has no spaces, into pages', () => {
    expect(textWidth('abc')).toBe(3);
    expect(textWidth('日本語')).toBe(6);
    expect(textWidth('🎬a')).toBe(3);
    const cjk = 'これは日本語の字幕です。スペースがないので一つの単語として扱われます。';
    const pages = captionPages(Words.timed([{ text: cjk, start: 0, end: 7 }], 1), 20);
    expect(pages.map((p) => p.text).join('')).toBe(cjk);
    for (const p of pages) expect(textWidth(p.text)).toBeLessThanOrEqual(20);
    expect(pages[0]!.start).toBe(0);
    expect(pages.at(-1)!.words.at(-1)!.end).toBeCloseTo(7);
    // a word that fits keeps its space; split pieces join without one
    const mixed = captionPages(Words.timed([{ text: 'Say 日本語日本語日本語日本語 now', start: 0, end: 3 }], 1), 12);
    expect(mixed.map((p) => p.text)).toEqual(['Say', '日本語日本語', '日本語日本語', 'now']);
  });

  test('clock and formatNumber are the same on every machine', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65.99)).toBe('1:05');
    expect(clock(65.99, 'mm:ss')).toBe('01:05');
    expect(clock(7.25, 'm:ss.t')).toBe('0:07.2');
    expect(clock(125, 'ss')).toBe('125');
    expect(formatNumber(1234567.891, 1)).toBe('1,234,567.9');
  });

  test('motionAt: in and out over the window, nothing outside it', () => {
    expect(motionAt({}, -0.1, 0, 2)).toBeNull();
    expect(motionAt({}, 2, 0, 2)).toBeNull();
    expect(motionAt({ in: 0.5 }, 1, 0, 2)).toEqual({ opacity: 1, dx: 0, dy: 0, scale: 1 });
    const m = motionAt({ from: 'left', in: 1, distance: 100 }, 0.5, 0, 4)!;
    expect(m.opacity).toBeCloseTo(0.875);
    expect(m.dx).toBeCloseTo(-12.5);
    expect(motionAt(false, 0, 0, 1)).toEqual({ opacity: 1, dx: 0, dy: 0, scale: 1 });
  });

  test('stackBars: each bar\'s total and its segments as shares, bottom first', () => {
    const [a, b, c] = stackBars([[1, 3], [2, 0, 2], [0, 0]]);
    expect(a).toEqual({ total: 4, segments: [[0, 0.25], [0.25, 1]] });
    expect(b).toEqual({ total: 4, segments: [[0, 0.5], [0.5, 0.5], [0.5, 1]] });
    expect(c).toEqual({ total: 0, segments: [[0, 0], [0, 0]] });
    expect(() => stackBars([[1, -2]])).toThrow('bar 0 has the value -2');
    expect(() => stackBars([[NaN]])).toThrow('finite');
  });

  test('growth: one after another, all done at the end; together without stagger', () => {
    expect(growth(0, 0, 4)).toBe(0);
    for (let i = 0; i < 4; i++) expect(growth(1, i, 4)).toBe(1);
    // the first item leads, the last starts only once the first is halfway
    expect(growth(0.25, 0, 4)).toBeGreaterThan(growth(0.25, 3, 4));
    expect(growth(0.25, 3, 4)).toBe(0);
    expect(growth(0.4, 2, 4, false)).toBe(0.4);
  });

  test('donutSlices and percents: slices end to end round the ring, percents adding up to 100', () => {
    const s = donutSlices([1, 1, 2]);
    expect(s.map((x) => [x.start, x.end])).toEqual([[0, 0.25], [0.25, 0.5], [0.5, 1]]);
    expect(donutSlices([0, 0]).every((x) => x.share === 0 && x.end === 0)).toBe(true);
    expect(() => donutSlices([1, -1])).toThrow('0 or more');
    // a third each rounds to 33 + 33 + 33 = 99: the largest remainder (ties to the earliest) takes the last unit
    expect(percents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percents([52, 21, 9, 18])).toEqual([52, 21, 9, 18]);
    expect(percents([2, 3, 7], 1)).toEqual([16.7, 25, 58.3]);
    expect(percents([0, 0])).toEqual([0, 0]);
  });

  test('arcPath: angles clockwise from 12 o\'clock, a pie wedge to the centre, a whole turn in two halves', () => {
    const [x, y] = polar(100, 100, 50, 0.25);
    expect([x, y].map((v) => +v.toFixed(6))).toEqual([150, 100]);
    expect(arcPath(100, 100, 0, 50, 0, 0.25)).toBe('M100.00 50.00 A50.00 50.00 0 0 1 150.00 100.00 L100.00 100.00 Z');
    expect(arcPath(100, 100, 25, 50, 0, 0.25)).toBe('M100.00 50.00 A50.00 50.00 0 0 1 150.00 100.00 L125.00 100.00 A25.00 25.00 0 0 0 100.00 75.00 Z');
    expect(arcPath(100, 100, 25, 50, 0.3, 0.3)).toBe('');
    expect(arcPath(100, 100, 25, 50, 0, 1).match(/M/g)).toHaveLength(2);
  });

  test('formatCell and columnAlign: grouped numbers, the sign before the prefix, numbers to the right', () => {
    expect(formatCell(1234.5, { label: '', digits: 2, prefix: '$' })).toBe('$1,234.50');
    expect(formatCell(-1200.5, { label: '', digits: 2, prefix: '$' })).toBe('−$1,200.50');
    expect(formatCell(-0.004, { label: '', digits: 1, suffix: '%' })).toBe('0.0%');
    expect(formatCell('n/a', { label: '', digits: 2 })).toBe('n/a');
    expect(formatCell(3, { label: '', format: (v, r) => `${v}@${r}` }, 7)).toBe('3@7');
    const rows = [['a', 1, 'x'], ['b', 2, 3]];
    expect([0, 1, 2].map((i) => columnAlign(rows, i))).toEqual(['left', 'right', 'left']);
    expect(columnAlign(rows, 1, { label: '', align: 'center' })).toBe('center');
  });

  test('windowOf: clip seconds as given, spans of the words taken off the loading clip', () => {
    const words = Words.timed([{ text: 'the tide comes in', start: 12, end: 14 }, { text: 'and goes out', start: 15, end: 17 }], 1);
    expect(windowOf(undefined, 'x')).toBeUndefined();
    expect(windowOf([1, 5], 'x')).toEqual([1, 5]);
    expect(windowOf([5, 5], 'x')).toEqual([5, 5]);
    expect(windowOf([2, Infinity], 'x')).toEqual([2, Infinity]);
    expect(() => windowOf([-Infinity, 2], 'x')).toThrow('expected seconds');
    expect(() => windowOf([5, 4], 'x')).toThrow('ends before it starts');
    expect(() => windowOf([words.get('tide'), 5], 'text block')).toThrow('text block: at [{ start: 12, end: 14 }, 5]: a span of the words is in video time');
    LOADING.clip = loading(10, 20);
    try {
      expect(windowOf([words.get('tide'), 9], 'x')).toEqual([2, 9]);
      expect(windowOf([1, words.get('goes out')], 'x')).toEqual([1, 7]);
      expect(windowOf(words.get('goes out'), 'x')).toEqual([5, 7]);
      expect(windowOf([words.findWords('comes')[0]!, words.get('goes')], 'x')).toEqual([words.findWords('comes')[0]!.start - 10, 7]);
      expect(() => windowOf([words.find('tide'), 9] as never, 'x')).toThrow('each end is clip seconds or a span');
      expect(() => windowOf([1, 2, 3] as never, 'x')).toThrow('expected [from, to]');
      expect(() => windowOf([1, NaN], 'x')).toThrow('expected seconds');
      expect(() => windowOf([words.get('tide'), 1.5], 'x')).toThrow('its window [2, 1.5] in clip seconds ends before it starts');
      expect(windowOf([words.get('goes out'), Infinity], 'x')).toEqual([5, Infinity]);
      LOADING.clip = loading(0, 10);
      expect(() => windowOf(words.get('goes out'), 'x')).toThrow("is outside the clip 'c' (0 to 10)");
      LOADING.clip = loading(17, 20);
      expect(() => windowOf(words.get('tide'), 'x')).toThrow("its window [-5, -3] in clip seconds is outside the clip 'c'");
      expect(windowOf([words.get('tide'), 2], 'x')).toEqual([-5, 2]); // (from before the clip into it: shown from its start)
    } finally { LOADING.clip = null; }
  });

  test('stagger: each item eases in over dur, starting each apart, in the order asked', () => {
    const o = { at: 1, each: 0.1, dur: 0.5, ease: ease.linear };
    expect(stagger(0.9, 0, 4, o)).toBe(0);
    expect(stagger(1.25, 0, 4, o)).toBeCloseTo(0.5);
    expect(stagger(1.25, 1, 4, o)).toBeCloseTo(0.3);
    expect(stagger(1.25, 3, 4, o)).toBe(0);
    expect(stagger(9, 3, 4, o)).toBe(1);
    expect([0, 1, 2, 3].map((i) => staggerStart(i, 4, { each: 1, order: 'end' }))).toEqual([3, 2, 1, 0]);
    expect([0, 1, 2, 3, 4].map((i) => staggerStart(i, 5, { each: 1, order: 'center' }))).toEqual([2, 1, 0, 1, 2]);
    expect([0, 1, 2, 3].map((i) => staggerStart(i, 4, { each: 1, order: 'center' }))).toEqual([1, 0, 0, 1]);
    expect([0, 1, 2, 3, 4].map((i) => staggerStart(i, 5, { each: 1, order: 'edges' }))).toEqual([0, 1, 2, 1, 0]);
    // total spreads the starts over a fixed time, however many items
    expect(staggerStart(9, 10, { total: 0.9 })).toBeCloseTo(0.9);
    expect(staggerStart(0, 1, { total: 0.9 })).toBe(0);
    // random: a permutation, the same for a seed, another for another seed
    const shuffle = (seed: number) => Array.from({ length: 8 }, (_, i) => staggerStart(i, 8, { each: 1, order: 'random', seed }));
    expect([...shuffle(3)].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(shuffle(3)).toEqual(shuffle(3));
    expect(shuffle(3)).not.toEqual(shuffle(4));
    expect(stagger(1, 0, 1, { at: 1, dur: 0 })).toBe(1);
  });

  test('kineticPieces splits words, and letters as graphemes within their words', () => {
    expect(kineticPieces('  one  two\nthree ', 'word')).toEqual([['one'], ['two'], ['three']]);
    expect(kineticPieces('10\u00a0km in', 'word')).toEqual([['10\u00a0km'], ['in']]);
    expect(kineticPieces('Café 🎬!', 'letter')).toEqual([['C', 'a', 'f', 'é'], ['🎬', '!']]);
  });

  test('cssColor maps palette keys to theme variables, passes CSS colours through and throws on an unknown key', () => {
    expect(cssColor('accentHi')).toBe('var(--accent-hi)');
    expect(cssColor('accentLo')).toBe('var(--accent-lo)');
    expect(cssColor('#ff0000')).toBe('#ff0000');
    expect(cssColor('white')).toBe('white');
    expect(cssColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    // (under bun the theme is neutral, which has 'muted'; print and film do not)
    expect(cssColor('muted')).toBe('var(--muted)');
    expect(() => cssColor('accent-hi')).toThrow("colour 'accent-hi'");
    expect(cssColor('var(--brand)')).toBe('var(--brand)');
    expect(() => cssColor('nope')).toThrow("colour 'nope': the theme has no such palette key (it has bg, fg, accent");
    expect(cssColor('none')).toBe('none');
    expect(esc('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
  });
});

// clips: a Canvas2D line off the centre, an HTML text block changing every frame, the Canvas2D line again (a
// Layer2D upload after an HTML one must not come out upside down), captions with a word highlighted, a chart and
// a code block; then the faults; then a text block timed by a span of the words and the same timed in clip seconds;
// then a donut, a pie, horizontal and stacked bars and a table (in place throughout); then vertical stacked
// bars and a donut with its legend under it
const project = fixture('kit', {
  'reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({
  size: [1280, 720], fps: 30, theme: 'neutral',
  timeline: () => [
    { id: 'canvas', scene: () => import('./scenes/canvas'), start: 0, end: 1 },
    { id: 'block', scene: () => import('./scenes/block'), start: 1, end: 2 },
    { id: 'canvas2', scene: () => import('./scenes/canvas'), start: 2, end: 3 },
    { id: 'parts', scene: () => import('./scenes/parts'), start: 3, end: 5 },
    { id: 'faults', scene: () => import('./scenes/faults'), start: 5, end: 6 },
    { id: 'kinetic', scene: () => import('./scenes/kinetic'), start: 6, end: 9, check: { exempt: ['blank'] } },
    { id: 'drawn', scene: () => import('./scenes/drawn'), start: 9, end: 11 },
    { id: 'scaled', scene: () => import('./scenes/scaled'), start: 11, end: 13 },
    { id: 'spans', scene: () => import('./scenes/timed'), start: 13, end: 15, params: { spans: true }, check: { exempt: ['blank'] } },
    { id: 'numbers', scene: () => import('./scenes/timed'), start: 15, end: 17, check: { exempt: ['blank'] } },
    { id: 'data', scene: () => import('./scenes/data'), start: 17, end: 19 },
    { id: 'data2', scene: () => import('./scenes/data2'), start: 19, end: 20 },
  ],
});
`,
  'scenes/block.ts': `import type * as THREE from 'three';
import { Scene, type Frame, TextBlock, clearRT, LIN } from 'reel';
export default class Block extends Scene {
  text = new TextBlock({ text: (f) => 'Frame ' + Math.round(f.t * 30) + ' of a block fitted to its box', motion: false });
  render(f: Frame, out: THREE.WebGLRenderTarget) { clearRT(this.ctx.renderer, out, LIN.bg); this.text.draw(this.ctx.renderer, out, f); }
}
`,
  'scenes/canvas.ts': `import type * as THREE from 'three';
import { Scene, type Frame, Layer2D, W, H, clearRT, LIN, rgba, reportText } from 'reel';
export default class Canvas extends Scene {
  layer = new Layer2D();
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg);
    const c = this.layer.ctx;
    this.layer.clear();
    c.font = '700 48px Archivo'; c.textAlign = 'center'; c.fillStyle = rgba('fg');
    c.fillText('Near the top', W / 2, H * 0.2);
    reportText(c, 'Near the top', W / 2, H * 0.2);
    this.ctx.comp.draw(this.ctx.renderer, this.layer.upload(), out);
  }
}
`,
  'scenes/parts.ts': `import type * as THREE from 'three';
import { Scene, type Frame, Captions, BarChart, CodeBlock, Words, clearRT, LIN, W, H } from 'reel';
const words = Words.timed([{ text: 'Captions light up each word as it is said', start: 3, end: 5 }]);
export default class Parts extends Scene {
  caps = new Captions({ words, style: 'highlight', size: 36 });
  chart = new BarChart({ data: [{ label: 'a', value: 1 }, { label: 'b', value: 3 }], box: { x: W * 0.08, y: H * 0.08, w: W * 0.4, h: H * 0.5 } });
  code = new CodeBlock({ code: 'const x = 1; // one\\nfunction f() { return x; }', lang: 'ts', box: { x: W * 0.52, y: H * 0.08, w: W * 0.4, h: H * 0.4 } });
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    clearRT(r, out, LIN.bg);
    this.chart.draw(r, out, f); this.code.draw(r, out, f); this.caps.draw(r, out, f);
  }
}
`,
  'data/words.json': JSON.stringify({ lines: [{ text: 'the tide comes in', start: 13.5, end: 14.2, words: [{ w: 'the', start: 13.5, end: 13.6 }, { w: 'tide', start: 13.6, end: 13.8 }, { w: 'comes', start: 13.8, end: 14 }, { w: 'in', start: 14, end: 14.2 }] }] }),
  'scenes/timed.ts': `import type * as THREE from 'three';
import { Scene, type Frame, TextBlock, clearRT, LIN } from 'reel';
export default class Timed extends Scene {
  text = new TextBlock({ text: 'The tide comes in', motion: false, at: this.ctx.params.spans ? this.ctx.words.get('tide') : [0.5, 1.2] });
  render(f: Frame, out: THREE.WebGLRenderTarget) { clearRT(this.ctx.renderer, out, LIN.bg); this.text.draw(this.ctx.renderer, out, f); }
}
`,
  // words rising far enough to cross the line below them, letters sliding up behind their words' baselines, and
  // words entering as they are said, the one being said highlighted
  'scenes/kinetic.ts': `import type * as THREE from 'three';
import { Scene, type Frame, KineticText, Words, clearRT, LIN, W, H } from 'reel';
const words = Words.timed([{ text: 'Each word arrives as it is said', start: 6.2, end: 8 }]);
export default class Kinetic extends Scene {
  rise = new KineticText({ text: 'Words rise into place one after another across two lines of text', by: 'word', distance: 1.4, each: 0.25, dur: 0.8, order: 'end', size: 56, box: { x: W * 0.08, y: H * 0.08, w: W * 0.5, h: H * 0.4 } });
  clip = new KineticText({ text: 'Letter by letter', by: 'letter', enter: 'clip', order: 'center', size: 48, box: { x: W * 0.6, y: H * 0.08, w: W * 0.32, h: H * 0.3 } });
  said = new KineticText({ words: words.lines[0]!, enter: 'blur', highlight: true, size: 44, box: { x: W * 0.08, y: H * 0.6, w: W * 0.84, h: H * 0.3 } });
  // (a function that leaves transform out once a piece is in: no frame may keep it from an earlier one)
  own = new KineticText({ text: 'My own entrance', size: 40, dur: 2, enter: (k) => (k < 1 ? { opacity: k, transform: 'translateY(' + (1 - k) + 'em)' } : { opacity: 1 }), box: { x: W * 0.6, y: H * 0.4, w: W * 0.32, h: H * 0.16 } });
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    clearRT(r, out, LIN.bg);
    this.rise.draw(r, out, f); this.clip.draw(r, out, f); this.said.draw(r, out, f); this.own.draw(r, out, f);
  }
}
`,
  'assets/mark.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect x="3" y="3" width="114" height="74" rx="14" fill="none" stroke="#222" stroke-width="6"/><path d="M50 24 L78 40 L50 56 Z" fill="#f3a712"><animateTransform attributeName="transform" type="rotate" from="0 64 40" to="360 64 40" dur="0.7s" repeatCount="indefinite"/></path><defs><circle id="c" r="4"/></defs><use href="#c" x="20" y="20"/><path d="M0 0 L120 80" stroke="red" visibility="hidden"/><image href="dot.svg" x="90" y="10" width="20" height="20"/></svg>',
  'assets/dot.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#2a6"/></svg>',
  'scenes/drawn.ts': `import type * as THREE from 'three';
import { Scene, type Frame, SvgDraw, Arrow, TextBlock, clearRT, LIN, W, H, safeBox, split, center } from 'reel';
const [l, r] = split(safeBox(0.1), 'h', [1, 1], 120);
export default class Drawn extends Scene {
  a = new TextBlock({ text: 'From here', box: center(l!, 300, 100), motion: false });
  b = new TextBlock({ text: 'To there', box: center(r!, 300, 100), motion: false });
  arrow = new Arrow({ from: this.a.box, to: this.b.box, curve: 0.2, heads: 'both', progress: (f) => (f.lt - 0.2) / 1.2 });
  wave = new SvgDraw({ paths: ['M0 50 C50 0 100 0 150 50 S250 100 300 50', { d: 'M100 10 h40 v40 h-40 Z', fill: 'accentHi' }], viewBox: [0, 0, 300, 100], box: { x: W * 0.3, y: H * 0.1, w: W * 0.4, h: H * 0.15 }, label: 'wave' });
  mark = new SvgDraw({ src: 'assets/mark.svg', box: { x: W * 0.4, y: H * 0.7, w: W * 0.2, h: H * 0.2 } });
  away = new Arrow({ from: { x: W * 0.8, y: H * 0.9 }, to: { x: W + 200, y: H * 0.9 }, label: 'away' });
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const rr = this.ctx.renderer;
    clearRT(rr, out, LIN.bg);
    this.a.draw(rr, out, f); this.b.draw(rr, out, f); this.arrow.draw(rr, out, f); this.wave.draw(rr, out, f); this.mark.draw(rr, out, f); this.away.draw(rr, out, f);
  }
}
`,
  'scenes/scaled.ts': `import type * as THREE from 'three';
import { Scene, type Frame, SvgDraw, TextBlock, clearRT, LIN } from 'reel';
// a line in a viewBox drawn at 3x: 0, then 95% drawn, then all of it
export default class Scaled extends Scene {
  line = new SvgDraw({ paths: ['M0 50 L300 50'], viewBox: [0, 0, 300, 100], box: { x: 100, y: 200, w: 900, h: 300 }, width: 8, motion: false,
    progress: (f) => (f.lt < 0.5 ? 0 : f.lt < 1.2 ? 0.95 : 1) });
  title = new TextBlock({ text: 'Scaled', box: { x: 100, y: 500, w: 600, h: 120 }, motion: false });
  render(f: Frame, out: THREE.WebGLRenderTarget) { clearRT(this.ctx.renderer, out, LIN.bg); this.line.draw(this.ctx.renderer, out, f); this.title.draw(this.ctx.renderer, out, f); }
}
`,
  'scenes/data.ts': `import type * as THREE from 'three';
import { Scene, type Frame, DonutChart, BarChart, StackedBarChart, Table, clearRT, LIN, W, H } from 'reel';
const series = [{ label: 'Render' }, { label: 'Encode' }];
const data = [{ label: 'Demo', values: [30, 12] }, { label: 'Music', values: [44, 16] }];
export default class Data extends Scene {
  donut = new DonutChart({ data: [{ label: 'Render', value: 52 }, { label: 'Encode', value: 21 }, { label: 'Mix', value: 18 }], highlight: 0, box: { x: W * 0.06, y: H * 0.06, w: W * 0.42, h: H * 0.4 } });
  pie = new DonutChart({ data: [{ label: 'Yes', value: 3 }, { label: 'No', value: 1 }], hole: 0, labels: 'around', box: { x: W * 0.52, y: H * 0.06, w: W * 0.42, h: H * 0.4 } });
  hbars = new BarChart({ data: [{ label: 'Still', value: 1 }, { label: 'Whip', value: 24 }], orientation: 'horizontal', box: { x: W * 0.06, y: H * 0.5, w: W * 0.28, h: H * 0.42 } });
  stacked = new StackedBarChart({ series, data, orientation: 'horizontal', highlight: 1, box: { x: W * 0.36, y: H * 0.5, w: W * 0.28, h: H * 0.42 } });
  table = new Table({ columns: ['Clip', { label: 'Cost', prefix: '$', digits: 2 }], rows: [['Demo', 0.81], ['Music', -2.4]], highlight: (f) => (f.lt > 1 ? 1 : undefined), motion: false, box: { x: W * 0.66, y: H * 0.5, w: W * 0.28, h: H * 0.42 } });
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    clearRT(r, out, LIN.bg);
    for (const c of [this.donut, this.pie, this.hbars, this.stacked, this.table]) c.draw(r, out, f);
  }
}
`,
  'scenes/data2.ts': `import type * as THREE from 'three';
import { Scene, type Frame, DonutChart, StackedBarChart, clearRT, LIN, W, H } from 'reel';
export default class Data2 extends Scene {
  stacked = new StackedBarChart({ title: 'Stacked', series: [{ label: 'Render' }, { label: 'Encode' }], data: [{ label: 'Demo', values: [30, 12] }, { label: 'Music', values: [44, 16] }], motion: false, box: { x: W * 0.06, y: H * 0.08, w: W * 0.5, h: H * 0.84 } });
  tall = new DonutChart({ data: [{ label: 'Render', value: 52 }, { label: 'Encode', value: 21 }, { label: 'Mix', value: 18 }], box: { x: W * 0.62, y: H * 0.08, w: W * 0.3, h: H * 0.84 } });
  render(f: Frame, out: THREE.WebGLRenderTarget) { const r = this.ctx.renderer; clearRT(r, out, LIN.bg); this.stacked.draw(r, out, f); this.tall.draw(r, out, f); }
}
`,
  'scenes/faults.ts': `import type * as THREE from 'three';
import { Scene, type Frame, HtmlLayer, KineticText, TextBlock, clearRT, LIN } from 'reel';
export default class Faults extends Scene {
  // (kinetic text that cannot fit its box is cut off at the box, not at its padded layer's edge)
  kin = new KineticText({ text: 'Overfull kinetic', fit: false, size: 64, total: 0, dur: 0, box: { x: 700, y: 420, w: 220, h: 60 }, motion: false });
  edge = new HtmlLayer({
    html: '<p data-label="edge">Cut off at the edge of its layer</p><p class="n" data-label="nowrap">Too long to stay in its box</p>',
    css: 'p { position: absolute; left: 40px; top: -30px; font: 700 48px Archivo; } .n { top: 100px; width: 200px; font-size: 24px; white-space: nowrap; }', width: 600, height: 200,
  });
  block = new TextBlock({ text: 'Unbreakablewordthatcannotfitatall', fit: false, size: 64, box: { x: 100, y: 400, w: 300, h: 120 }, motion: false, label: 'narrow' });
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg);
    this.edge.draw(this.ctx.renderer, out, { x: 300, y: 150 });
    this.block.draw(this.ctx.renderer, out, f);
    this.kin.draw(this.ctx.renderer, out, f);
  }
}
`,
});
afterAll(async () => { await reel(['daemon', 'stop', '--project', project.dir]); project.cleanup(); });

type Finding = { kind: string; severity: string; clip: string; text?: string };

test.skipIf(!hasChrome)('check passes the components and names the faults', async () => {
  const r = await reel(['check', '--json', '--project', project.dir]);
  const findings: Finding[] = r.json().findings;
  const real = findings.filter((f) => f.severity !== 'info');
  expect(real.filter((f) => f.clip !== 'faults')).toEqual([]);
  // (the text block's word breaks and its lines run past the bottom of the block: its layer cuts them off)
  const faults = real.filter((f) => f.clip === 'faults').map((f) => `${f.kind} ${f.severity} ${f.text!.split(' ')[0]}`).sort();
  expect(faults).toEqual(['clipped warning Cut', 'clipped warning Overfull', 'clipped warning Unbreakablewordthatcannotfitatall', 'clipped warning kinetic', 'overflow error Too']);
  expect(r.code).toBe(1);
}, 180_000);

test.skipIf(!hasChrome)('a component timed by a span of the words shows over the span, in clip seconds', async () => {
  const still = async (t: number) => (await reel(['still', '--t', String(t), '--json', '--project', project.dir])).json().files[0] as string;
  // (the largest difference in levels: the dither differs from frame to frame by 1)
  const differs = async (t: number, file: string) => (await reel(['diff', '--t', String(t), file, '--json', '--project', project.dir])).json().max as number;
  const before = await still(13.3), during = await still(13.9), after = await still(14.5);
  // the same as the clip timed in numbers at the same clip time, and blank outside the span
  expect(await differs(15.3, before)).toBeLessThanOrEqual(1);
  expect(await differs(15.9, during)).toBeLessThanOrEqual(1);
  expect(await differs(16.5, after)).toBeLessThanOrEqual(1);
  expect(await differs(13.3, after)).toBeLessThanOrEqual(1);
  expect(await differs(13.3, during)).toBeGreaterThan(100);
}, 180_000);

test.skipIf(!hasChrome)('charts and a table mid-sweep render the same after a seek past them and back', async () => {
  // charts and a table mid-sweep (a highlight that switches on later): the same after a seek past it and back
  const data = (await reel(['still', '--t', '17.7', '--json', '--project', project.dir])).json().files[0];
  await reel(['still', '--t', '18.9', '--json', '--project', project.dir]);
  const back = await reel(['diff', '--t', '17.7', data, '--json', '--project', project.dir]);
  expect(back.json().changed).toBe(0);
  expect(back.code).toBe(0);
}, 180_000);

// the mistakes that used to pass silently: a component made at a module's top level or lazily in render(), a
// colour that only another theme has, a window in video seconds, a frame drawn from Math.random(), a transition
// with nothing to overlap
const mistakes = fixture('mistakes', {
  'reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({
  size: [640, 360], fps: 30, theme: 'print',
  timeline: () => [
    { id: 'module', scene: () => import('./scenes/module'), start: 0, end: 1 },
    { id: 'lazy', scene: () => import('./scenes/lazy'), start: 1, end: 2 },
    { id: 'muted', scene: () => import('./scenes/muted'), start: 2, end: 3 },
    { id: 'late', scene: () => import('./scenes/late'), start: 3, end: 4 },
    { id: 'random', scene: () => import('./scenes/random'), start: 4, end: 5, transition: 'wipe' },
    { id: 'image', scene: () => import('./scenes/image'), start: 5, end: 6 },
    { id: 'shared', scene: () => import('./scenes/shared'), start: 6, end: 7 },
  ],
});
`,
  'scenes/module.ts': `import type * as THREE from 'three';
import { Scene, type Frame, TextBlock, clearRT, LIN } from 'reel';
const title = new TextBlock({ text: 'Made at the top level' });
export default class M extends Scene {
  render(f: Frame, out: THREE.WebGLRenderTarget) { clearRT(this.ctx.renderer, out, LIN.bg); title.draw(this.ctx.renderer, out, f); }
}
`,
  'scenes/lazy.ts': `import type * as THREE from 'three';
import { Scene, type Frame, TextBlock, clearRT, LIN } from 'reel';
export default class L extends Scene {
  title?: TextBlock;
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg);
    this.title ??= new TextBlock({ text: 'Made lazily' });
    this.title.draw(this.ctx.renderer, out, f);
  }
}
`,
  'scenes/muted.ts': `import type * as THREE from 'three';
import { Scene, type Frame, TextBlock, clearRT, LIN } from 'reel';
export default class C extends Scene {
  title = new TextBlock({ text: 'Muted', color: 'muted' });
  render(f: Frame, out: THREE.WebGLRenderTarget) { clearRT(this.ctx.renderer, out, LIN.bg); this.title.draw(this.ctx.renderer, out, f); }
}
`,
  'scenes/late.ts': `import type * as THREE from 'three';
import { Scene, type Frame, TextBlock, clearRT, LIN } from 'reel';
export default class T extends Scene {
  title = new TextBlock({ text: 'Late', at: [3.2, 3.8] });
  render(f: Frame, out: THREE.WebGLRenderTarget) { clearRT(this.ctx.renderer, out, LIN.bg); this.title.draw(this.ctx.renderer, out, f); }
}
`,
  'scenes/image.ts': `import type * as THREE from 'three';
import { Scene, type Frame, ImageBox, clearRT, LIN } from 'reel';
export default class I extends Scene {
  img?: ImageBox;
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg);
    this.img ??= new ImageBox({ src: 'missing.png' });
    this.img.draw(this.ctx.renderer, out, f);
  }
}
`,
  'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="#c8301e"/></svg>',
  'scenes/shared.ts': `import type * as THREE from 'three';
import { Scene, type Frame, ImageBox, clearRT, LIN } from 'reel';
// (an image made at a module's top level, as a helper shared by scenes would: loaded with the scenes, and fine)
const logo = new ImageBox({ src: 'logo.svg', box: { x: 220, y: 80, w: 200, h: 200 } });
export default class S extends Scene {
  render(f: Frame, out: THREE.WebGLRenderTarget) { clearRT(this.ctx.renderer, out, LIN.bg); logo.draw(this.ctx.renderer, out, f); }
}
`,
  'scenes/random.ts': `import type * as THREE from 'three';
import { Scene, type Frame, Layer2D, clearRT, LIN, rgba, W, H } from 'reel';
export default class R extends Scene {
  layer = new Layer2D();
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg);
    this.layer.clear();
    this.layer.ctx.fillStyle = rgba('fg');
    this.layer.ctx.fillRect(Math.random() * W * 0.8, H * 0.3, W * 0.2, H * 0.4);
    this.ctx.comp.draw(this.ctx.renderer, this.layer.upload(), out);
  }
}
`,
});
afterAll(async () => { await reel(['daemon', 'stop', '--project', mistakes.dir]); mistakes.cleanup(); });

test.skipIf(!hasChrome)('check names the mistakes that used to draw nothing, or the wrong thing, silently', async () => {
  const r = await reel(['check', '--json', '--project', mistakes.dir]);
  const findings: (Finding & { message: string })[] = r.json().findings;
  const of = (clip: string, kind: string) => findings.filter((f) => f.clip === clip && f.kind === kind).map((f) => f.message).join('\n');
  expect(of('module', 'sceneError')).toContain('make it a field of the scene or create it in init()');
  expect(of('lazy', 'sceneError')).toContain('make it a field of the scene or create it in init()');
  expect(of('image', 'sceneError')).toContain('missing.png: a kit component was made after the scenes loaded');
  expect(findings.filter((f) => f.clip === 'shared')).toEqual([]);
  expect(of('muted', 'sceneError')).toMatch(/colour 'muted': the theme has no such palette key \(it has [^)]*\bink2\b/);
  expect(of('late', 'sceneError')).toContain("is outside the clip 'late'");
  expect(of('random', 'nondeterministic')).toContain("'random' Math.random() was called");
  expect(of('random', 'timeline')).toContain("has a wipe transition but does not overlap 'late'");
  expect(r.code).toBe(1);
}, 180_000);

test.skipIf(!hasChrome)('kinetic text: a frame is the same whatever frame came before it', async () => {
  const cold = (await reel(['still', '--t', '8.5', '--no-daemon', '--json', '--project', project.dir])).json().files[0];
  await reel(['still', '--t', '6.9', '--json', '--project', project.dir]);
  const warm = await reel(['diff', '--t', '8.5', cold, '--tol', '3', '--json', '--project', project.dir]);
  expect(warm.json().changed).toBe(0);
}, 180_000);

test.skipIf(!hasChrome)('drawn-on paths and arrows draw over time and report themselves to check', async () => {
  // (half drawn and fully drawn differ; check sees the drawings as pictures, by label)
  const half = (await reel(['still', '--t', '9.6', '--only', 'drawn', '--json', '--project', project.dir])).json().files[0];
  const diff = await reel(['diff', '--t', '10.6', half, '--only', 'drawn', '--json', '--project', project.dir]);
  expect(diff.json().changed).toBeGreaterThan(1000);
  const r = await reel(['check', '--json', '--only', 'drawn', '--project', project.dir]);
  const drawn = (r.json().findings as (Finding & { message: string })[]).filter((f) => f.clip === 'drawn');
  expect(drawn.filter((f) => f.severity !== 'info')).toEqual([]);
  // (only the arrow led off the frame is found, as a picture running off its edge)
  expect(drawn.map((f) => `${f.kind} ${f.message}`)).toEqual([expect.stringMatching(/^offFrame 'away' runs .*right/)]);
  expect(r.code).toBe(0);
  // a scaled viewBox: 95% drawn is all but the line's last 45 px (a stroke 8 px wide), nowhere near none of it
  const at = async (t: string) => (await reel(['still', '--t', t, '--only', 'scaled', '--json', '--project', project.dir])).json().files[0];
  const [none, most] = [await at('11.2'), await at('11.8')];
  const toFull = async (file: string) => (await reel(['diff', '--t', '12.5', file, '--tol', '16', '--only', 'scaled', '--json', '--project', project.dir])).json().changed;
  const all = await toFull(none), rest = await toFull(most);
  expect(all).toBeGreaterThan(5000);
  expect(rest).toBeLessThan(all * 0.1);
}, 180_000);

for (const [t, later] of [['4.1', '4.9'], ['6.9', '8.5'], ['9.7', '10.5']] as const) {
  test.skipIf(!hasChrome)(`a frame of components renders the same after a seek backwards (${t} s)`, async () => {
    const first = (await reel(['still', '--t', t, '--json', '--project', project.dir])).json().files[0];
    await reel(['still', '--t', later, '--json', '--project', project.dir]);
    const again = await reel(['diff', '--t', t, first, '--json', '--project', project.dir]);
    expect(again.json().changed).toBe(0);
    expect(again.code).toBe(0);
  }, 180_000);
}

// captions whose second word sits a fraction of a pixel off the pixel grid (the media example's): Chrome keeps the
// paint state of an element that once had an opacity below 1, so without the engine repainting a layer from
// scratch the word came out a fraction of a pixel off once it had been dimmed, and a frame depended on the seeks
// before it
const caps = fixture('kit-caps', {
  'reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({ size: [1080, 1920], fps: 30, theme: 'neutral', timeline: () => [{ id: 'caps', scene: () => import('./scenes/caps'), start: 0, end: 3 }] });
`,
  'scenes/caps.ts': `import type * as THREE from 'three';
import { Scene, type Frame, Captions, Words, clearRT, LIN } from 'reel';
const words = Words.timed([{ text: 'A clip decoded frame by frame', start: 0.3, end: 2.5 }]);
export default class Caps extends Scene {
  captions = new Captions({ words, size: 52 });
  render(f: Frame, out: THREE.WebGLRenderTarget) { clearRT(this.ctx.renderer, out, LIN.bg); this.captions.draw(this.ctx.renderer, out, f); }
}
`,
});
afterAll(async () => { await reel(['daemon', 'stop', '--project', caps.dir]); caps.cleanup(); });

test.skipIf(!hasChrome)('a caption frame is the same whether its words were dimmed before or not', async () => {
  // the page shown first at 0.6 s ('clip' already said), then the same frame after 0.35 s, when 'clip' was dimmed
  await reel(['still', '--t', '0.1', '--json', '--project', caps.dir]);
  const fresh = (await reel(['still', '--t', '0.6', '--json', '--project', caps.dir])).json().files[0];
  await reel(['still', '--t', '0.35', '--json', '--project', caps.dir]);
  const again = await reel(['diff', '--t', '0.6', fresh, '--json', '--project', caps.dir]);
  expect(again.json().changed).toBe(0);
  expect(again.code).toBe(0);
}, 180_000);
