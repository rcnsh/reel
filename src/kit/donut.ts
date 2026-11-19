// A donut (or pie) chart: slices swept clockwise from 12 o'clock as progress runs 0 to 1, drawn as SVG paths in
// an HTML layer, with a legend (or labels around the ring) and a value in the middle.
import type { Frame } from '../engine/scene';
import { clamp, ease } from '../engine/util';
import { cssColor, esc, HtmlComponent, safeBox, UNIT, val, type Anim } from './common';
import { formatNumber, progressOf, seriesColor, type ProgressOptions } from './charts';

/** A slice of a ring: where it starts and ends, in turns clockwise from 12 o'clock (0 to 1), and its share. */
export interface Slice { start: number; end: number; share: number }

/** Slices for values (0 or more): each one's share of the total laid end to end round the ring. A total of 0 gives empty slices. */
export function donutSlices(values: number[]): Slice[] {
  for (const v of values) if (!(v >= 0) || !Number.isFinite(v)) throw new Error(`donut chart: the value ${v}; values must be finite and 0 or more`);
  const total = values.reduce((a, v) => a + v, 0);
  let at = 0;
  return values.map((v) => {
    const share = total > 0 ? v / total : 0, start = at;
    at += share;
    return { start, end: at, share };
  });
}

/**
 * Shares as whole percents (or with `digits` decimals) that add up to exactly 100: each rounded down, and the
 * remaining units given to the largest remainders (ties to the earlier). All zero gives zeros.
 */
export function percents(values: number[], digits = 0): number[] {
  const total = values.reduce((a, v) => a + v, 0), unit = 10 ** digits;
  if (!(total > 0)) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100 * unit), floor = exact.map(Math.floor);
  let left = 100 * unit - floor.reduce((a, v) => a + v, 0);
  const order = exact.map((x, i) => ({ r: x - floor[i]!, i })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) { if (left <= 0) break; floor[i]!++; left--; }
  return floor.map((x) => x / unit);
}

/** A point at angle `a` (turns clockwise from 12 o'clock) and radius r about (cx, cy), in SVG coordinates (y down). */
export const polar = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + r * Math.sin(a * 2 * Math.PI), cy - r * Math.cos(a * 2 * Math.PI)];

/**
 * The SVG path of a ring sector from angle a0 to a1 (turns, clockwise from 12 o'clock) between radii r0 and r1
 * (r0 = 0: a pie wedge). Empty when a1 <= a0; a whole turn is drawn as two halves (one arc cannot close a circle).
 */
export function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  if (!(a1 > a0)) return '';
  const span = Math.min(1, a1 - a0);
  if (span > 0.5) {
    const m = a0 + span / 2;
    return `${arcPath(cx, cy, r0, r1, a0, m)} ${arcPath(cx, cy, r0, r1, m, a0 + span)}`;
  }
  const n = (v: number) => v.toFixed(2), [x0, y0] = polar(cx, cy, r1, a0), [x1, y1] = polar(cx, cy, r1, a0 + span);
  const outer = `M${n(x0)} ${n(y0)} A${n(r1)} ${n(r1)} 0 0 1 ${n(x1)} ${n(y1)}`;
  if (r0 <= 0) return `${outer} L${n(cx)} ${n(cy)} Z`;
  const [x2, y2] = polar(cx, cy, r0, a0 + span), [x3, y3] = polar(cx, cy, r0, a0);
  return `${outer} L${n(x2)} ${n(y2)} A${n(r0)} ${n(r0)} 0 0 0 ${n(x3)} ${n(y3)} Z`;
}

export interface DonutChartOptions extends ProgressOptions {
  data: { label: string; value: number; color?: string }[];
  /** The hole's radius as a share of the ring's (default 0.6); 0 makes a pie. */
  hole?: number;
  /** A title above the chart. */
  title?: string;
  /** What a slice's label shows beside its name: its share (default), its value, or both. */
  show?: 'share' | 'value' | 'both';
  /** A value's text (default formatNumber); `shareDigits`: decimals of the percents (default 0). */
  format?: (v: number) => string;
  shareDigits?: number;
  /** Labels in a legend beside or under the ring (default), around the ring at each slice, or none. */
  labels?: 'legend' | 'around' | 'none';
  /**
   * The text in the hole (a donut only). Default: the highlighted slice's share counting up, or the total counting
   * up; '' for none. `caption` goes under it (default the highlighted slice's name).
   */
  center?: Anim<string>;
  caption?: string;
  /** The index of a slice to pick out: it moves out a little and the others are dimmed. */
  highlight?: number;
  /** The gap between slices in logical px (default 0.4% of the short side; 0 for none). */
  gap?: number;
}

