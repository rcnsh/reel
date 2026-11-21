import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync, readdirSync, rmdirSync } from 'node:fs';
import { pageOf, samplesOf, type Values } from './args';
import { run, type Result } from './ops';
import { Renderer } from './renderer';
import { ENGINE } from './server';

export const GOLDEN = path.join(ENGINE, 'tests/golden');

export interface GoldenSpec { example: string; times: number[]; samples?: 'auto' | number; size?: string; theme?: string }
export interface GoldenList { maxSize: number; tol: number; frames: GoldenSpec[] }
export const goldenDir = (platform: string = process.platform) => path.join(GOLDEN, platform);
export const goldenList = (): GoldenList => JSON.parse(readFileSync(path.join(GOLDEN, 'goldens.json'), 'utf8'));

export const goldenName = (g: GoldenSpec, t: number) =>
  `${t.toFixed(3)}s${g.samples ? `-samples-${g.samples}` : ''}${g.size ? `-${g.size}` : ''}${g.theme ? `-${g.theme}` : ''}.png`;

export function moveFile(from: string, to: string, rename: (a: string, b: string) => void = renameSync) {
  try { rename(from, to); return; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e; }
  const part = `${to}.${process.pid}.part`;
  try { copyFileSync(from, part); renameSync(part, to); } finally { rmSync(part, { force: true }); }
  rmSync(from, { force: true });
}

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

export function staleGoldens(dir: string, list: GoldenList = goldenList()): string[] {
  if (!existsSync(dir)) return [];
  const listed = new Set(list.frames.flatMap((g) => g.times.map((t) => path.join(g.example, goldenName(g, t)))));
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.png'))
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .filter((f) => !listed.has(f)).sort();
}

export function pruneGoldens(dir: string, list: GoldenList = goldenList()): string[] {
  const stale = staleGoldens(dir, list);
  for (const f of stale) rmSync(path.join(dir, f));
  for (const sub of new Set(stale.map((f) => path.dirname(f)).filter((d) => d !== '.'))) {
    const abs = path.join(dir, sub);
    if (existsSync(abs) && !readdirSync(abs).length) rmdirSync(abs);
  }
  return stale;
}
