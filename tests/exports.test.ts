// One export at a time: a live claim refuses another, --force runs beside it, a dead process's claim is cleared.
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'reel-exports-test-'));
process.env.REEL_EXPORTS_DIR = dir;
const { claimExport, runningExports } = await import('../cli/exports');
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
