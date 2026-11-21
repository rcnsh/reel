import { describe, expect, test } from 'bun:test';
import { TAU, clamp, cubicBezier, linearToHex, ease, frameIdx, hash, hexToLinear, interpolate, keys, lerp, mulberry32, noise1, pointAtLength, polylineLengths, prog, pulse, remap, smoothstep, spring, springSettleTime, springStep, window01 } from '../src/engine/util';
import { LIN, mixColor } from '../src/engine/palette';

describe('util', () => {
  test('clamp, lerp, remap, smoothstep', () => {
    expect(clamp(-1)).toBe(0);
    expect(clamp(2, 0, 1.5)).toBe(1.5);
    expect(lerp(2, 4, 0.25)).toBe(2.5);
    expect(remap(5, 0, 10, 100, 200)).toBe(150);
    expect(remap(20, 0, 10, 100, 200)).toBe(200);
    expect(remap(20, 0, 10, 100, 200, false)).toBe(300);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, -1)).toBe(0);
  });

  test('every ease runs 0 to 1', () => {
    for (const [name, f] of Object.entries(ease)) {
      expect(f(0)).toBeCloseTo(0, 6);
      expect(f(1)).toBeCloseTo(1, 6);
      if (!/Back|Elastic/.test(name)) for (let t = 0; t <= 1; t += 0.05) { expect(f(t)).toBeGreaterThanOrEqual(-1e-9); expect(f(t)).toBeLessThanOrEqual(1 + 1e-9); }
    }
  });

  test('prog, window01, keys', () => {
    expect(prog(5, 0, 10)).toBe(0.5);
    expect(prog(-5, 0, 10)).toBe(0);
    expect(prog(5, 0, 10, ease.inQuad)).toBe(0.25);
    expect(prog(1.9, 2, 2)).toBe(0);
    expect(prog(2, 2, 2)).toBe(1);
    expect(prog(3, 2, 2, ease.outCubic)).toBe(1);
    expect(window01(0, 1, 3)).toBe(0);
    expect(window01(2, 1, 3)).toBe(1);
    expect(window01(3, 1, 3)).toBe(0);
    const k: [number, number, ((t: number) => number)?][] = [[0, 0], [1, 10, ease.linear], [2, 0]];
    expect(keys(-1, k)).toBe(0);
    expect(keys(0.5, k)).toBe(5);
    expect(keys(1.5, k)).toBe(5);
    expect(keys(9, k)).toBe(0);
    expect(keys(1, [])).toBe(0);
    expect(keys(0.99, [[0, 0], [1, 0], [1, 10], [2, 10]])).toBe(0);
    expect(keys(1.01, [[0, 0], [1, 0], [1, 10], [2, 10]])).toBe(10);
    expect(() => keys(3, [[0, 0], [2, 1], [1, 5]])).toThrow('keys: key 2 at 1 comes before key 1 at 2');
    expect(() => keys(3, [[0, 0], [NaN, 1]])).toThrow('keys: key 1 has no time (NaN)');
  });

  test('springStep and pulse', () => {
    expect(springStep(0)).toBe(0);
    expect(springStep(10)).toBeCloseTo(1, 3);
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => springStep(i / 100)))).toBeGreaterThan(1);
    expect(pulse(1, 2)).toBe(0);
    expect(pulse(2, 2)).toBe(1);
    expect(pulse(2.12, 2, 0.12)).toBeCloseTo(0.5, 9);
  });

  test('springStep settles at every damping; overshoots only under 1', () => {
    const ts = Array.from({ length: 400 }, (_, i) => i / 100);
    for (const d of [0.2, 0.35, 0.999, 1, 1.001, 1.5, 4]) {
      const v = ts.map((t) => springStep(t, 4, d));
      for (const x of v) expect(Number.isFinite(x)).toBe(true);
      expect(springStep(0, 4, d)).toBe(0);
      expect(springStep(4, 4, d)).toBeCloseTo(1, 3);
      if (d >= 1) {
        for (let i = 1; i < v.length; i++) expect(v[i]!).toBeGreaterThanOrEqual(v[i - 1]! - 1e-12);
        expect(Math.max(...v)).toBeLessThanOrEqual(1);
      } else if (d <= 0.5) expect(Math.max(...v)).toBeGreaterThan(1);
    }
    for (const t of [0.01, 0.05, 0.2]) {
      expect(springStep(t, 4, 0.9999999)).toBeCloseTo(springStep(t, 4, 1), 5);
      expect(springStep(t, 4, 1.0000001)).toBeCloseTo(springStep(t, 4, 1), 5);
    }
    expect(springStep(1e4, 4, 50)).toBeCloseTo(1, 6);
    for (const d of [1, 1.5, 3, 10, 1e6]) {
      expect(springStep(1e-12, 4, d) / 1e-12).toBeCloseTo(TAU * 4, 1);
      expect(springStep(1 / 60, 4, d)).toBeLessThanOrEqual(springStep(1 / 60, 4, 1) + 1e-12);
    }
    expect(springStep(1 / 60, 4, 3)).toBeLessThan(0.4);
    expect(() => springStep(0.1, 4, -0.1)).toThrow('damping must be >= 0');
  });

  test('spring: endpoints, overshoot under critical damping, none at or above it', () => {
    const run = (o: Partial<Parameters<typeof spring>[0]>) => Array.from({ length: 300 }, (_, i) => spring({ t: i / 100, ...o }));
    for (const damping of [10, 20, 60]) {
      expect(spring({ t: 0, damping })).toBe(0);
      expect(spring({ t: -1, damping })).toBe(0);
      expect(spring({ t: 20, damping })).toBeCloseTo(1, 6);
      const v = run({ damping });
      if (damping < 20) expect(Math.max(...v)).toBeGreaterThan(1.1);
      else for (let i = 1; i < v.length; i++) expect(v[i]!).toBeGreaterThanOrEqual(v[i - 1]! - 1e-12);
    }
    const w0 = 10, z = 0.5, w1 = w0 * Math.sqrt(1 - z * z), t = 0.3;
    expect(spring({ t })).toBeCloseTo(1 - Math.exp(-z * w0 * t) * (Math.cos(w1 * t) + ((z * w0) / w1) * Math.sin(w1 * t)), 12);
    expect(spring({ t, damping: 20 })).toBeCloseTo(1 - Math.exp(-w0 * t) * (1 + w0 * t), 12);
    expect(spring({ t: 1, from: 100, to: 200, delay: 1 })).toBe(100);
    expect(spring({ t: 30, from: 100, to: 200, delay: 1 })).toBeCloseTo(200, 6);
    expect(spring({ t: 1.3, from: 100, to: 200, delay: 1 })).toBeCloseTo(100 + 100 * spring({ t: 0.3 }), 9);
    expect(spring({ t: 0.77, damping: 3 })).toBe(spring({ t: 0.77, damping: 3 }));
    expect(() => spring({ t: 0, mass: 0 })).toThrow('mass and stiffness');
    expect(() => spring({ t: 0, damping: 0, duration: 1 })).toThrow('never settles');
  });

  test('spring: duration stretches it to settle then', () => {
    for (const damping of [5, 10, 20, 60]) {
      const T = springSettleTime(1, 100, damping);
      for (let t = T; t < T * 3; t += T / 50) expect(Math.abs(1 - spring({ t, damping }))).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(1 - spring({ t: T * 0.999, damping }))).toBeGreaterThan(0.005 - 1e-4);
      for (const d of [0.5, 2]) {
        expect(spring({ t: d, damping, duration: d })).toBeCloseTo(spring({ t: T, damping }), 9);
        expect(spring({ t: d / 2, damping, duration: d })).toBeCloseTo(spring({ t: T / 2, damping }), 9);
      }
    }
    for (const damping of [0.02, 0.05, 0.3]) {
      const T = springSettleTime(1, 100, damping), period = (2 * Math.PI) / 10;
      for (let t = T; t < T + 3 * period; t += period / 400) expect(Math.abs(1 - spring({ t, damping }))).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(1 - spring({ t: T - 1e-6, damping }))).toBeGreaterThan(0.005);
    }
    expect(() => springSettleTime(1, 100, 0)).toThrow('never settles');
    expect(springSettleTime(1, 100, 1e9) / ((Math.log(200) * 1e9) / 100)).toBeCloseTo(1, 3);
    expect(springSettleTime(1, 100, 20)).toBeGreaterThan(0.7);
    expect(springSettleTime(1, 100, 20)).toBeLessThan(0.75);
  });

  test('every ease family, in, out and inOut', () => {
    for (const fam of ['Sine', 'Quad', 'Cubic', 'Quart', 'Quint', 'Expo', 'Circ', 'Back', 'Elastic', 'Bounce']) {
      for (const k of ['in', 'out', 'inOut']) expect(typeof (ease as Record<string, unknown>)[k + fam]).toBe('function');
      const e = ease as unknown as Record<string, (t: number) => number>;
      for (const t of [0.1, 0.3, 0.6]) {
        expect(e['out' + fam]!(t)).toBeCloseTo(1 - e['in' + fam]!(1 - t), 9);
        expect(e['inOut' + fam]!(t)).toBeCloseTo(1 - e['inOut' + fam]!(1 - t), 9);
      }
      expect(e['inOut' + fam]!(0.5)).toBeCloseTo(0.5, 9);
    }
    expect(ease.outBounce(0.5)).toBeCloseTo(0.765625, 9);
    expect(ease.inOutBack(0.25)).toBeCloseTo(-0.0996818, 6);
  });

  test('cubicBezier matches Chrome', () => {
    const ref: [number[], number[]][] = [
      [[0.25, 0.1, 0.25, 1], [0.09479630571576989, 0.4085105913555371, 0.8024033910598437, 0.9604589783649767, 0.9943164774961483]],
      [[0.42, 0, 1, 1], [0.017026631752235472, 0.0934646510311063, 0.31535673426536154, 0.621861869174206, 0.839427844517541]],
      [[0, 0, 0.58, 1], [0.16057215548245898, 0.378138130825794, 0.6846432657346383, 0.9065353489688935, 0.9829733682477645]],
      [[0.42, 0, 0.58, 1], [0.019722453548276987, 0.129161931047288, 0.5, 0.8708380689527122, 0.9802775464517232]],
      [[0.68, -0.55, 0.265, 1.55], [-0.06629147596609188, -0.08280711019239485, 0.6066798972541555, 1.0891657755583135, 1.0623731939374257]],
      [[0.1, 0.9, 0.2, 1], [0.5852730721595231, 0.8494695047568054, 0.9662364339104639, 0.9949325787043688, 0.9993812375595585]],
    ];
    for (const [c, ys] of ref) {
      const f = cubicBezier(c[0]!, c[1]!, c[2]!, c[3]!);
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      [0.1, 0.25, 0.5, 0.75, 0.9].forEach((x, i) => expect(f(x)).toBeCloseTo(ys[i]!, 6));
    }
    const e = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(e(-1)).toBeCloseTo(-0.4, 12);
    expect(e(2)).toBe(1);
    expect(cubicBezier(0.3, 0.3, 0.7, 0.7)(0.37)).toBe(0.37);
    expect(() => cubicBezier(-0.1, 0, 1, 1)).toThrow('x1 and x2');
  });

  test('interpolate: segments, easing and extrapolation', () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50);
    expect(interpolate(15, [0, 10, 20], [0, 100, 0])).toBe(50);
    expect(interpolate(5, [0, 10], [0, 100], { easing: ease.inQuad })).toBe(25);
    expect(interpolate(-5, [0, 10, 20], [0, 100, 0])).toBe(-50);
    expect(interpolate(25, [0, 10, 20], [0, 100, 0])).toBe(-50);
    expect(interpolate(20, [0, 10], [0, 100], { easing: ease.inQuad })).toBe(400);
    expect(interpolate(-5, [0, 10], [50, 100], { extrapolateLeft: 'clamp' })).toBe(50);
    expect(interpolate(25, [0, 10], [50, 100], { extrapolateRight: 'clamp' })).toBe(100);
    expect(interpolate(25, [0, 10], [50, 100], { extrapolateLeft: 'clamp' })).toBe(175);
    expect(interpolate(-5, [0, 10], [50, 100], { extrapolateLeft: 'identity' })).toBe(-5);
    expect(interpolate(25, [0, 10], [50, 100], { extrapolateRight: 'identity' })).toBe(25);
    expect(interpolate(10, [0, 10], [50, 100], { extrapolateRight: 'identity' })).toBe(100);
    expect(interpolate(Infinity, [0, 1], [1, 1])).toBe(1);
    expect(() => interpolate(0, [0, 0], [1, 2])).toThrow('strictly increasing');
    expect(() => interpolate(0, [0, 1], [1])).toThrow('same length');
  });

  test('mixColor mixes in linear light', () => {
    const m = mixColor('#000000', '#ffffff', 0.5);
    expect(m.lin).toEqual([0.5, 0.5, 0.5]);
    expect(m.hex).toBe('#bcbcbc');
    expect(m.rgba(0.4)).toBe('rgba(188,188,188,0.4)');
    expect(mixColor('#ff0000', [0, 0, 1], 0).hex).toBe('#ff0000');
    expect(mixColor('#ff0000', [0, 0, 1], 2).hex).toBe('#0000ff');
    expect(mixColor('bg', 'fg', 0).lin).toEqual(LIN.bg!);
    expect(mixColor('bg', 'fg', 1).lin).toEqual(LIN.fg!);
    expect(mixColor('accent', 'accent', 0.3).hex.toLowerCase()).toBe(mixColor('accent', 'accent', 0.9).hex.toLowerCase());
    expect(() => mixColor('nope', 'bg', 0.5)).toThrow("has no 'nope'");
    expect(() => mixColor('#fff', 'bg', 0.5)).toThrow("'#fff' is not a #rrggbb colour");
    expect(() => mixColor('bg', 'fg', NaN)).toThrow('NaN in the mix');
    expect(linearToHex(hexToLinear('#3a7bd5'))).toBe('#3a7bd5');
    expect(linearToHex([2, -1, 0.5])).toBe('#ff00bc');
  });

  test('randomness is seeded and repeatable', () => {
    const a = mulberry32(7), b = mulberry32(7);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()));
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    expect(hash(1, 2)).toBe(hash(1, 2));
    expect(hash(1, 2)).not.toBe(hash(2, 1));
    expect(noise1(3)).toBeCloseTo(noise1(3), 12);
    expect(Math.abs(noise1(3.3))).toBeLessThanOrEqual(1);
  });

  test('frameIdx holds across a frame (60 fps under bun)', () => {
    expect(frameIdx(1)).toBe(60);
    expect(frameIdx(1 + 0.4 / 60)).toBe(60);
    expect(frameIdx(1 - 0.4 / 60)).toBe(60);
  });

  test('polyline lengths and points', () => {
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }];
    const L = polylineLengths(pts);
    expect([...L]).toEqual([0, 5, 11]);
    expect(pointAtLength(pts, L, 8)).toMatchObject({ x: 3, y: 7 });
    expect(pointAtLength(pts, L, 99)).toMatchObject({ x: 3, y: 10 });
  });

  test('hexToLinear', () => {
    expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
    expect(hexToLinear('#FFFFFF')).toEqual([1, 1, 1]);
    expect(hexToLinear('#808080')[0]).toBeCloseTo(0.2158, 3);
  });
});
