// `reel video` end to end in every output format family: a second of a small project with a sound track, the stream
// checked with ffprobe (codec, pixel format, colour tags, alpha, sound) and a decoded frame checked for transparency.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fixture, hasChrome, reel } from './helpers';

const proj = fixture('formats', {
  'reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({ size: [320, 180], fps: 10, theme: 'neutral', timeline: () => [{ id: 'dot', scene: () => import('./scenes/dot'), start: 0, end: 1 }] });
`,
  'scenes/dot.ts': `import type * as THREE from 'three';
import { Scene, type Frame, Layer2D, H, clearRT, LIN, rgba } from 'reel';
export default class Dot extends Scene {
  layer = new Layer2D();
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg);
    const c = this.layer.ctx; this.layer.clear();
    c.fillStyle = rgba('accent'); c.beginPath(); c.arc(80 + f.lt * 160, H / 2, 40, 0, Math.PI * 2); c.fill();
    this.ctx.comp.draw(this.ctx.renderer, this.layer.upload(), out);
  }
}
`,
  'data/audio.json': JSON.stringify({ duration: 1, track: 'audio/tone.flac', bpm: 120, fps: 100, beats: [], downbeats: [], sections: [], features: {}, onsets: {} }),
});
const out = (f: string) => path.join(proj.dir, 'out', f);

beforeAll(() => {
  Bun.spawnSync(['mkdir', '-p', path.join(proj.dir, 'audio')]);
  Bun.spawnSync(['ffmpeg', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1', path.join(proj.dir, 'audio/tone.flac')]);
});
afterAll(() => proj.cleanup());

interface Stream { codec_type: string; codec_name: string; pix_fmt?: string; profile?: string; color_range?: string; color_space?: string; color_primaries?: string; color_transfer?: string; width?: number; tags?: Record<string, string> }
function probe(file: string): Stream[] {
  const r = Bun.spawnSync(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', file]);
  return JSON.parse(r.stdout.toString()).streams;
}
/** The alpha of the top-left pixel of frame `n` (the theme's background, which a transparent render leaves out). */
function cornerAlpha(file: string, decoder?: string, n = 5) {
  const r = Bun.spawnSync(['ffmpeg', '-loglevel', 'error', ...(decoder ? ['-c:v', decoder] : []), '-i', file, '-vf', `select=eq(n\\,${n}),format=rgba`, '-frames:v', '1', '-f', 'rawvideo', '-']);
  return r.stdout[3];
}
async function render(name: string, ...flags: string[]) {
  const r = await reel(['video', '--project', proj.dir, '--out', out(name), '--json', ...flags]);
  expect(r.err).not.toContain('ERRORS');
  expect(r.code).toBe(0);
  return r.json();
}
const bt709 = (s: Stream) => [s.color_range, s.color_space, s.color_primaries, s.color_transfer];

test.skipIf(!hasChrome)('H.264: 8-bit 4:2:0 with AAC, and 10-bit 4:4:4, tagged BT.709 limited range', async () => {
  await render('a.mp4');
  const [v, a] = probe(out('a.mp4'));
  expect([v!.codec_name, v!.pix_fmt, v!.profile]).toEqual(['h264', 'yuv420p', 'High']);
  expect(bt709(v!)).toEqual(['tv', 'bt709', 'bt709', 'bt709']);
  expect(a!.codec_name).toBe('aac');
  const j = await render('b.mp4', '--chroma', '444', '--depth', '10', '--noaudio');
  expect(j.pixels).toBe('rgb16');
  const s = probe(out('b.mp4'));
  expect(s.length).toBe(1);
  expect([s[0]!.pix_fmt, s[0]!.profile]).toEqual(['yuv444p10le', 'High 4:4:4 Predictive']);
}, 60_000);

test.skipIf(!hasChrome)('HEVC Main10 and ProRes 422 HQ: 10-bit from the deep readback', async () => {
  await render('h.mp4', '--format', 'hevc');
  const [v] = probe(out('h.mp4'));
  expect([v!.codec_name, v!.pix_fmt, v!.profile]).toEqual(['hevc', 'yuv420p10le', 'Main 10']);
  expect(bt709(v!)).toEqual(['tv', 'bt709', 'bt709', 'bt709']);
  await render('p.mov');
  const [p, a] = probe(out('p.mov'));
  expect([p!.codec_name, p!.pix_fmt, p!.profile]).toEqual(['prores', 'yuv422p10le', 'HQ']);
  expect(a!.codec_name).toBe('pcm_s24le');
}, 60_000);

test.skipIf(!hasChrome)('ProRes 4444 and VP9 WebM carry alpha: the background is transparent, the dot is not', async () => {
  const j = await render('a.mov', '--format', 'prores4444');
  expect(j.alpha).toBe(true);
  const [v, a] = probe(out('a.mov'));
  expect([v!.codec_name, v!.profile, v!.pix_fmt]).toEqual(['prores', '4444', 'yuva444p12le']);
  expect(a!.codec_name).toBe('pcm_s24le');
  expect(cornerAlpha(out('a.mov'))).toBe(0);
  await render('a.webm');
  const [w, o] = probe(out('a.webm'));
  expect([w!.codec_name, w!.tags?.alpha_mode ?? w!.tags?.ALPHA_MODE]).toEqual(['vp9', '1']);
  expect(o!.codec_name).toBe('opus');
  expect(cornerAlpha(out('a.webm'), 'libvpx-vp9')).toBe(0);
  // the mix goes into the container with its own codec
  const m = await render('m.webm', '--mix');
  expect(m.loudness).toBeTruthy();
  expect(probe(out('m.webm')).map((x) => x.codec_name)).toEqual(['vp9', 'opus']);
  // --opaque: the same formats with the background
  await render('o.webm', '--opaque');
  expect(probe(out('o.webm'))[0]!.tags?.alpha_mode ?? '0').not.toBe('1');
}, 90_000);

test.skipIf(!hasChrome)('GIF and WebP loops: no sound, the rate capped', async () => {
  const g = await render('l.gif', '--max-fps', '5');
  expect(g.fps).toBe(5);
  const [v, ...rest] = probe(out('l.gif'));
  expect(v!.codec_name).toBe('gif');
  expect(rest.length).toBe(0);
  expect(g.frames).toBe(5);
  await render('l.webp', '--alpha');
  expect(probe(out('l.webp'))[0]!.codec_name).toMatch(/webp/);
}, 60_000);

test.skipIf(!hasChrome)('image sequences: PNG with alpha, 16-bit PNG, JPEG and linear EXR, one file per frame', async () => {
  await render('png/f.png', '--alpha');
  expect(readdirSync(out('png')).length).toBe(10);
  const [p] = probe(out('png/f_000005.png'));
  expect(p!.pix_fmt).toBe('rgba');
  expect(cornerAlpha(out('png/f_000005.png'), undefined, 0)).toBe(0);
  await render('p16/f.png', '--format', 'png16');
  expect(probe(out('p16/f_000000.png'))[0]!.pix_fmt).toBe('rgb48be');
  await render('j/f.jpg', '--quality', '90');
  expect(probe(out('j/f_000009.jpg'))[0]!.pix_fmt).toBe('yuvj444p');
  await render('x/f.exr', '--alpha', '--from', '0.5');
  // (frames are numbered by their place in the video: a render from 0.5 s at 10 fps starts at 5)
  expect(existsSync(out('x/f_000005.exr'))).toBe(true);
  const [x] = probe(out('x/f_000005.exr'));
  expect([x!.codec_name, x!.pix_fmt, x!.color_transfer]).toEqual(['exr', 'gbrapf16le', 'linear']);
}, 90_000);

test.skipIf(!hasChrome)('--mix and --subtitles are refused for formats that carry no sound', async () => {
  const r = await reel(['video', '--project', proj.dir, '--format', 'gif', '--mix']);
  expect(r.code).toBe(2);
  expect(r.err).toContain('gif carries no sound');
});
