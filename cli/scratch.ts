import { chmodSync, lstatSync, readdirSync, readlinkSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { alive } from './exports';

let last = 0;
const stamp = () => (last = Math.max(Date.now(), last + 1));

export function partialOf(file: string): string {
  const ext = path.extname(file), stem = ext ? file.slice(0, -ext.length) : file;
  return `${stem}.partial-${process.pid}-${stamp()}${ext}`;
}

export const scratchDir = (dir: string, prefix: string) => path.join(dir, `${prefix}-${process.pid}-${stamp()}`);

export function destOf(file: string, depth = 0): string {
  try {
    return depth < 16 && lstatSync(file).isSymbolicLink() ? destOf(path.resolve(path.dirname(file), readlinkSync(file)), depth + 1) : file;
  } catch { return file; }
}

export function commit(partial: string, file: string) {
  try { chmodSync(partial, statSync(file).mode & 0o7777); } catch {}
  renameSync(partial, file);
}

export function commitFrames(from: string, to: string) {
  for (const n of readdirSync(from)) renameSync(path.join(from, n), path.join(to, n));
  rmSync(from, { recursive: true, force: true });
}

const aborts = new Set<() => void>();
const SIGNALS = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;
const onSignal = (sig: NodeJS.Signals) => {
  for (const f of [...aborts]) { try { f(); } catch {} }
  process.exit(SIGNALS[sig as keyof typeof SIGNALS] ?? 130);
};
export function onAbort(f: () => void): () => void {
  if (!aborts.size) for (const s of Object.keys(SIGNALS)) process.on(s, onSignal);
  aborts.add(f);
  return () => {
    aborts.delete(f);
    if (!aborts.size) for (const s of Object.keys(SIGNALS)) process.off(s, onSignal);
  };
}

export function ownerOf(name: string): { pid: number } | null {
  const m = /^(?:reel-(?:spool|webp)|.+\.partial)-(\d+)-\d{13}(?:\.[A-Za-z0-9]+)?$/.exec(name);
  return m ? { pid: +m[1]! } : null;
}

export function processName(pid: number): string | null {
  try {
    const p = Bun.spawnSync(['ps', '-o', 'comm=', '-p', String(pid)], { stderr: 'ignore' });
    const s = p.stdout.toString().trim();
    return p.exitCode === 0 && s ? path.basename(s) : null;
  } catch { return null; }
}

export function ownerGone(o: { pid: number }, name: (pid: number) => string | null = processName): boolean {
  if (!alive(o.pid)) return true;
  const n = name(o.pid);
  return n !== null && !/^bun/i.test(n);
}

const VITE_TEMP_AGE = 3600_000;

export function sweep(dirs: string[], viteCache?: string): string[] {
  const removed: string[] = [];
  const gone = new Map<string, boolean>();
  for (const dir of new Set(dirs)) {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const o = ownerOf(n);
      if (!o) continue;
      const k = String(o.pid);
      if (!gone.has(k)) gone.set(k, ownerGone(o));
      if (!gone.get(k)) continue;
      const f = path.join(dir, n);
      try { rmSync(f, { recursive: true, force: true }); removed.push(f); } catch {}
    }
  }
  if (viteCache) {
    let names: string[] = [];
    try { names = readdirSync(viteCache); } catch {}
    for (const n of names.filter((x) => x.includes('_temp_'))) {
      const f = path.join(viteCache, n);
      try {
        if (Date.now() - statSync(f).mtimeMs < VITE_TEMP_AGE) continue;
        rmSync(f, { recursive: true, force: true });
        removed.push(f);
      } catch {}
    }
  }
  return removed;
}
