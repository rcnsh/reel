// PNG files and image comparison: `reel diff`, the golden-frame tests and the MCP server's diff tool.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

/** An RGBA image, rows top-down. */
export interface Img { width: number; height: number; data: Uint8Array }

export function readPng(file: string): Img {
  let p;
  try { p = PNG.sync.read(readFileSync(file)); } catch (e) { throw new Error(`${file}: not a PNG that can be read (${(e as Error).message})`); }
  return { width: p.width, height: p.height, data: new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.length) };
}

export function encodePng(img: Img): Buffer {
  const p = new PNG({ width: img.width, height: img.height });
  p.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  return PNG.sync.write(p);
}

export function writePng(file: string, img: Img) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, encodePng(img));
}

export interface DiffStats {
  width: number;
  height: number;
  /** Pixels whose largest channel difference is over `tol` levels, and their share of all pixels. */
  changed: number;
  fraction: number;
  /** Largest channel difference anywhere (0..255), and the mean of every pixel's largest channel difference. */
  max: number;
  mean: number;
  /** The rectangle around the changed pixels, [x, y, w, h], or null when none changed. */
  box: [number, number, number, number] | null;
}

/**
 * Compare two images of one size (RGB; alpha is ignored). Returns the numbers and a picture of the difference:
 * `b` dimmed to grey, changed pixels in red (brighter for a bigger difference), the box around them outlined.
 */
export function diffImages(a: Img, b: Img, tol = 0): { stats: DiffStats; image: Img } {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`the images differ in size: ${a.width}x${a.height} and ${b.width}x${b.height}`);
  const { width: w, height: h } = a, n = w * h;
  const out = new Uint8Array(n * 4);
  let changed = 0, max = 0, sum = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(a.data[o]! - b.data[o]!), Math.abs(a.data[o + 1]! - b.data[o + 1]!), Math.abs(a.data[o + 2]! - b.data[o + 2]!));
    sum += d;
    if (d > max) max = d;
    const grey = Math.round((0.2126 * b.data[o]! + 0.7152 * b.data[o + 1]! + 0.0722 * b.data[o + 2]!) * 0.3);
    if (d > tol) {
      changed++;
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      out[o] = 140 + Math.round(115 * Math.min(1, d / 48)); out[o + 1] = grey >> 1; out[o + 2] = grey >> 1;
    } else { out[o] = out[o + 1] = out[o + 2] = grey; }
    out[o + 3] = 255;
  }
  const box: DiffStats['box'] = x1 >= 0 ? [x0, y0, x1 - x0 + 1, y1 - y0 + 1] : null;
  if (box) {
    const mark = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < w && y < h) out.set([255, 43, 214, 255], (y * w + x) * 4); };
    const [bx, by, bw, bh] = box, m = 2;
    for (let x = bx - m; x <= bx + bw - 1 + m; x++) { mark(x, by - m); mark(x, by + bh - 1 + m); }
    for (let y = by - m; y <= by + bh - 1 + m; y++) { mark(bx - m, y); mark(bx + bw - 1 + m, y); }
  }
  return { stats: { width: w, height: h, changed, fraction: changed / n, max, mean: +(sum / n).toFixed(4), box }, image: { width: w, height: h, data: out } };
}

/** One line for a person: how much changed and where. */
export function describeDiff(s: DiffStats) {
  if (!s.changed) return `identical (${s.width}x${s.height})`;
  return `${s.changed} of ${s.width * s.height} px changed (${(s.fraction * 100).toFixed(3)}%), max ${s.max}, mean ${s.mean.toFixed(3)} levels, in ${s.box![2]}x${s.box![3]} at ${s.box![0]},${s.box![1]}`;
}

/** A copy at most `max` px on its long side (area-averaged; never enlarged). */
export function downscale(img: Img, max: number): Img {
  const k = Math.max(img.width, img.height) / max;
  if (k <= 1) return img;
  const w = Math.max(1, Math.round(img.width / k)), h = Math.max(1, Math.round(img.height / k));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor((x * img.width) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
    const y0 = Math.floor((y * img.height) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    const s = [0, 0, 0, 0];
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const o = (yy * img.width + xx) * 4; for (let c = 0; c < 4; c++) s[c]! += img.data[o + c]!; }
    const n = (x1 - x0) * (y1 - y0), o = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) out[o + c] = Math.round(s[c]! / n);
  }
  return { width: w, height: h, data: out };
}
