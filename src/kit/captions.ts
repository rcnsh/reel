// Captions from the project's timed words: pages of at most a few lines, shown as their words are said.
import { H, W } from '../engine/gl';
import type { Frame } from '../engine/scene';
import type { Word, Words } from '../engine/words';
import { cssColor, esc, HtmlComponent, UNIT, type ComponentOptions } from './common';

export interface CaptionsOptions extends ComponentOptions {
  /** The timed words: `this.ctx.words` (narration), or `Words.timed([...])` for a video without a voice. */
  words: Words;
  /**
   * 'highlight' (default): the page's words, those not yet said dimmed and the one being said in the accent;
   * 'line': the page as a whole, faded in; 'word': one word at a time, large.
   */
  style?: 'highlight' | 'line' | 'word';
  /** Where in the safe area (default 'bottom'). */
  position?: 'bottom' | 'top' | 'middle';
  /** Font size in px (default 4.4% of the short side; 'word' twice that). */
  size?: number;
  /** Lines per page at most (default 2). */
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

/** A page of captions: its words and when it shows. */
export interface CaptionPage { text: string; words: Word[]; start: number; end: number }

/**
 * Split timed words into caption pages: each line of the words into runs of whole words of at most `maxChars`
 * characters, each shown from its first word until the next page or `hold` after its last word.
 */
export function captionPages(words: Words, maxChars: number, hold = 0.5): CaptionPage[] {
  const pages: CaptionPage[] = [];
  for (const line of words.lines) {
    let cur: Word[] = [];
    const runs: Word[][] = [];
    for (const w of line.words) {
      const len = cur.reduce((a, x) => a + x.w.length + 1, 0) + w.w.length;
      if (cur.length && len > maxChars) { runs.push(cur); cur = []; }
      cur.push(w);
    }
    if (cur.length) runs.push(cur);
    for (const r of runs) pages.push({ text: r.map((w) => w.w).join(' '), words: r, start: r[0]!.start, end: r.at(-1)!.end + hold });
  }
  pages.sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < pages.length; i++) pages[i]!.end = Math.min(pages[i]!.end, pages[i + 1]!.start);
  return pages;
}

/**
 * Captions in the safe area, driven by timed words. Pages hold at most `lines` lines; their words light up as
 * they are said. Classes: `.cap` (the page), `.w` (a word), `.said`, `.now`.
 */
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
        .cap { ${o.panel === false ? '' : `background: color-mix(in srgb, var(--bg) ${Math.round((o.panelOpacity ?? 0.82) * 100)}%, transparent);`} padding: .12em .4em; border-radius: .18em;
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
    // characters per page: as many as `lines` lines of the box hold at this size (about half an em a character)
    const perLine = Math.max(8, Math.floor(this.box.w / (size * 0.52)));
    this.pages = style === 'word' ? o.words.words.map((w, i, a) => ({ text: w.w, words: [w], start: w.start, end: Math.min(w.end + (o.hold ?? 0.25), a[i + 1]?.start ?? Infinity) })) : captionPages(o.words, perLine * lines, o.hold ?? 0.5);
  }

  /** The page on screen at video time t, or -1. */
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
      page.innerHTML = p ? `<span class="cap" data-at="${(p.start - f.start).toFixed(4)}">${p.words.map((w, k) => `<span class="w" data-k="${k}">${esc(w.w)}</span>`).join(' ')}</span>` : '';
    }
    const p = this.pages[i];
    if (!p || style !== 'highlight') return;
    l.$$('.w').forEach((e, k) => {
      const w = p.words[k]!;
      l.set(e, { class: { said: f.t >= w.start, now: f.t >= w.start && f.t < w.end } });
    });
  }
}
