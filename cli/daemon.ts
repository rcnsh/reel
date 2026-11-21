import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ENGINE } from './server';
import { findChrome, glBackend } from './chrome';
import type { Op, Req, Result } from './ops';

const PROTOCOL = 1;
const DIR = path.join(tmpdir(), 'reel-daemons');

export function engineVersion(): string {
  let chrome = '';
  try { chrome = findChrome().path; } catch {}
  let gl = '';
  try { gl = glBackend(); } catch {}
  const parts: string[] = [`p${PROTOCOL}`, chrome, gl];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(ts|html|json|glsl)$/.test(e.name)) { const s = statSync(f); parts.push(`${path.relative(ENGINE, f)}:${s.mtimeMs}:${s.size}`); }
    }
  };
  walk(path.join(ENGINE, 'src'));
  walk(path.join(ENGINE, 'cli'));
  const patches = path.join(ENGINE, 'patches');
  const patchFiles = existsSync(patches) ? readdirSync(patches).sort().map((f) => `patches/${f}`) : [];
  for (const f of ['index.html', 'package.json', 'bun.lock', ...patchFiles]) if (existsSync(path.join(ENGINE, f))) { const s = statSync(path.join(ENGINE, f)); parts.push(`${f}:${s.mtimeMs}:${s.size}`); }
  return Bun.hash(parts.join('\n')).toString(36);
}

interface State { pid: number; port: number; token: string; version: string; project: string; started: number }

