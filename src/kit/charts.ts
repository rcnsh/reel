// Data components animated by a progress value from 0 to 1 (by default the first 1.4 s of their window, eased):
// bar charts (vertical or horizontal, plain or stacked), a line chart, a number counter, a progress bar and a timer.
import type { Frame } from '../engine/scene';
import { clamp, ease, prog } from '../engine/util';
import { cssColor, esc, HtmlComponent, safeBox, UNIT, val, type Anim, type ComponentOptions } from './common';

export interface ProgressOptions extends ComponentOptions {
  /** 0 to 1: how far the chart has grown (default: over the first 1.4 s of its window, eased out). */
  progress?: Anim<number>;
}

/**
 * The default progress: grows over the first `seconds` (default 1.4 s) of the window, after a 0.2 s beat, eased out.
 */
export function progressOf(o: ProgressOptions, f: Frame, seconds = 1.4) {
  if (o.progress !== undefined) return clamp(val(o.progress, f));
  const w0 = o.at?.[0] ?? 0;
  return prog(f.lt, w0 + 0.2, w0 + 0.2 + seconds, ease.outCubic);
}

/**
 * How far item i of n has grown (0 to 1) at progress p: one after another, each over 3/(n+2) of the progress and
 * overlapping its neighbours (all done at p = 1), or with `stagger` false all together, k = p.
 */
export function growth(p: number, i: number, n: number, stagger = true) {
  return stagger ? ease.outCubic(clamp((p * (n + 2) - i) / 3)) : clamp(p);
}

/** Numbers as text: `en-US` grouping (the same on every machine), at most `digits` decimals. */
export const formatNumber = (x: number, digits = 0) => x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * The default colour of series (or slice) i, from the keys every palette has: accent, a light accent, fg, a light
 * fg, accentHi, accentLo, then round again.
 */
export function seriesColor(i: number) {
  const c = ['var(--accent)', 'color-mix(in srgb, var(--accent) 45%, var(--bg))', 'var(--fg)', 'color-mix(in srgb, var(--fg) 45%, var(--bg))', 'var(--accent-hi)', 'var(--accent-lo)'];
  return c[((i % c.length) + c.length) % c.length]!;
}

/**
 * Stacked bars: for each bar's values, its total and each segment's [from, to] as shares of that total (0 to 1,
 * bottom or left first). A bar of zeros has total 0 and empty segments. Values must be 0 or more.
 */
export function stackBars(bars: number[][]) {
  return bars.map((values, b) => {
    for (const v of values) if (!(v >= 0) || !Number.isFinite(v)) throw new Error(`stacked bars: bar ${b} has the value ${v}; values must be finite and 0 or more`);
    const total = values.reduce((a, v) => a + v, 0);
    let at = 0;
    const segments = values.map((v) => {
      const from = total > 0 ? at / total : 0;
      at += v;
      return [from, total > 0 ? at / total : 0] as [number, number];
    });
    return { total, segments };
  });
}

type Orientation = 'vertical' | 'horizontal';

interface BarsOptions extends ProgressOptions {
  /** The value of a full bar (default the largest value, or for stacked bars the largest total). */
  max?: number;
  /** A value's label (default formatNumber). */
  format?: (v: number) => string;
  /** The index of a bar to pick out. */
  highlight?: number;
  /** A title above the chart. */
  title?: string;
  /**
   * Bars grow one after another (default true). False: all together, each in proportion, so the chart never shows
   * a smaller bar ahead of a larger one (for a comparison whose order is the point).
   */
  stagger?: boolean;
  /** Bars stand up from a baseline (default) or run right from an axis on the left, labels beside them. */
  orientation?: Orientation;
}

interface BarsSpec { labels: string[]; totals: number[]; color?: string; segs?: { colors: string[]; spans: [number, number][][] }; legend?: { label: string; color: string }[]; label: string }

/**
 * What bar charts share: markup and CSS for vertical and horizontal bars, each a `.fill` (holding `.seg`s when
 * stacked) with its `.value` and `.label`, and an update that grows them.
 */
