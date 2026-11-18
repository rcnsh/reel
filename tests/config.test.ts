import { expect, test } from 'bun:test';
import { clipsFromSections, defineVideo, formatOf } from '../src/config';
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
  const clips = clipsFromSections({ audio, words: new Words({ lines: [] }) }, { './scenes/a.ts': load, './scenes/b.ts': load, './scenes/_helpers.ts': load });
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
