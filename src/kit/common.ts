// What every kit component shares: a box in logical px, a window of the clip it shows in, an entrance and exit
// drawn in GL (evaluated per sub-frame, so they get motion blur), values that may be functions of the frame, and
// an HTML layer the size of its box.
import type * as THREE from 'three';
import { HtmlLayer, type HtmlUpdate } from '../engine/html';
import { H, W } from '../engine/gl';
import type { Frame } from '../engine/scene';
import { clamp, ease, prog } from '../engine/util';

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
/** The kit's line width (a chart's line, a drawn path, an arrow): 0.5% of the short side, at least 3 px. */
export const lineWidth = () => Math.max(3, Math.round(UNIT * 0.005));

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

/** Options every component takes. */
export interface ComponentOptions {
  /** Where it sits, in logical px (each component has a default laid out from W and H). */
  box?: Box;
  /** The seconds of the clip it shows in, [from, to) from the clip's start (default the whole clip). */
  at?: [number, number];
  /** Its entrance and exit (false: none). */
  motion?: Motion | false;
  /** CSS added to its layer (its elements' classes are listed with each component). */
  css?: string;
  /** A name for findings (default the component's). */
  label?: string;
}

/** A text's graphemes: what a reader counts as one character (an emoji, a letter and its accent). */
export const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((g) => g.segment);

/** Options of a component that grows, draws or counts as a progress value runs from 0 to 1. */
export interface ProgressOptions extends ComponentOptions {
  /** 0 to 1: how far it has grown (default: over the first 1.4 s of its window, eased out). */
  progress?: Anim<number>;
}

/** A component's progress at f: its own, or by default 0 to 1 over 1.4 s from 0.2 s into its window, eased out. */
export function progressOf(o: ProgressOptions, f: Frame) {
  if (o.progress !== undefined) return clamp(val(o.progress, f));
  const w0 = o.at?.[0] ?? 0;
  return prog(f.lt, w0 + 0.2, w0 + 1.6, ease.outCubic);
}

/** HTML-escaped text. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A CSS colour from a palette key ('accent', 'accentHi') or any CSS colour. */
export const cssColor = (c: string) => (/^[a-z][A-Za-z0-9]*$/.test(c) && !['transparent', 'white', 'black', 'currentcolor', 'inherit', 'none'].includes(c.toLowerCase()) ? `var(--${c.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()})` : c);

/**
 * A component drawn from an HTML layer the size of its box. Subclasses give the markup, the CSS and what to
 * update each frame; draw() places the layer with the component's motion.
 */
export abstract class HtmlComponent {
  readonly box: Box;
  readonly layer: HtmlLayer;
  protected opts: ComponentOptions;

  /** Px the layer reaches past the box on each side (for strokes and caps drawn on the box's edge). */
  protected readonly pad: number;

  /** `pad`: the layer is that many px larger than the box on each side, the box at its origin (its markup laid out from `pad`). */
  constructor(o: ComponentOptions, defaults: { box: Box; html: string; css: string; label: string; pad?: number }) {
    this.opts = o;
    this.box = o.box ?? defaults.box;
    this.pad = Math.ceil(defaults.pad ?? 0);
    const update: HtmlUpdate = (f) => this.update(f);
    this.layer = new HtmlLayer({ html: defaults.html, css: defaults.css + (o.css ?? ''), width: Math.ceil(this.box.w) + 2 * this.pad, height: Math.ceil(this.box.h) + 2 * this.pad, update, label: o.label ?? defaults.label });
  }

  /** Once per output frame while the clip shows: bring the markup up to date for f. */
  protected abstract update(f: Frame): void;

  /** The component's window in clip seconds. */
  protected window(f: Frame): [number, number] { return this.opts.at ?? [0, f.end - f.start]; }

  /** Draw it over `out` (call in render(); a component outside its window draws nothing). */
  draw(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, f: Frame, o: { opacity?: number } = {}) {
    const [w0, w1] = this.window(f);
    const m = motionAt(this.opts.motion, f.lt, w0, w1);
    if (!m) return;
    this.layer.draw(renderer, out, { x: this.box.x - this.pad + m.dx, y: this.box.y - this.pad + m.dy, scale: m.scale, opacity: m.opacity * (o.opacity ?? 1) });
  }
}
