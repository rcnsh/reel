// Golden frames: the examples rendered again and compared with the committed stills for this operating system
// (tests/golden/<platform>/; a system with no set skips). A change that is meant to alter how the
// examples look updates them with `reel golden update` on each platform (and the PNGs are looked at before they
// are committed). Every set must hold only the PNGs goldens.json lists: `reel golden update` prunes the rest.
import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { glBackend } from '../cli/chrome';
import { GOLDEN, goldenDir, goldenList, goldenName, pruneGoldens, renderGoldens, staleGoldens, type GoldenList } from '../cli/golden';
import { describeDiff, diffImages, readPng } from '../cli/png';
import { hasChrome } from './helpers';

// REEL_GOLDEN_ACTUAL keeps the rendered frames in that folder (CI uploads them when the test fails).
const keep = process.env.REEL_GOLDEN_ACTUAL;
const dir = keep ? path.resolve(keep) : mkdtempSync(path.join(tmpdir(), 'reel-golden-test-'));
if (keep) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); }
else afterAll(() => rmSync(dir, { recursive: true, force: true }));

const set = goldenDir();
if (hasChrome && !existsSync(set)) console.warn(`golden frames: no set for ${process.platform} (${set}); skipped`);

const list: GoldenList = { maxSize: 64, tol: 3, frames: [{ example: 'a', times: [1, 2.5] }, { example: 'a', times: [3], samples: 'auto' }] };
const fixture = (files: string[]) => {
  const d = mkdtempSync(path.join(dir, 'set-'));
  for (const f of files) { mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); writeFileSync(path.join(d, f), f); }
  return d;
};

test('a set\'s stale goldens are the PNGs no listed golden maps to', () => {
  const d = fixture(['a/1.000s.png', 'a/2.500s.png', 'a/3.000s-samples-auto.png', 'a/3.000s.png', 'a/notes.txt', 'b/1.000s.png']);
  mkdirSync(path.join(d, 'a/dir.png'));
  expect(staleGoldens(d, list)).toEqual(['a/3.000s.png', 'b/1.000s.png']);
  expect(staleGoldens(path.join(d, 'missing'), list)).toEqual([]);
});

test('pruning removes only the stale PNGs, and the folders they leave empty', () => {
  const d = fixture(['a/1.000s.png', 'a/2.500s.png', 'a/3.000s-samples-auto.png', 'a/old.png', 'a/notes.txt', 'b/1.000s.png']);
  expect(pruneGoldens(d, list)).toEqual(['a/old.png', 'b/1.000s.png']);
  expect(readdirSync(path.join(d, 'a')).sort()).toEqual(['1.000s.png', '2.500s.png', '3.000s-samples-auto.png', 'notes.txt']);
  expect(existsSync(path.join(d, 'b'))).toBe(false);
  expect(pruneGoldens(d, list)).toEqual([]);
});

// Every system's set, not just this one's: a golden dropped from the list is noticed on any machine, and removing
// its PNG from another system's set needs no render there.
test('every golden set holds only listed goldens (reel golden update prunes the rest)', () => {
  const sets = readdirSync(GOLDEN, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  expect(sets.flatMap((s) => staleGoldens(path.join(GOLDEN, s)).map((f) => `${s}/${f}`))).toEqual([]);
});

test.skipIf(!hasChrome || !existsSync(set))('the examples render as their golden frames', async () => {
  const list = goldenList();
  const { files, errors } = await renderGoldens(dir);
  expect(errors).toEqual([]);
  const bad: string[] = [];
  for (const g of list.frames) for (const t of g.times) {
    const rel = path.join(g.example, goldenName(g, t)), golden = path.join(set, rel);
    if (!existsSync(golden)) { bad.push(`${rel}: no golden (reel golden update)`); continue; }
    const { stats } = diffImages(readPng(files.get(rel)!), readPng(golden), list.tol);
    if (stats.changed > 0) bad.push(`${rel}: ${describeDiff(stats)}`);
  }
  expect(bad).toEqual([]);
// (software rendering, a Linux machine without a GPU, takes minutes over the samples-auto frames)
}, glBackend() === 'swiftshader' ? 1_200_000 : 180_000);
