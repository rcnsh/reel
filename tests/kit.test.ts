// The component kit: its pure helpers, and a rendered project of components that `reel check` passes, that renders
// the same frame after a seek backwards, and whose faults (text cut off at a layer's edge, text overflowing a
// block that does not fit it) check names.
import { afterAll, describe, expect, test } from 'bun:test';
import { arcPath, captionPages, clock, columnAlign, donutSlices, formatCell, growth, percents, polar, stackBars, textWidth, cssColor, esc, formatNumber, motionAt, splitHighlighted } from '../src/kit';
import { Words } from '../src/engine/words';
import { fixture, hasChrome, reel } from './helpers';

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

  test('cssColor maps palette keys to theme variables and passes CSS colours through', () => {
    expect(cssColor('accentHi')).toBe('var(--accent-hi)');
    expect(cssColor('ink2')).toBe('var(--ink2)');
    expect(cssColor('#ff0000')).toBe('#ff0000');
    expect(cssColor('white')).toBe('white');
    expect(esc('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
  });
});

// clips: a Canvas2D line off the centre, an HTML text block changing every frame, the Canvas2D line again (a
// Layer2D upload after an HTML one must not come out upside down), captions with a word highlighted, a chart and
// a code block; then the faults; then a donut, a pie, horizontal and stacked bars and a table (in place throughout);
// then vertical stacked bars and a donut with its legend under it
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
    { id: 'data', scene: () => import('./scenes/data'), start: 6, end: 8 },
    { id: 'data2', scene: () => import('./scenes/data2'), start: 8, end: 9 },
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
import { Scene, type Frame, HtmlLayer, TextBlock, clearRT, LIN } from 'reel';
export default class Faults extends Scene {
  edge = new HtmlLayer({
    html: '<p data-label="edge">Cut off at the edge of its layer</p><p class="n" data-label="nowrap">Too long to stay in its box</p>',
    css: 'p { position: absolute; left: 40px; top: -30px; font: 700 48px Archivo; } .n { top: 100px; width: 200px; font-size: 24px; white-space: nowrap; }', width: 600, height: 200,
  });
  block = new TextBlock({ text: 'Unbreakablewordthatcannotfitatall', fit: false, size: 64, box: { x: 100, y: 400, w: 300, h: 120 }, motion: false, label: 'narrow' });
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg);
    this.edge.draw(this.ctx.renderer, out, { x: 300, y: 150 });
    this.block.draw(this.ctx.renderer, out, f);
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
  expect(faults).toEqual(['clipped warning Cut', 'clipped warning Unbreakablewordthatcannotfitatall', 'overflow error Too']);
  expect(r.code).toBe(1);
}, 180_000);

test.skipIf(!hasChrome)('a frame of components renders the same after a seek backwards', async () => {
  const first = (await reel(['still', '--t', '4.1', '--json', '--project', project.dir])).json().files[0];
  await reel(['still', '--t', '4.9', '--json', '--project', project.dir]);
  const again = await reel(['diff', '--t', '4.1', first, '--json', '--project', project.dir]);
  expect(again.json().changed).toBe(0);
  expect(again.code).toBe(0);
  // charts and a table mid-sweep (a highlight that switches on later): the same after a seek past it and back
  const data = (await reel(['still', '--t', '6.7', '--json', '--project', project.dir])).json().files[0];
  await reel(['still', '--t', '7.9', '--json', '--project', project.dir]);
  const back = await reel(['diff', '--t', '6.7', data, '--json', '--project', project.dir]);
  expect(back.json().changed).toBe(0);
  expect(back.code).toBe(0);
}, 180_000);
