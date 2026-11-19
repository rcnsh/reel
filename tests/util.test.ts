import { describe, expect, test } from 'bun:test';
import { clamp, ease, frameIdx, hash, hexToLinear, keys, lerp, mulberry32, noise1, pointAtLength, polylineLengths, prog, pulse, remap, smoothstep, springStep, window01 } from '../src/engine/util';

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
    // an empty range is a step at a
    expect(prog(1.9, 2, 2)).toBe(0);
    expect(prog(2, 2, 2)).toBe(1);
    expect(prog(3, 2, 2, ease.outCubic)).toBe(1);
    expect(window01(0, 1, 3)).toBe(0);
    expect(window01(2, 1, 3)).toBe(1);
    expect(window01(3, 1, 3)).toBe(0);
    const k: [number, number, ((t: number) => number)?][] = [[0, 0], [1, 10, ease.linear], [2, 0]];
    expect(keys(-1, k)).toBe(0);
    expect(keys(0.5, k)).toBe(5);
    expect(keys(1.5, k)).toBe(5); // inOutCubic at the midpoint
    expect(keys(9, k)).toBe(0);
    expect(keys(1, [])).toBe(0);
    // two keys at one time: a step; out of order: an error naming the keys
    expect(keys(0.99, [[0, 0], [1, 0], [1, 10], [2, 10]])).toBe(0);
    expect(keys(1.01, [[0, 0], [1, 0], [1, 10], [2, 10]])).toBe(10);
    expect(() => keys(3, [[0, 0], [2, 1], [1, 5]])).toThrow('keys: key 2 at 1 comes before key 1 at 2');
    expect(() => keys(3, [[0, 0], [NaN, 1]])).toThrow('keys: key 1 has no time (NaN)');
  });

  test('springStep and pulse', () => {
    expect(springStep(0)).toBe(0);
    expect(springStep(10)).toBeCloseTo(1, 3);
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => springStep(i / 100)))).toBeGreaterThan(1); // overshoots
    expect(pulse(1, 2)).toBe(0);
    expect(pulse(2, 2)).toBe(1);
    expect(pulse(2.12, 2, 0.12)).toBeCloseTo(0.5, 9);
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