const idOf = (project: string) => Bun.hash(project).toString(36);
const files = (project: string) => {
  const id = idOf(project);
  return { state: path.join(DIR, `${id}.json`), lock: path.join(DIR, `${id}.lock`), log: path.join(DIR, `${id}.log`) };
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function readState(file: string): State | null {
  try { return JSON.parse(readFileSync(file, 'utf8')) as State; } catch { return null; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const laneOf = (op: Op): 'long' | 'quick' | 'both' => (op === 'check' ? 'long' : op === 'perf' ? 'both' : 'quick');

async function ask(s: State, route: string, body?: unknown): Promise<any> {
  const r = await fetch(`http://127.0.0.1:${s.port}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-reel-token': s.token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeout: false,
  } as RequestInit);
  if (!r.ok) throw new Error(`warm renderer: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

async function stopState(s: State, file: string) {
  await ask(s, '/stop', {}).catch(() => {});
  for (let i = 0; i < 200 && alive(s.pid); i++) await sleep(50);
  if (alive(s.pid)) { try { process.kill(s.pid, 'SIGKILL'); } catch {} }
  if (readState(file)?.pid === s.pid) rmSync(file, { force: true });
}

async function ensure(project: string): Promise<State> {
  mkdirSync(DIR, { recursive: true });
  const f = files(project), version = engineVersion();
  const s = readState(f.state);
  if (s && alive(s.pid)) {
    if (s.version === version) return s;
    await stopState(s, f.state);
  } else if (s) rmSync(f.state, { force: true });
  const log = openSync(f.log, 'w');
  const child = spawn('bun', [path.join(ENGINE, 'cli/reel.ts'), 'daemon', 'run', '--project', project], { detached: true, stdio: ['ignore', log, log], env: process.env, cwd: project });
  child.unref();
  closeSync(log);
  let exited = false;
  child.on('exit', () => { exited = true; });
  for (let i = 0; i < 1200; i++) {
    const n = readState(f.state);
    if (n && n.version === version && alive(n.pid)) return n;
    if (exited && !(n && alive(n.pid)) && !lockHeld(f.lock)) {
      throw new Error(`the warm renderer did not start:\n${existsSync(f.log) ? readFileSync(f.log, 'utf8').slice(-2000) : ''}`);
    }
    await sleep(25);
  }
  throw new Error(`the warm renderer did not start within 30 s (log: ${f.log})`);
}

function lockHeld(lock: string) {
  try { const pid = Number(readFileSync(lock, 'utf8')); return pid > 0 && alive(pid); } catch { return false; }
}

export async function call(req: Req): Promise<Result> {
  let s = await ensure(req.project);
  try {
    return await ask(s, '/run', req);
  } catch (e) {
    if (alive(s.pid)) { try { process.kill(s.pid, 'SIGKILL'); } catch {} }
    rmSync(files(req.project).state, { force: true });
    s = await ensure(req.project);
    return ask(s, '/run', req);
  }
}

export interface DaemonStatus { project: string; pid: number; port: number; started: number; uptime: number; idle: number; requests: number; pages: number; busy: boolean; running: number; stale: boolean; log: string }

export async function status(): Promise<DaemonStatus[]> {
  if (!existsSync(DIR)) return [];
  const version = engineVersion(), out: DaemonStatus[] = [];
  for (const name of readdirSync(DIR).filter((n) => n.endsWith('.json'))) {
    const file = path.join(DIR, name), s = readState(file);
    if (!s || !alive(s.pid)) { rmSync(file, { force: true }); continue; }
    const st = await ask(s, '/status').catch(() => null);
    if (!st) continue;
    out.push({ project: s.project, pid: s.pid, port: s.port, started: s.started, uptime: st.uptime, idle: st.idle, requests: st.requests, pages: st.pages, busy: st.busy, running: st.running ?? (st.busy ? 1 : 0), stale: s.version !== version, log: files(s.project).log });
  }
  return out;
}

export async function stop(project: string | null): Promise<string[]> {
  if (!existsSync(DIR)) return [];
  const stopped: string[] = [];
  for (const name of readdirSync(DIR).filter((n) => n.endsWith('.json'))) {
    const file = path.join(DIR, name), s = readState(file);
    if (!s) { rmSync(file, { force: true }); continue; }
    if (project && s.project !== project) continue;
    if (alive(s.pid)) { await stopState(s, file); stopped.push(s.project); }
    else rmSync(file, { force: true });
  }
  return stopped;
}

export async function serve(project: string): Promise<boolean> {
  mkdirSync(DIR, { recursive: true });
  const f = files(project);
  for (;;) {
    try { writeFileSync(f.lock, String(process.pid), { flag: 'wx' }); break; } catch {
      if (lockHeld(f.lock)) { console.log(`another warm renderer runs for ${project}`); return false; }
      rmSync(f.lock, { force: true });
    }
  }
  const { Renderer } = await import('./renderer');
  const { run } = await import('./ops');
  const r = new Renderer(project);
  const idleLimit = Number(process.env.REEL_DAEMON_IDLE ?? 900) * 1000;
  const started = Date.now(), version = engineVersion(), token = crypto.randomUUID();
  let last = Date.now(), running = 0, requests = 0, closing = false;
  const lanes: Record<'long' | 'quick', Promise<unknown>> = { long: Promise.resolve(), quick: Promise.resolve() };
  const shutdown = async (why: string) => {
    if (closing) return;
    closing = true;
    console.log(`stopping: ${why}`);
    server.stop(true);
    await Promise.all(Object.values(lanes)).catch(() => {});
    await r.close().catch(() => {});
    if (readState(f.state)?.pid === process.pid) rmSync(f.state, { force: true });
    if (lockHeld(f.lock) && readFileSync(f.lock, 'utf8') === String(process.pid)) rmSync(f.lock, { force: true });
    process.exit(0);
  };

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      if (req.headers.get('x-reel-token') !== token) return new Response('bad token', { status: 403 });
      const url = new URL(req.url);
      if (url.pathname === '/status') return Response.json({ uptime: Date.now() - started, idle: running ? 0 : Date.now() - last, requests, pages: r.pageCount, busy: running > 0, running });
      if (url.pathname === '/stop') { setTimeout(() => void shutdown('asked to stop'), 10); return Response.json({ ok: true }); }
      if (url.pathname === '/run') {
        if (closing) return new Response('stopping', { status: 503 });
        const q = (await req.json()) as Req, lane = laneOf(q.op);
        const job = (lane === 'both' ? Promise.all([lanes.long, lanes.quick]) : lanes[lane]).then(async () => {
          running++; requests++;
          try {
            return await run(r, q, (file) => r.written.add(file));
          } catch (e) {
            return { ok: false, errors: [String((e as Error)?.message ?? e)], logs: [], warnings: [] } satisfies Result;
          } finally { running--; last = Date.now(); }
        });
        if (lane === 'both') lanes.long = lanes.quick = job.catch(() => {});
        else lanes[lane] = job.catch(() => {});
        return Response.json(await job);
      }
      return new Response('not found', { status: 404 });
    },
  });

  writeFileSync(f.state, JSON.stringify({ pid: process.pid, port: server.port!, token, version, project, started } satisfies State));
  console.log(`warm renderer for ${project} on 127.0.0.1:${server.port} (pid ${process.pid})`);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => void shutdown(sig));
  setInterval(() => {
    if (!running && Date.now() - last > idleLimit) void shutdown(`idle for ${Math.round(idleLimit / 1000)} s`);
    if (!existsSync(path.join(project, 'reel.config.ts'))) void shutdown('the project is gone');
  }, 5000).unref();
  lanes.quick = lanes.quick.then(() => r.page({ scale: 1 }).then((h) => r.release(h)).catch(() => {}));
  return true;
}
