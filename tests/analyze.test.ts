import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ENGINE, removeTempDirs, tempDir } from './helpers';

afterAll(removeTempDirs);

const ready = async (...args: string[]) =>
  Bun.which('uv') !== null && (await Bun.spawn(['uv', 'run', '-q', '--offline', path.join(ENGINE, args[0]!), ...args.slice(1)], { stdout: 'ignore', stderr: 'ignore' }).exited) === 0;
const [synthOk, analyzeOk, modelsOk] = await Promise.all([ready('tools/synth_song.py', '--help'), ready('tools/analyze.py', '--help'), ready('tools/music_models.py', '--cached')]);
const hasUv = synthOk && analyzeOk;
const hasModels = hasUv && modelsOk;

type Case = { name: string; synth: string[]; fast?: string[]; maxMs: number; fastMaxMs?: number; fastKicks?: false };
const CASES: Case[] = [
  { name: 'lead-in', synth: ['120', '3.0', '8'], maxMs: 10 },
  { name: 'break', synth: ['123.4', '1.5', '12', '--break', '5,6'], maxMs: 10 },
  { name: 'non-integer tempo', synth: ['97.3', '0.6', '8', '--human', '4'], maxMs: 10 },
  { name: 'half-time', synth: ['140', '1.0', '10', '--halftime', '--vocal'], maxMs: 10 },
  { name: 'drifting tempo', synth: ['120', '1.0', '12', '--drift', '0.06', '--syncopate'], fast: ['--free-tempo'], maxMs: 10, fastMaxMs: 20 },
  { name: 'drum and bass', synth: ['174', '1.0', '16'], maxMs: 10, fastKicks: false },
  { name: 'even eighths at 76', synth: ['76', '1.0', '10', '--even-hats'], maxMs: 10 },
];

const errors = (truth: number[], found: number[]) =>
  truth.map((t) => found.reduce((best, f) => (Math.abs(f - t) < Math.abs(best) ? f - t : best), Infinity));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]!; };

async function uv(name: string, args: string[], project: string) {
  const p = Bun.spawn(['uv', 'run', '-q', '--offline', path.join(ENGINE, args[0]!), ...args.slice(1)], { stdout: 'ignore', stderr: 'pipe', env: { ...process.env, REEL_PROJECT: project } });
  const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`${args[0]} (${name}): ${err}`);
}

async function run(c: Case, fast: boolean) {
  const dir = tempDir('reel-test-analyze-');
  const song = path.join(dir, 'song');
  await uv(c.name, ['tools/synth_song.py', song, ...c.synth], dir);
  await uv(c.name, ['tools/analyze.py', `${song}.wav`, ...(fast ? ['--fast', ...(c.fast ?? [])] : [])], dir);
  const truth = JSON.parse(readFileSync(`${song}.json`, 'utf8'));
  const got = JSON.parse(readFileSync(path.join(dir, 'data/audio.json'), 'utf8'));
  return { c, truth, got };
}

function check(label: string, fast: boolean, results: Awaited<ReturnType<typeof run>>[]) {
  const worst = (xs: number[]) => Math.max(...xs.map(Math.abs));
  const ms = (xs: number[]) => xs.map((x) => Math.round(x * 1000));
  const rows = results.map(({ c, truth, got }) => {
    const maxMs = fast ? (c.fastMaxMs ?? c.maxMs) : c.maxMs;
    const beat = ms(errors(truth.beats, got.beats)), down = ms(errors(truth.downbeats, got.downbeats));
    const kick = ms(errors(got.onsets.kick.map((o: [number, number]) => o[0]), truth.beats)).filter((e) => Math.abs(e) <= 30).map((e) => -e);
    const first = truth.beats[0], last = truth.beats.at(-1);
    const inside = got.beats.filter((b: number) => b > first - 0.1 && b < last + 0.1).length;
    const octave = Math.abs(Math.log2(got.bpm / truth.bpm)) < 0.1;
    console.log(`${label} ${c.name}: ${got.bpm.toFixed(2)} BPM (${truth.bpm}), ${inside}/${truth.beats.length} beats, beats max ${worst(beat)} ms, downbeats max ${worst(down)} ms, kicks median ${median(kick)} ms (${kick.length})`);
    return { case: c.name, octave, beatCount: inside === truth.beats.length, beats: worst(beat) <= maxMs, downbeats: worst(down) <= maxMs, kicks: (fast && c.fastKicks === false) || (kick.length >= 4 && Math.abs(median(kick)) <= 5) };
  });
  expect(rows).toEqual(CASES.map((c) => ({ case: c.name, octave: true, beatCount: true, beats: true, downbeats: true, kicks: true })));
}

test.skipIf(!hasUv)('analyze --fast puts beats, downbeats and kicks on the synthesised songs\' own times', async () => {
  check('--fast', true, await Promise.all(CASES.map((c) => run(c, true))));
}, 180_000);

test.skipIf(!hasModels)('analyze (Beat This! and Demucs) puts beats, downbeats and kicks on the synthesised songs\' own times', async () => {
  const results = [];
  for (const c of CASES) results.push(await run(c, false));
  check('default', false, results);
}, 900_000);
