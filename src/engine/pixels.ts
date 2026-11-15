// The readbacks a video export can ask the page for (no imports: the CLI plans with it outside the browser).
/**
 * What a video export reads back per frame: packed rgb24 (8-bit formats), rgba with straight alpha (transparent
 * renders), 16 bits per channel (rgb48le, rgba64le: deep formats; the final pass then renders into a float target),
 * the linear HDR frame before post as half-float rgba with premultiplied alpha (rgbaf16le, for EXR), or planar
 * yuv420p converted on the GPU (limited-range BT.709, chroma averaged over its 2x2 block): half the bytes of rgb24
 * to move, for 8-bit 4:2:0 formats whose frame width is a multiple of 8 and height a multiple of 4.
 */
export type Pixels = 'rgb8' | 'rgba8' | 'rgb16' | 'rgba16' | 'linear' | 'yuv420';
/** Channels, bytes per channel and bytes per pixel of each readback. */
export const PIXELS: Record<Pixels, { channels: 3 | 4; bytes: 1 | 2; perPixel: number }> = {
  rgb8: { channels: 3, bytes: 1, perPixel: 3 }, rgba8: { channels: 4, bytes: 1, perPixel: 4 }, rgb16: { channels: 3, bytes: 2, perPixel: 6 },
  rgba16: { channels: 4, bytes: 2, perPixel: 8 }, linear: { channels: 4, bytes: 2, perPixel: 8 }, yuv420: { channels: 3, bytes: 1, perPixel: 1.5 },
};

/** Whether a frame of w x h px can be read back as yuv420 (its planes pack into whole texels). */
export const yuvFits = (w: number, h: number) => w % 8 === 0 && h % 4 === 0;
