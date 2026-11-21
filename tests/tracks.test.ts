import { afterAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { blendOf, gradeOf, isIdentityGrade, lerpGrade, matteOf, matteSource, resolveGrade, trackSettingsOf, IDENTITY_GRADE } from '../src/engine/tracks';
import { readPng, type Img } from '../cli/png';
import { fixture, hasChrome, reel, removeTempDirs, tempDir } from './helpers';

afterAll(removeTempDirs);

test('gradeOf, matteOf, blendOf and trackSettingsOf take what they document and name what is wrong', () => {
  expect(gradeOf({ exposure: 2, tint: 'accent', blur: 4 }, 'x')).toEqual({ exposure: 2, tint: 'accent', blur: 4 });
  expect(gradeOf({ tint: [1, 0.5, 0.2] }, 'x')).toEqual({ tint: [1, 0.5, 0.2] });
  expect(() => gradeOf({ sat: 0 }, "clip 'a'")).toThrow("clip 'a': grade {\"sat\":0}: unknown key 'sat'");
  expect(() => gradeOf({ fade: 2 }, 'x')).toThrow('fade must be from 0 to 1');
  expect(() => gradeOf({ blur: -1 }, 'x')).toThrow('blur must be');
  expect(() => gradeOf({ tint: 'nokey' }, 'x')).toThrow('tint must be');
  expect(() => gradeOf({ tint: [1, 1] }, 'x')).toThrow('tint must be');
  expect(() => gradeOf('dark', 'x')).toThrow('expected an object');
  expect(matteOf('luma', 'x')).toEqual({ mode: 'luma', from: 'above' });
  expect(matteOf({ mode: 'alpha-inverted', from: 'below' }, 'x')).toEqual({ mode: 'alpha-inverted', from: 'below' });
  expect(() => matteOf('mask', 'x')).toThrow('mode must be one of alpha, alpha-inverted, luma, luma-inverted');
  expect(() => matteOf({ mode: 'alpha', from: 'left' }, 'x')).toThrow("from must be 'above' or 'below'");
  expect(() => matteOf({ mode: 'alpha', track: 2 }, 'x')).toThrow("unknown key 'track'");
  expect(blendOf('soft-light', 'x')).toBe('soft-light');
  expect(() => blendOf('lighten', "clip 'a'")).toThrow("clip 'a': blend \"lighten\": expected one of normal, add, screen, multiply, max, replace, overlay, soft-light, hard-light, difference, color-dodge");
  expect(trackSettingsOf({ 1: { blend: 'overlay', grade: { saturation: 0 } } }).get(1)).toEqual({ blend: 'overlay', grade: { saturation: 0 } });
  expect(trackSettingsOf(undefined).size).toBe(0);
  expect(() => trackSettingsOf({ x: {} })).toThrow('tracks[x]: a track is a whole number');
  expect(() => trackSettingsOf({ 1: { grad: {} } })).toThrow("tracks[1]: unknown key 'grad'");
  expect(() => trackSettingsOf({ 1: { opacity: -1 } })).toThrow('tracks[1]: opacity -1: expected a number from 0');
  expect(trackSettingsOf({ 1: { opacity: 2 } }).get(1)).toEqual({ opacity: 2 });
  expect(() => trackSettingsOf({ 1: { grade: { contrast: 0 } } })).toThrow('contrast must be');
});

test('a matte reads the nearest track above or below; grades layer, resolve and move between clips', () => {
  expect(matteSource(1, { mode: 'alpha', from: 'above' }, [0, 1, 3], 'x')).toBe(3);
  expect(matteSource(3, { mode: 'alpha', from: 'below' }, [0, 1, 3], 'x')).toBe(1);
  expect(() => matteSource(3, { mode: 'alpha', from: 'above' }, [0, 1, 3], "clip 'a'")).toThrow("clip 'a': matte from above: there is no track above track 3");
  expect(isIdentityGrade(resolveGrade())).toBe(true);
  expect(isIdentityGrade(resolveGrade({ tint: '#ffffff' }))).toBe(true);
  const g = resolveGrade({ exposure: 2, fade: 0.5 }, { fade: 0 }, undefined);
  expect(g).toMatchObject({ exposure: 2, fade: 0, saturation: 1 });
  expect(lerpGrade(IDENTITY_GRADE, g, 0.5).exposure).toBe(1.5);
});

const SOLID = `import type * as THREE from 'three';
import { Scene, type Frame, FSPass } from 'reel';
export default class Solid extends Scene {
  pass = new FSPass(\`uniform vec3 col; uniform float a; uniform vec4 rect;
    void main() {
      vec2 p = vec2(vUv.x, 1.0 - vUv.y);
      bool inside = p.x >= rect.x && p.x < rect.z && p.y >= rect.y && p.y < rect.w;
      fragColor = inside ? vec4(col * a, a) : vec4(0.0);
    }\`, { col: { value: (this.ctx.params.color as number[]) ?? [1, 1, 1] }, a: { value: (this.ctx.params.alpha as number) ?? 1 }, rect: { value: (this.ctx.params.rect as number[]) ?? [0, 0, 1, 1] } });
  render(_f: Frame, out: THREE.WebGLRenderTarget) {
    this.pass.render(this.ctx.renderer, out);
    return this.ctx.params.ret as Record<string, unknown> | undefined;
  }
}
`;

const BG = 0.2, RED = [0.6, 0.1, 0.1];
const LEFT = [0, 0, 0.5, 1];
type C = { id?: string; track?: number; color?: number[]; rect?: number[]; alpha?: number; start?: number; end?: number; [k: string]: unknown };
function config(clips: C[], extra = '', fns: Record<string, string> = {}) {
  const list = clips.map((c, i) => {
    const { id = `c${i}`, track = 0, color, rect, alpha, start = 0, end = 1, ret, ...rest } = c;
    const fn = fns[id] ? `, grade: ${fns[id]}` : '';
    return `{ id: ${JSON.stringify(id)}, scene: () => import('./scenes/solid'), start: ${start}, end: ${end}, track: ${track}, params: ${JSON.stringify({ color, rect, alpha, ret })}${Object.keys(rest).length ? ', ' + JSON.stringify(rest).slice(1, -1) : ''}${fn} }`;
  });
  return `import { defineVideo } from 'reel/config';
export default defineVideo({ size: [128, 72], fps: 30, theme: 'neutral', duration: 1, ${extra} timeline: () => [${list.join(', ')}] });
`;
}

const enc = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
const at = (img: Img, x: number, y = 0.5) => {
  const i = (Math.floor(y * img.height) * img.width + Math.floor(x * img.width)) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
};
const near = (px: number[], lin: number[], tol = 2) => lin.forEach((v, k) => expect(Math.abs(px[k]! - enc(v))).toBeLessThanOrEqual(tol));
const bg = (n = BG) => ({ id: 'bg', color: [n, n, n] });

describe.skipIf(!hasChrome)('rendered', () => {
  const p = fixture('tracks', { 'scenes/solid.ts': SOLID, 'reel.config.ts': config([bg()]) });
  const outDir = tempDir('reel-tracks-out-');
  afterAll(async () => { await reel(['daemon', 'stop', '--project', p.dir]); p.cleanup(); });
  let n = 0;
  async function still(cfg: string, extra: string[] = []) {
    writeFileSync(path.join(p.dir, 'reel.config.ts'), cfg);
    const out = path.join(outDir, `s${n++}.png`);
    const r = await reel(['still', '--project', p.dir, '--t', '0.5', '--out', out, ...extra]);
    if (r.code !== 0) throw new Error(`still failed (${r.code}): ${r.out}${r.err}`);
    return readPng(out);
  }

  test('a grade changes its own track only, set on the track, the clip, by a function or by the scene', async () => {
    const plain = await still(config([bg(), { track: 1, color: RED, rect: LEFT }]));
    near(at(plain, 0.25), RED);
    near(at(plain, 0.75), [BG, BG, BG]);
    const grey = 0.2126 * 0.6 + 0.7152 * 0.1 + 0.0722 * 0.1;
    const t = await still(config([bg(), { track: 1, color: RED, rect: LEFT }], `tracks: { 1: { grade: { saturation: 0 } } },`));
    near(at(t, 0.25), [grey, grey, grey]);
    expect(at(t, 0.75)).toEqual(at(plain, 0.75));
    const c = await still(config([bg(), { track: 1, color: RED, rect: LEFT, grade: { exposure: 0.5 } }], `tracks: { 1: { grade: { saturation: 0 } } },`));
    near(at(c, 0.25), [grey / 2, grey / 2, grey / 2]);
    near(at(await still(config([bg(), { track: 1, color: RED, grade: { fade: 1 } }])), 0.25), [BG, BG, BG]);
    const fl = await still(config([bg(), { track: 1, color: RED, rect: LEFT, grade: { flash: 0.3 } }]));
    expect(at(fl, 0.25)[1]!).toBeGreaterThan(at(plain, 0.25)[1]! + 40);
    expect(at(fl, 0.75)).toEqual(at(plain, 0.75));
    near(at(await still(config([{ ...bg(), grade: { fade: 0.5 } }])), 0.5), [BG / 2, BG / 2, BG / 2]);
    const f = await still(config([bg(), { id: 'red', track: 1, color: RED }], '', { red: '(f) => ({ fade: f.p })' }));
    near(at(f, 0.5), [0.5 * 0.6 + 0.5 * BG, 0.5 * 0.1 + 0.5 * BG, 0.5 * 0.1 + 0.5 * BG]);
    near(at(await still(config([bg(), { track: 1, color: [0.2, 0.1, 0.05], ret: { grade: { exposure: 2 } } }])), 0.5), [0.4, 0.2, 0.1]);
    const x = await still(config([bg(), { id: 'a', track: 1, color: [0.1, 0.1, 0.1], end: 0.75, grade: { exposure: 1 } }, { id: 'b', track: 1, color: [0.1, 0.1, 0.1], start: 0.25, grade: { exposure: 3 } }]));
    near(at(x, 0.5), [0.2, 0.2, 0.2]);
  }, 60_000);

  test('a blur softens the track; it renders the same with adaptive sampling', async () => {
    const cfg = config([bg(0), { track: 1, color: [0.5, 0.5, 0.5], rect: LEFT, grade: { blur: 6 } }]);
    const one = await still(cfg);
    const edge = at(one, 0.5 + 3 / 128)[0]!, inside = at(one, 0.1)[0]!;
    expect(edge).toBeGreaterThan(10);
    expect(edge).toBeLessThan(inside);
    near(at(one, 0.1), [0.5, 0.5, 0.5]);
    const auto = await still(cfg, ['--samples', 'auto']);
    for (const x of [0.1, 0.45, 0.5, 0.55, 0.9]) at(auto, x).forEach((v, k) => expect(Math.abs(v - at(one, x)[k]!)).toBeLessThanOrEqual(2));
    const big = await still(config([bg(0), { track: 1, color: [32, 32, 32], rect: [0.495, 0, 0.505, 1], grade: { blur: 40 } }]), ['--scale', '2']);
    const row = Array.from({ length: 100 }, (_, i) => at(big, 0.5 + i / 256)[0]!);
    for (let i = 1; i < row.length; i++) expect(row[i]!).toBeLessThanOrEqual(row[i - 1]! + 1);
    expect(row[0]!).toBeGreaterThan(row[99]! + 30);
  }, 60_000);

  test('a track matte cuts its track by the track above or below, which is not drawn', async () => {
    const GREEN = [0.1, 0.6, 0.1];
    const stack = (matte: unknown, m: C = { track: 2, color: GREEN, rect: LEFT }) => config([bg(), { track: 1, color: RED }, m], `tracks: { 1: { matte: ${JSON.stringify(matte)} } },`);
    const a = await still(stack('alpha'));
    near(at(a, 0.25), RED);
    near(at(a, 0.75), [BG, BG, BG]);
    const ai = await still(stack('alpha-inverted'));
    near(at(ai, 0.25), [BG, BG, BG]);
    near(at(ai, 0.75), RED);
    const l = await still(stack('luma', { track: 2, color: [1, 1, 1], rect: LEFT }));
    near(at(l, 0.25), RED);
    near(at(l, 0.75), [BG, BG, BG]);
    near(at(await still(stack('luma-inverted', { track: 2, color: [1, 1, 1], rect: LEFT })), 0.25), [BG, BG, BG]);
    const half = await still(stack('luma', { track: 2, color: [0.21404, 0.21404, 0.21404] }));
    near(at(half, 0.5), [0.5 * 0.6 + 0.5 * BG, 0.5 * 0.1 + 0.5 * BG, 0.5 * 0.1 + 0.5 * BG]);
    const below = await still(config([bg(), { track: 1, color: GREEN, rect: LEFT }, { track: 2, color: RED, matte: { mode: 'alpha', from: 'below' } }]));
    near(at(below, 0.25), RED);
    near(at(below, 0.75), [BG, BG, BG]);
    near(at(await still(stack('alpha', { track: 2, color: GREEN, start: 0.8 })), 0.5), [BG, BG, BG]);
    const clipMatte = config([bg(), { id: 'cut', track: 1, color: RED, end: 0.4, matte: 'alpha' }, { id: 'after', track: 1, color: [0.1, 0.1, 0.6], start: 0.4, rect: [0, 0, 0.1, 1] }, { track: 2, color: GREEN, rect: LEFT }]);
    near(at(await still(clipMatte), 0.25), GREEN);
    near(at(await still(stack('alpha', { track: 2, color: GREEN, rect: LEFT, post: { fade: 1 } })), 0.75), [BG, BG, BG]);
    const chain = await still(config([bg(), { track: 1, color: RED }, { track: 2, color: GREEN, rect: LEFT }, { track: 3, color: GREEN, rect: [0, 0, 0.25, 1] }], `tracks: { 1: { matte: 'alpha' }, 2: { matte: 'alpha' } },`));
    near(at(chain, 0.125), RED);
    near(at(chain, 0.375), [BG, BG, BG]);
  }, 60_000);

  test('the blend modes that read the tracks below', async () => {
    const over = (mode: string, top: number[], base = 0.5) => still(config([bg(base), { track: 1, color: top, blend: mode }]));
    near(at(await over('difference', [0.2, 0.5, 0.9]), 0.5), [0.3, 0, 0.4]);
    for (const m of ['overlay', 'soft-light', 'hard-light']) near(at(await over(m, [0.21404, 0.21404, 0.21404], 0.3), 0.5), [0.3, 0.3, 0.3]);
    const white = at(await still(config([{ color: [1, 1, 1] }])), 0.5);
    at(await over('hard-light', [1, 1, 1], 0.3), 0.5).forEach((v, k) => expect(Math.abs(v - white[k]!)).toBeLessThanOrEqual(1));
    expect(at(await over('overlay', [0.05, 0.05, 0.05], 0.1), 0.5)[0]!).toBeLessThan(enc(0.1) - 10);
    near(at(await over('color-dodge', [0.5, 0.5, 0.5], 0.2), 0.5), [0.4, 0.4, 0.4]);
    near(at(await still(config([bg(0.5), { track: 1, color: [0.2, 0.5, 0.9], blend: 'difference', opacity: 0.5 }])), 0.5), [0.4, 0.25, 0.45]);
    const two = await still(config([bg(0.5), { track: 1, color: [0.2, 0.2, 0.2], blend: 'difference' }, { track: 2, color: [0.1, 0.1, 0.1], blend: 'difference' }]));
    near(at(two, 0.5), [0.2, 0.2, 0.2]);
  }, 60_000);

  test('mistakes in the config fail the command with the clip or track named', async () => {
    const fail = async (cfg: string, msg: string) => {
      writeFileSync(path.join(p.dir, 'reel.config.ts'), cfg);
      const r = await reel(['still', '--project', p.dir, '--t', '0.5', '--out', path.join(outDir, 'bad.png')]);
      expect(r.code).toBe(1);
      expect(r.out + r.err).toContain(msg);
    };
    await fail(config([bg(), { id: 'red', track: 1, grade: { sat: 0 } }]), "clip 'red': grade {\"sat\":0}: unknown key 'sat'");
    await fail(config([bg(), { id: 'red', track: 1, matte: 'alpha' }]), "clip 'red': matte from above: there is no track above track 1");
    await fail(config([bg(), { track: 1 }, { track: 2 }], `tracks: { 1: { matte: 'alpha' }, 2: { matte: { mode: 'luma', from: 'below' } } },`), 'the mattes go round in a circle (track 1 is matted by track 2 is matted by track 1)');
    await fail(config([bg(), { id: 'red', track: 1, blend: 'lighten' }]), "clip 'red': blend \"lighten\"");
    await fail(config([bg()], `tracks: { 1: { blend: 'nope' } },`), 'tracks[1]: blend "nope"');
    await fail(config([bg(), { track: 1 }], `tracks: { 3: { grade: { saturation: 0 } } },`), 'tracks[3]: no clip is on track 3 (clips are on 0, 1)');
    await fail(config([bg(), { track: 1 }, { track: 2 }, { track: 3 }], `tracks: { 1: { matte: 'alpha' }, 2: { matte: 'alpha' }, 3: { matte: { mode: 'alpha', from: 'below' } } },`), 'the mattes go round in a circle (track 1 is matted by track 2 is matted by track 3 is matted by track 2)');
  }, 60_000);
});