abstract class Bars extends HtmlComponent {
  private bo: BarsSpec;
  constructor(o: BarsOptions, bo: BarsSpec) {
    if (o.highlight !== undefined && !(o.highlight >= 0 && o.highlight < bo.labels.length && Number.isInteger(o.highlight))) throw new Error(`${bo.label}: highlight ${o.highlight} is not a bar (0 to ${bo.labels.length - 1})`);
    const fs = Math.round(UNIT * 0.028), box = o.box ?? safeBox(0.12), hz = o.orientation === 'horizontal';
    const segs = (b: number) => bo.segs ? bo.segs.spans[b]!.map((s, i) => `<div class="seg" style="--a: ${s[0].toFixed(5)}; --b: ${s[1].toFixed(5)}; background: ${bo.segs!.colors[i]}"></div>`).join('') : '';
    const bars = bo.labels.map((l, i) => hz
      ? `<div class="bar${i === o.highlight ? ' hi' : ''}"><span class="label">${esc(l)}</span><div class="track"><div class="fill">${segs(i)}</div><span class="value"></span></div></div>`
      : `<div class="bar${i === o.highlight ? ' hi' : ''}"><span class="value"></span><div class="fill">${segs(i)}</div><span class="label">${esc(l)}</span></div>`).join('');
    const legend = bo.legend ? `<div class="legend">${bo.legend.map((s) => `<span class="key"><i style="background: ${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>` : '';
    const title = `.title { font: 700 ${Math.round(fs * 1.4)}px/1.2 Archivo; }`;
    // (the room a horizontal bar leaves at its end for its value: the longest label of the largest value)
    const fmt = o.format ?? formatNumber, room = Math.ceil(Math.max(...bo.totals.map((t) => fmt(t).length), 1) * fs * 0.62 + fs * 0.8);
    const css = hz
      ? `.frame { position: absolute; inset: 0; display: flex; flex-direction: column; gap: ${fs}px; }
        ${title}
        .bars { flex: 1; min-height: 0; display: grid; grid-template-columns: max-content 1fr; grid-auto-rows: minmax(0, 1fr); column-gap: ${Math.round(fs * 0.7)}px; align-items: center; }
        .bar { display: contents; }
        .label { font: 400 ${fs}px/1.2 Archivo; color: color-mix(in srgb, var(--fg) 75%, var(--bg)); white-space: nowrap; text-align: right; }
        .track { position: relative; height: 100%; display: flex; align-items: center; border-left: 2px solid color-mix(in srgb, var(--fg) 35%, transparent); }
        .fill { position: relative; height: min(72%, ${Math.round(fs * 1.8)}px); width: calc(var(--h, 0) * (100% - ${room}px)); background: ${cssColor(bo.color ?? 'accent')}; border-radius: 0 4px 4px 0; }
        .bar.hi .fill { background: var(--fg); }
        .value { position: absolute; top: 50%; left: calc(var(--h, 0) * (100% - ${room}px) + ${Math.round(fs * 0.4)}px); transform: translateY(-50%); font: 600 ${fs}px/1.3 Archivo; font-variant-numeric: tabular-nums; white-space: nowrap; }`
      : `.frame { position: absolute; inset: 0; display: flex; flex-direction: column; gap: ${fs}px; }
        ${title}
        .bars { flex: 1; margin-bottom: ${Math.round(fs * 1.9)}px; display: flex; align-items: stretch; gap: ${Math.round(UNIT * 0.02)}px; border-bottom: 2px solid color-mix(in srgb, var(--fg) 35%, transparent); }
        .bar { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; position: relative; }
        .fill { width: 100%; height: calc(var(--h, 0) * (100% - ${fs * 2.2}px)); background: ${cssColor(bo.color ?? 'accent')}; border-radius: 4px 4px 0 0; }
        .bar.hi .fill { background: var(--fg); }
        .value { font: 600 ${fs}px/1.3 Archivo; font-variant-numeric: tabular-nums; margin-bottom: ${Math.round(fs * 0.3)}px; }
        .label { position: absolute; top: 100%; margin-top: ${Math.round(fs * 0.4)}px; font: 400 ${fs}px/1.2 Archivo; color: color-mix(in srgb, var(--fg) 75%, var(--bg)); white-space: nowrap; }`;
    // stacked: segments placed in their bar by their shares, the bar clipped to its rounded end; a highlight dims the rest
    const stacked = !bo.segs ? '' : `
        .fill, .bar.hi .fill { position: relative; overflow: hidden; background: none; }
        .seg { position: absolute; ${hz ? 'top: 0; bottom: 0; left: calc(var(--a) * 100%); width: calc((var(--b) - var(--a)) * 100%);' : 'left: 0; right: 0; bottom: calc(var(--a) * 100%); height: calc((var(--b) - var(--a)) * 100%);'} }
        ${o.highlight !== undefined ? '.bar:not(.hi) .fill { opacity: 0.4; }' : ''}
        .legend { display: flex; flex-wrap: wrap; column-gap: ${Math.round(fs * 1.2)}px; row-gap: ${Math.round(fs * 0.3)}px; font: 400 ${fs}px/1.2 Archivo; color: color-mix(in srgb, var(--fg) 75%, var(--bg)); }
        .key { display: inline-flex; align-items: center; gap: ${Math.round(fs * 0.4)}px; white-space: nowrap; }
        .key i { width: ${Math.round(fs * 0.8)}px; height: ${Math.round(fs * 0.8)}px; border-radius: 3px; }`;
    super(o, {
      box, label: bo.label,
      html: `<div class="frame">${o.title ? `<p class="title">${esc(o.title)}</p>` : ''}${legend}<div class="bars">${bars}</div></div>`,
      css: css + stacked,
    });
    this.bo = bo;
  }

