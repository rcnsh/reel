// Golden frames: the examples rendered again and compared with the committed stills for this operating system
// (tests/golden/<platform>/; a system with no set skips). A change that is meant to alter how the
// examples look updates them with `reel golden update` on each platform (and the PNGs are looked at before they
// are committed).
import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { glBackend } from '../cli/chrome';
import { goldenDir, goldenList, goldenName, renderGoldens } from '../cli/golden';
import { describeDiff, diffImages, readPng } from '../cli/png';
import { hasChrome } from './helpers';

const dir = mkdtempSync(path.join(tmpdir(), 'reel-golden-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const set = goldenDir();
if (hasChrome && !existsSync(set)) console.warn(`golden frames: no set for ${process.platform} (${set}); skipped`);

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
