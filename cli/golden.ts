// Golden frames: stills of the examples (tests/golden/goldens.json) that the tests compare renders against.
// `reel golden update` writes them; tests/golden.test.ts renders the same list and compares.
import { mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pageOf, samplesOf, type Values } from './args';
import { run, type Result } from './ops';
import { Renderer } from './renderer';
import { ENGINE } from './server';

export const GOLDEN = path.join(ENGINE, 'tests/golden');

export interface GoldenSpec { example: string; times: number[]; samples?: 'auto' | number; size?: string; theme?: string }
export interface GoldenList { maxSize: number; tol: number; frames: GoldenSpec[] }
export const goldenList = (): GoldenList => JSON.parse(readFileSync(path.join(GOLDEN, 'goldens.json'), 'utf8'));

/** A golden's file name: the time and what differs from the example's defaults. */
export const goldenName = (g: GoldenSpec, t: number) =>
  `${t.toFixed(3)}s${g.samples ? `-samples-${g.samples}` : ''}${g.size ? `-${g.size}` : ''}${g.theme ? `-${g.theme}` : ''}.png`;

/**
 * Render every golden frame into `dir` (dir/<example>/<name>), one renderer per example (no warm renderer: the
 * tests leave nothing running). Returns the files by golden path relative to dir, and any errors.
 */
export async function renderGoldens(dir: string): Promise<{ files: Map<string, string>; errors: string[] }> {
  const list = goldenList(), files = new Map<string, string>(), errors: string[] = [];
  const work = path.join(tmpdir(), `reel-golden-${process.pid}-${Date.now()}`);
  for (const example of [...new Set(list.frames.map((g) => g.example))]) {
    const project = path.join(ENGINE, 'examples', example), r = new Renderer(project);
    try {
      for (const g of list.frames.filter((x) => x.example === example)) {
        const v: Values = { size: g.size, theme: g.theme, samples: g.samples === undefined ? undefined : String(g.samples) };
        for (const t of g.times) {
          const tmp = path.join(work, `${example}-${goldenName(g, t)}`);
          const res: Result = await run(r, { op: 'still', project, page: pageOf(v), samples: samplesOf(v), shutter: 0.5, args: { times: [t], out: tmp, maxSize: list.maxSize } });
          errors.push(...res.errors.map((e) => `${example} ${goldenName(g, t)}: ${e}`));
          if (!res.ok) continue;
          const rel = path.join(example, goldenName(g, t)), dest = path.join(dir, rel);
          mkdirSync(path.dirname(dest), { recursive: true });
          renameSync(tmp, dest);
          files.set(rel, dest);
        }
      }
    } finally { await r.close(); }
  }
  rmSync(work, { recursive: true, force: true });
  return { files, errors };
}
