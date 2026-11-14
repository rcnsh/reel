// Shared by the tests: whether a Chrome is there to render with, and scratch copies of the examples.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hasChrome as findChrome } from '../cli/chrome';

export const ENGINE = path.resolve(import.meta.dir, '..');
export const REEL = path.join(ENGINE, 'cli/reel.ts');

/** A Chrome the renders can use: $CHROME_PATH, else the pinned build (`reel chrome install`). Tests that render skip without one. */
export const hasChrome = findChrome();

/** A copy of an example in a fresh temp folder (its renders and warm renderer stay out of the repo). */
export function scratchCopy(example: string) {
  const dir = mkdtempSync(path.join(tmpdir(), `reel-test-${example}-`));
  cpSync(path.join(ENGINE, 'examples', example), dir, { recursive: true, filter: (f) => !f.includes(`${path.sep}out`) });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Run the CLI; returns its exit code, stdout and stderr. */
export async function reel(args: string[], cwd = ENGINE) {
  const p = Bun.spawn(['bun', REEL, ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: process.env });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err, json: () => JSON.parse(out) };
}
