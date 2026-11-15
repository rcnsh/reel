import { afterAll, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describeDiff, diffImages, downscale, encodePng, readPng, type Img } from '../cli/png';
import { freeName, spaced, stillName } from '../cli/ops';
import { removeTempDirs, tempDir } from './helpers';

afterAll(removeTempDirs);

const img = (w: number, h: number, f: (x: number, y: number) => number[]): Img => {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...f(x, y), 255], (y * w + x) * 4);
  return { width: w, height: h, data };
};

test('PNG round trip', () => {
  const dir = tempDir('reel-png-');
  const a = img(7, 5, (x, y) => [x * 30, y * 50, 99]);
  writeFileSync(path.join(dir, 'a.png'), encodePng(a));
  expect(readPng(path.join(dir, 'a.png'))).toEqual(a);
  expect(() => readPng(path.join(dir, 'missing.png'))).toThrow('not a PNG that can be read');
});

test('diff: identical, a changed patch, a size mismatch', () => {
  const a = img(20, 10, () => [50, 50, 50]);
  expect(diffImages(a, a).stats).toMatchObject({ changed: 0, max: 0, mean: 0, box: null });
  expect(describeDiff(diffImages(a, a).stats)).toBe('identical (20x10)');
  const b = img(20, 10, (x, y) => (x >= 4 && x < 8 && y >= 2 && y < 5 ? [80, 50, 50] : [50, 50, 50]));
  const { stats, image } = diffImages(a, b);
  expect(stats).toMatchObject({ changed: 12, max: 30, box: [4, 2, 4, 3] });
  expect(stats.fraction).toBeCloseTo(12 / 200, 9);
  expect(stats.mean).toBeCloseTo((12 * 30) / 200, 4);
  expect(image.data[(3 * 20 + 5) * 4]).toBeGreaterThan(140); // changed pixels are red
  expect(diffImages(a, b, 30).stats.changed).toBe(0); // within the tolerance
  expect(() => diffImages(a, img(10, 10, () => [0, 0, 0]))).toThrow('differ in size');
});

test('downscale averages and keeps the aspect', () => {
  const a = img(40, 20, (x) => (x % 2 ? [255, 255, 255] : [0, 0, 0]));
  const s = downscale(a, 10);
  expect([s.width, s.height]).toEqual([10, 5]);
  expect(s.data[0]).toBeCloseTo(128, -1);
  expect(downscale(a, 100)).toBe(a);
});

test('still names and free names', () => {
  expect(stillName(['hello'], 2.5)).toBe('hello_2.500s');
  expect(stillName(['dawn', 'title', 'overlay'], 1)).toBe('dawn+title_1.000s');
  expect(stillName(['overlay'], 1)).toBe('overlay_1.000s');
  expect(stillName([], 9)).toBe('nothing_9.000s');
  expect(stillName(['a b/c'], 0)).toBe('a-b-c_0.000s');
  const dir = tempDir('reel-names-');
  const f1 = freeName(dir, 'x');
  writeFileSync(f1, '');
  const f2 = freeName(dir, 'x');
  writeFileSync(f2, '');
  expect([path.basename(f1), path.basename(f2), path.basename(freeName(dir, 'x'))]).toEqual(['x.png', 'x-2.png', 'x-3.png']);
  expect(spaced(0, 1, 3)).toEqual([0, 0.5, 1]);
  expect(spaced(2, 4, 1)).toEqual([2]);
});
