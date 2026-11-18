// The kit's Waveform and Spectrum drawn from an analysis whose content is known: the lit bars are where the
// sound is, what has played is in the accent, and check passes them.
import { afterAll, expect, test } from 'bun:test';
import { readPng } from '../cli/png';
import { fixture, hasChrome, reel } from './helpers';

const b64 = (xs: ArrayLike<number>) => Buffer.from(Uint8Array.from(xs)).toString('base64');
// 2 s at 100 fps: the waveform loud for the first second, silent after; the spectrum's lowest band full, the rest silent
const N = 200, B = 24;
const audio = {
  duration: 2, bpm: 120, fps: 100, beats: [], downbeats: [], sections: [], features: {}, onsets: {}, track: 'audio/none.flac',
  wave: { fps: 100, peak: b64(Array.from({ length: N }, (_, i) => (i < 100 ? 255 : 0))), rms: b64(Array.from({ length: N }, (_, i) => (i < 100 ? 120 : 0))) },
  spectrum: { fps: 100, bands: Array.from({ length: B }, (_, i) => Math.round(45 * 1.28 ** i)), data: b64(Array.from({ length: N * B }, (_, i) => (i % B === 0 ? 255 : 0))) },
};

const project = fixture('vis', {
  'reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({ size: [1280, 720], fps: 30, theme: 'neutral', timeline: () => [{ id: 'vis', scene: () => import('./scenes/vis'), start: 0, end: 2 }] });
`,
  'data/audio.json': JSON.stringify(audio),
  'scenes/vis.ts': `import type * as THREE from 'three';
import { Scene, type Frame, Waveform, Spectrum, clearRT, LIN } from 'reel';
export default class Vis extends Scene {
  wave = new Waveform({ audio: this.ctx.audio, count: 50, motion: false, box: { x: 100, y: 100, w: 1000, h: 200 } });
  line = new Waveform({ audio: this.ctx.audio, window: 1, style: 'line', motion: false, box: { x: 100, y: 330, w: 1000, h: 60 } });
  bars = new Spectrum({ audio: this.ctx.audio, motion: false, box: { x: 100, y: 420, w: 480, h: 200 } });
  ring = new Spectrum({ audio: this.ctx.audio, style: 'radial', motion: false, box: { x: 800, y: 420, w: 260, h: 260 } });
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    clearRT(r, out, LIN.bg);
    this.wave.draw(r, out, f); this.line.draw(r, out, f); this.bars.draw(r, out, f); this.ring.draw(r, out, f);
  }
}
`,
});
afterAll(async () => { await reel(['daemon', 'stop', '--project', project.dir]); project.cleanup(); });

test.skipIf(!hasChrome)('waveform and spectrum bars stand where the sound is; what has played is in the accent', async () => {
  const r = await reel(['still', '--t', '0.5', '--json', '--project', project.dir]);
  expect(r.code).toBe(0);
  const img = readPng(r.json().files[0]);
  const px = (x: number, y: number) => { const i = (y * img.width + x) * 4; return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!] as const; };
  const accent = (x: number, y: number) => { const [rr, , bb] = px(x, y); return bb - rr > 100; };      // #2F6BFF
  const bg = (x: number, y: number) => px(x, y).every((c) => c > 235);                                // #F4F4F2
  const grey = (x: number, y: number) => { const [rr, g, bb] = px(x, y); return !bg(x, y) && Math.abs(rr - bb) < 12 && Math.abs(rr - g) < 12; };
  // static waveform, 50 bars of 20 px over the clip's 2 s; at 0.5 s a quarter has played. Bar k's middle: 110 + 20 k
  expect(accent(110 + 20 * 5, 110)).toBe(true);    // played and loud: full height, accent
  expect(bg(110 + 20 * 40, 110)).toBe(true);       // silent: no bar, only a dot on the middle line, in the rest colour
  expect(grey(110 + 20 * 40, 200)).toBe(true);
  expect(grey(110 + 20 * 20, 110)).toBe(true);     // loud but not played: the rest colour
  expect(bg(110 + 20 * 5 + 10, 110)).toBe(true);   // the gap between bars
  // spectrum bars: 24 of 20 px; the lowest band full height, the highest a dot on the baseline
  expect(accent(110, 430)).toBe(true);
  expect(bg(110 + 20 * 23, 430)).toBe(true);
  expect(accent(110 + 20 * 23, 612)).toBe(true);
  // radial: the lowest band at the top reaches out to the box's edge, the bottom (the highest band) does not
  expect(accent(930, 424)).toBe(true);
  expect(bg(930, 676)).toBe(true);
}, 180_000);

test.skipIf(!hasChrome)('check passes them, and a frame renders the same after a seek', async () => {
  const c = await reel(['check', '--json', '--project', project.dir]);
  expect(c.json().findings.filter((f: { severity: string }) => f.severity !== 'info')).toEqual([]);
  const first = (await reel(['still', '--t', '1.2', '--json', '--project', project.dir])).json().files[0];
  await reel(['still', '--t', '0.3', '--json', '--project', project.dir]);
  const again = await reel(['diff', '--t', '1.2', first, '--json', '--project', project.dir]);
  expect(again.json().changed).toBe(0);
}, 180_000);

// an analysis from before the waveform and spectrum were stored (or narration): a clear error, not a flat line
const old = fixture('vis-old', {
  'reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({ size: [1280, 720], fps: 30, theme: 'neutral', timeline: () => [{ id: 'old', scene: () => import('./scenes/old'), start: 0, end: 2 }] });
`,
  'data/audio.json': JSON.stringify({ ...audio, wave: undefined, spectrum: undefined }),
  'scenes/old.ts': `import type * as THREE from 'three';
import { Scene, type Frame, Spectrum, clearRT, LIN } from 'reel';
export default class Old extends Scene {
  bars = new Spectrum({ audio: this.ctx.audio });
  render(f: Frame, out: THREE.WebGLRenderTarget) { clearRT(this.ctx.renderer, out, LIN.bg); this.bars.draw(this.ctx.renderer, out, f); }
}
`,
});
afterAll(async () => { await reel(['daemon', 'stop', '--project', old.dir]); old.cleanup(); });

test.skipIf(!hasChrome)('an analysis without a spectrum is an error naming the fix', async () => {
  const r = await reel(['still', '--t', '0.5', '--json', '--project', old.dir]);
  expect(r.code).toBe(1);
  expect(JSON.stringify(r.json().errors)).toContain('data/audio.json has no spectrum: run `reel analyze <song>`');
}, 180_000);