  protected update(f: Frame) {
    const o = this.opts as BarsOptions, p = progressOf(o, f), n = this.bo.totals.length;
    const max = o.max ?? Math.max(...this.bo.totals, 1e-9);
    this.layer.$$('.bar').forEach((e, i) => {
      const k = growth(p, i, n, o.stagger !== false), v = this.bo.totals[i]!;
      // (a value past max fills its bar)
      this.layer.set(e, { vars: { h: (Math.min(1, v / max) * k).toFixed(4) } });
      this.layer.set(e.querySelector('.value')!, { text: k > 0 ? (o.format ?? formatNumber)(v * k) : '' });
    });
  }
}

export interface BarChartOptions extends BarsOptions {
  data: { label: string; value: number }[];
  /** Bar colour (palette key or CSS colour, default accent); the `highlight`ed bar is drawn in fg instead. */
  color?: string;
}

/**
 * A bar chart: bars grow from the baseline one after another (or together, `stagger: false`) as progress runs 0 to
 * 1, with their values above and labels below; `orientation: 'horizontal'` runs them right from an axis, labels on
 * the left and values at their ends. Markup: `.frame` (a column) > `.title`, `.bars` > `.bar` > `.value`, `.fill`,
 * `.label` (horizontal: `.bars` is a grid, `.bar` > `.label`, `.track` > `.fill`, `.value`).
 */
export class BarChart extends Bars {
  constructor(o: BarChartOptions) {
    super(o, { labels: o.data.map((d) => d.label), totals: o.data.map((d) => d.value), color: o.color, label: 'bar chart' });
  }
}

export interface StackedBarChartOptions extends BarsOptions {
  /** One bar per item: its label and one value per series (0 or more), stacked bottom (or left) first. */
  data: { label: string; values: number[] }[];
  /** The series, in the order of each bar's values: a name for the legend and a colour (default seriesColor(i)). */
  series: { label: string; color?: string }[];
  /** Show the legend under the title (default true). */
  legend?: boolean;
}

/**
 * Stacked bars, vertical or horizontal: each bar grows as a whole (one after another, or together with
 * `stagger: false`) with its segments in proportion, its total at its end, and a legend of the series. A
 * `highlight`ed bar keeps its colours and the rest are dimmed. Markup as BarChart, plus `.legend` > `.key` and
 * `.seg` inside each `.fill`.
 */
