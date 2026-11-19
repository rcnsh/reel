// Video jobs on disk (cli/jobs.ts): detached commands any process can follow and cancel by id. Stand-in commands
// print what `reel video --json --progress` prints, so these run without Chrome.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { cancelJob, jobsDir, jobView, listJobs, startJob, waitJob } from '../cli/jobs';
import { ENGINE, tempDir } from './helpers';

let dir: string;
const before = process.env.REEL_EXPORTS_DIR;
beforeAll(() => { dir = tempDir('reel-jobs-'); process.env.REEL_EXPORTS_DIR = dir; });
afterAll(() => { if (before === undefined) delete process.env.REEL_EXPORTS_DIR; else process.env.REEL_EXPORTS_DIR = before; rmSync(dir, { recursive: true, force: true }); });

/** A stand-in for `reel video`: the progress lines of `frames` frames, `ms` apart, then the result on stdout. */
const fake = (frames: number, ms: number, o: { queuedMs?: number; code?: number } = {}) => ['bun', '-e', `
  const say = (o) => console.error(JSON.stringify(o));
  if (${o.queuedMs ?? 0}) { say({ queued: true, running: 'pid 1, other -> x.mp4, for 3 s', ahead: 0 }); await Bun.sleep(${o.queuedMs ?? 0}); say({ queued: false }); }
  console.error('a line that is not progress');
  for (let i = 1; i <= ${frames}; i++) { await Bun.sleep(${ms}); say({ frames: i, total: ${frames}, fps: 10, eta: 0 }); }
  console.log(JSON.stringify({ ok: ${(o.code ?? 0) === 0}, file: '/x.mp4', frames: ${frames} }));
  process.exit(${o.code ?? 0});
`];
const until = async (id: string, f: (v: ReturnType<typeof jobView>) => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  let v = jobView(id);
  while (!f(v) && Date.now() < end) { await Bun.sleep(50); v = jobView(id); }
  return v;
};

test('a job runs detached to completion, and its view comes from the files alone', async () => {
  const s = startJob(fake(4, 30), { project: '/p', out: '/x.mp4' });
  expect(s.job).toMatch(/^video-/);
  expect(s.state).toBe('running');
  const v = await until(s.job, (x) => x.state === 'done');
  expect(v.state).toBe('done');
  expect(v.result).toEqual({ ok: true, file: '/x.mp4', frames: 4 });
  expect(v.progress).toEqual({ frames: 4, total: 4, fps: 10, eta: 0 });
  expect(v.output).toBe('a line that is not progress\n');
  expect(path.dirname(path.join(jobsDir(), s.job))).toBe(path.join(dir, 'reel-exports', 'jobs'));
});

test('a job that exits non-zero is failed, with its result', async () => {
  const s = startJob(fake(1, 10, { code: 1 }), { project: '/p', out: '/x.mp4' });
  const v = await until(s.job, (x) => x.state !== 'running');
  expect(v.state).toBe('failed');
  expect((v.result as { ok: boolean }).ok).toBe(false);
});

test('a queued job shows the export ahead, then runs', async () => {
  const s = startJob(fake(2, 20, { queuedMs: 600 }), { project: '/p', out: '/x.mp4', wait: true });
  expect(s.state).toBe('queued');
  const q = await until(s.job, (x) => !!x.queue);
  expect(q.queue).toEqual({ running: 'pid 1, other -> x.mp4, for 3 s', ahead: 0 });
  // (waiting returns at the change, not at the timeout)
  const t0 = Date.now();
  const w = await waitJob(s.job, 20);
  expect(Date.now() - t0).toBeLessThan(5000);
  expect(w.state).not.toBe('queued');
  expect((await until(s.job, (x) => x.state === 'done')).state).toBe('done');
});

test('waiting returns when progress moves, and at the timeout when nothing does', async () => {
  const s = startJob(fake(40, 100), { project: '/p', out: '/x.mp4' });
  const first = await until(s.job, (x) => !!x.progress);
  const w = await waitJob(s.job, 20);
  // (a twentieth of 40 frames is 2)
  expect(w.progress!.frames - first.progress!.frames).toBeGreaterThanOrEqual(2);
  expect(w.progress!.frames).toBeLessThan(40);
  await cancelJob(s.job);
  const slow = startJob(['sleep', '30'], { project: '/p', out: '/x.mp4' });
  const t0 = Date.now();
  const v = await waitJob(slow.job, 0.6);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(550);
  expect(v.state).toBe('running');
  await cancelJob(slow.job);
});

test('cancel stops the command and the job reads cancelled', async () => {
  const s = startJob(['sleep', '30'], { project: '/p', out: '/x.mp4' });
  const c = await cancelJob(s.job);
  expect(c.state).toBe('cancelled');
  // (cancelling an ended job changes nothing)
  expect((await cancelJob(s.job)).state).toBe('cancelled');
});

test('a command that outlives its killed shell still reads running and is cancellable; with both gone the job failed', async () => {
  const k = startJob(['sleep', '30'], { project: '/p', out: '/x.mp4' });
  const dir = path.join(jobsDir(), k.job);
  const pid = JSON.parse(await Bun.file(path.join(dir, 'job.json')).text()).pid;
  await until(k.job, () => existsSync(path.join(dir, 'child.pid')));
  const child = Number(await Bun.file(path.join(dir, 'child.pid')).text());
  process.kill(pid, 'SIGKILL');
  await Bun.sleep(200);
  expect(jobView(k.job).state).toBe('running');
  expect((await cancelJob(k.job)).state).toBe('cancelled');
  expect(() => process.kill(child, 0)).toThrow();
  const g = startJob(['sleep', '30'], { project: '/p', out: '/x.mp4' });
  const gdir = path.join(jobsDir(), g.job);
  await until(g.job, () => existsSync(path.join(gdir, 'child.pid')));
  const gpid = JSON.parse(await Bun.file(path.join(gdir, 'job.json')).text()).pid;
  process.kill(-gpid, 'SIGKILL');
  const v = await until(g.job, (x) => x.state !== 'running');
  expect(v.state).toBe('failed');
  expect(v.output).toContain('ended without a result');
  // (a dead job's clock stops)
  const sec = v.seconds;
  await Bun.sleep(1200);
  expect(jobView(g.job).seconds).toBe(sec);
});

test('another process finds, follows and cancels a job it did not start; the list has every job, newest first', async () => {
  const s = startJob(['sleep', '30'], { project: '/q', out: '/y.mp4' });
  // (async: the shell is this process's child, reaped only while its event loop runs)
  const other = Bun.spawn(['bun', '-e', `
    const J = await import(${JSON.stringify(path.join(ENGINE, 'cli/jobs.ts'))});
    const seen = J.jobView(${JSON.stringify(s.job)}).state;
    const listed = J.listJobs('/q').map((j) => j.job);
    const c = (await J.cancelJob(${JSON.stringify(s.job)})).state;
    console.log(JSON.stringify({ seen, listed, c }));
  `], { env: process.env, stdout: 'pipe' });
  expect(JSON.parse(await new Response(other.stdout).text())).toEqual({ seen: 'running', listed: [s.job], c: 'cancelled' });
  const all = listJobs();
  expect(all[0]!.job).toBe(s.job);
  expect(all.length).toBeGreaterThanOrEqual(5);
  expect(all.every((j) => !('result' in j))).toBe(true);
  expect(() => jobView('../etc')).toThrow(/no job/);
  expect(() => jobView('video-nope')).toThrow(/no job 'video-nope'/);
}, 20_000);
