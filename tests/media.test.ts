// Media inputs: the 16-bit PNG decoder (every row filter, grey and alpha, sRGB, gamma and Display P3 by cICP, what it
// leaves to the browser), an SVG's own size, a video clip's time (trim, speed, loop, held and blended frames, its
// sound), and a Lottie frame that is the same whatever frame was drawn before it.
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { decodePng16, pngDepth } from '../src/engine/png16';
import { fixture, hasChrome, reel, scratchCopy } from './helpers';
import { svgSize, sourceTime, frameAt, framesAt, trimFrames, videoSounds, type FrameSpan, type VideoTiming } from '../src/kit';

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
  // (absolute units in px: 1 in is 96 px)
  expect(svgSize('<svg width="1in" height="72pt">')).toEqual([96, 96]);
});

describe('video time', () => {
  // a 2 s source at 10 fps: frame k shows from k / 10
  const frames: FrameSpan[] = Array.from({ length: 20 }, (_, k) => ({ pts: k / 10, dur: 0.1 }));
  const T = (o: Partial<VideoTiming> = {}): VideoTiming => ({ at: [0, 4], trim: [0, 2], speed: 1, loop: false, ...o });

  test('trim, speed and window map clip time to source time; a clip holds its last frame or loops', () => {
    expect(sourceTime(0.5, T())).toBe(0.5);
    expect(sourceTime(3, T())).toBe(2);
    expect(sourceTime(1, T({ at: [0.5, 4], trim: [1, 1.8], speed: 0.5 }))).toBeCloseTo(1.25, 12);
    expect(sourceTime(0, T({ at: [0.5, 4], trim: [1, 1.8] }))).toBe(1);
    expect(sourceTime(2.5, T({ loop: true }))).toBeCloseTo(0.5, 12);
    expect(sourceTime(1.3, T({ trim: [0.5, 1], speed: 2, loop: true }))).toBeCloseTo(0.6, 12);
  });

  test('the frame on display: exact frame times land on their frame; a held clip shows the trim\'s last frame', () => {
    expect(frameAt(frames, 0)).toBe(0);
    expect(frameAt(frames, 0.3)).toBe(3);
    expect(frameAt(frames, 3 * (1 / 10))).toBe(3);
    expect(frameAt(frames, 0.2999)).toBe(2);
    expect(frameAt(frames, -1)).toBe(0);
    expect(framesAt(frames, 9, T(), false)).toEqual({ a: 19, b: 19, w: 0 });
    // a trim ending exactly on frame 10's start does not show frame 10
    expect(trimFrames(frames, T({ trim: [0.25, 1] }))).toEqual([2, 9]);
    expect(framesAt(frames, 5, T({ trim: [0.25, 1] }), false).a).toBe(9);
  });

  test('blending mixes each frame into the next by how far the moment is between them; a loop blends into its start', () => {
    const f = framesAt(frames, 0.325, T(), true);
    expect([f.a, f.b]).toEqual([3, 4]);
    expect(f.w).toBeCloseTo(0.25, 9);
    expect(framesAt(frames, 1.95, T({ loop: true }), true)).toMatchObject({ a: 19, b: 0 });
    expect(framesAt(frames, 2.95, T(), true)).toEqual({ a: 19, b: 19, w: 0 });
  });

  test('the clip\'s sound: one piece per pass through a looped trim, at its speed, in video time', () => {
    const s = videoSounds('assets/a.mp4', 10, T({ at: [1, 4], trim: [0.5, 1.5], speed: 0.5, loop: true }), -3);
    expect(s.map((x) => [x.at, x.duration, x.from, x.speed, x.db])).toEqual([[11, 2, 0.5, 0.5, -3], [13, 1, 0.5, 0.5, -3]]);
    expect(videoSounds('a.mp4', 0, T({ at: [0, 9] }))).toHaveLength(1);
  });
});

