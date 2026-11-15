// One video export at a time per machine. An export holds several Chromes, their GPU processes, the encoder and a
// reorder buffer; a few 4K exports at once have exhausted a 24 GB machine's memory and frozen it. Each running export
// leaves a claim (its pid, project and output) in the temp folder; a new one refuses while a live claim exists,
// unless forced. Claims of processes that are gone are cleared.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DIR = () => path.join(process.env.REEL_EXPORTS_DIR ?? tmpdir(), 'reel-exports');

export interface Claim { pid: number; project: string; out: string; started: number }

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

/** The exports running on this machine now (claims of dead processes are removed). */
export function runningExports(): Claim[] {
  const out: Claim[] = [];
  let names: string[] = [];
  try { names = readdirSync(DIR()); } catch { return out; }
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    const f = path.join(DIR(), n);
    let c: Claim | null = null;
    try { c = JSON.parse(readFileSync(f, 'utf8')); } catch {}
    if (!c || !alive(c.pid)) { rmSync(f, { force: true }); continue; }
    if (c.pid !== process.pid) out.push(c);
  }
  return out;
}

/**
 * Claim the machine for an export: throws, naming the export already running, unless `force`. Returns the release
 * (also run when the process exits).
 */
export function claimExport(project: string, file: string, force: boolean): () => void {
  const others = runningExports();
  if (others.length && !force) {
    const o = others[0]!;
    throw new Error(`another reel export is running (pid ${o.pid}, ${o.project} -> ${o.out}, for ${Math.round((Date.now() - o.started) / 1000)} s): one export at a time keeps memory bounded; wait for it, or pass --force to run beside it`);
  }
  mkdirSync(DIR(), { recursive: true });
  const f = path.join(DIR(), `${process.pid}.json`);
  writeFileSync(f, JSON.stringify({ pid: process.pid, project, out: file, started: Date.now() } satisfies Claim));
  const release = () => { rmSync(f, { force: true }); process.off('exit', release); };
  process.on('exit', release);
  return release;
}
