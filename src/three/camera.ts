import { clamp, ease as easings, lerp } from '../engine/util';

export type Vec3 = [number, number, number];

/**
 * A camera at one moment: its position and the point it looks at (world units; a unit is a metre for the lens
 * maths), and optionally its vertical field of view in degrees, its roll in degrees, and depth of field: `focus`, the
 * distance in focus (default the distance to `target`), with `fstop` (the lens's f-number: the aperture is the focal
 * length over it) or `aperture` (the lens radius in world units). Without either, everything is sharp.
 */
export interface CameraPose { position: Vec3; target: Vec3; fov?: number; roll?: number; focus?: number; fstop?: number; aperture?: number }

export type Rig = (t: number) => CameraPose;

export type Easing = keyof typeof easings | ((x: number) => number);

/** The progress 0..1 of t through `at` ([from, to] seconds; default [0, 1]), eased (default inOutCubic). */
export function progress(t: number, at: [number, number] = [0, 1], e: Easing = 'inOutCubic') {
  const k = clamp((t - at[0]) / Math.max(1e-9, at[1] - at[0]));
  return (typeof e === 'function' ? e : easings[e])(k);
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const mix = (a: Vec3, b: Vec3, k: number): Vec3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const DEG = Math.PI / 180;

interface Common { at?: [number, number]; ease?: Easing; fov?: number; focus?: number; fstop?: number; aperture?: number; roll?: number }
const lens = (o: Common) => ({ ...(o.fov !== undefined ? { fov: o.fov } : {}), ...(o.roll !== undefined ? { roll: o.roll } : {}), ...(o.focus !== undefined ? { focus: o.focus } : {}), ...(o.fstop !== undefined ? { fstop: o.fstop } : {}), ...(o.aperture !== undefined ? { aperture: o.aperture } : {}) });

export function orbit(o: Common & { target?: Vec3; radius: number | [number, number]; height?: number | [number, number]; from?: number; to?: number }): Rig {
  const target = o.target ?? [0, 0, 0];
  return (t) => {
    const k = progress(t, o.at, o.ease ?? 'inOutCubic');
    const a = lerp(o.from ?? 0, o.to ?? 360, k) * DEG;
    const r = typeof o.radius === 'number' ? o.radius : lerp(o.radius[0], o.radius[1], k);
    const h = o.height === undefined ? 0 : typeof o.height === 'number' ? o.height : lerp(o.height[0], o.height[1], k);
    return { position: [target[0] + r * Math.sin(a), target[1] + h, target[2] + r * Math.cos(a)], target, ...lens(o) };
  };
}

/** Move in a straight line from one position to another, looking at `target` (default: where it looks along its path). */
export function dolly(o: Common & { from: Vec3; to: Vec3; target?: Vec3 }): Rig {
  return (t) => {
    const k = progress(t, o.at, o.ease ?? 'inOutCubic'), p = mix(o.from, o.to, k);
    return { position: p, target: o.target ?? add(o.to, sub(o.to, o.from)), ...lens(o) };
  };
}

export function crane(o: Common & { base: Vec3; rise: number; target: Vec3; targetRise?: number }): Rig {
  return (t) => {
    const k = progress(t, o.at, o.ease ?? 'inOutCubic');
    return { position: add(o.base, [0, o.rise * k, 0]), target: add(o.target, [0, (o.targetRise ?? 0) * k, 0]), ...lens(o) };
  };
}

/**
 * Change what a rig looks at over time: keys of [time, point], each move from one key's point to the next eased
 * (default inOutCubic); before the first key it looks at the first point, after the last at the last. The camera's
 * position stays the rig's.
 */
export function lookAt(rig: Rig, keys: [number, Vec3][], e: Easing = 'inOutCubic'): Rig {
  const ks = [...keys].sort((a, b) => a[0] - b[0]);
  if (!ks.length) throw new Error('lookAt: give at least one key');
  return (t) => {
    let target = ks[0]![1];
    for (let i = 1; i < ks.length; i++) {
      const [t0, a] = ks[i - 1]!, [t1, b] = ks[i]!;
      if (t >= t1) { target = b; continue; }
      if (t > t0) target = mix(a, b, progress(t, [t0, t1], e));
      break;
    }
    return { ...rig(t), target };
  };
}

function catmull(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const kt = (a: Vec3, b: Vec3) => Math.max(1e-6, Math.sqrt(len(sub(b, a))));
  const t0 = 0, t1 = t0 + kt(p0, p1), t2 = t1 + kt(p1, p2), t3 = t2 + kt(p2, p3);
  const t = lerp(t1, t2, u);
  const L = (a: Vec3, b: Vec3, ta: number, tb: number) => mix(a, b, (t - ta) / (tb - ta));
  const a1 = L(p0, p1, t0, t1), a2 = L(p1, p2, t1, t2), a3 = L(p2, p3, t2, t3);
  const b1 = L(a1, a2, t0, t2), b2 = L(a2, a3, t1, t3);
  return L(b1, b2, t1, t2);
}

/**
 * A smooth curve through `points` (centripetal Catmull–Rom), travelled at an even speed: `at(s)` for s in 0..1 of
 * its length. `closed` joins the last point back to the first.
 */
export function smoothPath(points: Vec3[], closed = false) {
  if (points.length < 2) throw new Error('smoothPath: give at least two points');
  const n = points.length, P = (i: number) => (closed ? points[((i % n) + n) % n]! : points[clamp(i, 0, n - 1)]!);
  const ext = (i: number): Vec3 => {
    if (closed || (i >= 0 && i < n)) return P(i);
    return i < 0 ? sub(scale(points[0]!, 2), points[1]!) : sub(scale(points[n - 1]!, 2), points[n - 2]!);
  };
  const segs = closed ? n : n - 1, STEPS = 64;
  const table: { s: number; seg: number; u: number }[] = [{ s: 0, seg: 0, u: 0 }];
  let total = 0, prev = points[0]!;
  for (let g = 0; g < segs; g++) for (let j = 1; j <= STEPS; j++) {
    const u = j / STEPS, q = catmull(ext(g - 1), ext(g), ext(g + 1), ext(g + 2), u);
    total += len(sub(q, prev)); prev = q;
    table.push({ s: total, seg: g, u });
  }
  const point = (seg: number, u: number) => catmull(ext(seg - 1), ext(seg), ext(seg + 1), ext(seg + 2), u);
  return {
    length: total,
    at(s: number): Vec3 {
      const d = clamp(s) * total;
      let lo = 0, hi = table.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (table[m]!.s <= d) lo = m; else hi = m; }
      const a = table[lo]!, b = table[hi]!, k = b.s > a.s ? (d - a.s) / (b.s - a.s) : 0;
      const ua = a.seg === b.seg ? a.u : 0;
      return point(b.seg, lerp(ua, b.u, k));
    },
  };
}

