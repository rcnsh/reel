import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { alive, exportsDir, processStart, writeWhole } from './exports';

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface Progress { frames: number; total: number; fps: number; eta: number }
export interface JobView {
  job: string; state: JobState; project: string; out: string; started: number; seconds: number;
  queue?: { running: string | null; ahead: number }; progress: Progress | null; result?: unknown; output?: string;
}
interface JobFile { id: string; project: string; out: string; started: number; pid: number; pstart?: string; wait: boolean }

const KEEP_MS = 7 * 24 * 3600 * 1000;
const WRAP = 'd="$REEL_JOB_DIR"; "$@" >"$d/stdout" 2>"$d/stderr" & echo $! >"$d/child.pid.tmp" && mv "$d/child.pid.tmp" "$d/child.pid"; wait $!; echo $? >"$d/code.tmp" && mv "$d/code.tmp" "$d/code"';

export const jobsDir = () => path.join(exportsDir(), 'jobs');
const jobDir = (id: string) => {
  if (!/^video-[\w-]+$/.test(id)) throw new Error(`no job '${id}': a job id looks like video-<...>, as video_start returned it`);
  return path.join(jobsDir(), id);
};
const read = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const mtime = (f: string) => { try { return statSync(f).mtimeMs; } catch { return undefined; } };

function tail(f: string, n = 16384): { text: string; whole: boolean } {
  let fd: number;
  try { fd = openSync(f, 'r'); } catch { return { text: '', whole: true }; }
  try {
    const size = statSync(f).size, len = Math.min(n, size), buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const s = buf.toString('utf8');
    if (len === size) return { text: s, whole: true };
    const i = s.indexOf('\n');
    return { text: i < 0 ? '' : s.slice(i + 1), whole: false };
  } finally { closeSync(fd); }
}

function prune() {
  let names: string[] = [];
  try { names = readdirSync(jobsDir()); } catch { return; }
  for (const n of names) {
    const dir = path.join(jobsDir(), n);
    let v: JobView | null = null;
    try { v = jobView(n, false); } catch {}
    const old = v ? v.state !== 'queued' && v.state !== 'running' && Date.now() - v.started > KEEP_MS : Date.now() - (mtime(dir) ?? Date.now()) > 60_000;
    if (old) rmSync(dir, { recursive: true, force: true });
  }
}

