// What a 3D stage reports to `reel check`: the screen rectangle of a box in the world, seen through a camera. Pure
// (a column-major view-projection matrix in, a rectangle in logical px out), so it is unit-tested.
import type { CameraPose, Vec3 } from './camera';

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

/** Where a point of the world lands on screen. */
export interface ScreenPoint {
  /** Logical px, origin top left (may be outside the frame). */
  x: number; y: number;
  /** The distance from the camera along its view, in world units (negative: behind it). */
  depth: number;
  /** Behind the camera: x and y mean nothing. */
  behind: boolean;
}

/**
 * Where `point` (world coordinates) lands on a W x H frame seen from `pose` with a vertical field of view of `fov`
 * degrees (the pose's own `fov` wins): the same camera Stage3D.camera(pose) places, without its jitter. Pure, so a
 * clip on another track can compute where a stage's object is from the rig both share.
 */
export function projectPoint(pose: CameraPose, point: Vec3, fov: number, W: number, H: number): ScreenPoint {
  const [px, py, pz] = pose.position, [tx, ty, tz] = pose.target;
  // the camera's axes as three's lookAt makes them: back (it looks along -back), right, up
  let bx = px - tx, by = py - ty, bz = pz - tz;
  const bl = Math.hypot(bx, by, bz) || 1;
  bx /= bl; by /= bl; bz /= bl;
  // right = up(0, 1, 0) x back (looking straight up or down, three nudges the back axis the same way)
  if (bx === 0 && bz === 0) { bz += 1e-4; const l = Math.hypot(bx, by, bz); bx /= l; by /= l; bz /= l; }
  let rx = bz, ry = 0, rz = -bx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; rz /= rl;
  let ux = by * rz - bz * ry, uy = bz * rx - bx * rz, uz = bx * ry - by * rx;
  if (pose.roll) {
    const a = (pose.roll * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    [rx, ry, rz, ux, uy, uz] = [rx * c + ux * s, ry * c + uy * s, rz * c + uz * s, ux * c - rx * s, uy * c - ry * s, uz * c - rz * s];
  }
  const dx = point[0] - px, dy = point[1] - py, dz = point[2] - pz;
  const depth = -(dx * bx + dy * by + dz * bz);
  const k = Math.tan((((pose.fov ?? fov) * Math.PI) / 180) / 2) * Math.max(depth, 1e-9);
  const nx = (dx * rx + dy * ry + dz * rz) / (k * (W / H)), ny = (dx * ux + dy * uy + dz * uz) / k;
  return { x: ((nx + 1) / 2) * W, y: ((1 - ny) / 2) * H, depth, behind: depth <= 1e-9 };
}