export class StackedBarChart extends Bars {
  constructor(o: StackedBarChartOptions) {
    const stacks = stackBars(o.data.map((d) => d.values));
    for (const [i, d] of o.data.entries()) if (d.values.length > o.series.length) throw new Error(`stacked bar chart: bar ${i} ('${d.label}') has ${d.values.length} values for ${o.series.length} series`);
    const colors = o.series.map((s, i) => esc(s.color ? cssColor(s.color) : seriesColor(i)));
    super(o, {
      labels: o.data.map((d) => d.label), totals: stacks.map((s) => s.total), label: 'stacked bar chart',
      segs: { colors, spans: stacks.map((s) => s.segments) },
      legend: o.legend === false ? undefined : o.series.map((s, i) => ({ label: s.label, color: colors[i]! })),
    });
  }
}

export interface LineChartOptions extends ProgressOptions {
  /** One series of values, or several, evenly spaced along x. */
  series: number[] | { label?: string; values: number[]; color?: string }[];
  /** Labels along x (the first and last are shown). */
  labels?: string[];
  min?: number;
  max?: number;
  title?: string;
  /** The last value's label (default formatNumber). */
  format?: (v: number) => string;
}

/**
 * A line chart drawn left to right as progress runs 0 to 1 (an SVG path revealed along its length), with a dot
 * and the value at its head. Classes: `.title`, `.plot`, `.line`, `.head`, `.value`, `.axis`.
 */
export class LineChart extends HtmlComponent {
  private o: LineChartOptions;
  private head: (p: number) => { v: number; x: number; y: number };
  constructor(o: LineChartOptions) {
    const fs = Math.round(UNIT * 0.028), box = o.box ?? safeBox(0.12);
    const series = (typeof o.series[0] === 'number' ? [{ values: o.series as number[] }] : (o.series as { values: number[]; color?: string }[])).map((s, i) => ({ values: s.values, color: cssColor(s.color ?? (i === 0 ? 'accent' : 'fg')) }));
    // (no values at all: an empty plot with its title and axis, no line and no head)
    const all = series.flatMap((s) => s.values), lo = o.min ?? Math.min(0, ...all), hi = o.max ?? (all.length ? Math.max(...all) : lo + 1);
    const titleH = o.title ? fs * 2.4 : 0, axisH = o.labels ? fs * 2 : 0;
    const pw = Math.round(box.w - fs * 4), ph = Math.round(box.h - titleH - axisH - fs * 1.6);
    const X = (i: number, n: number) => (i / Math.max(1, n - 1)) * pw, Y = (v: number) => ph - ((v - lo) / Math.max(1e-9, hi - lo)) * ph;
    const paths = series.map((s) => `<path class="line" stroke="${s.color}" d="${s.values.map((v, i) => `${i ? 'L' : 'M'}${X(i, s.values.length).toFixed(2)} ${Y(v).toFixed(2)}`).join(' ')}"/>`).join('');
    const r = Math.max(4, Math.round(fs * 0.28));
    super(o, {
      box, label: 'line chart',
      html: `<div class="frame">${o.title ? `<p class="title">${esc(o.title)}</p>` : ''}<div class="plot"><svg width="${pw}" height="${ph}" viewBox="0 0 ${pw} ${ph}">
          <line class="base" x1="0" x2="${pw}" y1="${ph}" y2="${ph}"/><g class="lines">${paths}</g></svg><span class="head"></span><span class="value"></span></div>
        ${o.labels ? `<div class="axis"><span>${esc(o.labels[0] ?? '')}</span><span>${esc(o.labels.at(-1) ?? '')}</span></div>` : ''}</div>`,
      css: `.frame { position: absolute; inset: 0; display: flex; flex-direction: column; }
        .title { font: 700 ${Math.round(fs * 1.4)}px/1.2 Archivo; margin-bottom: ${fs}px; }
        .plot { position: relative; margin-top: ${fs * 1.6}px; width: ${pw}px; }
        svg { display: block; overflow: visible; }
        .base { stroke: color-mix(in srgb, var(--fg) 35%, transparent); stroke-width: 2; }
        .lines { clip-path: inset(-${fs}px calc(${pw}px - var(--x, 0px)) -${fs}px -${fs}px); }
        .line { fill: none; stroke-width: ${Math.max(3, Math.round(UNIT * 0.005))}; stroke-linecap: round; stroke-linejoin: round; }
        .head { position: absolute; width: ${r * 2}px; height: ${r * 2}px; margin: -${r}px 0 0 -${r}px; border-radius: 50%; background: ${series[0]?.color ?? 'var(--accent)'}; }
        .value { position: absolute; font: 600 ${fs}px Archivo; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .axis { display: flex; justify-content: space-between; width: ${pw}px; margin-top: ${Math.round(fs * 0.5)}px; font: 400 ${fs}px Archivo; color: color-mix(in srgb, var(--fg) 75%, var(--bg)); }`,
    });
    this.o = o;
    // the line is revealed left to right by x, and its head sits on the first series at that x
    const s = series[0]?.values ?? [];
    this.head = (p: number) => {
      if (!s.length) return { v: NaN, x: p * pw, y: ph };
      const x = p * (s.length - 1), i = Math.max(0, Math.min(s.length - 2, Math.floor(x))), u = x - i;
      const v = s.length > 1 ? s[i]! + (s[i + 1]! - s[i]!) * u : s[0]!;
      return { v, x: p * pw, y: Y(v) };
    };
  }

