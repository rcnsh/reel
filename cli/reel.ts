#!/usr/bin/env bun
// reel: render a video project (a folder with a reel.config.ts) in headless Chrome. `reel --help` lists the
// commands and flags (cli/args.ts). Every rendering command takes --project <folder> (default: the current
// folder) and --json (one JSON object on stdout: { ok, errors, logs, warnings, ... }). Exit codes: 0 done,
// 1 something failed (scene errors included), 2 a bad command line or no project.
import path from 'node:path';
import { HELP, int, list, num, pageOf, parseCommand, samplesOf, UsageError, type Values } from './args';
import { ENGINE, projectDir } from './server';
import type { Req, Result } from './ops';

const argv = process.argv.slice(2);
const mode = argv[0] ?? '';
if (!mode || mode === '--help' || mode === '-h' || mode === 'help') { console.log(HELP); process.exit(mode ? 0 : 1); }

/** A bad command line or project: exit 2 (with --json, the report shape on stdout as well). */
const fail = (msg: string): never => {
  if (argv.includes('--json')) console.log(JSON.stringify({ ok: false, errors: [msg], logs: [], warnings: [] }, null, 1));
  console.error(`reel: ${msg}`);
  process.exit(2);
};

// the project tools keep their own flags: hand the rest of the line to them
const TOOLS: Record<string, string[]> = {
  narrate: ['bun', path.join(ENGINE, 'tools/narration.ts')],
  align: ['bun', path.join(ENGINE, 'tools/align.ts')],
  mix: ['bun', path.join(ENGINE, 'tools/mix.ts')],
  analyze: ['uv', 'run', path.join(ENGINE, 'tools/analyze.py')],
};
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

let P!: ReturnType<typeof parseCommand>;
try { P = parseCommand(argv); } catch (e) { fail((e as Error).message); }
const A = P.values;
if (A.help) { console.log(HELP); process.exit(0); }
const json = !!A.json;
const say = (s: string) => { if (!json) console.log(s); };
/** A path given on the command line, absolute (requests travel to the warm renderer, whose folder differs). */
const abs = (p: unknown) => (typeof p === 'string' ? path.resolve(p) : undefined);

/** Print a result and exit with its code. */
function finish(res: Result, human: (r: Result) => void): never {
  if (json) console.log(JSON.stringify(res, null, 1));
  else {
    if (res.ok) human(res);
    for (const w of res.warnings ?? []) console.error(`warning: ${w}`);
    if (res.logs.length) console.error('BROWSER LOG:\n' + res.logs.slice(0, 40).join('\n'));
    if (res.errors.length) console.error('ERRORS:\n' + res.errors.join('\n'));
  }
  process.exit(res.usage ? 2 : res.ok ? 0 : 1);
}

if (mode === 'init') {
  const { initOptions, initProject } = await import('./init');
  const out: Result & { project?: string; files?: string[] } = { ok: true, errors: [], logs: [], warnings: [] };
  let files: string[] = [];
  try { files = initProject(P.positionals[0]!, initOptions(A as { size?: string; fps?: string; theme?: string; narrated?: boolean })); } catch (e) { fail((e as Error).message); }
  const project = path.resolve(P.positionals[0]!);
  Object.assign(out, { project, files });
  if (A.narrated) {
    // time the script with a scratch voice, so the project has its words and length before the first render
    const p = Bun.spawn(['bun', path.join(ENGINE, 'tools/narration.ts')], { stdio: ['ignore', json ? 'pipe' : 'inherit', json ? 'pipe' : 'inherit'], env: { ...process.env, REEL_PROJECT: project } });
    if (await p.exited !== 0) out.errors.push(`reel narrate failed in ${project}: the project is written but has no timing yet; run \`reel narrate\` (macOS say) or \`reel align <recording>\` there`);
  }
  out.ok = !out.errors.length;
  finish(out, () => {
    console.log(files.map((f) => path.relative(process.cwd(), f)).join('\n'));
    console.log(`\n${project} is ready: cd there and run \`bun run reel still --t 1\``);
  });
}

let PROJECT = '';
try { PROJECT = projectDir(typeof A.project === 'string' ? A.project : '.'); } catch (e) { fail((e as Error).message); }

if (mode === 'dev') {
  const { startServer } = await import('./server');
  let srv;
  // (5173 when it is free, else the next free port: the URL printed is this project's)
  const port = num(A, 'port', 5173);
  try { srv = await startServer(PROJECT, { port, strictPort: A.port !== undefined, hmr: true, theme: A.theme as string | undefined }); } catch (e) { fail((e as Error).message); }
  console.log(`${srv!.url}  (space plays, arrows seek, , and . step a frame, [ and ] jump clips, l loops, h hides the UI)`);
  await new Promise(() => {});
}

