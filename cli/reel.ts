#!/usr/bin/env bun
// reel: render a video project (a folder with a reel.config.ts) in headless Chrome. `reel --help` lists the
// commands and flags. Every command takes --project <folder> (default: the current folder) and --json (one JSON
// object on stdout: { ok, errors, logs, ... }). A command exits 1 when anything went wrong, scene errors included.
import { chromium, type Page } from 'playwright-core';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { ENGINE, projectDir, startServer } from './server';
import { initOptions, initProject } from './init';

const HELP = `reel <command> [flags]

Rendering (headless Chrome; each exits 1 on a scene error)
  info                       the project's format, duration, clips and cues
  still   --t 1.5,23[,..]    PNG stills, the pixels the video export produces   [--out <dir>]
  sheet                      a contact sheet: --from/--to with --n frames, or --times a,b,c, or --cuts
                             (4 frames around every cut)                          [--cols 4] [--out <file.png>]
  video                      the video: x264 through ffmpeg, with the project's audio track
                             [--from 0] [--to <duration>] [--out <file.mp4>] [--crf 16] [--preset slow]
                             [--x264 aq-mode=3] [--noaudio] [--workers 2] [--chunk 8] [--mem-gb 1] [--spool-gb 20]
  events                     write the sound-mix cues (the timeline and every cue() of the scenes)  [--out data/cues.json]
  perf    --from 0 --to 5    milliseconds per frame, including the export's pixel readback
  gpu                        the GPU Chrome renders with

Working on a project
  init <folder>              a new project that renders straight away; refuses a folder that holds anything
                             [--size 1920x1080] [--fps 60] [--theme neutral|print|film] [--narrated]
  dev                        the preview player with live reload                  [--port 5173]
  narrate                    time narration.txt with a scratch voice (macOS say)
  align <recording|folder>   time narration.txt to a voice recording
  analyze <song> [...]       beats, envelopes and sections of a song (flags: reel analyze --help)
  mix <in.mp4> <out.mp4>     lay music and cue sounds under a render             [--from 0]

Flags for every rendering command
  --project <folder>   the project (default: the current folder)
  --only a,b           load only these clips (faster; other clips render as nothing)
  --samples N|auto     sub-frames averaged per frame for motion blur (default 1); auto picks per tile
                       [--min-samples 4] [--max-samples 324] [--tol 3] [--refine tiles|frame]
  --shutter 0.5        the share of the frame time the sub-frames span
  --scale N            render N x the pixels (2 = 3840x2160 from a 1920x1080 project)
  --size WxH, --fps N  override the project's frame size and rate
  --theme <name>       render with a built-in theme (print, film, neutral) instead of the project's
  --headed             show the browser
  --json               machine-readable output

Chrome: $CHROME_PATH, else the installed Google Chrome.`;

const argv = process.argv.slice(2);
const mode = argv[0] ?? '';
if (!mode || mode === '--help' || mode === '-h' || mode === 'help') { console.log(HELP); process.exit(mode ? 0 : 1); }

