// The warm renderer: one background process per project that keeps its dev server, a headless Chrome and its
// pages open between commands, so a still takes a fraction of a second instead of seconds. The CLI and the MCP
// server start it on demand (call()), it reloads its pages when the project's files change and stops itself
// after an idle period (REEL_DAEMON_IDLE seconds, default 900).
//
// It listens on 127.0.0.1 with a random port and token, written with its pid and the engine's version to a
// state file in the temp folder. A client whose engine version differs (the engine's code, the protocol or
// CHROME_PATH changed) stops it and starts a fresh one. Requests run one at a time, in arrival order.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ENGINE } from './server';
import type { Req, Result } from './ops';

/** Bumped when the request or state format changes. */
const PROTOCOL = 1;
const DIR = path.join(tmpdir(), 'reel-daemons');

/** The engine as the warm renderer sees it: its code (by mtime and size), the protocol and the Chrome it runs. */
export function engineVersion(): string {
  const parts: string[] = [`p${PROTOCOL}`, process.env.CHROME_PATH ?? ''];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(ts|html|json|glsl)$/.test(e.name)) { const s = statSync(f); parts.push(`${path.relative(ENGINE, f)}:${s.mtimeMs}:${s.size}`); }
    }
  };
  walk(path.join(ENGINE, 'src'));
  walk(path.join(ENGINE, 'cli'));
  for (const f of ['index.html', 'package.json', 'bun.lock']) if (existsSync(path.join(ENGINE, f))) { const s = statSync(path.join(ENGINE, f)); parts.push(`${f}:${s.mtimeMs}:${s.size}`); }
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

