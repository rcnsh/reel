// Text components: a block of text fitted to a box, a title card, a lower third.
import { H, W } from '../engine/gl';
import type { Frame } from '../engine/scene';
import { cssColor, esc, HtmlComponent, safeBox, UNIT, val, type Anim, type Box, type ComponentOptions } from './common';

export interface TextBlockOptions extends ComponentOptions {
  /** The text (plain; or `html` for markup). Either may be a function of the frame. */
  text?: Anim<string>;
  html?: Anim<string>;
  /** The largest size in px (default 7% of the short side) and the smallest it may shrink to (default 2.6%). */
  size?: number;
  minSize?: number;
  /** Shrink the text until it fits the box (default true): within the box's height and at most `maxLines` lines. */
  fit?: boolean;
  maxLines?: number;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** CSS font family (default Archivo), weight (default 700), line height (default 1.15). */
  font?: string;
  weight?: number;
  lineHeight?: number;
  /** A palette key or CSS colour (default fg). */
  color?: string;
}

/**
 * A block of text in a box: wraps, aligns, and (by default) shrinks until it fits the box and `maxLines`, between
 * `size` and `minSize`. Text that cannot fit even at `minSize` overflows, and `reel check` says so.
 * Classes: `.tb` (the text).
 */
export class TextBlock extends HtmlComponent {
  private fitted = '';
  private o: TextBlockOptions;
  constructor(o: TextBlockOptions) {
    const box = o.box ?? safeBox();
    const justify = { top: 'start', middle: 'center', bottom: 'end' }[o.valign ?? 'middle'];
    super(o, {
      box, label: 'text block',
      html: `<div class="frame"><div class="tb"></div></div>`,
      css: `.frame { position: absolute; inset: 0; display: grid; align-content: ${justify}; }
        .tb { width: 100%; text-align: ${o.align ?? 'left'}; font-family: ${o.font ? `'${o.font}'` : 'Archivo'}; font-weight: ${o.weight ?? 700};
          line-height: ${o.lineHeight ?? 1.15}; color: ${cssColor(o.color ?? 'fg')}; font-size: ${o.size ?? Math.round(UNIT * 0.07)}px;
          overflow-wrap: break-word; text-wrap: balance; }`,
    });
    this.o = o;
  }

  protected update(f: Frame) {
    const o = this.o, el = this.layer.$('.tb');
    const html = o.html !== undefined ? val(o.html, f) : esc(val(o.text ?? '', f));
    if (el.innerHTML !== html) el.innerHTML = html;
    if (o.fit === false || this.fitted === html) return;
    this.fitted = html;
    fitText(el, this.box, o.size ?? Math.round(UNIT * 0.07), o.minSize ?? Math.round(UNIT * 0.026), o.maxLines, o.lineHeight ?? 1.15);
  }
}

/**
 * The largest font size from `max` down to `min` (to half a px) at which `el`'s text fits `box` (its height, its
 * width without overflow, and at most `maxLines` lines). A pure function of the text and the box: layout is
 * deterministic.
 */
export function fitText(el: HTMLElement, box: Box, max: number, min: number, maxLines?: number, lineHeight = 1.15) {
  const fits = (s: number) => {
    el.style.fontSize = `${s}px`;
    const r = el.getBoundingClientRect();
    if (r.height > box.h + 0.5 || el.scrollWidth > Math.ceil(r.width) + 0.5) return false;
    return !maxLines || Math.round(r.height / (s * lineHeight)) <= maxLines;
  };
  if (fits(max)) return max;
  let lo = min, hi = max;
  if (!fits(lo)) return lo;
  while (hi - lo > 0.5) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  el.style.fontSize = `${lo}px`;
  return lo;
}

export interface TitleCardOptions extends ComponentOptions {
  title: Anim<string>;
  subtitle?: Anim<string>;
  /** A small line above the title (a chapter, a date). */
  kicker?: Anim<string>;
  align?: 'left' | 'center';
  /** Title font (default Archivo 800), and the accent rule under it (default true). */
  font?: string;
  weight?: number;
  rule?: boolean;
}

/**
 * A title card: kicker, title (fitted to the box, at most three lines), subtitle and an accent rule, centred in the
 * safe area by default. Classes: `.kicker`, `.title`, `.rule`, `.subtitle`.
 */
