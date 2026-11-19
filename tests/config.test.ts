import { expect, test } from 'bun:test';
import { clipsFromSections, defineVideo, formatOf, resolveProps, sequence, type Clip, type VideoConfig } from '../src/config';
import { AudioData } from '../src/engine/audio';
import { Words } from '../src/engine/words';
import { loadConfig, workspaceOf } from '../cli/server';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('formatOf: defaults and checks', () => {
  expect(formatOf(defineVideo({ timeline: () => [] }))).toEqual({ w: 1920, h: 1080, fps: 60 });
  expect(formatOf({ size: [1080, 1920], fps: 30, timeline: () => [] })).toEqual({ w: 1080, h: 1920, fps: 30 });
  expect(() => formatOf({ size: [1082, 1920], timeline: () => [] })).toThrow('multiple of 4');
  expect(() => formatOf({ size: [1080, 1921], timeline: () => [] })).toThrow('height even');
  expect(() => formatOf({ size: [8, 8], timeline: () => [] })).toThrow('16 to 8192');
  expect(() => formatOf({ fps: 0, timeline: () => [] })).toThrow('frame rate');
  expect(() => formatOf({ fps: 241, timeline: () => [] })).toThrow('frame rate');
});

test('clipsFromSections: one clip per section with a scene, each until the next', () => {
  const audio = new AudioData({ duration: 9, bpm: 100, fps: 100, beats: [], downbeats: [], sections: [{ name: 'a', start: 0.6, end: 3 }, { name: 'skip', start: 3, end: 5 }, { name: 'b', start: 5, end: 9 }], features: {}, onsets: {} });
  const load = async () => ({ default: class {} });
  const clips = clipsFromSections({ audio, words: new Words({ lines: [] }), props: {} }, { './scenes/a.ts': load, './scenes/b.ts': load, './scenes/_helpers.ts': load });
  expect(clips.map(({ id, start, end }) => ({ id, start, end }))).toEqual([{ id: 'a', start: 0, end: 5 }, { id: 'b', start: 5, end: 9 }]);
});

const load = (async () => ({ default: class {} })) as unknown as Clip['scene'];
const windows = (clips: { id: string; start: number; end: number; transition?: unknown; track?: number }[]) => clips.map(({ id, start, end, transition, track }) => ({ id, start, end, transition, track }));

test('sequence: clips back to back, a transition overlapping the clip before', () => {
  const clips = sequence([
    { id: 'title', scene: load, dur: 4.4 },
    { id: 'light', scene: load, dur: 5, transition: 'slide' },
    { id: 'samples', scene: load, dur: 6.2, transition: { kind: 'wipe', direction: 'right' } },
    { id: 'cut', scene: load, dur: 2 },
    { id: 'fade', scene: load, dur: 3, overlap: 1 },
  ], { overlap: 0.4 });
  expect(windows(clips)).toEqual([
    { id: 'title', start: 0, end: 4.4, transition: undefined, track: undefined },
    { id: 'light', start: 4, end: 9, transition: 'slide', track: undefined },
    { id: 'samples', start: 8.6, end: 14.8, transition: { kind: 'wipe', direction: 'right' }, track: undefined },
    { id: 'cut', start: 14.8, end: 16.8, transition: undefined, track: undefined },
    { id: 'fade', start: 15.8, end: 18.8, transition: undefined, track: undefined },
  ]);
  expect(clips[1]).not.toHaveProperty('dur');
  expect(clips[1]).not.toHaveProperty('overlap');
});

