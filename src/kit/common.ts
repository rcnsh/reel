// What every kit component shares: a box in logical px, a window of the clip it shows in, an entrance and exit
// drawn in GL (evaluated per sub-frame, so they get motion blur), values that may be functions of the frame, and
// an HTML layer the size of its box.
import type * as THREE from 'three';
import { HtmlLayer, type HtmlUpdate } from '../engine/html';
import { H, W } from '../engine/gl';
import { LOADING, type Frame } from '../engine/scene';
import { clamp, ease } from '../engine/util';

/** A value, or a function of the frame giving it (evaluated once per output frame for content, per sub-frame for motion). */
export type Anim<T> = T | ((f: Frame) => T);
export const val = <T>(a: Anim<T>, f: Frame): T => (typeof a === 'function' ? (a as (f: Frame) => T)(f) : a);

/** A rectangle in logical frame px, origin top left. */
export interface Box { x: number; y: number; w: number; h: number }

/** The safe margin `reel check` asks text to stay inside (5% of each side). */
export const SAFE = 0.05;
/** A box inside the safe margin: `inset` shares of the frame in from each edge (default the safe margin plus a little). */
export function safeBox(inset = SAFE + 0.03): Box {
  return { x: W * inset, y: H * inset, w: W * (1 - 2 * inset), h: H * (1 - 2 * inset) };
}
/** The frame's short side: sizes scale with it, so a layout holds in 16:9, vertical and square. */
export const UNIT = Math.min(W, H);

/**
 * An entrance and an exit: over `in` seconds from the start of the component's window it fades (and moves from
 * `from`), over `out` seconds before its end it fades back. Evaluated per sub-frame.
 */
export interface Motion {
  /** 'fade', a direction it moves in from ('up' rises into place), 'scale', or 'none' (default 'up'). */
  from?: 'fade' | 'up' | 'down' | 'left' | 'right' | 'scale' | 'none';
  /** Seconds in (default 0.6) and out (default 0.4); 0 cuts. */
  in?: number;
  out?: number;
  /** Seconds after the window starts before it comes in (default 0). */
  delay?: number;
  /** How far it travels, in logical px (default 4% of the short side). */
  distance?: number;
}

/** What a component's draw puts on screen at time t of a window: opacity, offset and scale. */
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

/** A stretch of video time with a start and an end: a line or a word of the timed words (`ctx.words.get('…')`). */
export interface Span { start: number; end: number }

/**
 * When a component shows: [from, to] in seconds of its clip, either end of which may be a span of the words (it
 * opens the window at its start, closes it at its end), or a span alone (the window is the span).
 */
export type At = [number | Span, number | Span] | Span;

const isSpan = (x: unknown): x is Span => !!x && typeof x === 'object' && Number.isFinite((x as Span).start) && Number.isFinite((x as Span).end);

/**
 * A component's `at` in clip seconds. Spans are in video time, so they are taken off the start of the clip being
 * loaded: a component whose `at` holds one is made while its scene is (as a field, or in init()).
 */
export function windowOf(at: At | undefined, label: string): [number, number] | undefined {
  if (at === undefined) return undefined;
  const show = (x: unknown): string => (isSpan(x) ? `{ start: ${x.start}, end: ${x.end} }` : Array.isArray(x) ? `[${x.map(show).join(', ')}]` : String(x));
  const bad = (m: string): never => { throw new Error(`${label}: at ${show(at)}: ${m}`); };
  const ends: unknown[] = Array.isArray(at) ? at : [at, at];
  if (ends.length !== 2) bad('expected [from, to] or a span of the words (ctx.words.get(…))');
  const clip = LOADING.clip;
  const local = (x: unknown, end: boolean): number => {
    // (a window may run to Infinity: to the end of the clip)
    if (typeof x === 'number') return Number.isFinite(x) || (end && x === Infinity) ? x : bad('expected seconds');
    if (!isSpan(x)) return bad('each end is clip seconds or a span of the words with a start and an end (a line or word: ctx.words.get(…))');
    if (!clip) return bad('a span of the words is in video time, and the component was not made while a scene was: make it as a field of the scene or in init()');
    return (end ? x.end : x.start) - clip.start;
  };
  const w: [number, number] = [local(ends[0], false), local(ends[1], true)];
  if (w[1] < w[0]) bad(`its window [${w[0]}, ${w[1]}] in clip seconds ends before it starts`);
  // (a span of words said wholly outside the clip is a line found in another plate, or a clip moved off its words)
  if (clip && ends.some(isSpan) && (w[1] <= 0 || w[0] >= clip.end - clip.start)) bad(`its window [${w[0]}, ${w[1]}] in clip seconds is outside the clip '${clip.id}' (0 to ${clip.end - clip.start}): those words are said before or after it`);
  return w;
}

/** Options every component takes. */
export interface ComponentOptions {
  /** Where it sits, in logical px (each component has a default laid out from W and H). */
  box?: Box;
  /**
   * The seconds of the clip it shows in, [from, to) from the clip's start (default the whole clip). Either end may
   * be a span of the words instead (`ctx.words.get('the tide')`: from its start, to its end), or the whole of `at`.
   */
  at?: At;
  /** Its entrance and exit (false: none). */
  motion?: Motion | false;
  /** CSS added to its layer (its elements' classes are listed with each component). */
  css?: string;
  /** A name for findings (default the component's). */
  label?: string;
}

/** HTML-escaped text. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A CSS colour from a palette key ('accent', 'accentHi') or any CSS colour. */
export const cssColor = (c: string) => (/^[a-z][A-Za-z0-9]*$/.test(c) && !['transparent', 'white', 'black', 'currentcolor', 'inherit'].includes(c.toLowerCase()) ? `var(--${c.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()})` : c);

/**
 * A component drawn from an HTML layer the size of its box. Subclasses give the markup, the CSS and what to
 * update each frame; draw() places the layer with the component's motion.
 */
export abstract class HtmlComponent {
  readonly box: Box;
  readonly layer: HtmlLayer;
  protected opts: ComponentOptions;
  /** `at` in clip seconds (undefined: the whole clip). */
  protected at: [number, number] | undefined;

  constructor(o: ComponentOptions, defaults: { box: Box; html: string; css: string; label: string }) {
    this.opts = o;
    this.at = windowOf(o.at, o.label ?? defaults.label);
    this.box = o.box ?? defaults.box;
    const update: HtmlUpdate = (f) => this.update(f);
    this.layer = new HtmlLayer({ html: defaults.html, css: defaults.css + (o.css ?? ''), width: Math.ceil(this.box.w), height: Math.ceil(this.box.h), update, label: o.label ?? defaults.label });
  }

  /** Once per output frame while the clip shows: bring the markup up to date for f. */
  protected abstract update(f: Frame): void;

  /** The component's window in clip seconds. */
  protected window(f: Frame): [number, number] { return this.at ?? [0, f.end - f.start]; }

  /** Draw it over `out` (call in render(); a component outside its window draws nothing). */
  draw(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, f: Frame, o: { opacity?: number } = {}) {
    const [w0, w1] = this.window(f);
    const m = motionAt(this.opts.motion, f.lt, w0, w1);
    if (!m) return;
    this.layer.draw(renderer, out, { x: this.box.x + m.dx, y: this.box.y + m.dy, scale: m.scale, opacity: m.opacity * (o.opacity ?? 1) });
  }
}
