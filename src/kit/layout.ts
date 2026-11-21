import type { Box } from './common';

export type Inset = number | { top?: number; right?: number; bottom?: number; left?: number; x?: number; y?: number };

export function inset(box: Box, px: Inset): Box {
  const s = typeof px === 'number' ? { top: px, right: px, bottom: px, left: px }
    : { top: px.top ?? px.y ?? 0, right: px.right ?? px.x ?? 0, bottom: px.bottom ?? px.y ?? 0, left: px.left ?? px.x ?? 0 };
  return { x: box.x + s.left, y: box.y + s.top, w: Math.max(0, box.w - s.left - s.right), h: Math.max(0, box.h - s.top - s.bottom) };
}

export function split(box: Box, dir: 'h' | 'v', shares: number[] | number, gap = 0): Box[] {
  const s = typeof shares === 'number' ? Array.from({ length: Math.max(0, Math.floor(shares)) }, () => 1) : shares;
  if (s.some((x) => !(x >= 0))) throw new Error(`split: shares must be numbers 0 or more (got ${s.join(', ')})`);
  const total = s.reduce((a, b) => a + b, 0) || 1;
  const along = dir === 'h' ? box.w : box.h, n = Math.max(0, s.length - 1);
  if (n) gap = Math.min(gap, along / n);
  const room = Math.max(0, along - gap * n);
  let at = dir === 'h' ? box.x : box.y;
  return s.map((x) => {
    const len = (room * x) / total, b = dir === 'h' ? { x: at, y: box.y, w: len, h: box.h } : { x: box.x, y: at, w: box.w, h: len };
    at += len + gap;
    return b;
  });
}

export function grid(box: Box, cols: number, rows: number, gap: number | [number, number] = 0): Box[] {
  const [gx, gy] = typeof gap === 'number' ? [gap, gap] : gap;
  return split(box, 'v', rows, gy).flatMap((row) => split(row, 'h', cols, gx));
}

export type Align = 'start' | 'center' | 'end';

/** A box `w` x `h` placed inside `box`: across by `x`, down by `y` (both default centre). It may be larger than `box`. */
export function align(box: Box, w: number, h: number, x: Align = 'center', y: Align = 'center'): Box {
  const at = (a: Align, room: number) => (a === 'start' ? 0 : a === 'end' ? room : room / 2);
  return { x: box.x + at(x, box.w - w), y: box.y + at(y, box.h - h), w, h };
}

export const center = (box: Box, w: number, h: number): Box => align(box, w, h);
