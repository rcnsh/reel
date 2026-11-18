// Transitions named in a clip's config: checked strictly, and the share of each clip that shows.
import { expect, test } from 'bun:test';
import { idleTransitions, transitionOf, transitionWeights } from '../src/engine/transitions';

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

test('idleTransitions: a transition on a clip that does not overlap the one before it on its track never plays', () => {
  const clips = [
    { id: 'a', start: 0, end: 2 },
    { id: 'b', start: 1.5, end: 4, transition: 'wipe' }, // overlaps a: plays
    { id: 'c', start: 4, end: 6, transition: 'slide' }, // touches b: cuts
    { id: 'd', start: 6, end: 8 }, // no transition set: a cut is what was asked
    { id: 'e', start: 1, end: 3, track: 1, transition: { kind: 'dip' } }, // first on its track
    { id: 'f', start: 3.5, end: 5, track: 1, transition: 'crossfade' }, // a gap after e
  ];
  const w = idleTransitions(clips);
  expect(w.map((x) => x.clip)).toEqual(['c', 'e', 'f']);
  expect(w[0]!.message).toContain("does not overlap 'b'");
  expect(w[0]!.message).toContain("overlap it by the transition's length");
  expect(w[1]!.message).toContain('no clip before it on track 1');
  // clips that start together composite in timeline order: the later one's transition plays over the earlier
  expect(idleTransitions([{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 0, end: 5, transition: 'wipe' }])).toEqual([]);
  expect(idleTransitions([{ id: 'b', start: 0, end: 5, transition: 'wipe' }, { id: 'a', start: 0, end: 3 }]).map((x) => x.clip)).toEqual(['b']);
  // an overlap shorter than a frame shows on no frame
  const near = [{ id: 'a', start: 0, end: 4.3 + 1e-9 }, { id: 'b', start: 4.3, end: 6, transition: 'wipe' }];
  expect(idleTransitions(near)).toEqual([]);
  expect(idleTransitions(near, 1 / 30).map((x) => x.clip)).toEqual(['b']);
  expect(idleTransitions(near, 1 / 30)[0]!.message).toContain('by less than a frame');
  // exactly a frame, written the usual way, plays
  expect(idleTransitions([{ id: 'a', start: 0, end: 9 }, { id: 'b', start: 9 - 1 / 30, end: 12, transition: 'crossfade' }], 1 / 30)).toEqual([]);
});
