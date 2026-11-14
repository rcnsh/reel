// Low-discrepancy jitter indexed by the motion-blur sub-frame (SUB_FRAME.index): sub-pixel offsets for
// anti-aliasing, points on a lens aperture for depth of field, points on an area light for soft shadows. Every
// prefix of each sequence is evenly spread, so a frame that adaptive sampling stops after 4, 12 or 36 sub-frames
// has averaged a fair sample of each. The sequences differ from one another (and from the ternary order of the
// sub-frames' times), so the jitters do not line up with each other or with time. Pure.

const fract = (x: number) => x - Math.floor(x);

/** The radical inverse of i in `base` (the Halton sequence): 0, 1/2, 1/4, 3/4 … for base 2. */
export function halton(i: number, base: number) {
  let f = 1, r = 0;
  for (let n = i; n > 0; n = Math.floor(n / base)) { f /= base; r += f * (n % base); }
  return r;
}

/** Sub-pixel offset of sub-frame k, each coordinate in [-0.5, 0.5) px (the R2 sequence). */
export function subPixel(k: number): [number, number] {
  return [fract(0.5 + k * 0.7548776662466927) - 0.5, fract(0.5 + k * 0.5698402909980532) - 0.5];
}

/** A point of the unit square mapped to the unit disk, keeping areas and spacing (Shirley's concentric map). */
export function concentric(u: number, v: number): [number, number] {
  const a = 2 * u - 1, b = 2 * v - 1;
  if (a === 0 && b === 0) return [0, 0];
  let r: number, phi: number;
  if (Math.abs(a) > Math.abs(b)) { r = a; phi = (Math.PI / 4) * (b / a); } else { r = b; phi = Math.PI / 2 - (Math.PI / 4) * (a / b); }
  return [r * Math.cos(phi), r * Math.sin(phi)];
}

/** Point of sub-frame k on the unit lens disk (Halton bases 2 and 3). */
export const lensSample = (k: number) => concentric(halton(k + 1, 2), halton(k + 1, 3));

/** Point of sub-frame k on a unit area light's disk (Halton bases 5 and 7). */
export const lightSample = (k: number) => concentric(halton(k + 1, 5), halton(k + 1, 7));
