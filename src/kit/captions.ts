import { H, W } from '../engine/gl';
import type { Frame } from '../engine/scene';
import type { Word, Words } from '../engine/words';
import { cssColor, esc, graphemes, HtmlComponent, UNIT, type ComponentOptions } from './common';

export interface CaptionsOptions extends ComponentOptions {
  words: Words;
  style?: 'highlight' | 'line' | 'word';
  position?: 'bottom' | 'top' | 'middle';
  /** Font size in px (default 4.4% of the short side; 'word' twice that). */
  size?: number;
  lines?: number;
  /** A panel behind the text (default true), and its opacity (default 0.82). */
  panel?: boolean;
  panelOpacity?: number;
  /** Seconds a page stays after its last word (default 0.5, never past the next page). */
  hold?: number;
  /** Palette keys or CSS colours: text (default fg), the word being said (default accent). */
  color?: string;
  accent?: string;
  /** CSS font family (default Archivo) and weight (default 600). */
  font?: string;
  weight?: number;
}

/** A page of captions: its words and when it shows; `joined[k]`: word k follows the one before without a space. */
export interface CaptionPage { text: string; words: Word[]; joined: boolean[]; start: number; end: number }

const CAP_PADDING = 0.4;
const LINE_SLACK = 1;

const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;
export const textWidth = (s: string) => graphemes(s).reduce((a, g) => a + (WIDE.test(g) ? 2 : 1), 0);

export interface CaptionMeasure { width: (s: string) => number; space: number; line: number; lines: number }

const charBudget = (maxChars: number): CaptionMeasure => ({ width: textWidth, space: 1, line: maxChars, lines: 1 });

function splitLong(w: Word, m: CaptionMeasure): { w: Word; joined: boolean }[] {
  const total = m.width(w.w);
  if (total <= m.line) return [{ w, joined: false }];
  const pieces: string[] = [];
  let cur = '';
  for (const g of graphemes(w.w)) {
    if (cur && m.width(cur + g) > m.line) { pieces.push(cur); cur = ''; }
    cur += g;
  }
  if (cur) pieces.push(cur);
  const sizes = pieces.map((x) => m.width(x)), sum = sizes.reduce((x, y) => x + y, 0);
  let t = w.start, done = 0;
  return pieces.map((x, i) => {
    done += sizes[i]!;
    const end = w.start + ((w.end - w.start) * done) / sum, piece = { ...w, w: x, start: t, end };
    t = end;
    return { w: piece, joined: i > 0 };
  });
}

export function captionPages(words: Words, fit: number | CaptionMeasure, hold = 0.5): CaptionPage[] {
  const m = typeof fit === 'number' ? charBudget(fit) : fit;
  const pages: CaptionPage[] = [];
  for (const line of words.lines) {
    let cur: { w: Word; joined: boolean }[] = [], rows = 0, row = 0;
    const runs: (typeof cur)[] = [];
    for (const x of line.words.flatMap((w) => splitLong(w, m))) {
      const ww = m.width(x.w.w), gap = x.joined ? 0 : m.space;
      if (cur.length && row + gap + ww <= m.line) row += gap + ww;
      else if (cur.length && rows < m.lines) { rows++; row = ww; }
      else {
        if (cur.length) runs.push(cur);
        cur = []; rows = 1; row = ww;
      }
      cur.push(cur.length ? x : { ...x, joined: false });
    }
    if (cur.length) runs.push(cur);
    for (const r of runs) pages.push({ text: r.map((x, k) => (k && !x.joined ? ' ' : '') + x.w.w).join(''), words: r.map((x) => x.w), joined: r.map((x) => x.joined), start: r[0]!.w.start, end: r.at(-1)!.w.end + hold });
  }
  pages.sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < pages.length; i++) pages[i]!.end = Math.min(pages[i]!.end, pages[i + 1]!.start);
  return pages;
}

function measureIn(font: string): (s: string) => number {
  const c = new OffscreenCanvas(1, 1).getContext('2d')!;
  c.font = font;
  return (s) => c.measureText(s).width;
}

