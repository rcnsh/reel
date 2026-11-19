// The warm renderer's lanes: a long check runs in one, stills in the other, so a still does not wait for the check,
// and a still rendered beside it (on a second page) has the same pixels as one rendered alone.
import { afterAll, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pageOf, samplesOf } from '../cli/args';
import { glBackend } from '../cli/chrome';
import { call, laneOf } from '../cli/daemon';
import type { Op, Req } from '../cli/ops';
import { projectDir } from '../cli/server';
import { diffImages, readPng } from '../cli/png';
import { hasChrome, reel, scratchCopy } from './helpers';

const demo = scratchCopy('demo');
afterAll(async () => { await reel(['daemon', 'stop', '--project', demo.dir]); demo.cleanup(); });

// A check long enough to outlast a still on a second page: a frame every 0.01 s on a GPU; under SwiftShader, where
// a checked frame takes about a second, one every 0.1 s over the first 3 s
const LONG_CHECK = glBackend() === 'swiftshader' ? { step: 0.1, to: 3 } : { step: 0.01 };

const req = (op: Op, args: Record<string, unknown>): Req => ({ op, project: projectDir(demo.dir), page: pageOf({}), samples: samplesOf({}), shutter: 0.5, args });

test('sweeps go in the long lane, everything else in the quick one', () => {
  expect(laneOf('check')).toBe('long');
  expect(laneOf('perf')).toBe('both');
  for (const op of ['info', 'still', 'sheet', 'strip', 'events', 'gpu'] as const) expect(laneOf(op)).toBe('quick');
});

test.skipIf(!hasChrome)('a still does not queue behind a long check, and renders the same pixels beside it', async () => {
  const out = (n: string) => path.join(demo.dir, 'out', n);
  // (warm: the server, Chrome and a page)
  expect((await call(req('still', { times: [2.5], out: out('alone.png') }))).ok).toBe(true);
  let checkDone = 0;
  const check = call(req('check', LONG_CHECK)).then((r) => { checkDone = Date.now(); return r; });
  // (the check has the page: the still needs a second one)
  await Bun.sleep(400);
  const still = await call(req('still', { times: [2.5], out: out('beside.png') }));
  const stillDone = Date.now();
  expect(still.ok).toBe(true);
  expect(checkDone).toBe(0);
  const c = await check;
  expect(c.ok).toBe(true);
  expect(checkDone).toBeGreaterThan(stillDone);
  expect(diffImages(readPng(out('alone.png')), readPng(out('beside.png'))).stats.changed).toBe(0);
}, 180_000);

test.skipIf(!hasChrome)("a config change during a check: the still gets a new dev server at once, the check finishes on the old one", async () => {
  const out = (n: string) => path.join(demo.dir, 'out', n);
  const cfg = path.join(demo.dir, 'reel.config.ts'), was = readFileSync(cfg, 'utf8');
  expect((await call(req('still', { times: [2.5], out: out('print.png') }))).ok).toBe(true);
  let checkDone = 0;
  const check = call(req('check', LONG_CHECK)).then((r) => { checkDone = Date.now(); return r; });
  await Bun.sleep(400);
  writeFileSync(cfg, was.replace("theme: 'print'", "theme: 'neutral'"));
  try {
    const still = await call(req('still', { times: [2.5], out: out('neutral.png') }));
    expect(still.ok).toBe(true);
    expect(checkDone).toBe(0);
    expect((await check).ok).toBe(true);
    // (the still saw the new theme)
    expect(diffImages(readPng(out('print.png')), readPng(out('neutral.png'))).stats.fraction).toBeGreaterThan(0.5);
  } finally { writeFileSync(cfg, was); }
}, 180_000);
