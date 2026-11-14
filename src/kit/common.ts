// What every kit component shares: a box in logical px, a window of the clip it shows in, an entrance and exit
// drawn in GL (evaluated per sub-frame, so they get motion blur), values that may be functions of the frame, and
// an HTML layer the size of its box.
import type * as THREE from 'three';
import { HtmlLayer, type HtmlUpdate } from '../engine/html';
import { H, W } from '../engine/gl';
import type { Frame } from '../engine/scene';
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

  constructor(o: ComponentOptions, defaults: { box: Box; html: string; css: string; label: string }) {
    this.opts = o;
    this.box = o.box ?? defaults.box;
    const update: HtmlUpdate = (f) => this.update(f);
    this.layer = new HtmlLayer({ html: defaults.html, css: defaults.css + (o.css ?? ''), width: Math.ceil(this.box.w), height: Math.ceil(this.box.h), update, label: o.label ?? defaults.label });
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
    this.layer.draw(renderer, out, { x: this.box.x + m.dx, y: this.box.y + m.dy, scale: m.scale, opacity: m.opacity * (o.opacity ?? 1) });
  }
}
