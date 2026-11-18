import { expect, test } from 'bun:test';
import { clipsFromSections, defineVideo, formatOf, resolveProps, type VideoConfig } from '../src/config';
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