/**
 * Travel a smooth curve through `points` at an even speed over `at` (eased), looking at `target`, or, without
 * one, `lookAhead` of the path's length ahead of itself (default 0.05).
 */
export function path(o: Common & { points: Vec3[]; target?: Vec3; lookAhead?: number; closed?: boolean }): Rig {
  const c = smoothPath(o.points, o.closed);
  return (t) => {
    const k = progress(t, o.at, o.ease ?? 'inOutCubic'), position = c.at(k);
    let target = o.target;
    if (!target) {
      const la = o.lookAhead ?? 0.05, q = c.at(Math.min(1, k + la));
      target = len(sub(q, position)) > 1e-6 ? q : add(position, sub(position, c.at(Math.max(0, k - la))));
    }
    return { position, target, ...lens(o) };
  };
}

export function shots(keys: ({ t: number } & CameraPose)[], e: Easing = 'inOutCubic'): Rig {
  const ks = [...keys].sort((a, b) => a.t - b.t);
  if (!ks.length) throw new Error('shots: give at least one key');
  const pts = ks.map((k) => k.position);
  return (t) => {
    if (t <= ks[0]!.t) return { ...ks[0]!, t: undefined } as CameraPose;
    if (t >= ks.at(-1)!.t) return { ...ks.at(-1)!, t: undefined } as CameraPose;
    let i = 0;
    while (t > ks[i + 1]!.t) i++;
    const a = ks[i]!, b = ks[i + 1]!, k = progress(t, [a.t, b.t], e);
    const ext = (j: number): Vec3 => (j < 0 ? sub(scale(pts[0]!, 2), pts[1] ?? pts[0]!) : j >= pts.length ? sub(scale(pts.at(-1)!, 2), pts.at(-2) ?? pts.at(-1)!) : pts[j]!);
    const position = pts.length < 2 ? a.position : catmull(ext(i - 1), ext(i), ext(i + 1), ext(i + 2), k);
    const num = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : lerp(x ?? y!, y ?? x!, k));
    const pose: CameraPose = { position, target: mix(a.target, b.target, k) };
    for (const key of ['fov', 'roll', 'focus', 'fstop', 'aperture'] as const) { const v = num(a[key], b[key]); if (v !== undefined) pose[key] = v; }
    return pose;
  };
}

export const fovOf = (mm: number, sensor = 24) => (2 * Math.atan(sensor / (2 * mm))) / DEG;
export const focalOf = (fov: number, sensor = 24) => sensor / (2 * Math.tan((fov * DEG) / 2));
/** The lens radius in world units (metres) of a lens of `mm` focal length at f-number `fstop`. */
export const apertureOf = (mm: number, fstop: number, unitsPerMetre = 1) => (mm / fstop / 2 / 1000) * unitsPerMetre;
