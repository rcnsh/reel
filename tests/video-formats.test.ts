import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readPng } from '../cli/png';
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
function cornerAlpha(file: string, decoder?: string, n = 5) {
  const r = Bun.spawnSync(['ffmpeg', '-loglevel', 'error', ...(decoder ? ['-c:v', decoder] : []), '-i', file, '-vf', `select=eq(n\\,${n}),format=rgba`, '-frames:v', '1', '-f', 'rawvideo', '-']);
  return r.stdout[3];
}
async function render(name: string, ...flags: string[]) {
  const r = await reel(['video', '--project', proj.dir, '--out', out(name), '--json', '--wait', ...flags]);
  expect(r.err).not.toContain('ERRORS');
  expect(r.code).toBe(0);
  return r.json();
}
const bt709 = (s: Stream) => [s.color_range, s.color_space, s.color_primaries, s.color_transfer];
function r128(file: string) {
  const e = Bun.spawnSync(['ffmpeg', '-nostdin', '-hide_banner', '-i', file, '-map', 'a', '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']).stderr.toString();
  const at = (k: string) => { const v = e.slice(e.lastIndexOf('Summary:')).match(new RegExp(`${k}:\\s+(-?[\\d.]+|-inf)`))![1]!; return v === '-inf' ? -Infinity : Number(v); };
  return { integrated: at('I'), truePeak: at('Peak') };
}
function onTarget(file: string, integrated = -14, truePeak = -1) {
  const m = r128(file);
  expect(Math.abs(m.integrated - integrated)).toBeLessThanOrEqual(1);
  expect(m.truePeak).toBeLessThanOrEqual(truePeak);
}

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

test.skipIf(!hasChrome)('HEVC Main10 and ProRes 422 HQ: 10-bit from the deep readback, at the levels of the still', async () => {
  await render('h.mp4', '--format', 'hevc');
  const [v] = probe(out('h.mp4'));
  expect([v!.codec_name, v!.pix_fmt, v!.profile]).toEqual(['hevc', 'yuv420p10le', 'Main 10']);
  expect(bt709(v!)).toEqual(['tv', 'bt709', 'bt709', 'bt709']);
  const still = await reel(['still', '--project', proj.dir, '--no-daemon', '--t', '0.5', '--out', out('bg.png')]);
  expect(still.code).toBe(0);
  const grey = readPng(out('bg.png')).data[0]!;
  const y = Bun.spawnSync(['ffmpeg', '-loglevel', 'error', '-i', out('h.mp4'), '-vf', 'select=eq(n\\,5)', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'yuv420p10le', '-']).stdout;
  expect(Math.abs((y[0]! | (y[1]! << 8)) - (64 + (876 * grey) / 255))).toBeLessThan(1.5);
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
  const m = await render('m.webm', '--mix');
  expect(m.loudness).toBeTruthy();
  expect(probe(out('m.webm')).map((x) => x.codec_name)).toEqual(['vp9', 'opus']);
  onTarget(out('m.webm'));
  await render('o.webm', '--opaque');
  expect(probe(out('o.webm'))[0]!.tags?.alpha_mode ?? '0').not.toBe('1');
}, 90_000);

test.skipIf(!hasChrome)('the mix lands on its loudness target: -14 LUFS and -1 dBTP by default, or what mix.json says', async () => {
  const m = await render('loud.mp4', '--mix');
  onTarget(out('loud.mp4'));
  expect(Math.abs(m.loudness.integrated - r128(out('loud.mp4')).integrated)).toBeLessThanOrEqual(0.2);
  await Bun.write(path.join(proj.dir, 'mix.json'), JSON.stringify({ loudness: { integrated: -20, truePeak: -3 } }));
  try {
    await render('quiet.mp4', '--mix');
    onTarget(out('quiet.mp4'), -20, -3);
  } finally { Bun.spawnSync(['rm', '-f', path.join(proj.dir, 'mix.json')]); }
}, 60_000);

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
  expect(existsSync(out('x/f_000005.exr'))).toBe(true);
  const [x] = probe(out('x/f_000005.exr'));
  expect([x!.codec_name, x!.color_transfer]).toEqual(['exr', 'linear']);
  expect(x!.pix_fmt).toMatch(/^gbrapf(16|32)le$/);
  expect(exrChannels(out('x/f_000005.exr'))).toEqual([['A', 1], ['B', 1], ['G', 1], ['R', 1]]);
}, 90_000);

function exrChannels(file: string): [string, number][] {
  const b = readFileSync(file);
  let i = b.indexOf('channels\0chlist\0') + 16 + 4;
  const out: [string, number][] = [];
  while (b[i] !== 0) {
    const end = b.indexOf(0, i);
    out.push([b.toString('latin1', i, end), b.readInt32LE(end + 1)]);
    i = end + 1 + 16;
  }
  return out;
}

test.skipIf(!hasChrome)('--mix and --subtitles are refused for formats that carry no sound', async () => {
  const r = await reel(['video', '--project', proj.dir, '--format', 'gif', '--mix']);
  expect(r.code).toBe(2);
  expect(r.err).toContain('gif carries no sound');
});

test.skipIf(!hasChrome)('--draft: half size, one sample, encoded in the page, named and tagged a draft, with the sound', async () => {
  const j = await render('v.mp4', '--draft');
  expect(j.file).toEndWith('v.draft.mp4');
  expect(j.draft.scale).toBe(0.5);
  const r = Bun.spawnSync(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', j.file]);
  const p = JSON.parse(r.stdout.toString());
  expect(p.streams.map((s: Stream) => s.codec_name)).toEqual(['h264', 'aac']);
  expect(p.streams[0].width).toBe(160);
  expect(bt709(p.streams[0])).toEqual(['tv', 'bt709', 'bt709', 'bt709']);
  expect(p.format.tags.comment).toContain('reel draft');
  const bad = await reel(['video', '--project', proj.dir, '--draft', '--samples', 'auto']);
  expect(bad.code).toBe(2);
}, 60_000);
