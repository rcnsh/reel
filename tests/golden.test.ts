// Golden frames: the examples rendered again and compared with the committed stills in tests/golden. A change
// that is meant to alter how the examples look updates them with `reel golden update` (and the PNGs are looked
// at before they are committed).
import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GOLDEN, goldenList, goldenName, renderGoldens } from '../cli/golden';
import { describeDiff, diffImages, readPng } from '../cli/png';
import { hasChrome } from './helpers';

const dir = mkdtempSync(path.join(tmpdir(), 'reel-golden-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test.skipIf(!hasChrome)('the examples render as their golden frames', async () => {
  const list = goldenList();
  const { files, errors } = await renderGoldens(dir);
  expect(errors).toEqual([]);
  const bad: string[] = [];
  for (const g of list.frames) for (const t of g.times) {
    const rel = path.join(g.example, goldenName(g, t)), golden = path.join(GOLDEN, rel);
    if (!existsSync(golden)) { bad.push(`${rel}: no golden (reel golden update)`); continue; }
    const { stats } = diffImages(readPng(files.get(rel)!), readPng(golden), list.tol);
    if (stats.changed > 0) bad.push(`${rel}: ${describeDiff(stats)}`);
  }
  expect(bad).toEqual([]);
}, 180_000);
