// One export at a time: a live claim refuses another, --force runs beside it, a dead process's claim is cleared, and so
// is a claim whose pid now belongs to another process.
import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'reel-exports-test-'));
process.env.REEL_EXPORTS_DIR = dir;
const { claimExport, processStart, queueExport, queuedExports, runningExports } = await import('../cli/exports');
afterAll(() => { delete process.env.REEL_EXPORTS_DIR; rmSync(dir, { recursive: true, force: true }); });

test('a live export refuses another unless forced; a dead one is cleared', () => {
  mkdirSync(path.join(dir, 'reel-exports'), { recursive: true });
  // a live process (this test's parent) holding a claim
  writeFileSync(path.join(dir, 'reel-exports', `${process.ppid}.json`), JSON.stringify({ pid: process.ppid, project: '/p/a', out: '/p/a/out/video.mp4', started: Date.now() }));
  // a dead one
  writeFileSync(path.join(dir, 'reel-exports', '999999.json'), JSON.stringify({ pid: 999999, project: '/p/b', out: '/x', started: 0 }));
  expect(runningExports().map((c) => c.project)).toEqual(['/p/a']);
  expect(() => claimExport('/p/c', '/p/c/out/video.mp4', false)).toThrow(`another reel export is running (pid ${process.ppid}, /p/a`);
  const release = claimExport('/p/c', '/p/c/out/video.mp4', true);
  release();
  rmSync(path.join(dir, 'reel-exports', `${process.ppid}.json`));
  const r2 = claimExport('/p/c', '/p/c/out/video.mp4', false);
  r2();
  expect(runningExports()).toEqual([]);
});

test("a claim whose pid was reused by a process started at another time is stale; one by the same process is not", () => {
  const d = path.join(dir, 'reel-exports');
  mkdirSync(d, { recursive: true });
  const ppid = process.ppid, now = processStart(ppid);
  expect(now).toMatch(/^\w{3} \w{3} +\d+ \d\d:\d\d:\d\d \d{4}$/);
  // a killed export's claim: its pid is now this test's parent (alive), which started at another time
  writeFileSync(path.join(d, `${ppid}.json`), JSON.stringify({ pid: ppid, project: '/p/old', out: '/x', started: 0, pstart: 'Mon Jan 1 00:00:00 2001' }));
  expect(runningExports()).toEqual([]);
  expect(existsSync(path.join(d, `${ppid}.json`))).toBe(false);
  const r = claimExport('/p/c', '/p/c/out/video.mp4', false);
  r();
  // the same process still running: a live claim
  writeFileSync(path.join(d, `${ppid}.json`), JSON.stringify({ pid: ppid, project: '/p/live', out: '/x', started: 0, pstart: now }));
  expect(runningExports().map((c) => c.project)).toEqual(['/p/live']);
  rmSync(path.join(d, `${ppid}.json`));
  // a claim records its own process's start
  const r2 = claimExport('/p/c', '/p/c/out/video.mp4', false);
  expect(JSON.parse(readFileSync(path.join(d, `${process.pid}.json`), 'utf8')).pstart).toBe(processStart(process.pid));
  r2();
});

test('--wait queues behind the running export and takes the slot when it frees; a plain start refuses while one is queued', async () => {
  const d = path.join(dir, 'reel-exports');
  mkdirSync(path.join(d, 'queue'), { recursive: true });
  // the export holding the slot (this test's parent, alive)
  const held = path.join(d, `${process.ppid}.json`);
  writeFileSync(held, JSON.stringify({ pid: process.ppid, project: '/p/a', out: '/p/a/out/video.mp4', started: Date.now() - 5000 }));
  const heard: [string | null, number][] = [];
  let got: (() => void) | null = null;
  const q = queueExport('/p/q', '/p/q/out/video.mp4', (r, ahead) => heard.push([r?.project ?? null, ahead]), 20).then((r) => { got = r; });
  await Bun.sleep(100);
  expect(got).toBeNull();
  expect(heard[0]).toEqual(['/p/a', 0]);
  expect(existsSync(path.join(d, 'queue', `${process.pid}.json`))).toBe(true);
  rmSync(held);
  await q;
  expect(got).not.toBeNull();
  expect(existsSync(path.join(d, 'queue', `${process.pid}.json`))).toBe(false);
  expect(existsSync(path.join(d, `${process.pid}.json`))).toBe(true);
  got!();
  expect(runningExports()).toEqual([]);
  // another export queued ahead (alive, earlier): a plain start refuses and names the queue, --wait waits for it
  writeFileSync(path.join(d, 'queue', `${process.ppid}.json`), JSON.stringify({ pid: process.ppid, project: '/p/first', out: '/x', started: Date.now() - 1000 }));
  expect(queuedExports().map((c) => c.project)).toEqual(['/p/first']);
  expect(() => claimExport('/p/c', '/p/c/out/video.mp4', false)).toThrow('1 reel export is queued for the slot');
  let second: (() => void) | null = null;
  const heard2: number[] = [];
  const q2 = queueExport('/p/second', '/x2', (_r, ahead) => heard2.push(ahead), 20).then((r) => { second = r; });
  await Bun.sleep(100);
  expect(second).toBeNull();
  expect(heard2).toEqual([1]);
  rmSync(path.join(d, 'queue', `${process.ppid}.json`));
  await q2;
  second!();
}, 10_000);
