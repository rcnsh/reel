// The output format, read once from the page URL: the logical frame size scenes lay out in (`?w=1080&h=1920`,
// default 1920x1080), the frame rate (`?fps=30`, default 60) and the resolution multiplier (`?scale=2` renders
// every logical px as 2x2 physical px). Kept in its own module so glsl/common.ts can use it without an import
// cycle through gl.ts.
function read() {
  const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  const int = (k: string, d: number, lo: number, hi: number) => {
    const raw = q.get(k);
    if (raw === null) return d;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`?${k}=${raw}: expected an integer from ${lo} to ${hi}`);
    return v;
  };
  const w = int('w', 1920, 16, 8192), h = int('h', 1080, 16, 8192);
  // (the packed-RGB readback stores 4 bytes per texel, and yuv420 video needs even sides)
  if (w % 4 || h % 2) throw new Error(`frame size ${w}x${h}: the width must be a multiple of 4 and the height even`);
  const fps = Number(q.get('fps') ?? 60);
  if (!(fps > 0 && fps <= 240)) throw new Error(`?fps=${q.get('fps')}: expected a frame rate up to 240`);
  return { w, h, fps, scale: int('scale', 1, 1, 4) };
}
const f = read();

/** Logical frame size: scenes lay out in these px at every output scale. */
export const W = f.w;
export const H = f.h;
/** Output frames per second. */
export const FPS = f.fps;
/** Physical pixels per logical pixel of the output (integer 1..4, default 1). */
export const SCALE = f.scale;