/** HTTP to a daemon. Throws when it does not answer. */
async function ask(s: State, route: string, body?: unknown): Promise<any> {
  const r = await fetch(`http://127.0.0.1:${s.port}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-reel-token': s.token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    // (a check of a long video takes minutes: no client-side timeout)
    timeout: false,
  } as RequestInit);
  if (!r.ok) throw new Error(`warm renderer: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

/** Stop a daemon and wait for its process to end (killed after 10 s). */
async function stopState(s: State, file: string) {
  await ask(s, '/stop', {}).catch(() => {});
  for (let i = 0; i < 200 && alive(s.pid); i++) await sleep(50);
  if (alive(s.pid)) { try { process.kill(s.pid, 'SIGKILL'); } catch {} }
  if (readState(file)?.pid === s.pid) rmSync(file, { force: true });
}

/** The project's daemon, started (or restarted, when stale or dead) as needed. */
async function ensure(project: string): Promise<State> {
  mkdirSync(DIR, { recursive: true });
  const f = files(project), version = engineVersion();
  const s = readState(f.state);
  if (s && alive(s.pid)) {
    if (s.version === version) return s;
    await stopState(s, f.state);
  } else if (s) rmSync(f.state, { force: true });
  // start one (if another client started it meanwhile, ours sees the lock, exits, and we use theirs)
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

/** Run a request on the project's warm renderer (starting it if needed). */
export async function call(req: Req): Promise<Result> {
  let s = await ensure(req.project);
  try {
    return await ask(s, '/run', req);
  } catch (e) {
    // (it died under us, or never answered: start a fresh one and try once more)
    if (alive(s.pid)) { try { process.kill(s.pid, 'SIGKILL'); } catch {} }
    rmSync(files(req.project).state, { force: true });
    s = await ensure(req.project);
    return ask(s, '/run', req);
  }
}

export interface DaemonStatus { project: string; pid: number; port: number; started: number; uptime: number; idle: number; requests: number; pages: number; busy: boolean; stale: boolean; log: string }

/** Every running daemon (dead entries are cleaned up). */
export async function status(): Promise<DaemonStatus[]> {
  if (!existsSync(DIR)) return [];
  const version = engineVersion(), out: DaemonStatus[] = [];
  for (const name of readdirSync(DIR).filter((n) => n.endsWith('.json'))) {
    const file = path.join(DIR, name), s = readState(file);
    if (!s || !alive(s.pid)) { rmSync(file, { force: true }); continue; }
    const st = await ask(s, '/status').catch(() => null);
    if (!st) continue;
    out.push({ project: s.project, pid: s.pid, port: s.port, started: s.started, uptime: st.uptime, idle: st.idle, requests: st.requests, pages: st.pages, busy: st.busy, stale: s.version !== version, log: files(s.project).log });
  }
  return out;
}

/** Stop the daemon of `project`, or every one. Returns the projects stopped. */
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

/** Paths under a project whose changes never matter to its pages. */
const IGNORED = /^(out|node_modules|\.git|audio\/\.work|audio\/\.align|\.claude)(\/|$)|(^|\/)\.reel\.config\.[^/]*\.mjs$|(^|\/)\.DS_Store$/;

/** `reel daemon run`: be the project's warm renderer until stopped or idle. */
export async function serve(project: string) {
  mkdirSync(DIR, { recursive: true });
  const f = files(project);
  // one per project: whoever creates the lock file runs; a lock left by a dead process is taken over
  for (;;) {
    try { writeFileSync(f.lock, String(process.pid), { flag: 'wx' }); break; } catch {
      if (lockHeld(f.lock)) { console.log(`another warm renderer runs for ${project}`); return; }
      rmSync(f.lock, { force: true });
    }
  }
  const { Renderer } = await import('./renderer');
  const { run } = await import('./ops');
  const r = new Renderer(project);
  const idleLimit = Number(process.env.REEL_DAEMON_IDLE ?? 900) * 1000;
  const started = Date.now(), version = engineVersion(), token = crypto.randomUUID();
  let last = Date.now(), busy = false, requests = 0, closing = false;
  let chain: Promise<unknown> = Promise.resolve();
  /** Files this process wrote (stills, sheets): their change events are its own. */
  const written = new Map<string, number>();

  const watcher = watch(project, { recursive: true }, (_ev, name) => {
    if (!name) return r.invalidate();
    const rel = String(name).split(path.sep).join('/');
    if (IGNORED.test(rel)) return;
    const w = written.get(path.join(project, rel));
    if (w && Date.now() - w < 5000) return;
    r.invalidate();
  });

  const shutdown = async (why: string) => {
    if (closing) return;
    closing = true;
    console.log(`stopping: ${why}`);
    watcher.close();
    server.stop(true);
    await chain.catch(() => {});
    await r.close().catch(() => {});
    if (readState(f.state)?.pid === process.pid) rmSync(f.state, { force: true });
    if (lockHeld(f.lock) && readFileSync(f.lock, 'utf8') === String(process.pid)) rmSync(f.lock, { force: true });
    process.exit(0);
  };

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    // (a request may render for minutes before it answers)
    idleTimeout: 0,
    async fetch(req) {
      if (req.headers.get('x-reel-token') !== token) return new Response('bad token', { status: 403 });
      const url = new URL(req.url);
      if (url.pathname === '/status') return Response.json({ uptime: Date.now() - started, idle: busy ? 0 : Date.now() - last, requests, pages: r.pageCount, busy });
      if (url.pathname === '/stop') { setTimeout(() => void shutdown('asked to stop'), 10); return Response.json({ ok: true }); }
      if (url.pathname === '/run') {
        if (closing) return new Response('stopping', { status: 503 });
        const q = (await req.json()) as Req;
        const job = chain.then(async () => {
          busy = true; requests++;
          try {
            return await run(r, q, (file) => written.set(file, Date.now()));
          } catch (e) {
            return { ok: false, errors: [String((e as Error)?.message ?? e)], logs: [], warnings: [] } satisfies Result;
          } finally { busy = false; last = Date.now(); }
        });
        chain = job.catch(() => {});
        return Response.json(await job);
      }
      return new Response('not found', { status: 404 });
    },
  });

  writeFileSync(f.state, JSON.stringify({ pid: process.pid, port: server.port!, token, version, project, started } satisfies State));
  console.log(`warm renderer for ${project} on 127.0.0.1:${server.port} (pid ${process.pid})`);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => void shutdown(sig));
  // idle: nothing asked for a while; gone: the project folder was removed
  setInterval(() => {
    if (!busy && Date.now() - last > idleLimit) void shutdown(`idle for ${Math.round(idleLimit / 1000)} s`);
    if (!existsSync(path.join(project, 'reel.config.ts'))) void shutdown('the project is gone');
  }, 5000).unref();
  // warm up while the first request is being written: the server, Chrome and a page at the project's format
  chain = chain.then(() => r.page({ scale: 1 }).catch(() => {}));
}