  protected update(f: Frame) {
    const p = progressOf(this.o, f), h = this.head(p), on = p > 0 && !Number.isNaN(h.v);
    this.layer.vars({ x: `${h.x.toFixed(2)}px` });
    this.layer.set('.head', { style: { left: `${h.x.toFixed(2)}px`, top: `${h.y.toFixed(2)}px`, display: on ? '' : 'none' } });
    // (the value's label slides from left aligned at the start to right aligned at the end, so it stays in the box)
    this.layer.set('.value', { text: on ? (this.o.format ?? formatNumber)(h.v) : '', style: { left: `${h.x.toFixed(1)}px`, top: `${h.y.toFixed(1)}px`, transform: `translate(${(-p * 100).toFixed(2)}%, -150%)` } });
  }
}

export interface CounterOptions extends ProgressOptions {
  to: number;
  from?: number;
  /** Decimals (default 0), or a format of your own. */
  digits?: number;
  format?: (v: number) => string;
  prefix?: string;
  suffix?: string;
  /** A caption under the number. */
  caption?: string;
  size?: number;
  color?: string;
  /** Where the number and caption sit across the box (default center). */
  align?: 'left' | 'center' | 'right';
}

/**
 * A number counting from `from` to `to` as progress runs 0 to 1, with a caption. Markup: `.frame` (a column, centred
 * vertically, aligned by `align`) > `.num`, `.cap`.
 */
export class Counter extends HtmlComponent {
  private o: CounterOptions;
  constructor(o: CounterOptions) {
    const size = o.size ?? Math.round(UNIT * 0.16);
    super(o, {
      box: o.box ?? safeBox(0.15), label: 'counter',
      html: `<div class="frame"><p class="num"></p>${o.caption ? `<p class="cap">${esc(o.caption)}</p>` : ''}</div>`,
      css: `.frame { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: ${{ left: 'flex-start', center: 'center', right: 'flex-end' }[o.align ?? 'center']}; text-align: ${o.align ?? 'center'}; }
        .num { font: 800 ${size}px/1 Archivo; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; color: ${cssColor(o.color ?? 'fg')}; white-space: nowrap; }
        .cap { font: 400 ${Math.round(size * 0.22)}px/1.3 Archivo; margin-top: ${Math.round(size * 0.12)}px; color: color-mix(in srgb, var(--fg) 75%, var(--bg)); }`,
    });
    this.o = o;
  }
  protected update(f: Frame) {
    const o = this.o, v = (o.from ?? 0) + (o.to - (o.from ?? 0)) * progressOf(o, f);
    this.layer.text('.num', `${o.prefix ?? ''}${o.format ? o.format(v) : formatNumber(v, o.digits ?? 0)}${o.suffix ?? ''}`);
  }
}

