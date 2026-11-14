import { expect, test } from 'bun:test';
import { clipsFromSections, defineVideo, formatOf } from '../src/config';
import { AudioData } from '../src/engine/audio';
import { Words } from '../src/engine/words';

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
