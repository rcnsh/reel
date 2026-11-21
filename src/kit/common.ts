import type * as THREE from 'three';
import { HtmlLayer, kebab, type HtmlUpdate } from '../engine/html';
import { H, W } from '../engine/gl';
import { HEX } from '../engine/palette';
import { LOADING, type Frame } from '../engine/scene';
import { clamp, ease, prog } from '../engine/util';

export type Anim<T> = T | ((f: Frame) => T);
export const val = <T>(a: Anim<T>, f: Frame): T => (typeof a === 'function' ? (a as (f: Frame) => T)(f) : a);

export interface Box { x: number; y: number; w: number; h: number }

/** The safe margin `reel check` asks text to stay inside (5% of each side). */
export const SAFE = 0.05;
/** A box inside the safe margin: `inset` shares of the frame in from each edge (default the safe margin plus a little). */
export function safeBox(inset = SAFE + 0.03): Box {
  return { x: W * inset, y: H * inset, w: W * (1 - 2 * inset), h: H * (1 - 2 * inset) };
}
export const UNIT = Math.min(W, H);
/** The kit's line width (a chart's line, a drawn path, an arrow): 0.5% of the short side, at least 3 px. */
export const lineWidth = () => Math.max(3, Math.round(UNIT * 0.005));

export interface Motion {
  /** 'fade', a direction it moves in from ('up' rises into place), 'scale', or 'none' (default 'up'). */
  from?: 'fade' | 'up' | 'down' | 'left' | 'right' | 'scale' | 'none';
  in?: number;
  out?: number;
  delay?: number;
  /** How far it travels, in logical px (default 4% of the short side). */
  distance?: number;
}

export function motionAt(m: Motion | false | undefined, lt: number, w0: number, w1: number) {
  if (lt < w0 || lt >= w1) return null;
  if (m === false) return { opacity: 1, dx: 0, dy: 0, scale: 1 };
  const from = m?.from ?? 'up', tin = m?.in ?? 0.6, tout = m?.out ?? 0.4, d = m?.distance ?? UNIT * 0.04;
  const a0 = w0 + (m?.delay ?? 0);
  const kin = tin > 0 ? ease.outCubic(clamp((lt - a0) / tin)) : lt >= a0 ? 1 : 0;
  const kout = tout > 0 ? ease.inCubic(clamp((w1 - lt) / tout)) : 1;
  const k = Math.min(kin, kout);
  if (k <= 0) return null;
  const off = (1 - k) * d;
  const [dx, dy] = from === 'up' ? [0, off] : from === 'down' ? [0, -off] : from === 'left' ? [-off, 0] : from === 'right' ? [off, 0] : [0, 0];
  return { opacity: from === 'none' ? 1 : k, dx, dy, scale: from === 'scale' ? 0.92 + 0.08 * k : 1 };
}

export interface Span { start: number; end: number }

export type At = [number | Span, number | Span] | Span;

const isSpan = (x: unknown): x is Span => !!x && typeof x === 'object' && Number.isFinite((x as Span).start) && Number.isFinite((x as Span).end);

