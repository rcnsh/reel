
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

export const lensSample = (k: number) => concentric(halton(k + 1, 2), halton(k + 1, 3));

export const lightSample = (k: number) => concentric(halton(k + 1, 5), halton(k + 1, 7));