/**
 * A donut chart, or with `hole: 0` a pie: slices sweep in clockwise from 12 o'clock as progress runs 0 to 1, each
 * slice's label appearing as the sweep reaches it, and a value in the hole. Colours: each slice's `color`, else
 * seriesColor(i) (accent, a light accent, fg, …). Classes: `.title`, `.body`, `.ring`, `.slice`, `.center` > `.num`,
 * `.cap`; `.legend` > `.key` > `i` (the swatch), `.name`, `.val`; `.tag` (a label around the ring).
 */
export class DonutChart extends HtmlComponent {
  private o: DonutChartOptions;
  private slices: Slice[];
  private geo: { cx: number; cy: number; r0: number; r1: number; gap: number; out: number };
  private centerText: (f: Frame, p: number) => string;
  private numSize: (s: string) => number;

  constructor(o: DonutChartOptions) {
    const fs = Math.round(UNIT * 0.028), box = o.box ?? safeBox(0.12);
    if (o.highlight !== undefined && !o.data[o.highlight]) throw new Error(`donut chart: highlight ${o.highlight} is not a slice (0 to ${o.data.length - 1})`);
    const slices = donutSlices(o.data.map((d) => d.value)), pct = percents(o.data.map((d) => d.value), o.shareDigits ?? 0);
    const colors = o.data.map((d, i) => esc(d.color ? cssColor(d.color) : seriesColor(i)));
    const fmt = o.format ?? formatNumber, show = o.show ?? 'share', labels = o.labels ?? 'legend';
    const shareText = (i: number) => `${formatNumber(pct[i]!, o.shareDigits ?? 0)}%`;
    const valText = (i: number) => show === 'share' ? shareText(i) : show === 'value' ? fmt(o.data[i]!.value) : `${fmt(o.data[i]!.value)} · ${shareText(i)}`;

    // layout: the ring beside its legend in a wide box, above it in a tall one; around-labels take room on both sides
    const titleH = o.title ? Math.round(fs * 2.4) : 0, w = box.w, h = box.h - titleH;
    const longest = Math.max(1, ...o.data.map((d, i) => `${d.label} ${valText(i)}`.length)) * fs * 0.52;
    // (the legend: a row of 1.1 font sizes per slice, half a font size between rows, 1.6 between it and the ring)
    const wide = w >= h * 1.25, n = o.data.length, legendH = n * fs * 1.1 + Math.max(0, n - 1) * Math.round(fs * 0.5) + Math.round(fs * 1.6);
    let d: number;
    if (labels === 'around') d = Math.min(h - fs * 3, w - 2 * (longest + fs * 1.6));
    else if (labels === 'legend') d = wide ? Math.min(h, w - longest - fs * 4) : Math.min(w, h - legendH);
    else d = Math.min(w, h);
    d = Math.max(fs * 4, Math.floor(d));
    const out = Math.round(fs * 0.35), r1 = d / 2 - out, r0 = r1 * clamp(o.hole ?? 0.6, 0, 0.95);
    const size = d, cx = size / 2, cy = size / 2;
    const cap = o.caption ?? (o.highlight !== undefined ? o.data[o.highlight]?.label : undefined);

    const legend = labels !== 'legend' ? '' : `<div class="legend">${o.data.map((s, i) => `<div class="key"><i style="background: ${colors[i]}"></i><span class="name">${esc(s.label)}</span><span class="val">${esc(valText(i))}</span></div>`).join('')}</div>`;
    // (a slice of nothing has no tag: it would sit on its neighbour's edge)
    const tags = labels !== 'around' ? '' : o.data.map((s, i) => {
      if (slices[i]!.share <= 0) return '';
      const [x, y] = polar(cx, cy, r1 + out + fs * 0.6, (slices[i]!.start + slices[i]!.end) / 2), right = x >= cx - 0.5;
      return `<span class="tag" data-i="${i}" style="left: ${x.toFixed(1)}px; top: ${y.toFixed(1)}px; transform: translate(${right ? 0 : -100}%, -50%)">${esc(s.label)} <b>${esc(valText(i))}</b></span>`;
    }).join('');
    const hasCenter = r0 > 0;
    super(o, {
      box, label: 'donut chart',
      html: `<div class="frame">${o.title ? `<p class="title">${esc(o.title)}</p>` : ''}<div class="body"><div class="ring"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${o.data.map((_, i) => `<path class="slice${i === o.highlight ? ' hi' : ''}" style="fill: ${colors[i]}"/>`).join('')}</svg>${hasCenter ? `<div class="center"><span class="num"></span>${cap ? `<span class="cap">${esc(cap)}</span>` : ''}</div>` : ''}${tags}</div>${legend}</div></div>`,
      css: `.frame { position: absolute; inset: 0; display: flex; flex-direction: column; }
        .title { font: 700 ${Math.round(fs * 1.4)}px/1.2 Archivo; height: ${titleH}px; }
        .body { flex: 1; min-height: 0; display: flex; flex-direction: ${wide && labels === 'legend' ? 'row' : 'column'}; align-items: center; justify-content: center; gap: ${Math.round(fs * 1.6)}px; }
        .ring { position: relative; flex: none; width: ${size}px; height: ${size}px; }
        svg { display: block; overflow: visible; }
        ${o.highlight !== undefined ? '.slice:not(.hi) { opacity: 0.35; }' : ''}
        .center { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: ${Math.floor(r0 * 1.7)}px; display: flex; flex-direction: column; align-items: center; text-align: center; }
        .num { font: 800 var(--ns, ${Math.round(r0 * 0.5)}px)/1 Archivo; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; white-space: nowrap; }
        .cap { font: 400 ${Math.round(Math.max(fs * 0.8, Math.min(fs, r0 * 0.22)))}px/1.2 Archivo; margin-top: ${Math.round(r0 * 0.08)}px; color: color-mix(in srgb, var(--fg) 75%, var(--bg)); }
        .legend { display: flex; flex-direction: column; gap: ${Math.round(fs * 0.5)}px; font: 400 ${fs}px/1.1 Archivo; }
        .key { display: flex; align-items: center; gap: ${Math.round(fs * 0.5)}px; white-space: nowrap; opacity: var(--k, 0); }
        .key i { flex: none; width: ${Math.round(fs * 0.8)}px; height: ${Math.round(fs * 0.8)}px; border-radius: 3px; }
        .name { color: color-mix(in srgb, var(--fg) 75%, var(--bg)); }
        .val { font-weight: 600; font-variant-numeric: tabular-nums; margin-left: auto; padding-left: ${Math.round(fs * 0.8)}px; }
        .tag { position: absolute; font: 400 ${fs}px/1.2 Archivo; white-space: nowrap; color: color-mix(in srgb, var(--fg) 75%, var(--bg)); opacity: var(--k, 0); }
        .tag b { font-weight: 600; color: var(--fg); font-variant-numeric: tabular-nums; }`,
    });
    this.o = o;
    this.slices = slices;
    this.geo = { cx, cy, r0, r1, gap: o.gap ?? Math.max(2, UNIT * 0.004), out: o.highlight !== undefined ? out : 0 };
    const total = o.data.reduce((a, s) => a + s.value, 0), hi = o.highlight !== undefined ? o.highlight : -1;
    // the default centre: the highlighted slice's share or the total, counting up with the sweep
    this.centerText = (f, p) => {
      if (o.center !== undefined) return val(o.center, f);
      if (hi >= 0) return `${formatNumber(pct[hi]! * p, o.shareDigits ?? 0)}%`;
      return fmt(total * p);
    };
    // the number's size: fits the hole by its length at the end of the sweep (so it does not jump as it counts)
    const longestCenter = o.center === undefined ? (hi >= 0 ? `${formatNumber(pct[hi]!, o.shareDigits ?? 0)}%` : fmt(total)) : null;
    this.numSize = (s) => Math.round(Math.min(r0 * 0.5, (r0 * 1.6) / Math.max(1, (longestCenter ?? s).length * 0.62)));
  }

