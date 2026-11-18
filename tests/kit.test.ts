// The component kit: its pure helpers, and a rendered project of components that `reel check` passes, that renders
// the same frame after a seek backwards, and whose faults (text cut off at a layer's edge, text overflowing a
// block that does not fit it) check names.
import { afterAll, describe, expect, test } from 'bun:test';
import { captionPages, clock, textWidth, cssColor, esc, formatNumber, motionAt, splitHighlighted, windowOf } from '../src/kit';
import { LOADING } from '../src/engine/scene';
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

  test('windowOf: clip seconds as given, spans of the words taken off the loading clip', () => {
    const words = Words.timed([{ text: 'the tide comes in', start: 12, end: 14 }, { text: 'and goes out', start: 15, end: 17 }], 1);
    expect(windowOf(undefined, 'x')).toBeUndefined();
    expect(windowOf([1, 5], 'x')).toEqual([1, 5]);
    expect(windowOf([5, 5], 'x')).toEqual([5, 5]);
    expect(windowOf([2, Infinity], 'x')).toEqual([2, Infinity]);
    expect(() => windowOf([-Infinity, 2], 'x')).toThrow('expected seconds');
    expect(() => windowOf([5, 4], 'x')).toThrow('ends before it starts');
    expect(() => windowOf([words.get('tide'), 5], 'text block')).toThrow('text block: at [{ start: 12, end: 14 }, 5]: a span of the words is in video time');
    LOADING.clip = { id: 'c', start: 10, end: 20 };
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
      LOADING.clip = { id: 'c', start: 0, end: 10 };
      expect(() => windowOf(words.get('goes out'), 'x')).toThrow("is outside the clip 'c' (0 to 10)");
      LOADING.clip = { id: 'c', start: 17, end: 20 };
      expect(() => windowOf(words.get('tide'), 'x')).toThrow("its window [-5, -3] in clip seconds is outside the clip 'c'");
      expect(windowOf([words.get('tide'), 2], 'x')).toEqual([-5, 2]); // (from before the clip into it: shown from its start)
    } finally { LOADING.clip = null; }
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
// a code block; then the faults; then a text block timed by a span of the words and the same timed in clip seconds
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
    { id: 'spans', scene: () => import('./scenes/timed'), start: 6, end: 8, params: { spans: true }, check: { exempt: ['blank'] } },
    { id: 'numbers', scene: () => import('./scenes/timed'), start: 8, end: 10, check: { exempt: ['blank'] } },
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
  'data/words.json': JSON.stringify({ lines: [{ text: 'the tide comes in', start: 6.5, end: 7.2, words: [{ w: 'the', start: 6.5, end: 6.6 }, { w: 'tide', start: 6.6, end: 6.8 }, { w: 'comes', start: 6.8, end: 7 }, { w: 'in', start: 7, end: 7.2 }] }] }),
  'scenes/timed.ts': `import type * as THREE from 'three';
import { Scene, type Frame, TextBlock, clearRT, LIN } from 'reel';
export default class Timed extends Scene {
  text = new TextBlock({ text: 'The tide comes in', motion: false, at: this.ctx.params.spans ? this.ctx.words.get('tide') : [0.5, 1.2] });
  render(f: Frame, out: THREE.WebGLRenderTarget) { clearRT(this.ctx.renderer, out, LIN.bg); this.text.draw(this.ctx.renderer, out, f); }
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

test.skipIf(!hasChrome)('a component timed by a span of the words shows over the span, in clip seconds', async () => {
  const still = async (t: number) => (await reel(['still', '--t', String(t), '--json', '--project', project.dir])).json().files[0] as string;
  // (the largest difference in levels: the dither differs from frame to frame by 1)
  const differs = async (t: number, file: string) => (await reel(['diff', '--t', String(t), file, '--json', '--project', project.dir])).json().max as number;
  const before = await still(6.3), during = await still(6.9), after = await still(7.5);
  // the same as the clip timed in numbers at the same clip time, and blank outside the span
  expect(await differs(8.3, before)).toBeLessThanOrEqual(1);
  expect(await differs(8.9, during)).toBeLessThanOrEqual(1);
  expect(await differs(9.5, after)).toBeLessThanOrEqual(1);
  expect(await differs(6.3, after)).toBeLessThanOrEqual(1);
  expect(await differs(6.3, during)).toBeGreaterThan(100);
}, 180_000);

test.skipIf(!hasChrome)('a frame of components renders the same after a seek backwards', async () => {
  const first = (await reel(['still', '--t', '4.1', '--json', '--project', project.dir])).json().files[0];
  await reel(['still', '--t', '4.9', '--json', '--project', project.dir]);
  const again = await reel(['diff', '--t', '4.1', first, '--json', '--project', project.dir]);
  expect(again.json().changed).toBe(0);
  expect(again.code).toBe(0);
}, 180_000);
