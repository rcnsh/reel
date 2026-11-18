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
  expect(new AudioData({ duration: 5, bpm: 100, fps: 100, beats: [], downbeats: [], sections: [], features: {}, onsets: {} }).track).toBe('audio/narration.flac');
});

const b64 = (xs: number[]) => Buffer.from(Uint8Array.from(xs)).toString('base64');

test('waveform: interpolated at a time, peak and RMS over a span, silence outside the song', () => {
  // 1 s at 100 fps: frames 0-49 at peak 255 / rms 100, frames 50-99 silent
  const peak = Array.from({ length: 100 }, (_, i) => (i < 50 ? 255 : 0)), rms = peak.map((p) => (p ? 100 : 0));
  const A = new AudioData({ duration: 1, bpm: 120, fps: 100, beats: [], downbeats: [], sections: [], features: {}, onsets: {}, wave: { fps: 100, peak: b64(peak), rms: b64(rms) } });
  expect(A.hasWave).toBe(true);
  expect(A.wave(0.2).peak).toBe(1);
  expect(A.wave(0.5).peak).toBeCloseTo(0.5, 9); // between frame 49 (1) and frame 50 (0), at the middle of each
  expect(A.wave(0.8)).toEqual({ peak: 0, rms: 0 });
  expect(A.wave(-1)).toEqual({ peak: 0, rms: 0 });
  expect(A.wave(2)).toEqual({ peak: 0, rms: 0 });
  // a span over the edge: the loudest peak in it, and the RMS of loud and silent halves
  const s = A.wave(0.5, 0.2);
  expect(s.peak).toBe(1);
  expect(s.rms).toBeCloseTo(Math.sqrt(0.5) * (100 / 255), 6);
  // a span of a fraction of frames: steady sound gives the same RMS wherever the span falls
  for (const t of [0.1, 0.105, 0.11, 0.1175, 0.125]) expect(A.wave(t, 0.015).rms).toBeCloseTo(100 / 255, 6);
  // a span past the end counts the missing frames as silence
  expect(A.wave(0.05, 0.2).rms).toBeCloseTo(Math.sqrt(15 / 20) * (100 / 255), 6); // frames -5 to 14: 15 loud of 20
});

test('spectrum: bands interpolated in time, resampled across the bands, zeros outside', () => {
  // 4 bands, 3 frames: frame 0 lights band 0, frame 1 band 3, frame 2 nothing
  const data = [255, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0];
  const A = new AudioData({ duration: 0.03, bpm: 120, fps: 100, beats: [], downbeats: [], sections: [], features: {}, onsets: {}, spectrum: { fps: 100, bands: [50, 200, 800, 3200], data: b64(data) } });
  expect(A.hasSpectrum).toBe(true);
  expect(A.bandFreqs).toEqual([50, 200, 800, 3200]);
  expect([...A.bands(0)]).toEqual([1, 0, 0, 0]);
  expect([...A.bands(0.005)].map((v) => +v.toFixed(6))).toEqual([0.5, 0, 0, 0.5]);
  // 7 levels across 4 bands: every other one is a band, those between are halfway
  expect([...A.bands(0.01, 7)].map((v) => +v.toFixed(6))).toEqual([0, 0, 0, 0, 0, 0.5, 1]);
  // fewer levels than bands: the loudest of the bands each covers
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
