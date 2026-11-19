// Layout helpers: boxes cut from a box (a grid, a split by shares, an inset, a box of a size placed in another),
// so a scene lays out from W and H in shares instead of sums. Pure functions of their arguments.
import type { Box } from './common';

/** Px off each side: one number for all four, or per side (missing sides 0). Negative grows the box. */
export type Inset = number | { top?: number; right?: number; bottom?: number; left?: number; x?: number; y?: number };

/** `box` shrunk by `px` on each side (or per side; `x` and `y` set left and right, top and bottom). */
export function inset(box: Box, px: Inset): Box {
  const s = typeof px === 'number' ? { top: px, right: px, bottom: px, left: px }
    : { top: px.top ?? px.y ?? 0, right: px.right ?? px.x ?? 0, bottom: px.bottom ?? px.y ?? 0, left: px.left ?? px.x ?? 0 };
  return { x: box.x + s.left, y: box.y + s.top, w: Math.max(0, box.w - s.left - s.right), h: Math.max(0, box.h - s.top - s.bottom) };
}

/**
 * `box` cut into parts by shares, with `gap` px between them: 'h' lays the parts out in a row (left to right),
 * 'v' in a column (top to bottom). `split(b, 'h', [2, 1])` gives a part twice as wide as the other; a number
 * `n` gives n equal parts. Gaps the box cannot hold shrink until the parts (then empty) fit it.
 */
export function split(box: Box, dir: 'h' | 'v', shares: number[] | number, gap = 0): Box[] {
  const s = typeof shares === 'number' ? Array.from({ length: Math.max(0, Math.floor(shares)) }, () => 1) : shares;
  if (s.some((x) => !(x >= 0))) throw new Error(`split: shares must be numbers 0 or more (got ${s.join(', ')})`);
  const total = s.reduce((a, b) => a + b, 0) || 1;
  // (gaps wider than the box allows shrink to fit it, so every part stays inside it)
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

/**
 * `box` cut into `cols` x `rows` equal cells with `gap` px between them (or `[across, down]`), row by row from the
 * top left: cell (col c, row r) is at index `r * cols + c`.
 */
export function grid(box: Box, cols: number, rows: number, gap: number | [number, number] = 0): Box[] {
  const [gx, gy] = typeof gap === 'number' ? [gap, gap] : gap;
  return split(box, 'v', rows, gy).flatMap((row) => split(row, 'h', cols, gx));
}

/** Where a box sits along an axis of another: at its start, its centre or its end. */
export type Align = 'start' | 'center' | 'end';

/** A box `w` x `h` placed inside `box`: across by `x`, down by `y` (both default centre). It may be larger than `box`. */
export function align(box: Box, w: number, h: number, x: Align = 'center', y: Align = 'center'): Box {
  const at = (a: Align, room: number) => (a === 'start' ? 0 : a === 'end' ? room : room / 2);
  return { x: box.x + at(x, box.w - w), y: box.y + at(y, box.h - h), w, h };
}

/** A box `w` x `h` centred in `box`. */
export const center = (box: Box, w: number, h: number): Box => align(box, w, h);
