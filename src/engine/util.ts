// Small math / animation helpers shared by every scene. Everything must be a
// pure function of time (or seeded), so frames render identically on export.
import { FPS } from './format';
import type { SoundClip } from '../config';

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, x: number) => (a === b ? 0 : (x - a) / (b - a));
export const remap = (x: number, a: number, b: number, c: number, d: number, clampIt = true) => {
  const t = invLerp(a, b, x);
  return lerp(c, d, clampIt ? clamp(t) : t);
};
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const fract = (x: number) => x - Math.floor(x);
export const mod = (x: number, m: number) => ((x % m) + m) % m;
export const TAU = Math.PI * 2;

/** Window: 0 before a, ramps up over `fadeIn`, holds, ramps down over `fadeOut` ending at b. */
export const window01 = (x: number, a: number, b: number, fadeIn = 0.2, fadeOut = 0.2) =>
  Math.min(smoothstep(a, a + fadeIn, x), 1 - smoothstep(b - fadeOut, b, x));

// ---- easing (t in 0..1) ----
const C1 = 1.70158, C2 = C1 * 1.525, E3 = (2 * Math.PI) / 3, E45 = (2 * Math.PI) / 4.5;
const outBounce = (t: number) => {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};
/** The easings.net families: `in`, `out`, `inOut` × Sine Quad Cubic Quart Quint Expo Circ Back Elastic Bounce. */
export const ease = {
  linear: (t: number) => t,
  inSine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t: number) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuart: (t: number) => t * t * t * t,
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  inQuint: (t: number) => t * t * t * t * t,
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
  inOutQuint: (t: number) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2),
  inExpo: (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t: number) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  inCirc: (t: number) => 1 - Math.sqrt(1 - Math.pow(clamp(t), 2)),
  outCirc: (t: number) => Math.sqrt(1 - Math.pow(clamp(t) - 1, 2)),
  inOutCirc: (t: number) => {
    t = clamp(t);
    return t < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;
  },
  inBack: (t: number, s = C1) => (s + 1) * t * t * t - s * t * t,
  outBack: (t: number, s = C1) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  inOutBack: (t: number, s = C2) =>
    t < 0.5
      ? (Math.pow(2 * t, 2) * ((s + 1) * 2 * t - s)) / 2
      : (Math.pow(2 * t - 2, 2) * ((s + 1) * (t * 2 - 2) + s) + 2) / 2,
  inElastic: (t: number) =>
    t <= 0 ? 0 : t >= 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * E3),
  outElastic: (t: number) =>
    t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * E3) + 1,
  inOutElastic: (t: number) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5
      ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * E45)) / 2
      : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * E45)) / 2 + 1,
  inBounce: (t: number) => 1 - outBounce(1 - t),
  outBounce,
  inOutBounce: (t: number) => (t < 0.5 ? (1 - outBounce(1 - 2 * t)) / 2 : (1 + outBounce(2 * t - 1)) / 2),
};

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)` as an easing: the curve from (0, 0) to (1, 1), solved for y at x the way browsers
 * do (Newton's method, then bisection). Outside 0..1 it continues along the end tangents, as CSS does. x1 and x2
 * must lie in 0..1.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  if (!(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1)) throw new Error(`cubicBezier: x1 and x2 must be in 0..1 (got ${x1}, ${x2})`);
  if (x1 === y1 && x2 === y2) return (t) => t;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  const solve = (x: number) => {
    let u = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(u) - x;
      if (Math.abs(e) < 1e-7) return u;
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= e / d;
    }
    let lo = 0, hi = 1;
    u = x;
    while (lo < hi) {
      const v = sx(u);
      if (Math.abs(v - x) < 1e-7) return u;
      if (x > v) lo = u; else hi = u;
      const next = (lo + hi) / 2;
      if (next === u) break;
      u = next;
    }
    return u;
  };
  // the end tangents, for x outside 0..1 (what Chromium's gfx::CubicBezier does)
  const startSlope = x1 > 0 ? y1 / x1 : y1 === 0 && x2 > 0 ? y2 / x2 : y1 === 0 && y2 === 0 ? 1 : 0;
  const endSlope = x2 < 1 ? (y2 - 1) / (x2 - 1) : y2 === 1 && x1 < 1 ? (y1 - 1) / (x1 - 1) : y2 === 1 && y1 === 1 ? 1 : 0;
  return (t: number) => {
    if (t <= 0) return t < 0 ? t * startSlope : 0;
    if (t >= 1) return t > 1 ? 1 + (t - 1) * endSlope : 1;
    return sy(solve(t));
  };
}

/** Clamped eased progress of x through [a, b]. */
export const prog = (x: number, a: number, b: number, fn: (t: number) => number = ease.linear) =>
  fn(clamp((x - a) / (b - a)));

export type Extrapolate = 'clamp' | 'extend' | 'identity';
/**
 * Map x through a piecewise-linear curve: `input` (strictly increasing) to `output`, the same length, with `easing`
 * shaping each segment. Outside the input range, `extrapolateLeft`/`extrapolateRight`: `extend` (the default)
 * continues the end segment, `clamp` holds the end value, `identity` returns x.
 */
export function interpolate(
  x: number,
  input: readonly number[],
  output: readonly number[],
  opts: { easing?: (t: number) => number; extrapolateLeft?: Extrapolate; extrapolateRight?: Extrapolate } = {},
): number {
  const n = input.length;
  if (n < 2 || output.length !== n) throw new Error(`interpolate: input and output need the same length, at least 2 (got ${n} and ${output.length})`);
  for (let i = 1; i < n; i++) {
    if (!(input[i]! > input[i - 1]!)) throw new Error(`interpolate: input must be strictly increasing (got ${input.join(', ')})`);
  }
  if (Number.isNaN(x)) return x;
  const easing = opts.easing ?? ease.linear;
  if (x < input[0]!) {
    const mode = opts.extrapolateLeft ?? 'extend';
    if (mode === 'identity') return x;
    if (mode === 'clamp') return output[0]!;
  } else if (x > input[n - 1]!) {
    const mode = opts.extrapolateRight ?? 'extend';
    if (mode === 'identity') return x;
    if (mode === 'clamp') return output[n - 1]!;
  }
  let i = 1;
  while (i < n - 1 && x > input[i]!) i++;
  const a = input[i - 1]!, b = input[i]!, lo = output[i - 1]!, hi = output[i]!;
  return lo === hi ? lo : lerp(lo, hi, easing((x - a) / (b - a)));
}

/**
 * A spring-like response to a step at time 0 (0 -> 1), ringing at `freq` Hz. `damping` (>= 0) sets how fast it
 * decays: under 1 it overshoots, at 1 and over it does not. It leaves 0 already moving; `spring()` is the physical
 * spring, which starts at rest.
 */
export const springStep = (t: number, freq = 4, damping = 0.35) => {
  if (!(damping >= 0)) throw new Error(`springStep: damping must be >= 0 (got ${damping})`);
  if (t <= 0) return 0;
  const w = TAU * freq;
  if (damping < 1) return 1 - Math.exp(-damping * w * t) * Math.cos(w * Math.sqrt(1 - damping * damping) * t);
  // past 1: a slow and a fast decay, weighted so it leaves 0 at the speed it has at damping 1 (w), which keeps the
  // curve continuous in damping and stops a heavy damping from jumping half way at once
  const s = w * Math.sqrt(damping * damping - 1);
  const a = (1 + Math.sqrt((damping - 1) / (damping + 1))) / 2;
  return 1 - a * Math.exp((-(w * w) / (damping * w + s)) * t) - (1 - a) * Math.exp(-(s + damping * w) * t);
};

/** A mass on a spring released from 0 towards 1 at rest: its exact position at time t (seconds). */
function springAt(t: number, mass: number, stiffness: number, damping: number) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass));
  if (Math.abs(z - 1) < 1e-6) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  if (z < 1) {
    const w1 = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(w1 * t) + ((z * w0) / w1) * Math.sin(w1 * t));
  }
  // s - ζω0 written as -ω0²/(ζω0 + s), which keeps its precision at high damping
  const s = w0 * Math.sqrt(z * z - 1), k = (z * w0) / s;
  const a = Math.exp((-(w0 * w0) / (z * w0 + s)) * t), b = Math.exp(-(s + z * w0) * t);
  return 1 - ((a + b) / 2 + (k * (a - b)) / 2);
}

const SETTLE = 0.005;
const settled = new Map<string, number>();
/** When a spring last strays more than 0.5% of the way from its target, in seconds: what `spring`'s `duration` stretches. */
export function springSettleTime(mass = 1, stiffness = 100, damping = 10): number {
  if (!(mass > 0 && stiffness > 0 && damping > 0)) throw new Error(`springSettleTime: mass, stiffness and damping must be > 0 (got ${mass}, ${stiffness}, ${damping}); an undamped spring never settles`);
  const key = `${mass},${stiffness},${damping}`, known = settled.get(key);
  if (known !== undefined) return known;
  const off = (t: number) => Math.abs(1 - springAt(t, mass, stiffness, damping)) > SETTLE;
  const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass));
  // an interval [lo, hi] where it is off at lo and settled from hi on, with one crossing between
  let lo = 0, hi: number;
  if (z < 1 - 1e-6) {
    // it rings: the distance from the target peaks at t = kπ/ω1 with height e^(-ζω0 t) and falls to 0 between peaks,
    // so the crossing follows the last peak above the threshold, before the next one
    const w1 = w0 * Math.sqrt(1 - z * z), k = Math.max(0, Math.ceil((Math.log(1 / SETTLE) * w1) / (z * w0 * Math.PI)) - 1);
    lo = (k * Math.PI) / w1;
    hi = ((k + 1) * Math.PI) / w1;
  } else {
    // no overshoot: the distance falls monotonically
    hi = 1 / w0;
    while (off(hi)) { lo = hi; hi *= 2; }
  }
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (off(m)) lo = m; else hi = m; }
  if (settled.size >= 256) settled.clear();
  settled.set(key, hi);
  return hi;
}

/**
 * A physical spring (Remotion's `spring()`, in seconds): `from` to `to` starting at `delay`, the exact solution for a
 * mass, stiffness and damping (defaults 1, 100, 10), so any damping works and the value is a pure function of t.
 * `duration` stretches time so the spring settles (within 0.5%) exactly then.
 */
export function spring(o: {
  t: number; mass?: number; stiffness?: number; damping?: number; from?: number; to?: number; delay?: number; duration?: number;
}): number {
  const { mass = 1, stiffness = 100, damping = 10, from = 0, to = 1, delay = 0, duration } = o;
  if (!(mass > 0 && stiffness > 0 && damping >= 0)) throw new Error(`spring: mass and stiffness must be > 0 and damping >= 0 (got ${mass}, ${stiffness}, ${damping})`);
  if (damping === 0 && duration !== undefined) throw new Error('spring: an undamped spring never settles, so it cannot have a duration');
  if (duration !== undefined && !(duration > 0)) throw new Error(`spring: duration must be > 0 (got ${duration})`);
  let t = o.t - delay;
  if (duration !== undefined) t *= springSettleTime(mass, stiffness, damping) / duration;
  return lerp(from, to, springAt(t, mass, stiffness, damping));
}

/** Exponential decay pulse after an event at time `t0` (1 at t0, fades with half-life `hl`). */
export const pulse = (t: number, t0: number, hl = 0.12) => (t < t0 ? 0 : Math.pow(0.5, (t - t0) / hl));

// ---- deterministic randomness ----
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/**
 * Index of the output frame nearest t, for per-frame jitter/flicker. Constant over a frame's whole
 * motion-blur shutter, so each frame shows one state (Math.floor(t * FPS) switches at the frame's own time,
 * blending two states in every frame).
 */
export const frameIdx = (t: number) => Math.round(t * FPS);

/** Stateless hash of integers/floats to [0,1). */
export function hash(...xs: number[]) {
  let h = 2166136261 >>> 0;
  for (const x of xs) {
    h ^= Math.floor(x * 1000003) | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

// ---- value noise (1D/2D/3D), cheap & deterministic, for CPU-side motion ----
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
export function noise1(x: number, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  return lerp(hash(i, seed) * 2 - 1, hash(i + 1, seed) * 2 - 1, fade(f));
}
export function noise2(x: number, y: number, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = fade(x - ix), fy = fade(y - iy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy) * 2 - 1;
}
export function noise3(x: number, y: number, z: number, seed = 0) {
  const iz = Math.floor(z);
  const fz = fade(z - iz);
  return lerp(noise2(x + iz * 17.13, y - iz * 31.7, seed), noise2(x + (iz + 1) * 17.13, y - (iz + 1) * 31.7, seed), fz);
}
export function fbm1(x: number, oct = 4, seed = 0) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise1(x * f, seed + i * 7); f *= 2; a *= 0.5; }
  return s;
}
export function fbm2(x: number, y: number, oct = 4, seed = 0) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f, seed + i * 7); f *= 2; a *= 0.5; }
  return s;
}

// ---- keyframes ----
export type Key = [time: number, value: number, easeFn?: (t: number) => number];
/** Piecewise interpolation through keyframes; the ease on key i shapes the segment ending at key i. */
export function keys(t: number, ks: Key[]): number {
  if (ks.length === 0) return 0;
  if (t <= ks[0]![0]) return ks[0]![1];
  for (let i = 1; i < ks.length; i++) {
    const k = ks[i]!;
    if (t <= k[0]) {
      const p = ks[i - 1]!;
      const u = (t - p[0]) / (k[0] - p[0]);
      return lerp(p[1], k[1], (k[2] ?? ease.inOutCubic)(u));
    }
  }
  return ks[ks.length - 1]![1];
}

export const vec2 = (x = 0, y = 0) => ({ x, y });
export type V2 = { x: number; y: number };
export const dist = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Polyline helpers: cumulative arc lengths & point-at-length (used for text on paths, reveals). */
export function polylineLengths(pts: V2[]) {
  const L = new Float32Array(pts.length);
  for (let i = 1; i < pts.length; i++) L[i] = L[i - 1]! + dist(pts[i - 1]!, pts[i]!);
  return L;
}
export function pointAtLength(pts: V2[], L: Float32Array, s: number): { x: number; y: number; angle: number } {
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0, angle: 0 };
  if (n === 1) return { x: pts[0]!.x, y: pts[0]!.y, angle: 0 };
  s = clamp(s, 0, L[n - 1]!);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (L[mid]! < s) lo = mid; else hi = mid; }
  const a = pts[lo]!, b = pts[hi]!;
  const seg = L[hi]! - L[lo]!;
  const u = seg > 0 ? (s - L[lo]!) / seg : 0;
  return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** '#rrggbb' from a linear RGB triplet (applies linear->sRGB; clamps to 0..1). */
export function linearToHex(c: readonly [number, number, number]): string {
  return '#' + c.map((v) => {
    const x = clamp(v);
    return Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)).toString(16).padStart(2, '0');
  }).join('');
}

/** Linear-space color from hex (for GL uniforms; applies sRGB->linear). */
export function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return c as [number, number, number];
}

/**
 * Record a sound cue at time t (a pen tick, a whoosh, a page turn) for the mix: scenes call it from
 * init(), and `reel events` writes every cue to data/cues.json, sorted by time.
 */
export function cue(kind: string, t: number) {
  const g = globalThis as { __reelCues?: { kind: string; t: number }[] };
  (g.__reelCues ??= []).push({ kind, t });
}

/**
 * Put a sound on the timeline for the mix, from a scene's init(): a file of the project from `at` seconds of video
 * time. Like the config's `sounds`; `reel events` writes both to data/cues.json.
 */
export function sound(s: SoundClip) {
  const g = globalThis as { __reelSounds?: SoundClip[] };
  (g.__reelSounds ??= []).push({ ...s });
}