describe.skipIf(!hasChrome)('media rendered', () => {
  const media = scratchCopy('media');
  afterAll(async () => { await reel(['daemon', 'stop', '--project', media.dir]); media.cleanup(); });

  test('a video frame, a Lottie frame and the rest are the same reached in order or by a seek', async () => {
    // frames 40 to 47 at 30 fps: the clip's second group of pictures, the badge drawing its ring and tick
    const times = Array.from({ length: 8 }, (_, k) => ((40 + k) / 30).toFixed(4));
    const stills = async (ts: string[]) => {
      const r = await reel(['still', '--t', ts.join(','), '--json', '--project', media.dir]);
      expect(r.code).toBe(0);
      return new Map((r.json().frames as { t: number; file: string }[]).map((f) => [f.t.toFixed(4), readFileSync(f.file)]));
    };
    const played = await stills(times);
    await reel(['still', '--t', '7.5', '--project', media.dir]);
    const sought = await stills([...times].reverse());
    for (const t of times) expect(Buffer.compare(played.get(t)!, sought.get(t)!)).toBe(0);
    expect(new Set([...played.values()].map((b) => b.toString('base64'))).size).toBe(times.length);
  }, 120_000);

  test('a missing video is a scene error that check reports', async () => {
    const shot = path.join(media.dir, 'scenes/shot.ts');
    const text = readFileSync(shot, 'utf8');
    writeFileSync(shot, text.replace("src: 'assets/clip.mp4', alt: 'colour field'", "src: 'assets/nope.mp4', alt: 'colour field'"));
    try {
      const r = await reel(['check', '--json', '--only', 'shot', '--project', media.dir]);
      expect(r.code).toBe(1);
      expect(JSON.stringify(r.json())).toContain("video 'assets/nope.mp4' did not load");
    } finally { writeFileSync(shot, text); }
  }, 120_000);
});

// A Lottie whose layer grows from 100% to 100.5% over its first second, its bar 40000 px from the anchor: a change of
// scale too small for lottie-web's 1e-5 threshold still moves the bar's edge by a third of a pixel.
const LEVER = {
  v: '5.7.4', fr: 30, ip: 0, op: 60, w: 512, h: 512, ddd: 0, assets: [],
  layers: [{
    ddd: 0, ind: 1, ty: 4, nm: 'bar', sr: 1, ao: 0, ip: 0, op: 60, st: 0, bm: 0,
    ks: {
      o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [-39800, 256, 0] }, a: { a: 0, k: [0, 0, 0] },
      s: { a: 1, k: [{ t: 0, s: [100, 100, 100], i: { x: [1, 1, 1], y: [1, 1, 1] }, o: { x: [0, 0, 0], y: [0, 0, 0] } }, { t: 30, s: [100.5, 100.5, 100] }] },
    },
    shapes: [{ ty: 'gr', it: [
      { ty: 'rc', p: { a: 0, k: [40000, 0] }, s: { a: 0, k: [120, 300] }, r: { a: 0, k: 0 }, d: 1 },
      { ty: 'fl', c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 }, r: 1 },
      { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } },
    ] }],
  }],
};

describe.skipIf(!hasChrome)('Lottie rendered', () => {
  const p = fixture('lottie', {
    'reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({ size: [512, 512], fps: 30, timeline: () => [{ id: 'bar', scene: () => import('./scenes/bar'), start: 0, end: 2 }] });
`,
    'scenes/bar.ts': `import type * as THREE from 'three';
import { Scene, type Frame, LottieBox, clearRT, W, H } from 'reel';
export default class Bar extends Scene {
  bar = new LottieBox({ src: 'lever.json', box: { x: 0, y: 0, w: W, h: H } });
  render(f: Frame, out: THREE.WebGLRenderTarget) { clearRT(this.ctx.renderer, out, [0, 0, 0]); this.bar.draw(this.ctx.renderer, out, f); }
}
`,
    'lever.json': JSON.stringify(LEVER),
  });
  afterAll(async () => { await reel(['daemon', 'stop', '--project', p.dir]); p.cleanup(); });

  test('a Lottie frame is the same reached by a small step forward or by a jump, in one page', async () => {
    // the step is 0.05 of the animation's frames: its scale moves by less than 1e-5
    const t = 0.7, step = (t - 0.05 / 30).toFixed(6);
    const still = async (ts: string[]) => {
      const r = await reel(['still', '--t', ts.join(','), '--json', '--project', p.dir]);
      expect(r.code).toBe(0);
      return readFileSync((r.json().frames as { file: string }[]).at(-1)!.file);
    };
    const stepped = await still([step, t.toFixed(6)]);
    const jumped = await still(['1.5', t.toFixed(6)]);
    expect(Buffer.compare(stepped, jumped)).toBe(0);
  }, 120_000);
});