test('sequence: a start, a track and a default transition; bad lengths throw', () => {
  const clips = sequence([{ id: 'a', scene: load, dur: 2, params: { n: 1 } }, { id: 'b', scene: load, dur: 2 }, { id: 'c', scene: load, dur: 2, transition: 'zoom', overlap: 0.25 }], { start: 10, track: 2, transition: 'dip' });
  expect(windows(clips)).toEqual([
    { id: 'a', start: 10, end: 12, transition: undefined, track: 2 },
    { id: 'b', start: 11.5, end: 13.5, transition: 'dip', track: 2 },
    { id: 'c', start: 13.25, end: 15.25, transition: 'zoom', track: 2 },
  ]);
  expect(clips[0]!.params).toEqual({ n: 1 });
  expect(() => sequence([{ id: 'a', scene: load, dur: 0 }])).toThrow("clip 'a': dur 0 must be above 0");
  expect(() => sequence([{ id: 'a', scene: load, dur: 1, overlap: 0.5 }])).toThrow('no clip before it');
  expect(() => sequence([{ id: 'a', scene: load, dur: 1 }, { id: 'b', scene: load, dur: 3, overlap: 1 }])).toThrow("clip 'b': overlap 1 reaches back");
  expect(() => sequence([{ id: 'a', scene: load, dur: 1 }, { id: 'b', scene: load, dur: 3, overlap: -1 }])).toThrow("clip 'b': overlap -1 must be");
  expect(() => sequence([], { start: -1 })).toThrow('start -1');
  expect(() => sequence([{ id: 'a', scene: load, dur: 1, overlap: NaN }])).toThrow('no clip before it');
  // a clip that would reach back over two before it: b is overlapped on both sides by more than its length
  expect(() => sequence([{ id: 'a', scene: load, dur: 10 }, { id: 'b', scene: load, dur: 1, overlap: 0.6 }, { id: 'c', scene: load, dur: 1, overlap: 0.6 }])).toThrow("clip 'c': overlap 0.6 reaches back past the start of the clip before, 'b'");
  expect(sequence([{ id: 'a', scene: load, dur: 10 }, { id: 'b', scene: load, dur: 1, overlap: 0.5 }, { id: 'c', scene: load, dur: 1, overlap: 0.5 }]).map((c) => c.start)).toEqual([0, 9.5, 10]);
  // (0.1 + 0.2 is 0.30000000000000004: no clip three back for the sake of a rounding error)
  expect(sequence([{ id: 'a', scene: load, dur: 5 }, { id: 'b', scene: load, dur: 0.3, overlap: 0.1 }, { id: 'c', scene: load, dur: 2, overlap: 0.2 }]).map((c) => c.start)).toEqual([0, 4.9, 5]);
  expect(sequence([])).toEqual([]);
});

test('clipsFromSections: transitions overlap the clips across each boundary, centred on it', () => {
  const audio = new AudioData({ duration: 9, bpm: 100, fps: 100, beats: [], downbeats: [], sections: [{ name: 'a', start: 0.6, end: 3 }, { name: 'b', start: 3, end: 5 }, { name: 'c', start: 5, end: 9 }], features: {}, onsets: {} });
  const src = { audio, words: new Words({ lines: [] }) }, mods = { './scenes/a.ts': load, './scenes/b.ts': load, './scenes/c.ts': load };
  expect(windows(clipsFromSections(src, mods, { transition: 'wipe' }))).toEqual([
    { id: 'a', start: 0, end: 3.25, transition: undefined, track: undefined },
    { id: 'b', start: 2.75, end: 5.25, transition: 'wipe', track: undefined },
    { id: 'c', start: 4.75, end: 9, transition: 'wipe', track: undefined },
  ]);
  const named = clipsFromSections(src, mods, { transition: (n) => (n === 'c' ? 'zoom' : undefined), overlap: 1, params: (n) => ({ n }) });
  expect(windows(named)).toEqual([
    { id: 'a', start: 0, end: 3, transition: undefined, track: undefined },
    { id: 'b', start: 3, end: 5.5, transition: undefined, track: undefined },
    { id: 'c', start: 4.5, end: 9, transition: 'zoom', track: undefined },
  ]);
  expect(named.map((c) => c.params)).toEqual([{ n: 'a' }, { n: 'b' }, { n: 'c' }]);
  expect(clipsFromSections(src, mods, { params: { k: 1 } })[2]!.params).toEqual({ k: 1 });
  // an overlap without a transition crossfades every boundary
  expect(windows(clipsFromSections(src, mods, { overlap: 0.4 })).map((c) => [c.start, c.end])).toEqual([[0, 3.2], [2.8, 5.2], [4.8, 9]]);
  expect(() => clipsFromSections(src, mods, { overlap: 2.2 })).toThrow("section 'b' (2.00 s) is too short");
  // b's whole length overlapped, half by a and half by c, but never three at once
  expect(windows(clipsFromSections(src, mods, { overlap: 2 })).map((c) => [c.start, c.end])).toEqual([[0, 4], [2, 6], [4, 9]]);
  expect(() => clipsFromSections(src, mods, { overlap: -1 })).toThrow('overlap -1');
});