// the project tools keep their own flags: hand the rest of the line to them
const TOOLS: Record<string, string[]> = {
  narrate: ['bun', path.join(ENGINE, 'tools/narration.ts')],
  align: ['bun', path.join(ENGINE, 'tools/align.ts')],
  mix: ['bun', path.join(ENGINE, 'tools/mix.ts')],
  analyze: ['uv', 'run', path.join(ENGINE, 'tools/analyze.py')],
};
/** A bad command line or project: exit 2 (with --json, the report shape on stdout as well). */
const fail = (msg: string): never => {
  if (argv.includes('--json')) console.log(JSON.stringify({ ok: false, errors: [msg], logs: [] }, null, 1));
  console.error(`reel: ${msg}`);
  process.exit(2);
};
if (mode === 'init') {
  let a;
  try {
    a = parseArgs({ args: argv.slice(1), strict: true, allowPositionals: true, options: { size: { type: 'string' }, fps: { type: 'string' }, theme: { type: 'string' }, narrated: { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean' } } });
  } catch (e) { fail(`${(e as Error).message} (reel --help)`); }
  if (a!.values.help) { console.log(HELP); process.exit(0); }
  if (a!.positionals.length !== 1) fail('init needs one folder: reel init <folder>');
  const json = !!a!.values.json, out: { ok: boolean; errors: string[]; logs: string[]; project?: string; files?: string[] } = { ok: true, errors: [], logs: [] };
  let files: string[] = [];
  try { files = initProject(a!.positionals[0]!, initOptions(a!.values)); } catch (e) { fail((e as Error).message); }
  const project = path.resolve(a!.positionals[0]!);
  Object.assign(out, { project, files });
  if (!json) console.log(files.map((f) => path.relative(process.cwd(), f)).join('\n'));
  if (a!.values.narrated) {
    // time the script with a scratch voice, so the project has its words and length before the first render
    const p = Bun.spawn(['bun', path.join(ENGINE, 'tools/narration.ts')], { stdio: ['ignore', json ? 'pipe' : 'inherit', json ? 'pipe' : 'inherit'], env: { ...process.env, REEL_PROJECT: project } });
    if (await p.exited !== 0) out.errors.push(`reel narrate failed in ${project}: the project is written but has no timing yet; run \`reel narrate\` (macOS say) or \`reel align <recording>\` there`);
  }
  out.ok = !out.errors.length;
  if (json) console.log(JSON.stringify(out, null, 1));
  else if (out.ok) console.log(`\n${project} is ready: cd there and run \`bun run reel still --t 1\``);
  else console.error(out.errors.join('\n'));
  process.exit(out.ok ? 0 : 1);
}
if (TOOLS[mode]) {
  const rest = argv.slice(1);
  let dir = '.';
  const i = rest.findIndex((a) => a === '--project' || a.startsWith('--project='));
  if (i >= 0) dir = rest[i]!.includes('=') ? rest.splice(i, 1)[0]!.slice('--project='.length) : rest.splice(i, 2)[1] ?? fail('--project needs a folder');
  const help = rest.includes('--help') || rest.includes('-h');
  // (only analyze has flags of its own to list; the other tools would run)
  if (help && mode !== 'analyze') { console.log(HELP); process.exit(0); }
  let project = path.resolve(dir);
  if (!help) try { project = projectDir(dir); } catch (e) { fail((e as Error).message); }
  const proc = Bun.spawn([...TOOLS[mode]!, ...rest], { stdio: ['inherit', 'inherit', 'inherit'], env: { ...process.env, REEL_PROJECT: project } });
  process.exit(await proc.exited);
}

const MODES = ['info', 'still', 'sheet', 'video', 'events', 'perf', 'gpu', 'dev'];
if (!MODES.includes(mode)) fail(`unknown command '${mode}' (reel --help)`);
const str = { type: 'string' } as const, bool = { type: 'boolean' } as const;
let parsed;
try {
  parsed = parseArgs({
    args: argv.slice(1), strict: true, allowPositionals: false,
    options: {
      project: str, theme: str, only: str, samples: str, 'min-samples': str, 'max-samples': str, tol: str, refine: str, shutter: str, scale: str, size: str, fps: str,
      headed: bool, json: bool, help: bool, t: str, out: str, from: str, to: str, n: str, cols: str, times: str, cuts: bool,
      crf: str, preset: str, x264: str, noaudio: bool, workers: str, chunk: str, 'mem-gb': str, 'spool-gb': str, port: str,
    },
  });
} catch (e) { fail(`${(e as Error).message} (reel --help)`); }
const A = parsed!.values;
if (A.help) { console.log(HELP); process.exit(0); }
const num = (k: keyof typeof A, d: number) => {
  if (A[k] === undefined) return d;
  const v = Number(A[k]);
  if (!Number.isFinite(v)) fail(`--${k} ${A[k]}: expected a number`);
  return v;
};
const list = (k: 't' | 'times') => (A[k] ?? '').split(',').filter(Boolean).map((x) => { const v = Number(x); if (!Number.isFinite(v)) fail(`--${k} ${A[k]}: expected numbers separated by commas`); return v; });
const V = {
  json: !!A.json, shutter: num('shutter', 0.5), crf: num('crf', 16), preset: A.preset ?? 'slow', x264: A.x264 ?? 'aq-mode=3', noaudio: !!A.noaudio,
  workers: num('workers', 2), chunk: num('chunk', 8), 'mem-gb': num('mem-gb', 1), 'spool-gb': num('spool-gb', 20),
};
if (A.refine && A.refine !== 'tiles' && A.refine !== 'frame') fail(`--refine ${A.refine}: expected tiles or frame`);
const SAMPLES = A.samples === 'auto'
  ? { min: num('min-samples', 4), max: num('max-samples', 324), tol: num('tol', 3), refine: (A.refine ?? 'tiles') as 'tiles' | 'frame' }
  : num('samples', 1);
if (typeof SAMPLES === 'number' && !(Number.isInteger(SAMPLES) && SAMPLES >= 1)) fail(`--samples ${A.samples}: expected a whole number or auto`);
const SCALE = num('scale', 1);
if (![1, 2, 3, 4].includes(SCALE)) fail(`--scale ${A.scale}: expected 1 to 4`);

let PROJECT = '';
try { PROJECT = projectDir(A.project ?? '.'); } catch (e) { fail((e as Error).message); }
const hist = (h: Record<string, number>) => Object.entries(h).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}:${v}`).join(' ');
/** What --json prints; `errors` (scene and page errors) make the command exit 1. */
const report: { ok: boolean; errors: string[]; logs: string[]; [k: string]: unknown } = { ok: true, errors: [], logs: [] };
const say = (s: string) => { if (!V.json) console.log(s); };

if (mode === 'dev') {
  let srv;
  try { srv = await startServer(PROJECT, { port: num('port', 5173), hmr: true, theme: A.theme }); } catch (e) { fail((e as Error).message); }
  console.log(`${srv!.url}  (space plays, arrows seek, , and . step a frame, [ and ] jump clips, l loops, h hides the UI)`);
  await new Promise(() => {});
}

let srv!: Awaited<ReturnType<typeof startServer>>;
try { srv = await startServer(PROJECT, { theme: A.theme }); } catch (e) { fail((e as Error).message); }
let LW = srv.format.w, LH = srv.format.h;
if (A.size) {
  [LW, LH] = A.size.split('x').map(Number) as [number, number];
  if (!(LW > 0 && LH > 0) || LW % 4 || LH % 2) fail(`--size ${A.size}: expected WxH with a width that is a multiple of 4 and an even height`);
}
const FPS = num('fps', srv.format.fps);
if (!(FPS > 0)) fail(`--fps ${A.fps}: expected a frame rate`);
const OW = LW * SCALE, OH = LH * SCALE; // output size

async function openPage(url: string, collect = true) {
  const browser = await chromium.launch({
    // CHROME_PATH (e.g. Playwright's Chrome for Testing), else the installed Google Chrome
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: !A.headed,
    args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const page = await browser.newPage({ viewport: { width: LW, height: LH }, deviceScaleFactor: 1 });
  const logs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`${url}/?export=1&w=${LW}&h=${LH}&fps=${FPS}&scale=${SCALE}${A.only ? `&only=${A.only}` : ''}`);
  await page.waitForFunction(() => (window as any).__reel?.ready || (window as any).__reel?.error, null, { timeout: 120000 }).catch(() => { throw new Error(`the page did not start:\n${logs.join('\n')}`); });
  const err = await page.evaluate(() => (window as any).__reel.error);
  if (err) throw new Error(`the project failed to load:\n${err}`);
  const size: [number, number] = await page.evaluate(() => [(window as any).__reel.width, (window as any).__reel.height]);
  if (size[0] !== OW || size[1] !== OH) throw new Error(`the page renders ${size[0]}x${size[1]}, expected ${OW}x${OH}`);
  if (A.only) {
    const ids: string[] = await page.evaluate(() => (window as any).__reel.timeline.map((e: { id: string }) => e.id));
    for (const id of A.only.split(',')) if (!ids.includes(id)) throw new Error(`--only ${id}: no such clip (the project has ${ids.join(', ')})`);
  }
  /** Scene errors so far (load and render), into the report. */
  const finish = async () => {
    if (collect) {
      report.errors.push(...await page.evaluate(() => (window as any).__reel.errors as string[]).catch(() => []));
      report.logs.push(...logs);
    }
    await browser.close().catch(() => {});
  };
  return { browser, page, logs, finish };
}

async function stills(page: Page, times: number[], outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  for (const t of times) {
    const k: number = await page.evaluate(([t, s, sh]) => (window as any).__reel.still(t, s, sh), [t, SAMPLES, V.shutter] as const);
    const f = path.join(outDir, `f_${t.toFixed(3).padStart(8, '0')}.png`);
    if (typeof SAMPLES !== 'number') say(`t=${t}: ${k} sub-frames`);
    // (the pixel buffer the video export reads, not a screenshot of the page)
    await Bun.write(f, Buffer.from(await page.evaluate(() => (window as any).__reel.png()), 'base64'));
    files.push(f);
  }
  return files;
}

async function sheet(page: Page, times: number[], cols: number, out: string) {
  const dataUrl: string = await page.evaluate(async ({ times, cols }) => {
    const P = (window as any).__reel;
    const cw = P.width >= P.height ? 480 : Math.round((270 * P.width) / P.height), ch = Math.round((cw * P.height) / P.width), pad = 4, lab = 18;
    const rows = Math.ceil(times.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * (cw + pad) + pad; cv.height = rows * (ch + lab + pad) + pad;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#222'; c.fillRect(0, 0, cv.width, cv.height);
    const src = document.getElementById('c') as HTMLCanvasElement;
    times.forEach((t: number, i: number) => {
      P.still(t);
      const x = pad + (i % cols) * (cw + pad), y = pad + Math.floor(i / cols) * (ch + lab + pad);
      c.drawImage(src, x, y + lab, cw, ch);
      c.fillStyle = '#ddd'; c.font = '13px monospace'; c.fillText(`${t.toFixed(2)}s`, x + 2, y + 13);
    });
    return cv.toDataURL('image/png');
  }, { times, cols });
  mkdirSync(path.dirname(out), { recursive: true });
  await Bun.write(out, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
}

/**
 * Render [from, to) into one encoder. `--workers N` headless Chromes (default 2; each its own GPU process)
 * take chunks of `--chunk` frames in order; the server puts their frames back in order and writes them to a
 * single ffmpeg, so the file is the same as with one worker. A frame is acknowledged once it is written or
 * waiting in a bounded reorder buffer, and each page keeps at most a few frames unacknowledged, so memory stays
 * bounded at 4K. One worker already keeps the GPU busy in the heavy scenes; a second one fills the gaps in the
 * light ones (2D drawing, readback, transfer).
 */
async function video(url: string, from: number, to: number, out: string, track: string | null, stateful: boolean) {
  const fps = FPS;
  mkdirSync(path.dirname(out), { recursive: true });
  const crf = String(V.crf);
  // the sound the project's audio analysis names, if the file is there (a silent video has none)
  const audio = track && existsSync(path.join(PROJECT, track)) ? path.join(PROJECT, track) : null;
  const mux = !!audio && !V.noaudio;
  // (frames come as rgb24: the same YUV out of the scaler as from rgba, a quarter fewer bytes to move)
  const args = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${OW}x${OH}`, '-r', String(fps), '-i', 'pipe:0'];
  if (mux) args.push('-ss', String(from), '-t', String(to - from), '-i', audio!);
  // Frames are sRGB (toSRGB in the final pass): convert with the BT.709 matrix and tag the stream,
  // otherwise ffmpeg converts with BT.601 while players and YouTube decode untagged HD as BT.709.
  // scale tags the matrix and range; primaries and transfer need setparams (the -color_* output flags don't reach the stream).
  args.push('-vf', 'vflip,scale=out_color_matrix=bt709,setparams=color_primaries=bt709:color_trc=bt709', '-c:v', 'libx264', '-preset', V.preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-tune', 'grain', '-x264-params', V.x264);
  if (mux) args.push('-c:a', 'aac', '-b:a', '320k', '-shortest');
  args.push('-movflags', '+faststart', out);
  const ff = Bun.spawn(args, { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });

  const f0 = Math.round(from * fps), f1 = Math.round(to * fps), total = f1 - f0;
  const chunk = Math.max(1, V.chunk);
  // (a scene with simulation state needs its frames in order from one renderer)
  const workers = stateful ? 1 : Math.max(1, Math.min(V.workers, Math.ceil(total / chunk)));
  // reorder buffer: frames waiting for an earlier one or for the encoder, acknowledged while under ~1 GB in
  // memory; past that they go to a spool on disk (up to --spool-gb, default 20), so the renderers never wait
  // for x264 in the light scenes and x264 catches up in the heavy ones, where the CPU is free
  const frameBytes = OW * OH * 3;
  const cap = Math.max(4, Math.floor((V['mem-gb'] * 1e9) / frameBytes));
  const spoolCap = Math.floor((V['spool-gb'] * 1e9) / frameBytes);
  const spoolDir = path.join(tmpdir(), `reel-spool-${process.pid}`);
  mkdirSync(spoolDir, { recursive: true });
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { ff.kill(9); rmSync(spoolDir, { recursive: true, force: true }); process.exit(130); });
  const spooled = new Set<number>();
  let spoolPeak = 0;
  const spoolFile = (n: number) => path.join(spoolDir, `${n}.rgb`);
  const toSpool = (n: number, buf: Uint8Array) => {
    // (written synchronously: the frame must be on disk before drain() looks for it)
    writeFileSync(spoolFile(n), buf);
    spooled.add(n);
    spoolPeak = Math.max(spoolPeak, spooled.size);
  };
  const waiting = new Map<number, Uint8Array>();
  const owed = new Map<number, number>(); // frames in memory over the cap, not yet acknowledged -> their worker
  const queue: number[][] = Array.from({ length: workers }, () => []); // frame numbers each worker will send, in order
  const sockets: any[] = [];
  const ackCount = new Array(workers).fill(0);
  const ack = (k: number) => { ackCount[k]++; sockets[k]?.send(String(ackCount[k])); };
  let next = f0, written = 0, cursor = f0, ending = false;

  // any failure stops the render: closing the sockets makes every page's stream() throw
  let failure: Error | null = null, rejectFailed!: (e: Error) => void, resolveWritten!: () => void;
  const failed = new Promise<never>((_, rej) => { rejectFailed = rej; });
  failed.catch(() => {});
  const allWritten = new Promise<void>((res) => { resolveWritten = res; });
  const fail = (e: unknown) => {
    if (failure) return;
    failure = e instanceof Error ? e : new Error(String(e));
    for (const ws of sockets) ws?.close();
    rejectFailed(failure);
  };
  void ff.exited.then((code) => { if (!ending) fail(new Error(`ffmpeg exited early (code ${code})`)); });

  const t0 = performance.now();
  let draining = false;
  const drain = async () => {
    if (draining || failure) return;
    draining = true;
    try {
      while (!failure && (waiting.has(next) || spooled.has(next))) {
        let buf = waiting.get(next);
        if (buf) waiting.delete(next);
        else {
          buf = await Bun.file(spoolFile(next)).bytes();
          spooled.delete(next);
          rmSync(spoolFile(next));
        }
        ff.stdin.write(buf);
        await ff.stdin.flush();
        // a frame written is acknowledged if it was not yet; then the oldest owed while there is room
        const k = owed.get(next);
        if (k !== undefined) { owed.delete(next); ack(k); }
        next++; written++;
        for (const [m, kk] of owed) {
          if (waiting.size > cap) {
            if (spooled.size >= spoolCap) break;
            toSpool(m, waiting.get(m)!);
            waiting.delete(m);
          }
          owed.delete(m);
          ack(kk);
        }
        if (written % 60 === 0 || written === total) {
          const el = (performance.now() - t0) / 1000;
          if (!V.json) process.stdout.write(`\r${written}/${total} frames  ${(written / el).toFixed(1)} fps  eta ${((total - written) / (written / el)).toFixed(0)}s   `);
        }
        if (written === total) resolveWritten();
      }
    } catch (e) { fail(e); } finally { draining = false; }
  };
  const server = Bun.serve<{ k: number }>({
    port: 0,
    fetch(req, srv) { return srv.upgrade(req, { data: { k: +(new URL(req.url).searchParams.get('w') ?? 0) } }) ? undefined : new Response('ws only', { status: 400 }); },
    websocket: {
      maxPayloadLength: Math.max(64 * 1024 * 1024, OW * OH * 3 + 1024),
      open(ws) { sockets[ws.data.k] = ws; if (failure) ws.close(); },
      message(ws, msg) {
        if (failure) return;
        try {
          const k = ws.data.k, n = queue[k]!.shift(), buf = msg as Uint8Array;
          if (n === undefined) throw new Error(`worker ${k} sent a frame it was not given`);
          if (buf.length !== frameBytes) throw new Error(`worker ${k} sent ${buf.length} bytes for frame ${n}`);
          if (waiting.size < cap || n === next) { waiting.set(n, buf); ack(k); }
          else if (spooled.size < spoolCap) { toSpool(n, buf); ack(k); }
          else { waiting.set(n, buf); owed.set(n, k); }
          void drain();
        } catch (e) { fail(e); }
      },
    },
  });
  // chunks in order from a shared cursor
  const take = () => { if (cursor >= f1) return null; const a = cursor; cursor = Math.min(f1, a + chunk); return [a, cursor] as const; };
  const pages: Awaited<ReturnType<typeof openPage>>[] = [];
  const used: Record<string, number> = {};
  const sceneErrors = new Set<string>();
  const closePages = async () => {
    for (const p of pages.splice(0)) {
      for (const e of await p.page.evaluate(() => (window as any).__reel.errors as string[]).catch(() => [])) sceneErrors.add(e);
      for (const l of p.logs) report.logs.push(l);
      await p.browser.close().catch(() => {});
    }
  };
  let ok = false;
  try {
    const opened = await Promise.allSettled(Array.from({ length: workers }, () => openPage(url, false)));
    for (const o of opened) if (o.status === 'fulfilled') pages.push(o.value);
    for (const o of opened) if (o.status === 'rejected') throw o.reason;
    const rendering = Promise.all(pages.map(async ({ page }, k) => {
      for (let r = take(); r && !failure; r = take()) {
        for (let n = r[0]; n < r[1]; n++) queue[k]!.push(n);
        const h: Record<string, number> = await page.evaluate((o) => (window as any).__reel.stream(o), {
          from: r[0] / fps, to: r[1] / fps, ws: `ws://localhost:${server.port}/?w=${k}`, samples: SAMPLES, shutter: V.shutter, inflight: 4,
        });
        for (const [c, m] of Object.entries(h)) used[c] = (used[c] ?? 0) + m;
      }
    }));
    rendering.catch(() => {});
    // (a page error stops the render; a failure on this side stops waiting for the pages)
    await Promise.race([rendering, failed]).catch((e) => { fail(e); throw failure; });
    await Promise.race([allWritten, failed]);
    await closePages();
    ending = true;
    ff.stdin.end();
    const code = await ff.exited;
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    ok = true;
  } finally {
    ending = true;
    // (killed, ffmpeg leaves an unplayable file rather than a finished-looking truncated one)
    if (!ok) ff.kill(9);
    await closePages();
    server.stop(true);
    rmSync(spoolDir, { recursive: true, force: true });
  }
  report.errors.push(...sceneErrors);
  Object.assign(report, { file: out, frames: written, seconds: +((performance.now() - t0) / 1000).toFixed(1), workers, subFrames: used });
  say(`\nwrote ${out} (${written} frames in ${((performance.now() - t0) / 1000).toFixed(1)}s, ${workers} worker${workers > 1 ? 's' : ''}${spoolPeak ? `, up to ${spoolPeak} frames spooled to disk` : ''})`);
  say(`sub-frames per frame (count:frames): ${hist(used)}`);
}


let code = 0;
try {
  if (mode === 'video') {
    // (the duration and the track come from the project's data, the same in every page)
    const first = await openPage(srv.url, false);
    const meta: { duration: number; track: string | null; stateful: boolean } = await first.page.evaluate(() => { const P = (window as any).__reel; return { duration: P.duration, track: P.track, stateful: P.stateful }; });
    await first.browser.close();
    const from = num('from', 0), to = num('to', meta.duration);
    if (!(to > from)) fail(`--from ${from} --to ${to}: nothing to render`);
    await video(srv.url, from, to, path.resolve(A.out ?? path.join(PROJECT, 'out/video.mp4')), meta.track, meta.stateful);
  } else {
    const { page, finish } = await openPage(srv.url);
    try {
      const P = () => page.evaluate(() => { const R = (window as any).__reel; return { duration: R.duration as number, timeline: R.timeline as { id: string; start: number; end: number; track: number }[], cues: R.cues as { kind: string; t: number }[], track: R.track as string | null }; });
      if (mode === 'gpu') {
        report.gpu = await page.evaluate(() => {
          const gl = document.createElement('canvas').getContext('webgl2')!;
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        });
        say(String(report.gpu));
      } else if (mode === 'info') {
        const ev = await P();
        Object.assign(report, { project: PROJECT, size: [LW, LH], fps: FPS, scale: SCALE, theme: srv.theme.name, ...ev });
        say(`${PROJECT}\n${LW}x${LH} at ${FPS} fps, ${ev.duration.toFixed(3)} s, ${ev.track ?? 'no audio track'}, theme ${srv.theme.name}`);
        for (const e of ev.timeline) say(`  ${e.id.padEnd(16)} ${e.start.toFixed(3).padStart(9)} to ${e.end.toFixed(3).padStart(9)}  track ${e.track}`);
        say(`${ev.cues.length} sound cues`);
      } else if (mode === 'still') {
        const times = list('t');
        if (!times.length) fail('still needs --t <seconds>[,<seconds>...]');
        report.files = await stills(page, times, path.resolve(A.out ?? path.join(PROJECT, 'out/stills')));
        say((report.files as string[]).join('\n'));
      } else if (mode === 'sheet') {
        const from = num('from', 0), to = num('to', (await P()).duration), n = num('n', 12);
        let times = Array.from({ length: n }, (_, i) => from + ((to - from) * i) / Math.max(1, n - 1));
        if (A.times) times = list('times');
        if (A.cuts) {
          // 4 frames around every cut: 2 before, 2 after
          const starts = [...new Set((await P()).timeline.map((e) => e.start))].sort((a, b) => a - b).filter((s) => s > 0);
          if (!starts.length) fail('sheet --cuts: the timeline has no cuts');
          times = starts.flatMap((s) => [s - 0.1, s - 1 / FPS, s + 1 / FPS, s + 0.1]);
        }
        const out = path.resolve(A.out ?? path.join(PROJECT, `out/sheets/sheet_${times[0]!.toFixed(2)}-${times.at(-1)!.toFixed(2)}.png`));
        await sheet(page, times, num('cols', 4), out);
        Object.assign(report, { file: out, times });
        say(out);
      } else if (mode === 'events') {
        // sound-mix cues: the timeline (clip starts) and every cue() a scene recorded
        const { duration, timeline, cues } = await P();
        const out = path.resolve(A.out ?? path.join(PROJECT, 'data/cues.json'));
        mkdirSync(path.dirname(out), { recursive: true });
        writeFileSync(out, JSON.stringify({ duration, timeline, cues }, null, 1));
        Object.assign(report, { file: out, clips: timeline.length, cues: cues.length });
        say(`${out}: ${timeline.length} clips, ${cues.length} cues`);
      } else if (mode === 'perf') {
        const from = num('from', 0), to = num('to', 5);
        const r = await page.evaluate(async ({ from, to, samples, shutter }) => {
          const P = (window as any).__reel, dt = 1 / P.fps;
          const ms: number[] = [];
          const buf = new Uint8Array(P.width * P.height * 4);
          P.still(from);
          const used: Record<number, number> = {};
          for (let t = from; t < to; t += dt) {
            const a = performance.now();
            const k = P.engine.render(t, dt, false, samples, shutter);
            used[k] = (used[k] ?? 0) + 1;
            await P.engine.readPixelsAsync(buf);
            ms.push(performance.now() - a);
          }
          ms.sort((a, b) => a - b);
          return { frames: ms.length, avg: ms.reduce((a, b) => a + b, 0) / ms.length, p50: ms[ms.length >> 1]!, p95: ms[Math.floor(ms.length * 0.95)]!, max: ms[ms.length - 1]!, subFrames: used };
        }, { from, to, samples: SAMPLES, shutter: V.shutter });
        Object.assign(report, r);
        say(`frames ${r.frames}  avg ${r.avg.toFixed(1)}ms  p50 ${r.p50.toFixed(1)}  p95 ${r.p95.toFixed(1)}  max ${r.max.toFixed(1)}  sub-frames ${hist(r.subFrames)}`);
      }
    } finally { await finish(); }
  }
} catch (e) {
  report.errors.push(String((e as Error)?.message ?? e));
} finally {
  await srv.stop().catch(() => {});
}
report.errors = [...new Set(report.errors)];
report.ok = report.errors.length === 0;
if (!report.ok) code = 1;
if (V.json) console.log(JSON.stringify(report, null, 1));
else {
  if (report.logs.length) console.error('BROWSER LOG:\n' + report.logs.slice(0, 40).join('\n'));
  if (report.errors.length) console.error('ERRORS:\n' + report.errors.join('\n'));
}
process.exit(code);