export function windowOf(at: At | undefined, label: string): [number, number] | undefined {
  if (at === undefined) return undefined;
  const show = (x: unknown): string => (isSpan(x) ? `{ start: ${x.start}, end: ${x.end} }` : Array.isArray(x) ? `[${x.map(show).join(', ')}]` : String(x));
  const bad = (m: string): never => { throw new Error(`${label}: at ${show(at)}: ${m}`); };
  const ends: unknown[] = Array.isArray(at) ? at : [at, at];
  if (ends.length !== 2) bad('expected [from, to] or a span of the words (ctx.words.get(…))');
  const clip = LOADING.clip;
  const local = (x: unknown, end: boolean): number => {
    if (typeof x === 'number') return Number.isFinite(x) || (end && x === Infinity) ? x : bad('expected seconds');
    if (!isSpan(x)) return bad('each end is clip seconds or a span of the words with a start and an end (a line or word: ctx.words.get(…))');
    if (!clip) return bad('a span of the words is in video time, and the component was not made while a scene was: make it as a field of the scene or in init()');
    return (end ? x.end : x.start) - clip.start;
  };
  const w: [number, number] = [local(ends[0], false), local(ends[1], true)];
  if (w[1] < w[0]) bad(`its window [${w[0]}, ${w[1]}] in clip seconds ends before it starts`);
  if (clip && ends.some(isSpan) && (w[1] <= 0 || w[0] >= clip.end - clip.start)) bad(`its window [${w[0]}, ${w[1]}] in clip seconds is outside the clip '${clip.id}' (0 to ${clip.end - clip.start}): those words are said before or after it`);
  else if (clip && (w[1] <= 0 || w[0] >= clip.end - clip.start)) bad(`its window [${w[0]}, ${w[1]}] is outside the clip '${clip.id}', which is ${+(clip.end - clip.start).toFixed(3)} s long, so it never shows: \`at\` is in seconds from the clip's start, not the video's (video time t is t - this.ctx.start in the clip)`);
  return w;
}

export interface ComponentOptions {
  box?: Box;
  at?: At;
  motion?: Motion | false;
  css?: string;
  label?: string;
}

export const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((g) => g.segment);

export interface ProgressOptions extends ComponentOptions {
  progress?: Anim<number>;
}

export function progressOf(o: ProgressOptions, f: Frame, w0: number, seconds = 1.4) {
  if (o.progress !== undefined) return clamp(val(o.progress, f));
  return prog(f.lt, w0 + 0.2, w0 + 0.2 + seconds, ease.outCubic);
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CSS_KEYWORDS = ['transparent', 'white', 'black', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'none'];

export function cssColor(c: string): string {
  if (!/^[a-z][A-Za-z0-9-]*$/.test(c) || CSS_KEYWORDS.includes(c.toLowerCase())) return c;
  if (Object.prototype.hasOwnProperty.call(HEX, c)) return `var(--${kebab(c)})`;
  const css = (globalThis as { CSS?: { supports(p: string, v: string): boolean } }).CSS;
  if (css?.supports('color', c)) return c;
  throw new Error(`colour '${c}': the theme has no such palette key (it has ${Object.keys(HEX).join(', ')}), and it is not a CSS colour. Use one of those keys (bg, fg, accent, accentHi and accentLo are in every theme), a CSS colour such as '#6f6f73', or 'var(--name)' for a custom property your css defines`);
}

export abstract class HtmlComponent {
  readonly box: Box;
  readonly layer: HtmlLayer;
  protected opts: ComponentOptions;
  protected at: [number, number] | undefined;

  protected readonly pad: number;

  constructor(o: ComponentOptions, defaults: { box: Box; html: string; css: string; label: string; pad?: number }) {
    this.opts = o;
    this.at = windowOf(o.at, o.label ?? defaults.label);
    this.box = o.box ?? defaults.box;
    this.pad = Math.ceil(defaults.pad ?? 0);
    const update: HtmlUpdate = (f) => this.update(f);
    this.layer = new HtmlLayer({ html: defaults.html, css: defaults.css + (o.css ?? ''), width: Math.ceil(this.box.w) + 2 * this.pad, height: Math.ceil(this.box.h) + 2 * this.pad, update, label: o.label ?? defaults.label });
  }

  protected abstract update(f: Frame): void;

  protected window(f: Frame): [number, number] { return this.at ?? [0, f.end - f.start]; }

  draw(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, f: Frame, o: { opacity?: number } = {}) {
    const [w0, w1] = this.window(f);
    const m = motionAt(this.opts.motion, f.lt, w0, w1);
    if (!m) return;
    this.layer.draw(renderer, out, { x: this.box.x - this.pad + m.dx, y: this.box.y - this.pad + m.dy, scale: m.scale, opacity: m.opacity * (o.opacity ?? 1) });
  }
}
