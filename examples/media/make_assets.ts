// Makes this example's media, all from code so they carry no licence: a vertical video clip with its own sound
// (ffmpeg's gradients and a soft chord), a Lottie badge written by hand (a disc that pops in, a ring drawn round
// it, a tick drawn in), and an SVG mark. Run from the engine's folder: bun examples/media/make_assets.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dir, 'assets');
mkdirSync(dir, { recursive: true });

// The clip: 8 s of slowly turning colour at 720x1280, 30 fps, a keyframe every second (quick to seek), and a chord
// that swells and fades
const chord = '0.5*(0.30*sin(2*PI*220*t)+0.22*sin(2*PI*277.18*t)+0.18*sin(2*PI*329.63*t)+0.10*sin(2*PI*440*t))*(0.75+0.25*sin(2*PI*0.25*t))*min(1,t/1.5)*min(1,(8-t)/1.5)';
const ff = Bun.spawnSync(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'gradients=s=720x1280:r=30:d=8:c0=0x14213d:c1=0xe4572e:c2=0xf3a712:c3=0x2e86ab:nb_colors=4:speed=0.03:type=spiral:seed=7',
  '-f', 'lavfi', '-i', `aevalsrc=exprs='${chord}|${chord}':s=48000:d=8`,
  '-vf', 'format=yuv420p', '-c:v', 'libx264', '-crf', '26', '-g', '30', '-preset', 'slow', '-c:a', 'aac', '-b:a', '96k', '-shortest',
  path.join(dir, 'clip.mp4')]);
if (ff.exitCode !== 0) throw new Error(ff.stderr.toString());

// The badge: Lottie 5 JSON, 512 x 512 at 30 fps, 2 s
const fixed = (k: unknown) => ({ a: 0, k });
const keys = (...ks: [number, number[]][]) => ({
  a: 1,
  k: ks.map(([t, s], i) => (i < ks.length - 1 ? { t, s, i: { x: s.map(() => 0.25), y: s.map(() => 1) }, o: { x: s.map(() => 0.6), y: s.map(() => 0) } } : { t, s })),
});
const transform = { ty: 'tr', p: fixed([0, 0]), a: fixed([0, 0]), s: fixed([100, 100]), r: fixed(0), o: fixed(100), sk: fixed(0), sa: fixed(0) };
// (`ip`: the frame a layer appears on; a stroke drawn on with round caps shows a dot while its trim is still at 0)
const layer = (ind: number, nm: string, items: unknown[], ks: Record<string, unknown> = {}, ip = 0) => ({
  ddd: 0, ind, ty: 4, nm, sr: 1, ao: 0, ip, op: 60, st: 0, bm: 0,
  ks: { o: fixed(100), r: fixed(0), p: fixed([256, 256, 0]), a: fixed([0, 0, 0]), s: fixed([100, 100, 100]), ...ks },
  shapes: [{ ty: 'gr', nm: `${nm} group`, it: [...items, transform] }],
});
const stroke = (w: number) => ({ ty: 'st', c: fixed([1, 1, 1, 1]), o: fixed(100), w: fixed(w), lc: 2, lj: 2, nm: 'stroke' });
const trim = (from: number, to: number) => ({ ty: 'tm', s: fixed(0), e: keys([from, [0]], [to, [100]]), o: fixed(0), m: 1, nm: 'draw on' });
const badge = {
  v: '5.7.4', nm: 'badge', fr: 30, ip: 0, op: 60, w: 512, h: 512, ddd: 0, assets: [],
  layers: [
    layer(1, 'tick', [{ ty: 'sh', nm: 'tick path', ks: fixed({ c: false, v: [[-78, 6], [-22, 60], [86, -58]], i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]] }) }, stroke(30), trim(16, 34)], {}, 17),
    layer(2, 'ring', [{ ty: 'el', nm: 'ring shape', p: fixed([0, 0]), s: fixed([330, 330]), d: 1 }, stroke(14), trim(4, 28)], { r: keys([4, [-90]], [28, [0]]) }, 5),
    layer(3, 'disc', [{ ty: 'el', nm: 'disc shape', p: fixed([0, 0]), s: fixed([380, 380]), d: 1 }, { ty: 'fl', c: fixed([0.894, 0.341, 0.18, 1]), o: fixed(100), r: 1, nm: 'fill' }],
      { s: keys([0, [0, 0, 100]], [12, [112, 112, 100]], [20, [100, 100, 100]]) }),
  ],
};
writeFileSync(path.join(dir, 'badge.json'), JSON.stringify(badge));

// The mark: a frame with a play triangle, shapes only (no text, so no font to depend on)
writeFileSync(path.join(dir, 'mark.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">
  <rect x="3" y="3" width="114" height="74" rx="14" fill="none" stroke="#ffffff" stroke-width="6"/>
  <path d="M50 24 L78 40 L50 56 Z" fill="#f3a712"/>
  <circle cx="20" cy="20" r="4" fill="#ffffff"/><circle cx="100" cy="20" r="4" fill="#ffffff"/>
  <circle cx="20" cy="60" r="4" fill="#ffffff"/><circle cx="100" cy="60" r="4" fill="#ffffff"/>
</svg>
`);
console.log(`wrote ${dir}: clip.mp4, badge.json, mark.svg`);
