import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AudioData, type AudioJSON } from '../src/engine/audio';
import { ENGINE, removeTempDirs, tempDir } from './helpers';

const ready = (script: string) =>
  Bun.spawnSync(['uv', 'run', '-q', '--offline', path.join(ENGINE, script), '--help'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
const hasUv = Bun.which('uv') !== null && ready('tools/synth_song.py') && ready('tools/analyze.py');
afterAll(removeTempDirs);

const run = (args: string[], env: Record<string, string> = {}) => {
  const r = Bun.spawnSync(['uv', 'run', '-q', ...args], { cwd: ENGINE, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`${args.join(' ')} failed: ${r.stderr.toString()}`);
};

test.skipIf(!hasUv)('analyze --fast stores a waveform and a spectrum that follow the song', () => {
  const dir = tempDir('reel-test-analyze-');
  run(['tools/synth_song.py', path.join(dir, 'song'), '120', '1', '8', '--break', '4,5']);
  run(['tools/analyze.py', path.join(dir, 'song.wav'), '--fast'], { REEL_PROJECT: dir });
  const j = JSON.parse(readFileSync(path.join(dir, 'data/audio.json'), 'utf8')) as AudioJSON;
  const A = new AudioData(j);
  expect(A.hasWave && A.hasSpectrum).toBe(true);
  expect(A.bandFreqs.length).toBe(24);
  expect(A.bandFreqs[0]).toBeGreaterThan(40);
  expect(A.bandFreqs[23]).toBeLessThan(11000);

  const mean = (fn: (t: number) => number, t0: number, t1: number) => {
    let s = 0, n = 0;
    for (let t = t0; t < t1; t += 0.01, n++) s += fn(t);
    return s / n;
  };
  const band = (hz: number) => A.bandFreqs.findIndex((c, i) => hz < Math.sqrt(c * (A.bandFreqs[i + 1] ?? c * 2)));
  const level = (hz: number) => (t: number) => A.bands(t)[band(hz)]!;
  const drums: [number, number] = [3, 9], brk: [number, number] = [9.2, 12.8], lead: [number, number] = [0.2, 0.9];

  expect(mean(level(8000), ...drums)).toBeGreaterThan(0.2);
  expect(mean(level(8000), ...brk)).toBeLessThan(0.05);
  expect(mean(level(280), ...lead)).toBeGreaterThan(0.4);
  expect(mean(level(70), ...lead)).toBeLessThan(0.02);
  expect(mean(level(8000), ...lead)).toBeLessThan(0.02);
  const kick = level(70);
  for (const t of [3, 4, 5, 6, 7]) expect(kick(t + 0.05)).toBeGreaterThan(kick(t + 0.95) + 0.25);
  expect(mean((t) => A.wave(t).peak, ...drums)).toBeGreaterThan(2 * mean((t) => A.wave(t).peak, ...brk));
  expect(A.wave(30).peak).toBe(0);
  expect(JSON.stringify({ wave: j.wave, spectrum: j.spectrum }).length).toBeLessThan(JSON.stringify(j.features).length);
}, 180_000);

test.skipIf(!hasUv)('a short sound placed in a long silence leaves the silence at 0 in the spectrum', () => {
  const dir = tempDir('reel-test-analyze-bed-');
  run(['--with', 'numpy', '--with', 'soundfile', 'python', '-c',
    `import numpy as np, soundfile as sf; sr = 22050; t = np.arange(sr) / sr; sf.write(${JSON.stringify(path.join(dir, 'bed.wav'))}, 0.5 * np.sin(2 * np.pi * 440 * t) * (np.sin(2 * np.pi * 4 * t) > 0), sr)`]);
  mkdirSync(path.join(dir, 'data'));
  writeFileSync(path.join(dir, 'data/audio.json'), JSON.stringify({ duration: 250, bpm: 100, fps: 100, beats: [], downbeats: [], sections: [{ name: 'a', start: 0, end: 250 }], features: {}, onsets: {} }));
  run(['tools/analyze.py', path.join(dir, 'bed.wav'), '--fast', '--free-tempo', '--keep-sections', '--offset', '125'], { REEL_PROJECT: dir });
  const A = new AudioData(JSON.parse(readFileSync(path.join(dir, 'data/audio.json'), 'utf8')));
  const top = (t0: number, t1: number) => { let m = 0; for (let t = t0; t < t1; t += 0.05) m = Math.max(m, ...A.bands(t)); return m; };
  expect(top(5, 120)).toBe(0);
  expect(top(125, 126)).toBeGreaterThan(0.9);
  expect(A.wave(125.06).peak).toBeGreaterThan(0.9);
}, 180_000);
