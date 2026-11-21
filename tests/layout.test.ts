import { describe, expect, test } from 'bun:test';
import { align, anchor, arrowTrack, center, drawShares, grid, inset, pointAlong, split, svgLength, type Box } from '../src/kit';

const B: Box = { x: 100, y: 50, w: 1000, h: 600 };
const close = (a: Box, b: Box) => { for (const k of ['x', 'y', 'w', 'h'] as const) expect(a[k]).toBeCloseTo(b[k], 9); };

describe('layout', () => {
  test('inset: every side, per side, by axis, and never below zero', () => {
    expect(inset(B, 20)).toEqual({ x: 120, y: 70, w: 960, h: 560 });
    expect(inset(B, { left: 10, top: 5 })).toEqual({ x: 110, y: 55, w: 990, h: 595 });
    expect(inset(B, { x: 50, y: 10, bottom: 0 })).toEqual({ x: 150, y: 60, w: 900, h: 590 });
    expect(inset(B, -10)).toEqual({ x: 90, y: 40, w: 1020, h: 620 });
    expect(inset(B, 400)).toEqual({ x: 500, y: 450, w: 200, h: 0 });
  });

  test('split by shares in a row and a column, gaps between the parts only', () => {
    const [a, b] = split(B, 'h', [2, 1], 40);
    close(a!, { x: 100, y: 50, w: 640, h: 600 });
    close(b!, { x: 780, y: 50, w: 320, h: 600 });
    expect(b!.x + b!.w).toBeCloseTo(B.x + B.w, 9);
    const col = split(B, 'v', 3, 30);
    expect(col.map((c) => c.h)).toEqual([180, 180, 180]);
    expect(col.map((c) => c.y)).toEqual([50, 260, 470]);
    expect(split(B, 'h', [1])).toEqual([B]);
    const W = 1920, [chart, note] = split({ x: W * 0.08, y: 0, w: W * 0.86, h: 10 }, 'h', [0.56, 0.26], W * 0.04);
    expect(chart!.w).toBeCloseTo(W * 0.56, 9);
    expect(note!.x).toBeCloseTo(W * 0.68, 9);
    expect(note!.w).toBeCloseTo(W * 0.26, 9);
    expect(() => split(B, 'h', [1, -1])).toThrow(/shares/);
    const tight = split({ x: 0, y: 0, w: 100, h: 50 }, 'h', 3, 80);
    expect(tight.map((p) => p.x)).toEqual([0, 50, 100]);
    expect(tight.map((p) => p.w)).toEqual([0, 0, 0]);
  });

  test('grid: cells row by row, gaps across and down', () => {
    const g = grid(B, 3, 2, [20, 30]);
    expect(g).toHaveLength(6);
    close(g[0]!, { x: 100, y: 50, w: 320, h: 285 });
    close(g[2]!, { x: 780, y: 50, w: 320, h: 285 });
    close(g[4]!, { x: 440, y: 365, w: 320, h: 285 });
  });

  test('align and center place a box of a size inside another', () => {
    expect(center(B, 200, 100)).toEqual({ x: 500, y: 300, w: 200, h: 100 });
    expect(align(B, 200, 100, 'start', 'end')).toEqual({ x: 100, y: 550, w: 200, h: 100 });
    expect(align(B, 200, 100, 'end', 'start')).toEqual({ x: 900, y: 50, w: 200, h: 100 });
  });
});

describe('drawn lines', () => {
  test('drawShares: one stroke draws with progress; several start in order and all finish at 1', () => {
    expect(drawShares(0.4, 1)[0]!).toBeCloseTo(0.4, 12);
    expect(drawShares(0, 4)).toEqual([0, 0, 0, 0]);
    expect(drawShares(1, 4)).toEqual([1, 1, 1, 1]);
    const mid = drawShares(0.5, 4);
    for (let i = 0; i + 1 < mid.length; i++) expect(mid[i]!).toBeGreaterThanOrEqual(mid[i + 1]!);
    expect(drawShares(0.5, 4, false)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  test('svgLength: an SVG width or height in px for the absolute units, NaN for the rest', () => {
    expect(svgLength('120')).toBe(120);
    expect(svgLength('120px')).toBe(120);
    expect(svgLength('210mm')).toBeCloseTo(793.7, 1);
    expect(svgLength('72pt')).toBeCloseTo(96, 9);
    expect(svgLength('1in')).toBe(96);
    expect(svgLength('100%')).toBeNaN();
    expect(svgLength('2em')).toBeNaN();
    expect(svgLength(null)).toBeNaN();
  });

  test('anchor: sides, centre, and auto facing the other end', () => {
    expect(anchor(B, 'top')).toEqual({ x: 600, y: 50, nx: 0, ny: -1 });
    expect(anchor(B, 'right')).toEqual({ x: 1100, y: 350, nx: 1, ny: 0 });
    expect(anchor(B, 'center')).toEqual({ x: 600, y: 350, nx: 0, ny: 0 });
    expect(anchor(B, 'auto', { x: 2000, y: 400 })).toMatchObject({ x: 1100, y: 350 });
    expect(anchor(B, 'auto', { x: 600, y: 0 })).toMatchObject({ x: 600, y: 50 });
    expect(anchor(B, 'auto', { x: 1200, y: 1000 })).toMatchObject({ x: 600, y: 650 });
  });

  test('arrowTrack: a straight line has its length; a bow bends left of its way and is longer', () => {
    const s = arrowTrack({ x: 0, y: 0 }, { x: 300, y: 400 });
    expect(s.length).toBeCloseTo(500, 9);
    expect(s.d).toBe('M0 0 L300 400');
    const mid = pointAlong(s, 250);
    expect(mid.x).toBeCloseTo(150, 9);
    expect(mid.y).toBeCloseTo(200, 9);
    expect(mid.angle).toBeCloseTo(Math.atan2(400, 300), 9);
    const c = arrowTrack({ x: 0, y: 0 }, { x: 400, y: 0 }, 0.25);
    expect(c.length).toBeGreaterThan(400);
    expect(pointAlong(c, c.length / 2).y).toBeCloseTo(-100, 0);
    expect(pointAlong(c, 0).angle).toBeLessThan(0);
    expect(pointAlong(c, c.length).angle).toBeGreaterThan(0);
    const end = pointAlong(c, 1e9);
    expect(end.x).toBeCloseTo(400, 9);
    expect(end.y).toBeCloseTo(0, 9);
  });
});