export function startJob(cmd: string[], o: { project: string; out: string; wait?: boolean; env?: Record<string, string | undefined> }): JobView {
  prune();
  const id = `video-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, dir = path.join(jobsDir(), id);
  mkdirSync(dir, { recursive: true });
  const child = spawn('sh', ['-c', WRAP, 'sh', ...cmd], { detached: true, stdio: 'ignore', env: { ...(o.env ?? process.env), REEL_JOB_DIR: dir } });
  child.unref();
  const job: JobFile = { id, project: o.project, out: o.out, started: Date.now(), pid: child.pid!, pstart: processStart(child.pid!) ?? undefined, wait: !!o.wait };
  writeWhole(path.join(dir, 'job.json'), job);
  return jobView(id);
}

function jobFile(id: string): JobFile {
  const s = read(path.join(jobDir(id), 'job.json'));
  if (!s) throw new Error(`no job '${id}' (video_status without a job lists them)`);
  return JSON.parse(s) as JobFile;
}

const verified = new Map<string, number>();
function pgidOf(pid: number): number | null {
  if (!pid || !alive(pid)) return null;
  const p = Bun.spawnSync(['ps', '-o', 'pgid=', '-p', String(pid)], { stderr: 'ignore' });
  const n = Number(p.stdout.toString().trim());
  return p.exitCode === 0 && n > 0 ? n : null;
}

function running(j: JobFile, dir: string) {
  const k = `${j.pid}|${j.pstart}`;
  if (alive(j.pid)) {
    if (!j.pstart) return true;
    const at = verified.get(k);
    if (at !== undefined && Date.now() - at < 5000) return true;
    const now = processStart(j.pid);
    if (now === j.pstart) verified.set(k, Date.now());
    return now === null || now === j.pstart;
  }
  verified.delete(k);
  return orphan(j, dir) !== null;
}
function orphan(j: JobFile, dir: string): number | null {
  const pid = Number(read(path.join(dir, 'child.pid')) ?? 0);
  return pid && pgidOf(pid) === j.pid ? pid : null;
}

export function jobView(id: string, full = true): JobView {
  const j = jobFile(id), dir = jobDir(id);
  const code = read(path.join(dir, 'code')), cancelled = existsSync(path.join(dir, 'cancelled'));
  let progress: Progress | null = null, queue: JobView['queue'], queued = j.wait, output = '';
  const err = tail(path.join(dir, 'stderr'));
  if (!err.whole) queued = false;
  for (const line of err.text.split('\n')) {
    if (!line) continue;
    try {
      const p = JSON.parse(line);
      if (typeof p.frames === 'number') { progress = p; queued = false; queue = undefined; continue; }
      if (p.queued === true) { queue = { running: p.running, ahead: p.ahead }; continue; }
      if (p.queued === false) { queued = false; queue = undefined; continue; }
    } catch {}
    output += line + '\n';
  }
  output = output.slice(-4000);
  let state: JobState, end: number | undefined, result: unknown;
  if (code !== null) {
    state = Number(code.trim()) === 0 ? 'done' : cancelled ? 'cancelled' : 'failed';
    end = mtime(path.join(dir, 'code'));
    if (full) {
      const stdout = read(path.join(dir, 'stdout')) ?? '';
      try { result = JSON.parse(stdout); } catch { result = stdout.slice(-4000); }
    }
  } else if (running(j, dir)) state = queued ? 'queued' : 'running';
  else {
    state = cancelled ? 'cancelled' : 'failed';
    end = cancelled ? mtime(path.join(dir, 'cancelled')) : Math.max(mtime(path.join(dir, 'stderr')) ?? 0, mtime(path.join(dir, 'stdout')) ?? 0) || j.started;
    if (!cancelled) output += 'the job\'s process ended without a result (it was killed, or the machine restarted)\n';
  }
  const ended = state !== 'queued' && state !== 'running';
  return {
    job: id, state, project: j.project, out: j.out, started: j.started, seconds: +(((end ?? Date.now()) - j.started) / 1000).toFixed(1),
    ...(state === 'queued' && queue ? { queue } : {}), progress, ...(full && ended && result !== undefined ? { result } : {}), ...(full && ended && output ? { output } : {}),
  };
}

export function listJobs(project?: string): JobView[] {
  let names: string[] = [];
  try { names = readdirSync(jobsDir()); } catch { return []; }
  const out: JobView[] = [];
  for (const n of names) {
    try {
      const v = jobView(n, false);
      if (!project || v.project === project) out.push(v);
    } catch {}
  }
  return out.sort((a, b) => b.started - a.started);
}

export async function cancelJob(id: string, timeoutMs = 15_000): Promise<JobView> {
  const j = jobFile(id), dir = jobDir(id);
  const v = jobView(id);
  if (v.state !== 'queued' && v.state !== 'running') return v;
  writeFileSync(path.join(dir, 'cancelled'), String(Date.now()));
  const shell = () => alive(j.pid) && running(j, dir);
  const group = (sig: NodeJS.Signals) => { if (j.pstart && (shell() || orphan(j, dir))) { try { process.kill(-j.pid, sig); } catch {} } };
  const pid = Number(read(path.join(dir, 'child.pid')) ?? 0);
  if (pid && pgidOf(pid) === j.pid) { try { process.kill(pid, 'SIGTERM'); } catch {} } else group('SIGTERM');
  const until = Date.now() + timeoutMs;
  const ended = () => !running(j, dir) || existsSync(path.join(dir, 'code'));
  while (!ended() && Date.now() < until) await Bun.sleep(100);
  if (!ended()) { group('SIGKILL'); for (let i = 0; i < 20 && !ended(); i++) await Bun.sleep(100); }
  return jobView(id);
}

export const MAX_WAIT_S = 50;

export async function waitJob(id: string, seconds: number, signal?: AbortSignal, poll = 250): Promise<JobView> {
  const first = jobView(id), until = Date.now() + Math.min(seconds, MAX_WAIT_S) * 1000;
  const step = first.progress ? Math.max(1, Math.ceil(first.progress.total / 20)) : 1;
  let v = first;
  while (Date.now() < until && !signal?.aborted) {
    if (v.state !== first.state || JSON.stringify(v.queue) !== JSON.stringify(first.queue)) break;
    if (v.progress && (!first.progress || v.progress.frames - first.progress.frames >= step)) break;
    if (v.state !== 'queued' && v.state !== 'running') break;
    await Bun.sleep(Math.min(poll, Math.max(0, until - Date.now())));
    v = jobView(id);
  }
  return v;
}
