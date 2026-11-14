// Transitions named in a clip's config: checked strictly, and the share of each clip that shows.
import { expect, test } from 'bun:test';
import { transitionOf, transitionWeights } from '../src/engine/transitions';

test('transitionOf takes a name or an object and rejects anything else', () => {
  expect(transitionOf(undefined, 'x')).toEqual({ kind: 'crossfade' });
  expect(transitionOf('wipe', 'x')).toEqual({ kind: 'wipe' });
  expect(transitionOf({ kind: 'dip', color: 'accent' }, 'x')).toEqual({ kind: 'dip', color: 'accent' });
  expect(() => transitionOf('fade', "clip 'a'")).toThrow("clip 'a': transition \"fade\": kind must be one of crossfade, wipe, slide, zoom, dip");
  expect(() => transitionOf({ kind: 'wipe', dir: 'left' }, 'x')).toThrow("unknown key 'dir'");
  expect(() => transitionOf({ kind: 'slide', direction: 'sideways' }, 'x')).toThrow('direction must be');
  expect(() => transitionOf({ kind: 'dip', color: 'nokey' }, 'x')).toThrow('palette key');
  expect(() => transitionOf({ kind: 'wipe', softness: 2 }, 'x')).toThrow('softness');
});

test('transitionWeights: a crossfade is linear, a dip shows neither clip at its middle', () => {
  expect(transitionWeights({ kind: 'crossfade' }, 0.25)).toEqual([0.75, 0.25]);
  expect(transitionWeights({ kind: 'dip' }, 0.5)).toEqual([0, 0]);
  expect(transitionWeights({ kind: 'dip' }, 0.75)).toEqual([0, 0.5]);
  const [o, i] = transitionWeights({ kind: 'wipe' }, 0.5);
  expect(o + i).toBeCloseTo(1);
});
