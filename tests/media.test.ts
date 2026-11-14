// Media inputs: the 16-bit PNG decoder (every row filter, grey and alpha, sRGB, gamma and Display P3 by cICP, what it
// leaves to the browser) and an SVG's own size.
import { describe, expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';
import { decodePng16, pngDepth } from '../src/engine/png16';
import { svgSize } from '../src/kit';

function crc32(b: Uint8Array) {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
/** A 16-bit PNG of `samples` (channels per pixel by colour type), each row with filter `y % 5`. */
function png16(w: number, h: number, colorType: number, samples: number[], extra: Uint8Array[] = []) {
  const ch = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colorType]!, bpp = ch * 2, stride = w * bpp;
  const px = new Uint8Array(h * stride);
  samples.forEach((s, i) => { px[i * 2] = s >> 8; px[i * 2 + 1] = s & 255; });
  const raw = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const f = y % 5;
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i++) {
      const x = px[y * stride + i]!, a = i >= bpp ? px[y * stride + i - bpp]! : 0, up = y ? px[(y - 1) * stride + i]! : 0, ul = y && i >= bpp ? px[(y - 1) * stride + i - bpp]! : 0;
      const p = a + up - ul, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul);
      const pred = [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : ul][f]!;
      raw[y * (stride + 1) + 1 + i] = (x - pred) & 255;
    }
  }
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, w); v.setUint32(4, h); ihdr[8] = 16; ihdr[9] = colorType;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array())];
  return new Uint8Array(Buffer.concat(parts));
}
const srgb = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);

describe('16-bit PNG', () => {
  test('every level survives every row filter, as linear floats', async () => {
    const w = 37, h = 10, s: number[] = [];
    for (let i = 0; i < w * h * 3; i++) s.push((i * 2654435761) % 65536);
    const p = (await decodePng16(png16(w, h, 2, s)))!;
    expect([p.width, p.height]).toEqual([w, h]);
    for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) expect(p.data[i * 4 + k]).toBeCloseTo(srgb(s[i * 3 + k]! / 65535), 6);
    expect(p.data[3]).toBe(1);
    // a dark ramp keeps its levels (the browser's 8-bit decode leaves 4 of these 1024)
    const ramp = (await decodePng16(png16(1024, 1, 0, Array.from({ length: 1024 }, (_, i) => i))))!;
    expect(new Set(Array.from({ length: 1024 }, (_, i) => ramp.data[i * 4])).size).toBe(1024);
  });

  test('grey with alpha, and a gamma', async () => {
    const p = (await decodePng16(png16(2, 1, 4, [65535, 32768, 0, 65535])))!;
    [1, 1, 1, 32768 / 65535, 0, 0, 0, 1].forEach((v, i) => expect(p.data[i]).toBeCloseTo(v, 6));
    const gama = new Uint8Array(4); new DataView(gama.buffer).setUint32(0, 50000);   // a gamma of 0.5: decode squares
    const q = (await decodePng16(png16(1, 1, 0, [32768], [chunk('gAMA', gama)])))!;
    expect(q.data[0]).toBeCloseTo((32768 / 65535) ** 2, 6);
  });

  test('Display P3 by cICP becomes Rec.709 primaries; what it cannot read is left to the browser', async () => {
    const p3 = chunk('cICP', new Uint8Array([12, 13, 0, 1]));
    const red = (await decodePng16(png16(1, 1, 2, [65535, 0, 0], [p3])))!;
    // P3's red lies outside Rec.709: more red than 1, the other channels clipped at 0
    expect(red.data[0]).toBeCloseTo(1.2249, 3);
    expect([red.data[1], red.data[2]]).toEqual([0, 0]);
    const white = (await decodePng16(png16(1, 1, 2, [65535, 65535, 65535], [p3])))!;
    for (let k = 0; k < 3; k++) expect(white.data[k]).toBeCloseTo(1, 4);
    expect(await decodePng16(png16(1, 1, 2, [0, 0, 0], [chunk('iCCP', new Uint8Array(8))]))).toBeNull();
    expect(await decodePng16(png16(1, 1, 2, [0, 0, 0], [chunk('cICP', new Uint8Array([9, 16, 0, 1]))]))).toBeNull();
    const eight = png16(1, 1, 2, [0, 0, 0]); eight[24] = 8;
    expect(pngDepth(eight)).toBe(8);
    expect(await decodePng16(eight)).toBeNull();
    expect(pngDepth(new TextEncoder().encode('<svg/>'))).toBe(0);
  });
});

test('svgSize: absolute width and height, else the viewBox, else 300 x 150', () => {
  expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80px">')).toEqual([120, 80]);
  expect(svgSize('<svg viewBox="0 0 400 100" width="100%">')).toEqual([400, 100]);
  expect(svgSize("<svg viewBox='0,0,400,100' height='50'>")).toEqual([200, 50]);
  expect(svgSize('<?xml version="1.0"?><svg>')).toEqual([300, 150]);
});