  protected update(f: Frame) {
    const p = progressOf(this.o, f), { cx, cy, r0, r1, gap, out } = this.geo, n = this.slices.length;
    this.layer.$$('path').forEach((e, i) => {
      const s = this.slices[i]!, mid = (s.start + s.end) / 2;
      // (the gap is a fixed width at the outer edge: half of it off each end of every slice, none for a lone slice)
      const g = n > 1 && s.share < 1 ? gap / (2 * Math.PI * r1) / 2 : 0;
      const a0 = s.start + g, a1 = Math.min(s.end - g, p);
      const push = i === this.o.highlight ? out * ease.outCubic(clamp((p - s.end) / 0.1 + 1)) : 0;
      const [dx, dy] = [push * Math.sin(mid * 2 * Math.PI), -push * Math.cos(mid * 2 * Math.PI)];
      this.layer.set(e, { attr: { d: arcPath(cx + dx, cy + dy, r0, r1, a0, a1) || 'M0 0' } });
    });
    // a slice's label appears as the sweep reaches it
    const reveal = (i: number) => ease.outCubic(clamp((p - this.slices[i]!.start) / 0.08)).toFixed(3);
    this.layer.$$('.key').forEach((e, i) => this.layer.set(e, { vars: { k: p > 0 ? reveal(i) : 0 } }));
    this.layer.$$('.tag').forEach((e) => this.layer.set(e, { vars: { k: p > 0 ? reveal(Number(e.dataset.i)) : 0 } }));
    if (r0 > 0) {
      const t = p > 0 || this.o.center !== undefined ? this.centerText(f, p) : '';
      this.layer.set('.num', { text: t, vars: { ns: `${this.numSize(t)}px` } });
    }
  }
}
