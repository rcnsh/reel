import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const exportsDir = () => path.join(process.env.REEL_EXPORTS_DIR ?? tmpdir(), 'reel-exports');

export interface Claim { pid: number; project: string; out: string; started: number; pstart?: string }

export const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

export function processStart(pid: number): string | null {
  try {
    const p = Bun.spawnSync(['ps', '-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C' }, stderr: 'ignore' });
    const s = p.stdout.toString().trim().replace(/\s+/g, ' ');
    return p.exitCode === 0 && s ? s : null;
  } catch { return null; }
}

const checked = new Set<string>();
function live(c: Claim) {
  if (!alive(c.pid)) return false;
  if (!c.pstart || checked.has(`${c.pid}|${c.pstart}`)) return true;
  const now = processStart(c.pid);
  if (now === c.pstart) checked.add(`${c.pid}|${c.pstart}`);
  return now === null || now === c.pstart;
}

export function writeWhole(f: string, c: unknown) {
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(c));
  renameSync(tmp, f);
}

function claimsIn(dir: string): Claim[] {
  const out: Claim[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    const f = path.join(dir, n);
    let c: Claim | null = null;
    try { c = JSON.parse(readFileSync(f, 'utf8')); } catch {}
    if (!c) {
      try { if (Date.now() - statSync(f).mtimeMs > 10_000) rmSync(f, { force: true }); } catch {}
      continue;
    }
    if (!live(c)) { rmSync(f, { force: true }); continue; }
    if (c.pid !== process.pid) out.push(c);
  }
  return out;
}

export const runningExports = () => claimsIn(exportsDir());

export const queuedExports = () => claimsIn(path.join(exportsDir(), 'queue')).sort((a, b) => a.started - b.started || a.pid - b.pid);

const claimOf = (project: string, out: string): Claim => ({ pid: process.pid, project, out, started: Date.now(), pstart: processStart(process.pid) ?? undefined });

function take(project: string, out: string): (() => void) | false {
  mkdirSync(exportsDir(), { recursive: true });
  const f = path.join(exportsDir(), `${process.pid}.json`);
  writeWhole(f, claimOf(project, out));
  if (runningExports().length) { rmSync(f, { force: true }); return false; }
  const release = () => { rmSync(f, { force: true }); process.off('exit', release); };
  process.on('exit', release);
  return release;
}

const busy = (o: Claim) => `pid ${o.pid}, ${o.project} -> ${o.out}, for ${Math.round((Date.now() - o.started) / 1000)} s`;

export function claimExport(project: string, file: string, force: boolean): () => void {
  if (force) {
    mkdirSync(exportsDir(), { recursive: true });
    const f = path.join(exportsDir(), `${process.pid}.json`);
    writeWhole(f, claimOf(project, file));
    const release = () => { rmSync(f, { force: true }); process.off('exit', release); };
    process.on('exit', release);
    return release;
  }
  for (let i = 0; ; i++) {
    const others = runningExports(), queued = queuedExports();
    if (!others.length && !queued.length) { const r = take(project, file); if (r) return r; }
    if (i >= 12) {
      const o = others[0];
      throw new Error(`${o ? `another reel export is running (${busy(o)})` : `${queued.length} reel export${queued.length > 1 ? 's are' : ' is'} queued for the slot`}: one export at a time keeps memory bounded; pass --wait to queue behind ${o ? 'it' : 'them'}, or --force to run beside it`);
    }
    Bun.sleepSync(150 + Math.random() * 200);
  }
}

export async function queueExport(project: string, file: string, onWait: (running: Claim | null, ahead: number) => void = () => {}, poll = 1000): Promise<() => void> {
  const q = path.join(exportsDir(), 'queue'), ticket = path.join(q, `${process.pid}.json`), mine = claimOf(project, file);
  mkdirSync(q, { recursive: true });
  writeWhole(ticket, mine);
  const drop = () => { rmSync(ticket, { force: true }); process.off('exit', drop); };
  process.on('exit', drop);
  let told = '';
  try {
    for (;;) {
      const running = runningExports()[0] ?? null;
      const ahead = queuedExports().filter((o) => o.started < mine.started || (o.started === mine.started && o.pid < mine.pid)).length;
      if (!running && !ahead) { const r = take(project, file); if (r) return r; }
      const now = `${running?.pid}:${ahead}`;
      if (now !== told) { told = now; onWait(running, ahead); }
      await Bun.sleep(poll * (0.75 + Math.random() / 2));
    }
  } finally { drop(); }
}

export const describeClaim = busy;