export interface ProgressBarOptions extends ComponentOptions {
  /** 0 to 1 (default the clip's progress, f.p). */
  progress?: Anim<number>;
  /** Text beside the bar, or a function of the frame. */
  text?: Anim<string>;
  color?: string;
}

/** A progress bar along the bottom of the safe area by default. Classes: `.track`, `.fill`, `.label`. */
export class ProgressBar extends HtmlComponent {
  private o: ProgressBarOptions;
  constructor(o: ProgressBarOptions = {}) {
    const s = safeBox(), h = Math.max(6, Math.round(UNIT * 0.012)), fs = Math.round(UNIT * 0.026);
    super({ motion: false, ...o }, {
      box: o.box ?? { x: s.x, y: s.y + s.h - fs * 1.6, w: s.w, h: fs * 1.6 }, label: 'progress bar',
      html: `<div class="frame"><div class="track"><div class="fill"></div></div><span class="label"></span></div>`,
      css: `.frame { position: absolute; inset: 0; display: flex; align-items: center; gap: ${fs}px; }
        .track { flex: 1; height: ${h}px; border-radius: ${h}px; background: color-mix(in srgb, var(--fg) 18%, transparent); overflow: hidden; }
        .fill { height: 100%; width: calc(var(--p, 0) * 100%); background: ${cssColor(o.color ?? 'accent')}; border-radius: inherit; }
        .label { font: 600 ${fs}px Archivo; font-variant-numeric: tabular-nums; }
        .label:empty { display: none; }`,
    });
    this.o = o;
  }
  protected update(f: Frame) {
    this.layer.vars({ p: clamp(this.o.progress === undefined ? f.p : val(this.o.progress, f)).toFixed(4) });
    this.layer.text('.label', this.o.text ? val(this.o.text, f) : '');
  }
}

export interface TimerOptions extends ComponentOptions {
  /** Seconds shown at the start of the window and at its end (default counts up from 0 over the window). */
  from?: number;
  to?: number;
  /** 'm:ss' (default), 'mm:ss', 'ss', or 'm:ss.t' (tenths). */
  format?: 'm:ss' | 'mm:ss' | 'ss' | 'm:ss.t';
  size?: number;
  color?: string;
}

/** Seconds as a clock: 'm:ss', 'mm:ss', 'ss' or 'm:ss.t'. */
export function clock(s: number, format: TimerOptions['format'] = 'm:ss') {
  const t = Math.max(0, s), tenths = format === 'm:ss.t';
  const whole = tenths ? Math.floor(t * 10 + 1e-6) / 10 : Math.floor(t + 1e-6);
  const m = Math.floor(whole / 60), sec = whole - m * 60;
  const ss = tenths ? sec.toFixed(1).padStart(4, '0') : String(Math.floor(sec)).padStart(2, '0');
  if (format === 'ss') return String(Math.floor(whole));
  return `${format === 'mm:ss' ? String(m).padStart(2, '0') : m}:${ss}`;
}

/** A clock counting up (or down, with from > to) across its window. Classes: `.clock`. */
export class Timer extends HtmlComponent {
  private o: TimerOptions;
  constructor(o: TimerOptions = {}) {
    const size = o.size ?? Math.round(UNIT * 0.06), s = safeBox();
    super({ motion: false, ...o }, {
      box: o.box ?? { x: s.x + s.w - size * 4, y: s.y, w: size * 4, h: size * 1.4 }, label: 'timer',
      html: `<div class="frame"><span class="clock"></span></div>`,
      css: `.frame { position: absolute; inset: 0; display: flex; align-items: center; justify-content: flex-end; }
        .clock { font: 700 ${size}px/1 'IBM Plex Mono'; font-variant-numeric: tabular-nums; color: ${cssColor(o.color ?? 'fg')}; }`,
    });
    this.o = o;
  }
  protected update(f: Frame) {
    const [w0, w1] = this.window(f), k = clamp((f.lt - w0) / Math.max(1e-3, w1 - w0));
    const from = this.o.from ?? 0, to = this.o.to ?? w1 - w0;
    this.layer.text('.clock', clock(from + (to - from) * k, this.o.format));
  }
}
