import { LineBatch } from './lines';
import { LIN, rgba } from './palette';
import { frameIdx, hash, TAU } from './util';

type P2 = { x: number; y: number };

/**
 * Sputtering particles for a spark whose head position over time is `headAt(t)`.
 * Deterministic: particles are born at fixed times (rate per second) with hashed velocities.
 * A rate that changes over time is a function of the birth time with its maximum `rateMax`: particles
 * are then born on the constant rateMax clock and thinned by hash, so each one keeps its identity
 * whatever t it is drawn at (a rate read at the current t would re-time them all from one
 * motion-blur sub-frame to the next).
 * Draws into a 2D LineBatch as short streaks (motion-blurred), additive.
 */
export function sparkParticles(lb: LineBatch, t: number, headAt: (t: number) => P2 | null, o: { rate?: number | ((tb: number) => number); rateMax?: number; life?: number; speed?: number; gravity?: number; intensity?: number; seed?: number; width?: number } = {}) {
  const life = o.life ?? 0.45, speed = o.speed ?? 260, g = o.gravity ?? 520, I = o.intensity ?? 1, seed = o.seed ?? 1;
  const rateAt = typeof o.rate === 'function' ? o.rate : null;
  const rate = rateAt ? o.rateMax! : (o.rate as number | undefined) ?? 90;
  if (!(rate > 0)) return;
  const n0 = Math.floor((t - life) * rate), n1 = Math.floor(t * rate);
  for (let n = n0; n <= n1; n++) {
    const tb = n / rate;
    if (tb > t) continue;
    if (rateAt && hash(n, seed + 3) * rate >= rateAt(tb)) continue;
    const age = t - tb;
    const h = headAt(tb);
    if (!h) continue;
    const a = hash(n, seed) * TAU, sp = speed * (0.25 + hash(n, seed + 1) ** 2 * 1.2);
    const lf = life * (0.35 + 0.65 * hash(n, seed + 2));
    if (age > lf) continue;
    const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp - speed * 0.3;
    const x = h.x + vx * age, y = h.y + vy * age + 0.5 * g * age * age;
    const dtb = 0.018;
    const x0 = h.x + vx * Math.max(0, age - dtb), y0 = h.y + vy * Math.max(0, age - dtb) + 0.5 * g * Math.max(0, age - dtb) ** 2;
    const k = 1 - age / lf;
    const heat = k * k;
    const col: [number, number, number] = [
      (LIN.accent![0] + (1 - LIN.accent![0]) * heat) * 2.2 * I,
      (LIN.accent![1] + (0.8 - LIN.accent![1]) * heat) * 2.2 * I,
      (LIN.accent![2] + (0.5 - LIN.accent![2]) * heat) * 2.2 * I,
    ];
    lb.seg2(x0, y0, x, y, (o.width ?? 1.6) * (0.5 + k * 0.7), col, Math.min(1, k * 1.4));
  }
}

export function sparkHead(lb: LineBatch, x: number, y: number, t: number, scale = 1, intensity = 1) {
  const flick = 0.85 + 0.15 * Math.sin(t * 91.7) * Math.sin(t * 57.3);
  const I = intensity * flick;
  lb.seg2(x, y, x + 0.01, y, 26 * scale, [LIN.accent![0] * 0.5 * I, LIN.accent![1] * 0.5 * I, LIN.accent![2] * 0.5 * I], 0.35);
  lb.seg2(x, y, x + 0.01, y, 12 * scale, [LIN.accentHi![0] * 2.5 * I, LIN.accentHi![1] * 2.5 * I, LIN.accentHi![2] * 2.5 * I], 0.8);
  lb.seg2(x, y, x + 0.01, y, 5 * scale, [6 * I, 5 * I, 4 * I], 1);
  for (let i = 0; i < 4; i++) {
    const a = i * (TAU / 4) + t * 3 + 0.4;
    const r = (9 + 5 * hash(frameIdx(t) >> 1, i)) * scale;
    lb.seg2(x, y, x + Math.cos(a) * r, y + Math.sin(a) * r, 1.2 * scale, [3 * I, 1.2 * I, 0.4 * I], 0.8);
  }
}

export function sparkHead2D(c: CanvasRenderingContext2D, x: number, y: number, t: number, scale = 1) {
  const g = c.createRadialGradient(x, y, 0, x, y, 22 * scale);
  g.addColorStop(0, 'rgba(255,250,240,1)');
  g.addColorStop(0.18, 'rgba(255,170,90,0.95)');
  g.addColorStop(0.45, rgba('accent', 0.45));
  g.addColorStop(1, rgba('accent', 0));
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, 22 * scale, 0, TAU); c.fill();
}
