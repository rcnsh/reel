// What a 3D stage reports to `reel check`: the screen rectangle of a box in the world, seen through a camera. Pure
// (a column-major view-projection matrix in, a rectangle in logical px out), so it is unit-tested.
import type { Vec3 } from './camera';

/** The 8 corners of an axis-aligned box from its min and max corners. */
export const corners = (min: Vec3, max: Vec3): Vec3[] =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);

/** The 12 edges of a box, as pairs of indices into corners(). */
const EDGES: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

export interface Projected {
  /** The rectangle on screen in logical px (origin top left), of the part in front of the camera. */
  x: number; y: number; w: number; h: number;
  /** Every corner is behind the camera: nothing of it can be seen (the rectangle is empty). */
  behind: boolean;
  /** Some corners are behind the camera: the rectangle is that of the part in front. */
  partial: boolean;
}

/**
 * The screen rectangle of a box with these corners (world coordinates), through `m`, a column-major 4x4
 * view-projection matrix (three's `camera.projectionMatrix * camera.matrixWorldInverse`), on a W x H frame. Edges
 * that cross the camera's plane are clipped there, so a box the camera is inside of or beside still gets the
 * rectangle of what is in front.
 */
export function projectBox(pts: Vec3[], m: ArrayLike<number>, W: number, H: number): Projected {
  const clip = pts.map(([x, y, z]) => [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
    m[3]! * x + m[7]! * y + m[11]! * z + m[15]!,
  ]);
  const EPS = 1e-5;
  const front = clip.map((c) => c[3]! > EPS);
  const vis: number[][] = clip.filter((_, i) => front[i]);
  if (!vis.length) return { x: 0, y: 0, w: 0, h: 0, behind: true, partial: false };
  const partial = vis.length < clip.length;
  if (partial && pts.length === 8) {
    // where an edge crosses w = EPS
    for (const [a, b] of EDGES) {
      if (front[a] === front[b]) continue;
      const A = clip[a]!, B = clip[b]!, k = (EPS - A[3]!) / (B[3]! - A[3]!);
      vis.push(A.map((v, i) => v + (B[i]! - v) * k));
    }
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of vis) {
    const w = Math.max(EPS, c[3]!), sx = ((c[0]! / w + 1) / 2) * W, sy = ((1 - c[1]! / w) / 2) * H;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  // (a clipped corner projects towards infinity: keep the rectangle finite, a frame beyond each edge at most)
  const lim = (v: number, s: number) => Math.min(2 * s, Math.max(-s, v));
  x0 = lim(x0, W); x1 = lim(x1, W); y0 = lim(y0, H); y1 = lim(y1, H);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, behind: false, partial };
}
