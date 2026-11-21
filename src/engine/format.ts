declare const __REEL_FORMAT__: { w: number; h: number; fps: number } | undefined;

function read() {
  const base = typeof __REEL_FORMAT__ === 'undefined' || !__REEL_FORMAT__ ? { w: 1920, h: 1080, fps: 60 } : __REEL_FORMAT__;
  const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  const int = (k: string, d: number, lo: number, hi: number) => {
    const raw = q.get(k);
    if (raw === null) return d;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`?${k}=${raw}: expected an integer from ${lo} to ${hi}`);
    return v;
  };
  const w = int('w', base.w, 16, 8192), h = int('h', base.h, 16, 8192);
  if (w % 4 || h % 2) throw new Error(`frame size ${w}x${h}: the width must be a multiple of 4 and the height even`);
  const fps = Number(q.get('fps') ?? base.fps);
  if (!(fps > 0 && fps <= 240)) throw new Error(`?fps=${q.get('fps')}: expected a frame rate up to 240`);
  const bits = int('bits', 8, 8, 16);
  if (![8, 10, 12, 16].includes(bits)) throw new Error(`?bits=${bits}: expected 8, 10, 12 or 16`);
  const scale = q.get('scale') === '0.5' ? 0.5 : int('scale', 1, 1, 4);
  if ((w * scale) % 4 || (h * scale) % 2) throw new Error(`frame size ${w}x${h} at scale ${scale} is ${w * scale}x${h * scale}: the width must be a multiple of 4 and the height even`);
  return { w, h, fps, scale, alpha: q.get('alpha') === '1', bits };
}
const f = read();

export const W = f.w;
export const H = f.h;
export const FPS = f.fps;
export const SCALE = f.scale;
export const ALPHA = f.alpha;
export const BITS = f.bits;