test('loadConfig: a config that does not parse names the file, line and column', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'reel-test-config-'));
  try {
    writeFileSync(path.join(dir, 'reel.config.ts'), "import { defineVideo } from 'reel/config';\nexport default defineVideo({ timeline: () => [] });\ngarbage(\n");
    await expect(loadConfig(dir)).rejects.toThrow(`${path.join(dir, 'reel.config.ts')}:3:9: Unexpected end of file`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('workspaceOf: a monorepo root with a workspace marker, never a stray package.json above the project', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'reel-ws-'));
  try {
    const project = path.join(root, 'a/b');
    mkdirSync(project, { recursive: true });
    writeFileSync(path.join(root, 'package.json'), '{}');
    expect(workspaceOf(project, () => root)).toEqual([]);
    expect(workspaceOf(project, () => project)).toEqual([]);
    writeFileSync(path.join(root, 'package.json'), '{ "workspaces": ["a/*"] }');
    expect(workspaceOf(project, () => root)).toEqual([root]);
    writeFileSync(path.join(root, 'package.json'), '{}');
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages: [a]');
    expect(workspaceOf(project, () => root)).toEqual([root]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resolveProps: the given props over the defaults, key by key, checked against them', () => {
  expect(resolveProps(undefined, null)).toEqual({});
  expect(resolveProps(undefined, { anything: [1] })).toEqual({ anything: [1] });
  const d = { title: 'Hi', n: 1, on: false, tags: ['a'], style: { x: 1 }, extra: null };
  expect(resolveProps(d, null)).toEqual(d);
  expect(resolveProps(d, { title: 'Q3', tags: [], extra: { any: 'thing' } })).toEqual({ ...d, title: 'Q3', tags: [], extra: { any: 'thing' } });
  expect(() => resolveProps(d, { titel: 'x' })).toThrow("'titel' is not one of the config's props (title, n, on, tags, style, extra)");
  expect(() => resolveProps(d, { constructor: 'x' })).toThrow('not one of');
  expect(() => resolveProps(d, { n: '1' })).toThrow("'n' expected a number, as in the config's props, got a string");
  expect(() => resolveProps(d, { tags: { 0: 'a' } })).toThrow("'tags' expected an array, as in the config's props, got an object");
  expect(() => resolveProps(d, { style: null })).toThrow("'style' expected an object, as in the config's props, got null");
  expect(() => resolveProps({}, { a: 1 })).toThrow('(it has none)');
  expect(() => resolveProps([1], null)).toThrow("the config's props: expected an object, got an array");
  // (an optional prop: a default of undefined, like null, takes any value)
  expect(resolveProps({ title: 'x', subtitle: undefined }, { subtitle: 'hi' })).toEqual({ title: 'x', subtitle: 'hi' });
  // (the defaults are not changed)
  expect(d.title).toBe('Hi');
});

test('defineVideo types src.props from the config\'s props', () => {
  const c = defineVideo({
    props: { title: 'Hi', seconds: 2 },
    timeline: (src) => {
      const t: string = src.props.title, s: number = src.props.seconds;
      // @ts-expect-error: not a prop of the config
      void src.props.missing;
      return [{ id: t, scene: async () => ({ default: class {} as never }), start: 0, end: s }];
    },
  });
  expect(c.timeline({ words: new Words({ lines: [] }), audio: AudioData.empty(), props: { title: 'x', seconds: 3 } }).map((e) => [e.id, e.end])).toEqual([['x', 3]]);
});

/** Props typed as the authoring skill says: an interface (which has no index signature). */
interface TitleProps { title: string; n: number }

test('a config with typed props (inferred, or an interface) and a sounds function is still a VideoConfig', () => {
  const c = defineVideo({ props: { title: 'x' }, timeline: () => [], sounds: (src) => [{ file: src.props.title, at: 0 }] });
  const d = defineVideo({ props: { title: 'x', n: 1 } as TitleProps, timeline: () => [], sounds: (src) => [{ file: src.props.title, at: src.props.n }] });
  const vc: VideoConfig = c, vd: VideoConfig = d;
  expect([formatOf(vc).fps, formatOf(vd).fps]).toEqual([60, 60]);
});