export class TitleCard extends HtmlComponent {
  private fitted = '';
  private o: TitleCardOptions;
  constructor(o: TitleCardOptions) {
    const box = o.box ?? safeBox(0.1);
    const align = o.align ?? 'center';
    super(o, {
      box, label: 'title card',
      html: `<div class="frame"><div class="card"><p class="kicker"></p><h1 class="title"></h1>${o.rule === false ? '' : '<div class="rule"></div>'}<p class="subtitle"></p></div></div>`,
      css: `.frame { position: absolute; inset: 0; display: grid; align-content: center; }
        .card { text-align: ${align}; display: flex; flex-direction: column; align-items: ${align === 'center' ? 'center' : 'flex-start'}; gap: ${Math.round(UNIT * 0.018)}px; }
        .kicker { font: 600 ${Math.round(UNIT * 0.026)}px 'IBM Plex Mono'; letter-spacing: .18em; text-transform: uppercase; color: color-mix(in srgb, var(--accent) 72%, var(--fg)); }
        .title { font-family: ${o.font ? `'${o.font}'` : 'Archivo'}; font-weight: ${o.weight ?? 800}; line-height: 1.02; letter-spacing: -0.01em; font-size: ${Math.round(UNIT * 0.12)}px; text-wrap: balance; width: 100%; }
        .rule { width: ${Math.round(UNIT * 0.09)}px; height: ${Math.max(3, Math.round(UNIT * 0.006))}px; background: var(--accent); margin: ${Math.round(UNIT * 0.006)}px 0; }
        .subtitle { font: 400 ${Math.round(UNIT * 0.036)}px/1.3 Archivo; color: color-mix(in srgb, var(--fg) 78%, var(--bg)); max-width: 32em; text-wrap: balance; }
        .kicker:empty, .subtitle:empty { display: none; }`,
    });
    this.o = o;
  }

  protected update(f: Frame) {
    const o = this.o, l = this.layer;
    l.text('.kicker', o.kicker ? val(o.kicker, f) : '');
    l.text('.subtitle', o.subtitle ? val(o.subtitle, f) : '');
    const title = val(o.title, f);
    l.text('.title', title);
    const key = `${title}|${l.$('.kicker').textContent}|${l.$('.subtitle').textContent}`;
    if (key === this.fitted) return;
    this.fitted = key;
    // the title shrinks until the whole card fits the box
    const card = l.$('.card'), t = l.$('.title');
    const rest = card.getBoundingClientRect().height - t.getBoundingClientRect().height;
    fitText(t, { ...this.box, h: this.box.h - rest }, Math.round(UNIT * 0.12), Math.round(UNIT * 0.045), 3, 1.02);
  }
}

export interface LowerThirdOptions extends ComponentOptions {
  name: Anim<string>;
  /** A second line: a role, a place, a source. */
  role?: Anim<string>;
  side?: 'left' | 'right';
}

/**
 * A lower third: a name and a role beside an accent bar, on a panel, in the lower left (or right) of the safe
 * area. Slides in from its side. Classes: `.lt`, `.name`, `.role`, `.bar`.
 */
export class LowerThird extends HtmlComponent {
  private o: LowerThirdOptions;
  constructor(o: LowerThirdOptions) {
    const side = o.side ?? 'left', m = 0.07;
    const w = Math.min(W * (1 - 2 * m), UNIT * 1.1), h = UNIT * 0.2;
    const box = o.box ?? { x: side === 'left' ? W * m : W * (1 - m) - w, y: H * (1 - m) - h, w, h };
    super({ motion: { from: side === 'left' ? 'right' : 'left', distance: UNIT * 0.06 }, ...o }, {
      box, label: 'lower third',
      html: `<div class="frame"><div class="lt"><div class="bar"></div><div class="txt"><p class="name"></p><p class="role"></p></div></div></div>`,
      css: `.frame { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: ${side === 'left' ? 'flex-start' : 'flex-end'}; }
        .lt { display: flex; gap: ${Math.round(UNIT * 0.02)}px; padding: ${Math.round(UNIT * 0.022)}px ${Math.round(UNIT * 0.03)}px; max-width: 100%;
          background: color-mix(in srgb, var(--bg) 88%, transparent); border-radius: ${Math.round(UNIT * 0.012)}px; }
        .bar { flex: none; width: ${Math.max(4, Math.round(UNIT * 0.007))}px; background: var(--accent); border-radius: 2px; }
        .txt { min-width: 0; }
        .name { font: 700 ${Math.round(UNIT * 0.046)}px/1.1 Archivo; }
        .role { font: 400 ${Math.round(UNIT * 0.03)}px/1.25 Archivo; color: color-mix(in srgb, var(--fg) 75%, var(--bg)); margin-top: ${Math.round(UNIT * 0.006)}px; }
        .role:empty { display: none; }`,
    });
    this.o = o;
  }

  protected update(f: Frame) {
    this.layer.text('.name', val(this.o.name, f));
    this.layer.text('.role', this.o.role ? val(this.o.role, f) : '');
  }
}
