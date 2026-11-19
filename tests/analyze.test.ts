// `reel analyze --fast` against songs whose beats are known (tools/synth_song.py), in the cases that have broken
// it before: a lead-in, a break, a non-integer tempo, a half-time feel and a drifting tempo. Skips without uv, or
// while uv has not got the tools' packages yet (the first `reel analyze --fast` fetches them; tests stay offline).
import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ENGINE, removeTempDirs, tempDir } from './helpers';

afterAll(removeTempDirs);

const ready = (script: string) =>
  Bun.spawnSync(['uv', 'run', '-q', '--offline', path.join(ENGINE, script), '--help'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
const hasUv = Bun.which('uv') !== null && ready('tools/synth_song.py') && ready('tools/analyze.py');

type Case = { name: string; synth: string[]; analyze?: string[]; maxMs: number };
const CASES: Case[] = [
  { name: 'lead-in', synth: ['120', '3.0', '8'], maxMs: 10 },
  { name: 'break', synth: ['123.4', '1.5', '12', '--break', '5,6'], maxMs: 10 },
  { name: 'non-integer tempo', synth: ['97.3', '0.6', '8', '--human', '4'], maxMs: 10 },
  { name: 'half-time', synth: ['140', '1.0', '10', '--halftime', '--vocal'], maxMs: 10 },
  // one fitted tempo cannot follow a drift (the fast path's documented limit): the tracked beats can
  { name: 'drifting tempo', synth: ['120', '1.0', '12', '--drift', '0.06', '--syncopate'], analyze: ['--free-tempo'], maxMs: 20 },
];

/** For each true time, how far the nearest found one is (s; positive: found late). */
const errors = (truth: number[], found: number[]) =>
  truth.map((t) => found.reduce((best, f) => (Math.abs(f - t) < Math.abs(best) ? f - t : best), Infinity));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]!; };

async function uv(name: string, args: string[], project: string) {
  const p = Bun.spawn(['uv', 'run', '-q', '--offline', path.join(ENGINE, args[0]!), ...args.slice(1)], { stdout: 'ignore', stderr: 'pipe', env: { ...process.env, REEL_PROJECT: project } });
  const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`${args[0]} (${name}): ${err}`);
}

async function run(c: Case) {
  const dir = tempDir('reel-test-analyze-');
  const song = path.join(dir, 'song');
  await uv(c.name, ['tools/synth_song.py', song, ...c.synth], dir);
  // (straight through uv, as `reel analyze` runs it: the folder needs no reel.config.ts)
  await uv(c.name, ['tools/analyze.py', `${song}.wav`, '--fast', ...(c.analyze ?? [])], dir);
  const truth = JSON.parse(readFileSync(`${song}.json`, 'utf8'));
  const got = JSON.parse(readFileSync(path.join(dir, 'data/audio.json'), 'utf8'));
  return { c, truth, got };
}

test.skipIf(!hasUv)('analyze --fast puts beats, downbeats and kicks on the synthesised songs\' own times', async () => {
  const results = await Promise.all(CASES.map(run));
  const worst = (xs: number[]) => Math.max(...xs.map(Math.abs));
  const ms = (xs: number[]) => xs.map((x) => Math.round(x * 1000));
  const rows = results.map(({ c, truth, got }) => {
    const beat = ms(errors(truth.beats, got.beats)), down = ms(errors(truth.downbeats, got.downbeats));
    // kicks on a beat (not the off-beat ones of a syncopated or half-time bar), positive: late
    const kick = ms(errors(got.onsets.kick.map((o: [number, number]) => o[0]), truth.beats)).filter((e) => Math.abs(e) <= 30).map((e) => -e);
    const first = truth.beats[0], last = truth.beats.at(-1);
    const inside = got.beats.filter((b: number) => b > first - 0.1 && b < last + 0.1).length;
    console.log(`${c.name}: ${inside}/${truth.beats.length} beats, beats max ${worst(beat)} ms, downbeats max ${worst(down)} ms, kicks median ${median(kick)} ms (${kick.length})`);
    return { case: c.name, beatCount: inside === truth.beats.length, beats: worst(beat) <= c.maxMs, downbeats: worst(down) <= c.maxMs, kicks: kick.length >= 4 && Math.abs(median(kick)) <= 5 };
  });
  expect(rows).toEqual(CASES.map((c) => ({ case: c.name, beatCount: true, beats: true, downbeats: true, kicks: true })));
}, 180_000);
