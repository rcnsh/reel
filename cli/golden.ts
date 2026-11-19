// Golden frames: stills of the examples (tests/golden/goldens.json) that the tests compare renders against.
// `reel golden update` writes them; tests/golden.test.ts renders the same list and compares. Each operating system
// has a set of its own (tests/golden/<platform>/): Chrome rasterises text and decodes video differently on macOS and
// Linux, by more than any tolerance that would still catch a real change, while on one system the GL backend barely
// matters (on a Mac, SwiftShader and Metal differ in a few dozen pixels of text edges). The Linux set is rendered by
// SwiftShader, the backend of a machine without a GPU.
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pageOf, samplesOf, type Values } from './args';
import { run, type Result } from './ops';
import { Renderer } from './renderer';
import { ENGINE } from './server';

export const GOLDEN = path.join(ENGINE, 'tests/golden');

export interface GoldenSpec { example: string; times: number[]; samples?: 'auto' | number; size?: string; theme?: string }
export interface GoldenList { maxSize: number; tol: number; frames: GoldenSpec[] }
/** The golden set for an operating system (this one, by default). */
export const goldenDir = (platform: string = process.platform) => path.join(GOLDEN, platform);
export const goldenList = (): GoldenList => JSON.parse(readFileSync(path.join(GOLDEN, 'goldens.json'), 'utf8'));

/** A golden's file name: the time and what differs from the example's defaults. */
export const goldenName = (g: GoldenSpec, t: number) =>
  `${t.toFixed(3)}s${g.samples ? `-samples-${g.samples}` : ''}${g.size ? `-${g.size}` : ''}${g.theme ? `-${g.theme}` : ''}.png`;

/**
 * Move a file, across filesystems too: a rename fails with EXDEV when the temp folder is on another disk from the
 * checkout (a box's /tmp and /data), so then it copies beside the destination, renames that into place and removes
 * the source. `rename` is a parameter for the tests.
 */
export function moveFile(from: string, to: string, rename: (a: string, b: string) => void = renameSync) {
  try { rename(from, to); return; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e; }
  const part = `${to}.${process.pid}.part`;
  try { copyFileSync(from, part); renameSync(part, to); } finally { rmSync(part, { force: true }); }
  rmSync(from, { force: true });
}

/**
 * Render every golden frame into `dir` (dir/<example>/<name>), one renderer per example (no warm renderer: the
 * tests leave nothing running). Returns the files by golden path relative to dir, and any errors.
 */
export async function renderGoldens(dir: string): Promise<{ files: Map<string, string>; errors: string[] }> {
  const list = goldenList(), files = new Map<string, string>(), errors: string[] = [];
  const work = path.join(tmpdir(), `reel-golden-${process.pid}-${Date.now()}`);
  try {
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
            moveFile(tmp, dest);
            files.set(rel, dest);
          }
        }
      } finally { await r.close(); }
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
  return { files, errors };
}
