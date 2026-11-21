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
  expect(A.beatAt(0)).toBeCloseTo(-1, 9);
  expect(A.beatAt(11)).toBeCloseTo(18 + 1.5 / 0.5, 6);
  expect(A.timeOfBeat(2)).toBeCloseTo(1.5, 9);
  expect(A.timeOfBeat(-1)).toBeCloseTo(0, 9);
  expect(A.barAt(2.5)).toBeCloseTo(1, 9);
  expect(A.nearestBeat(0.8)).toBeCloseTo(1, 9);
  expect(A.beatBefore(1.49)).toBeCloseTo(1.5, 9);
  expect(A.beatBefore(1.4)).toBeCloseTo(1, 9);
  expect(A.beatBefore(0.1)).toBe(0);
  expect(A.nearestDownbeat(3)).toBeCloseTo(2.5, 9);
  expect(A.section(5)?.name).toBe('b');
});

test('envelopes and hits', () => {
  expect(A.env('rms', 5)).toBeCloseTo(0.5, 6);
  expect(A.env('rms', -1)).toBe(0);
  expect(A.env('rms', 99)).toBeCloseTo(0.999, 6);
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
  expect(E.beatAt(0.6)).toBeCloseTo(1, 9);
  expect(E.nearestDownbeat(3)).toBeCloseTo(2.4, 9);
  expect(new AudioData({ duration: 5, bpm: 100, fps: 100, beats: [], downbeats: [], sections: [], features: {}, onsets: {} }).track).toBe('audio/narration.flac');
});

const b64 = (xs: number[]) => Buffer.from(Uint8Array.from(xs)).toString('base64');

test('waveform: interpolated at a time, peak and RMS over a span, silence outside the song', () => {
  const peak = Array.from({ length: 100 }, (_, i) => (i < 50 ? 255 : 0)), rms = peak.map((p) => (p ? 100 : 0));
  const A = new AudioData({ duration: 1, bpm: 120, fps: 100, beats: [], downbeats: [], sections: [], features: {}, onsets: {}, wave: { fps: 100, peak: b64(peak), rms: b64(rms) } });
  expect(A.hasWave).toBe(true);
  expect(A.wave(0.2).peak).toBe(1);
  expect(A.wave(0.5).peak).toBeCloseTo(0.5, 9);
  expect(A.wave(0.8)).toEqual({ peak: 0, rms: 0 });
  expect(A.wave(-1)).toEqual({ peak: 0, rms: 0 });
  expect(A.wave(2)).toEqual({ peak: 0, rms: 0 });
  const s = A.wave(0.5, 0.2);
  expect(s.peak).toBe(1);
  expect(s.rms).toBeCloseTo(Math.sqrt(0.5) * (100 / 255), 6);
  for (const t of [0.1, 0.105, 0.11, 0.1175, 0.125]) expect(A.wave(t, 0.015).rms).toBeCloseTo(100 / 255, 6);
  expect(A.wave(0.05, 0.2).rms).toBeCloseTo(Math.sqrt(15 / 20) * (100 / 255), 6);
});

test('spectrum: bands interpolated in time, resampled across the bands, zeros outside', () => {
  const data = [255, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0];
  const A = new AudioData({ duration: 0.03, bpm: 120, fps: 100, beats: [], downbeats: [], sections: [], features: {}, onsets: {}, spectrum: { fps: 100, bands: [50, 200, 800, 3200], data: b64(data) } });
  expect(A.hasSpectrum).toBe(true);
  expect(A.bandFreqs).toEqual([50, 200, 800, 3200]);
  expect([...A.bands(0)]).toEqual([1, 0, 0, 0]);
  expect([...A.bands(0.005)].map((v) => +v.toFixed(6))).toEqual([0.5, 0, 0, 0.5]);
  expect([...A.bands(0.01, 7)].map((v) => +v.toFixed(6))).toEqual([0, 0, 0, 0, 0, 0.5, 1]);
  expect([...A.bands(0, 2)]).toEqual([1, 0]);
  expect([...A.bands(0.01, 2)]).toEqual([0, 1]);
  expect([...A.bands(0, 1)]).toEqual([1]);
  expect(() => A.bands(0, 3, new Float32Array(4))).toThrow('out holds 4 levels, not 3');
  expect([...A.bands(-0.5)]).toEqual([0, 0, 0, 0]);
  expect([...A.bands(1)]).toEqual([0, 0, 0, 0]);
});

test('an analysis without a waveform or spectrum still loads, silent', () => {
  expect(A.hasWave).toBe(false);
  expect(A.hasSpectrum).toBe(false);
  expect(A.wave(1)).toEqual({ peak: 0, rms: 0 });
  expect(A.bands(1).length).toBe(0);
  expect([...A.bands(1, 3)]).toEqual([0, 0, 0]);
});

test('no beats: every helper answers on the bpm grid from 0, never NaN', () => {
  const E = AudioData.empty(), p = 0.6;
  expect(E.timeOfBeat(0)).toBe(0);
  expect(E.timeOfBeat(5)).toBeCloseTo(5 * p, 9);
  expect(E.timeOfBeat(-1)).toBeCloseTo(-p, 9);
  expect(E.nearestBeat(3.1)).toBeCloseTo(3, 9);
  expect(E.beatBefore(3)).toBeCloseTo(3, 9);
  expect(E.beatBefore(2.9)).toBeCloseTo(2.4, 9);
  expect(E.barAt(4.8)).toBeCloseTo(2, 9);
  expect(E.nearestDownbeat(5.5)).toBeCloseTo(4.8, 9);
  for (const t of [0, 0.3, 3, 7.77]) expect(E.timeOfBeat(E.beatAt(t))).toBeCloseTo(t, 9);
  const one = new AudioData({ duration: 5, bpm: 60, fps: 100, beats: [0.5], downbeats: [], sections: [], features: {}, onsets: {} });
  expect(one.beatAt(2.5)).toBeCloseTo(2, 9);
  expect(one.timeOfBeat(2)).toBeCloseTo(2.5, 9);
  expect(one.beatBefore(2.2)).toBeCloseTo(1.5, 9);
  const oneDown = new AudioData({ duration: 5, bpm: 60, fps: 100, beats: [], downbeats: [1], sections: [], features: {}, onsets: {} });
  expect(oneDown.nearestDownbeat(1.3)).toBeCloseTo(1, 9);
  expect(oneDown.nearestDownbeat(4.5)).toBeCloseTo(5, 9);
  const zero = new AudioData({ duration: 5, bpm: 0, fps: 100, beats: [], downbeats: [], sections: [], features: {}, onsets: {} });
  expect(zero.nearestDownbeat(3)).toBeCloseTo(2.4, 9);
  expect(zero.bpm).toBe(0);
});