export class Captions extends HtmlComponent {
  readonly pages: CaptionPage[];
  private o: CaptionsOptions;
  private shown = -2;
  constructor(o: CaptionsOptions) {
    const style = o.style ?? 'highlight', pos = o.position ?? 'bottom';
    const size = o.size ?? Math.round(UNIT * (style === 'word' ? 0.09 : 0.044)), lines = o.lines ?? (style === 'word' ? 1 : 2);
    const m = 0.08, h = Math.min(H * 0.34, size * 1.45 * lines + size * 1.2);
    const box = o.box ?? { x: W * m, y: pos === 'top' ? H * m : pos === 'middle' ? (H - h) / 2 : H * (1 - m) - h, w: W * (1 - 2 * m), h };
    const align = { top: 'start', middle: 'center', bottom: 'end' }[pos];
    super({ motion: false, ...o }, {
      box, label: 'captions',
      html: `<div class="frame"><div class="page"></div></div>`,
      css: `.frame { position: absolute; inset: 0; display: grid; align-content: ${align}; justify-items: center; text-align: center; }
        .page { max-width: 100%; font-family: ${o.font ? `'${o.font}'` : 'Archivo'}; font-weight: ${o.weight ?? 600}; font-size: ${size}px; line-height: 1.45; color: ${cssColor(o.color ?? 'fg')}; text-wrap: balance; }
        .cap { ${o.panel === false ? '' : `background: color-mix(in srgb, var(--bg) ${Math.round((o.panelOpacity ?? 0.82) * 100)}%, transparent);`} padding: .12em ${CAP_PADDING}em; border-radius: .18em;
          -webkit-box-decoration-break: clone; box-decoration-break: clone; }
        .w { opacity: ${style === 'highlight' ? 0.45 : 1}; }
        .w.said { opacity: 1; }
        .w.now { color: ${cssColor(o.accent ?? 'accent')}; }
        .line .cap { animation: capIn .18s ease-out both; }
        .word .cap { display: inline-block; animation: capPop .16s ease-out both; }
        @keyframes capIn { from { opacity: 0; } }
        @keyframes capPop { from { opacity: 0; transform: scale(.92); } }`,
    });
    this.o = o;
    if (style === 'word') this.pages = o.words.words.map((w, i, a) => ({ text: w.w, words: [w], joined: [false], start: w.start, end: Math.min(w.end + (o.hold ?? 0.25), a[i + 1]?.start ?? Infinity) }));
    else {
      const width = measureIn(`${o.weight ?? 600} ${size}px ${o.font ? `'${o.font}'` : 'Archivo'}`);
      this.pages = captionPages(o.words, { width, space: width(' '), line: this.box.w - CAP_PADDING * 2 * size - LINE_SLACK, lines }, o.hold ?? 0.5);
    }
  }

  pageAt(t: number) {
    for (let i = this.pages.length - 1; i >= 0; i--) { const p = this.pages[i]!; if (t >= p.start) return t < p.end ? i : -1; }
    return -1;
  }

  protected update(f: Frame) {
    const i = this.pageAt(f.t), style = this.o.style ?? 'highlight', l = this.layer, page = l.$('.page');
    if (i !== this.shown) {
      this.shown = i;
      const p = this.pages[i];
      page.className = `page ${style}`;
      page.innerHTML = p ? `<span class="cap" data-at="${(p.start - f.start).toFixed(4)}">${p.words.map((w, k) => `${k && !p.joined[k] ? ' ' : ''}<span class="w" data-k="${k}">${esc(w.w)}</span>`).join('')}</span>` : '';
    }
    const p = this.pages[i];
    if (!p || style !== 'highlight') return;
    l.$$('.w').forEach((e, k) => {
      const w = p.words[k]!;
      l.set(e, { class: { said: f.t >= w.start, now: f.t >= w.start && f.t < w.end } });
    });
  }
}
