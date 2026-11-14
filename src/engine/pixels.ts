// The readbacks a video export can ask the page for (no imports: the CLI plans with it outside the browser).
/**
 * What a video export reads back per frame: packed rgb24 (8-bit formats), rgba with straight alpha (transparent
 * renders), 16 bits per channel (rgb48le, rgba64le: deep formats; the final pass then renders into a float target),
 * or the linear HDR frame before post as half-float rgba with premultiplied alpha (rgbaf16le, for EXR).
 */
export type Pixels = 'rgb8' | 'rgba8' | 'rgb16' | 'rgba16' | 'linear';
/** Channels and bytes per channel of each readback. */
export const PIXELS: Record<Pixels, { channels: 3 | 4; bytes: 1 | 2 }> = {
  rgb8: { channels: 3, bytes: 1 }, rgba8: { channels: 4, bytes: 1 }, rgb16: { channels: 3, bytes: 2 }, rgba16: { channels: 4, bytes: 2 }, linear: { channels: 4, bytes: 2 },
};