const hist = (h: Record<string, number>) => Object.entries(h).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}:${v}`).join(' ');

let req!: Req;
try {
  const page = pageOf(A), samples = samplesOf(A), shutter = num(A, 'shutter', 0.5);
  if (mode === 'video') {
    const { exportVideo } = await import('./video');
    const { Renderer } = await import('./renderer');
    const r = new Renderer(PROJECT, { headed: !!A.headed });
    const res: Result = { ok: true, errors: [], logs: [], warnings: [] };
    try {
      const m = await r.meta();
      const out = abs(A.out) ?? path.join(PROJECT, 'out/video.mp4');
      const v = await exportVideo({
        url: m.url, project: PROJECT, fmt: { w: page.w ?? m.format.w, h: page.h ?? m.format.h, fps: page.fps ?? m.format.fps, scale: page.scale }, only: page.only, theme: page.theme,
        samples, shutter, from: num(A, 'from'), to: num(A, 'to'), out,
        crf: num(A, 'crf', 16), preset: (A.preset as string) ?? 'slow', x264: (A.x264 as string) ?? 'aq-mode=3', noaudio: !!A.noaudio,
        workers: int(A, 'workers', 2), chunk: int(A, 'chunk', 8), memGb: num(A, 'mem-gb', 1), spoolGb: num(A, 'spool-gb', 20), headed: !!A.headed,
        onProgress: (p) => {
          if (A.progress) console.error(JSON.stringify(p));
          else if (!json) process.stdout.write(`\r${p.frames}/${p.total} frames  ${p.fps.toFixed(1)} fps  eta ${p.eta.toFixed(0)}s   `);
        },
      });
      Object.assign(res, { file: v.file, frames: v.frames, seconds: v.seconds, workers: v.workers, subFrames: v.subFrames });
      res.errors.push(...v.errors);
      res.logs.push(...v.logs);
      say(`\nwrote ${v.file} (${v.frames} frames in ${v.seconds}s, ${v.workers} worker${v.workers > 1 ? 's' : ''}${v.spoolPeak ? `, up to ${v.spoolPeak} frames spooled to disk` : ''})`);
      say(`sub-frames per frame (count:frames): ${hist(v.subFrames)}`);
    } catch (e) {
      if (e instanceof UsageError) throw e;
      res.errors.push(String((e as Error)?.message ?? e));
    } finally { await r.close(); }
    res.ok = !res.errors.length;
    finish(res, () => {});
  }
  req = { op: mode as Req['op'], project: PROJECT, page, samples, shutter, args: argsOf(A) };
} catch (e) {
  if (e instanceof UsageError) fail(e.message);
  throw e;
}

/** The op's arguments from its flags. */
function argsOf(v: Values): Record<string, unknown> {
  const maxSize = v['max-size'] !== undefined ? int(v, 'max-size', 0, 16) : undefined;
  switch (mode) {
    case 'still': {
      const times = list(v, 't');
      if (!times.length) throw new UsageError('still needs --t <seconds>[,<seconds>...]');
      return { times, out: abs(v.out), maxSize };
    }
    case 'sheet': return { from: num(v, 'from'), to: num(v, 'to'), n: int(v, 'n', 12), times: list(v, 'times'), cuts: !!v.cuts, cols: int(v, 'cols', 4), cell: int(v, 'cell', 480, 16), out: abs(v.out), maxSize };
    case 'strip': return { from: num(v, 'from'), to: num(v, 'to'), n: int(v, 'n', 8, 2), frames: v.frames === undefined ? undefined : int(v, 'frames', 8, 2), cell: int(v, 'cell', 360, 16), out: abs(v.out), maxSize };
    case 'events': return { out: abs(v.out) };
    case 'perf': return { from: num(v, 'from', 0), to: num(v, 'to', 5) };
    default: return {};
  }
}

const { Renderer } = await import('./renderer');
const { run } = await import('./ops');
const r = new Renderer(PROJECT, { headed: !!A.headed });
let res: Result;
try { res = await run(r, req); } finally { await r.close(); }

finish(res!, (x) => {
  if (mode === 'info') {
    const tl = x.timeline as { id: string; start: number; end: number; track: number }[], [w, h] = x.size as number[];
    say(`${PROJECT}\n${w}x${h} at ${x.fps} fps, ${(x.duration as number).toFixed(3)} s, ${x.track ?? 'no audio track'}, theme ${x.theme}`);
    for (const e of tl) say(`  ${e.id.padEnd(16)} ${e.start.toFixed(3).padStart(9)} to ${e.end.toFixed(3).padStart(9)}  track ${e.track}`);
    say(`${(x.cues as unknown[]).length} sound cues`);
  } else if (mode === 'still') {
    for (const f of x.frames as { t: number; file: string; subFrames: number }[]) say(typeof req.samples === 'number' ? f.file : `${f.file}  (${f.subFrames} sub-frames)`);
  } else if (mode === 'sheet' || mode === 'strip') say(String(x.file));
  else if (mode === 'events') say(`${x.file}: ${x.clips} clips, ${x.cues} cues`);
  else if (mode === 'perf') say(`frames ${x.frames}  avg ${(x.avg as number).toFixed(1)}ms  p50 ${(x.p50 as number).toFixed(1)}  p95 ${(x.p95 as number).toFixed(1)}  max ${(x.max as number).toFixed(1)}  sub-frames ${hist(x.subFrames as Record<string, number>)}`);
  else if (mode === 'gpu') say(String(x.gpu));
});
