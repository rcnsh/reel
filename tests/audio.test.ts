import { expect, test } from 'bun:test';
import { AudioData } from '../src/engine/audio';

const grid = (bpm: number, from: number, n: number) => Array.from({ length: n }, (_, i) => +(from + (i * 60) / bpm).toFixed(6));
const A = new AudioData({
  duration: 10, bpm: 120, fps: 100, beats: grid(120, 0.5, 19), downbeats: grid(30, 0.5, 5), sections: [{ name: 'a', start: 0, end: 4 }, { name: 'b', start: 4, end: 10 }],
  features: { rms: Array.from({ length: 1000 }, (_, i) => i / 1000) }, onsets: { kick: [[1, 1], [2, 0.5]] },
});

test('beats and bars', () => {
  expect(A.beatAt(0.5)).toBe(0);
  expect(A.beatAt(0.75)).toBeCloseTo(0.5, 9);
  expect(A.beatAt(0)).toBeCloseTo(-1, 9); // extrapolated before the first beat
  expect(A.beatAt(11)).toBeCloseTo(18 + 1.5 / 0.5, 6);
  expect(A.timeOfBeat(2)).toBeCloseTo(1.5, 9);
  expect(A.timeOfBeat(-1)).toBeCloseTo(0, 9);
  expect(A.barAt(2.5)).toBeCloseTo(1, 9);
  expect(A.nearestBeat(0.8)).toBeCloseTo(1, 9);
  expect(A.beatBefore(1.49)).toBeCloseTo(1.5, 9); // within the 20 ms slack
  expect(A.beatBefore(1.4)).toBeCloseTo(1, 9);
  expect(A.beatBefore(0.1)).toBe(0); // never before 0
  expect(A.nearestDownbeat(3)).toBeCloseTo(2.5, 9);
  expect(A.section(5)?.name).toBe('b');
});

test('envelopes and hits', () => {
  expect(A.env('rms', 5)).toBeCloseTo(0.5, 6);
  expect(A.env('rms', -1)).toBe(0);
  expect(A.env('rms', 99)).toBeCloseTo(0.999, 6); // (Float32)
  expect(A.env('nothing', 1)).toBe(0);
  expect(A.hit('kick', 0.9)).toBe(0);
  expect(A.hit('kick', 1)).toBe(1);
  expect(A.hit('kick', 1.11, 0.11)).toBeCloseTo(0.5, 9);
  expect(A.events('kick', 0, 1.5)).toEqual([[1, 1]]);
  expect(A.sample(1).kick).toBe(1);
});

test('no analysis: a silent grid, no track', () => {
  const E = AudioData.empty();
  expect(E.track).toBeNull();
  expect(E.beatAt(0.6)).toBeCloseTo(1, 9); // 100 BPM
  expect(E.nearestDownbeat(3)).toBe(3);
  expect(new AudioData({ duration: 5, bpm: 100, fps: 100, beats: [], downbeats: [], sections: [], features: {}, onsets: {} }).track).toBe('audio/narration.mp3');
});
