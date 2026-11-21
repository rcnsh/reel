export type Pixels = 'rgb8' | 'rgba8' | 'rgb16' | 'rgba16' | 'linear' | 'yuv420';
export const PIXELS: Record<Pixels, { channels: 3 | 4; bytes: 1 | 2; perPixel: number }> = {
  rgb8: { channels: 3, bytes: 1, perPixel: 3 }, rgba8: { channels: 4, bytes: 1, perPixel: 4 }, rgb16: { channels: 3, bytes: 2, perPixel: 6 },
  rgba16: { channels: 4, bytes: 2, perPixel: 8 }, linear: { channels: 4, bytes: 2, perPixel: 8 }, yuv420: { channels: 3, bytes: 1, perPixel: 1.5 },
};

export const yuvFits = (w: number, h: number) => w % 8 === 0 && h % 4 === 0;
