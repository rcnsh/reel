// The component kit: its pure helpers, and a rendered project of components that `reel check` passes, that renders
// the same frame after a seek backwards, and whose faults (text cut off at a layer's edge, text overflowing a
// block that does not fit it) check names.
import { afterAll, describe, expect, test } from 'bun:test';
import { captionPages, clock, textWidth, cssColor, esc, formatNumber, motionAt, splitHighlighted } from '../src/kit';
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

  test('cssColor maps palette keys to theme variables and passes CSS colours through', () => {
    expect(cssColor('accentHi')).toBe('var(--accent-hi)');
    expect(cssColor('ink2')).toBe('var(--ink2)');
    expect(cssColor('#ff0000')).toBe('#ff0000');
    expect(cssColor('white')).toBe('white');
    expect(cssColor('none')).toBe('none');
    expect(esc('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
  });
});

// clips: a Canvas2D line off the centre, an HTML text block changing every frame, the Canvas2D line again (a
// Layer2D upload after an HTML one must not come out upside down), captions with a word highlighted, a chart and
// a code block; then the faults
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
    { id: 'drawn', scene: () => import('./scenes/drawn'), start: 6, end: 8 },
    { id: 'scaled', scene: () => import('./scenes/scaled'), start: 8, end: 10 },
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
  for (const [t, later] of [['4.1', '4.9'], ['6.7', '7.5']]) {
    const first = (await reel(['still', '--t', t!, '--json', '--project', project.dir])).json().files[0];
    await reel(['still', '--t', later!, '--json', '--project', project.dir]);
    const again = await reel(['diff', '--t', t!, first, '--json', '--project', project.dir]);
    expect(again.json().changed).toBe(0);
    expect(again.code).toBe(0);
  }
}, 180_000);

test.skipIf(!hasChrome)('drawn-on paths and arrows draw over time and report themselves to check', async () => {
  // (half drawn and fully drawn differ; check sees the drawings as pictures, by label)
  const half = (await reel(['still', '--t', '6.6', '--only', 'drawn', '--json', '--project', project.dir])).json().files[0];
  const diff = await reel(['diff', '--t', '7.6', half, '--only', 'drawn', '--json', '--project', project.dir]);
  expect(diff.json().changed).toBeGreaterThan(1000);
  const r = await reel(['check', '--json', '--only', 'drawn', '--project', project.dir]);
  const drawn = (r.json().findings as (Finding & { message: string })[]).filter((f) => f.clip === 'drawn');
  expect(drawn.filter((f) => f.severity !== 'info')).toEqual([]);
  // (only the arrow led off the frame is found, as a picture running off its edge)
  expect(drawn.map((f) => `${f.kind} ${f.message}`)).toEqual([expect.stringMatching(/^offFrame 'away' runs .*right/)]);
  expect(r.code).toBe(0);
  // a scaled viewBox: 95% drawn is all but the line's last 45 px (a stroke 8 px wide), nowhere near none of it
  const at = async (t: string) => (await reel(['still', '--t', t, '--only', 'scaled', '--json', '--project', project.dir])).json().files[0];
  const [none, most] = [await at('8.2'), await at('8.8')];
  const toFull = async (file: string) => (await reel(['diff', '--t', '9.5', file, '--tol', '16', '--only', 'scaled', '--json', '--project', project.dir])).json().changed;
  const all = await toFull(none), rest = await toFull(most);
  expect(all).toBeGreaterThan(5000);
  expect(rest).toBeLessThan(all * 0.1);
}, 180_000);
