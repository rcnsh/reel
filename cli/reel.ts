#!/usr/bin/env bun
// reel: render a video project (a folder with a reel.config.ts) in headless Chrome. `reel --help` lists the
// commands and flags (cli/args.ts). Every rendering command takes --project <folder> (default: the current
// folder) and --json (one JSON object on stdout: { ok, errors, logs, warnings, ... }). Exit codes: 0 done,
// 1 something failed (scene errors included), 2 a bad command line or no project.
import { rmSync } from 'node:fs';
import path from 'node:path';
import { checkScale, HELP, int, list, num, pageOf, parseCommand, samplesOf, UsageError, type PageOpts, type Values } from './args';
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
  narrate: ['bun', path.join(ENGINE, 'tools/narrate.ts')],
  align: ['bun', path.join(ENGINE, 'tools/align.ts')],
  mix: ['bun', path.join(ENGINE, 'tools/mix.ts')],
  subtitles: ['bun', path.join(ENGINE, 'tools/subtitles.ts')],
  assets: ['bun', path.join(ENGINE, 'tools/assets.ts')],
  analyze: ['uv', 'run', path.join(ENGINE, 'tools/analyze.py')],
};
if (TOOLS[mode]) {
  const rest = argv.slice(1);
  let dir = '.';
  const i = rest.findIndex((a) => a === '--project' || a.startsWith('--project='));
  if (i >= 0) dir = rest[i]!.includes('=') ? rest.splice(i, 1)[0]!.slice('--project='.length) : rest.splice(i, 2)[1] ?? fail('--project needs a folder');
  const help = rest.includes('--help') || rest.includes('-h');
  let project = path.resolve(dir);
  if (!help) try { project = projectDir(dir); } catch (e) { fail((e as Error).message); }
  const proc = Bun.spawn([...TOOLS[mode]!, ...rest], { stdio: ['inherit', 'inherit', 'inherit'], env: { ...process.env, REEL_PROJECT: project } });
  process.exit(await proc.exited);
}

let P!: ReturnType<typeof parseCommand>;
try { P = parseCommand(argv); } catch (e) { fail((e as Error).message); }
let A = P.values;
if (A.help) { console.log(HELP); process.exit(0); }
// (the GL backend travels by environment: to the warm renderer, whose engine version includes it, and video's browsers)
if (typeof A.gl === 'string') {
  process.env.REEL_GL = A.gl;
  try { (await import('./chrome')).glBackend(); } catch (e) { fail(`--gl ${A.gl}: ${(e as Error).message.replace(/^REEL_GL=\S+: /, '')}`); }
}
const json = !!A.json;
const say = (s: string) => { if (!json) console.log(s); };
/** A path given on the command line, absolute (requests travel to the warm renderer, whose folder differs). */
const abs = (p: unknown) => (typeof p === 'string' ? path.resolve(p) : undefined);

/** Print a result and exit with its code. */
function finish(res: Result, human: (r: Result) => void): never {
  if (json) console.log(JSON.stringify(res, null, 1));
  else {
    if (res.ok || res.findings) human(res);
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
    const p = Bun.spawn(['bun', path.join(ENGINE, 'tools/narrate.ts')], { stdio: ['ignore', json ? 'pipe' : 'inherit', json ? 'pipe' : 'inherit'], env: { ...process.env, REEL_PROJECT: project } });
    if (await p.exited !== 0) out.errors.push(`reel narrate failed in ${project}: the project is written but has no timing yet; run \`reel narrate\` there once the error above is fixed, or \`reel align <recording>\``);
  }
  out.ok = !out.errors.length;
  finish(out, () => {
    console.log(files.map((f) => path.relative(project, f)).join('\n'));
    console.log(`\n${project} is ready: cd there and run \`bun run reel still --t 1\``);
  });
}

if (mode === 'mcp') {
  const { serveMcp } = await import('./mcp');
  await serveMcp();
  await new Promise(() => {});
}

if (mode === 'golden') {
  if (P.positionals[0] !== 'update') fail(`golden ${P.positionals[0]}: expected update`);
  const { goldenDir, renderGoldens } = await import('./golden');
  const { files, errors } = await renderGoldens(goldenDir());
  finish({ ok: !errors.length, errors, logs: [], warnings: [], files: [...files.values()] }, () => console.log([...files.values()].join('\n')));
}

if (mode === 'chrome') {
  const sub = P.positionals[0];
  const c = await import('./chrome');
  if (sub === 'install') {
    let last = -1;
    const file = await c.installChrome((done, total) => {
      const pc = Math.floor((100 * done) / Math.max(1, total));
      if (!json && pc !== last && pc % 5 === 0) { last = pc; process.stderr.write(`\rdownloading Chrome for Testing ${c.CHROME_BUILD}: ${pc}%   `); }
    }).catch((e) => finish({ ok: false, errors: [`reel chrome install: ${(e as Error).message}`], logs: [], warnings: [] }, () => {}));
    if (!json) process.stderr.write('\n');
    const warnings = process.env.CHROME_PATH ? [`CHROME_PATH is set (${process.env.CHROME_PATH}), so renders use that instead: unset it to use this one`] : [];
    const libs = c.missingLibsMessage(file as string);
    if (libs) warnings.push(libs);
    finish({ ok: true, errors: [], logs: [], warnings, file, build: c.CHROME_BUILD }, () => console.log(file));
  }
  if (sub === 'path') {
    const res: Result = { ok: true, errors: [], logs: [], warnings: [] };
    try {
      const choice = c.findChrome();
      const { launchChrome } = await import('./renderer');
      const b = await launchChrome();
      Object.assign(res, { file: choice.path, source: choice.source, version: b.version() });
      await b.close();
    } catch (e) { res.ok = false; res.errors.push((e as Error).message); }
    finish(res, (r) => console.log(`${r.file}\nChrome ${r.version} (${r.source === 'CHROME_PATH' ? 'from CHROME_PATH' : 'the pinned build'})`));
  }
  fail(`chrome ${sub}: expected install or path`);
}

if (mode === 'font') {
  if (P.positionals[0] !== 'add') fail(`font ${P.positionals[0]}: expected add`);
  let project = '';
  try { project = projectDir(typeof A.project === 'string' ? A.project : '.'); } catch (e) { fail((e as Error).message); }
  const { addGoogleFont } = await import('./fonts');
  const res: Result = { ok: true, errors: [], logs: [], warnings: [] };
  try { Object.assign(res, await addGoogleFont(project, P.positionals[1]!)); } catch (e) { res.ok = false; res.errors.push((e as Error).message); }
  finish(res, (r) => console.log(`${(r.files as string[]).map((f) => path.relative(process.cwd(), f)).join('\n')}\nHTML layers can use font-family: ${(r.families as string[]).map((f) => `'${f}'`).join(', ')}`));
}

if (mode === 'skills') {
  if (P.positionals[0] !== 'update') fail(`skills ${P.positionals[0]}: expected update`);
  let project = '';
  try { project = projectDir(typeof A.project === 'string' ? A.project : '.'); } catch (e) { fail((e as Error).message); }
  const { installSkills, skillNames } = await import('./init');
  const files = installSkills(project);
  finish({ ok: true, errors: [], logs: [], warnings: [], skills: skillNames(), files }, () => console.log(`${skillNames().join(', ')} -> ${path.join(project, '.claude/skills')} (${files.length} files)`));
}

if (mode === 'daemon') {
  const sub = P.positionals[0];
  const d = await import('./daemon');
  if (sub === 'run') {
    let running = false;
    try { running = await d.serve(projectDir(typeof A.project === 'string' ? A.project : '.')); } catch (e) { fail((e as Error).message); }
    if (!running) process.exit(0);
    await new Promise(() => {});
  }
  const res: Result = { ok: true, errors: [], logs: [], warnings: [] };
  if (sub === 'status') {
    const list = await d.status();
    res.daemons = list;
    finish(res, () => {
      if (!list.length) console.log('no warm renderer is running');
      for (const x of list) console.log(`${x.project}\n  pid ${x.pid}, up ${Math.round(x.uptime / 1000)} s, ${x.busy ? 'busy' : `idle ${Math.round(x.idle / 1000)} s`}, ${x.requests} requests, ${x.pages} page${x.pages === 1 ? '' : 's'}${x.stale ? ', stale (the engine changed: the next command restarts it)' : ''}\n  log ${x.log}`);
    });
  }
  if (sub === 'stop') {
    let project: string | null = null;
    if (!A.all) try { project = projectDir(typeof A.project === 'string' ? A.project : '.'); } catch (e) { fail(`${(e as Error).message}, or --all`); }
    res.stopped = await d.stop(project);
    // (--all also sweeps what dead exports and servers left: spool and frame folders, Vite's stale optimizer folders)
    if (A.all) res.swept = (await import('./scratch')).sweep([(await import('node:os')).tmpdir()], path.join(ENGINE, 'node_modules/.vite'));
    finish(res, () => {
      console.log((res.stopped as string[]).length ? `stopped ${(res.stopped as string[]).join(', ')}` : 'no warm renderer was running');
      if (A.all) console.log(`removed ${(res.swept as string[]).length} stale scratch folder${(res.swept as string[]).length === 1 ? '' : 's'}`);
    });
  }
  fail(`daemon ${sub}: expected status or stop`);
}

let PROJECT = '';
// (diff of two files needs no project)
const needsProject = !(mode === 'diff' && A.t === undefined);
try { PROJECT = projectDir(typeof A.project === 'string' ? A.project : '.'); } catch (e) { if (needsProject) fail((e as Error).message); }

if (mode === 'review') {
  const R = await import('./review');
  const file = P.positionals[0] ? path.resolve(P.positionals[0]) : R.latestRender(PROJECT);
  if (!file) fail(`no video under ${path.join(PROJECT, 'out')}: render one (reel video --draft) or name a file`);
  if (!(await Bun.file(file!).exists())) fail(`${file}: no such file`);
  const port = A.port === undefined ? 0 : (() => { try { return int(A, 'port', 0, 1); } catch (e) { return fail((e as Error).message); } })();
  const warnings: string[] = [];
  const timeline = await R.timelineOf(PROJECT, (w) => warnings.push(w));
  let srv;
  try { srv = R.serveReview({ project: PROJECT, file: file!, port, timeline }); } catch (e) { fail((e as Error).message); }
  if (json) console.log(JSON.stringify({ ok: true, errors: [], logs: [], warnings, url: srv!.url, file, draft: srv!.draft, notes: (await import('./notes')).notesPath(PROJECT) }));
  else {
    for (const w of warnings) console.error(`warning: ${w}`);
    console.log(`${srv!.url}  reviewing ${path.relative(process.cwd(), file!) || file}${srv!.draft ? ' (a draft)' : ''}; notes go to ${path.relative(process.cwd(), (await import('./notes')).notesPath(PROJECT))}. Ctrl-C stops it.`);
  }
  await new Promise(() => {});
}

if (mode === 'notes') {
  const N = await import('./notes');
  const [sub, arg] = P.positionals;
  const res: Result = { ok: true, errors: [], logs: [], warnings: [], file: N.notesPath(PROJECT) };
  try {
    if (sub === undefined) {
      if (A.t !== undefined) throw new UsageError('--t goes with notes add and notes move');
      const all = N.readNotes(PROJECT), shown = A.open ? all.filter((n) => n.status === 'open') : all;
      res.notes = shown.map((n) => N.listed(PROJECT, n));
      finish(res, () => console.log(N.formatNotes(PROJECT, shown, all)));
    }
    if (sub === 'done' || sub === 'reopen') {
      if (!arg) throw new UsageError(`notes ${sub} <id>`);
      const note = N.patchNote(PROJECT, arg, { status: sub === 'done' ? 'done' : 'open' });
      res.note = N.listed(PROJECT, note);
      finish(res, () => console.log(`${note.id} is ${note.status}: ${note.text.split('\n')[0]}`));
    }
    if (sub === 'add') {
      if (!arg) throw new UsageError('notes add --t <seconds> "<text>"');
      const t = num(A, 't');
      if (t === undefined || t < 0) throw new UsageError('notes add needs --t <seconds>');
      const R = await import('./review');
      const fps = (await import('../src/config')).formatOf(await (await import('./server')).loadConfig(PROJECT)).fps;
      const timeline = await R.timelineOf(PROJECT, (w) => res.warnings.push(w));
      const { frame } = N.frameOf(t, fps);
      const latest = R.latestRender(PROJECT);
      const note = N.addNote(PROJECT, { t, frame, clips: timeline ? N.clipsAt(timeline.timeline, t) : [], text: arg, render: latest ? R.renderRef(PROJECT, latest, R.isDraft(latest, '')) : null });
      res.note = N.listed(PROJECT, note);
      finish(res, () => console.log(`added ${note.id} at ${note.t.toFixed(3)} s (frame ${note.frame}, ${note.clips.join('+') || 'no clip'})`));
    }
    if (sub === 'move') {
      const t = num(A, 't');
      if (!arg || t === undefined || t < 0) throw new UsageError('notes move <id> --t <seconds>');
      const R = await import('./review');
      const fps = (await import('../src/config')).formatOf(await (await import('./server')).loadConfig(PROJECT)).fps;
      const timeline = await R.timelineOf(PROJECT, (w) => res.warnings.push(w));
      const note = N.patchNote(PROJECT, arg, { moved: { t, frame: N.frameOf(t, fps).frame, clips: timeline ? N.clipsAt(timeline.timeline, t) : [] } });
      res.note = N.listed(PROJECT, note);
      finish(res, () => console.log(`${note.id} is now at ${note.t.toFixed(3)} s (frame ${note.frame}, ${note.clips.join('+') || 'no clip'})`));
    }
    throw new UsageError(`notes ${sub}: expected add, move, done or reopen (or nothing, to list them)`);
  } catch (e) {
    if (e instanceof UsageError) fail(e.message);
    finish({ ...res, ok: false, errors: [(e as Error).message] }, () => {});
  }
}

if (mode === 'dev') {
  const { startServer } = await import('./server');
  let srv;
  // (5173 when it is free, else the next free port: the URL printed is this project's)
  const port = num(A, 'port', 5173);
  try { srv = await startServer(PROJECT, { port, strictPort: A.port !== undefined, hmr: true, theme: A.theme as string | undefined }); } catch (e) { fail((e as Error).message); }
  console.log(`${srv!.url}  (space plays, arrows seek, , and . step a frame, [ and ] jump clips, l loops, h hides the UI)`);
  await new Promise(() => {});
}

function printCheck(x: Result) {
  const fs = x.findings as import('../src/check').Finding[], sm = x.summary as Record<string, number>;
  for (const f of fs) {
    const when = f.until > f.t ? `${f.t.toFixed(2)}-${f.until.toFixed(2)}s` : `${f.t.toFixed(2)}s`;
    console.log(`${f.severity.toUpperCase().padEnd(7)} ${f.kind.padEnd(10)} ${when.padEnd(12)} ${(f.clip || '-').padEnd(12)} ${f.message}${f.image ? `\n${' '.repeat(44)}${f.image}` : ''}`);
  }
  console.log(`${x.frames} frames checked: ${sm.error} errors, ${sm.warning} warnings, ${sm.info} notes`);
}

const hist = (h: Record<string, number>) => Object.entries(h).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}:${v}`).join(' ');

/** The logical frame size a page will have: --size, else the config's, read outside the browser (null when the config does not load: the renderer reports that). */
async function frameSize(page: PageOpts): Promise<[number, number] | null> {
  if (page.w && page.h) return [page.w, page.h];
  try {
    const f = (await import('../src/config')).formatOf(await (await import('./server')).loadConfig(PROJECT));
    return [f.w, f.h];
  } catch { return null; }
}

let req!: Req;
try {
  const page = pageOf(A), shutter = num(A, 'shutter', 0.5);
  // (a scale that does not pack is refused here, before a browser starts; only half size can miss)
  if (page.scale === 0.5) { const s = await frameSize(page); if (s) checkScale(s[0], s[1], page.scale); }
  let samples = samplesOf(A);
  if (mode === 'video') {
    const { exportVideo } = await import('./video');
    const { Renderer } = await import('./renderer');
    const F = await import('./formats');
    const format = F.formatOf(A.format as string | undefined, abs(A.out));
    if (A.audio && A.noaudio) throw new UsageError('--audio and --noaudio contradict each other');
    if (A.wait && A.force) throw new UsageError('--wait and --force contradict each other: --wait queues for the export slot, --force runs beside the export that holds it');
    // the project's export defaults (the config's `export`), under the flags given
    // (a config that does not load is reported by the renderer, with its line)
    const cfg = await (await import('./server')).loadConfig(PROJECT).catch(() => null);
    const given = A;
    A = F.withExportDefaults(A, cfg?.export, format);
    if (A.samples !== given.samples) samples = samplesOf(A);
    const enc = F.encodeOptsOf(A, format);
    if (A.draft) {
      // a quick look: half size (the layout of the full size), one sample, the fastest encoder; named and tagged a draft
      if (A.samples !== undefined || A.scale !== undefined) throw new UsageError('--draft renders at half size with one sample: leave out --samples and --scale');
      samples = 1;
      enc.draft = F.draftEncoder();
      // (half size when the frame's halves pack into the readback, else full size: still one sample)
      const s = await frameSize(page);
      page.scale = s ? F.draftScale(s[0], s[1]) : 1;
      enc.comment = `reel draft: ${page.scale === 0.5 ? 'half size' : 'full size'}, one sample, not for delivery`;
    }
    const mixed = !!A.mix || A.subtitles === true;
    if (mixed && !format.audio) throw new UsageError(`--${A.mix ? 'mix' : 'subtitles'}: ${format.id} carries no sound${A.subtitles ? ' or subtitles' : ''} (h264, hevc, prores, prores4444 and webm do)`);
    const r = new Renderer(PROJECT, { headed: !!A.headed });
    const res: Result = { ok: true, errors: [], logs: [], warnings: [] };
    let release = () => {}, offPic = () => {}, pic: string | null = null;
    try {
      const m = await r.meta();
      const sc = page.scale, plan = F.planOf(format, enc, page.fps ?? m.format.fps, [(page.w ?? m.format.w) * sc, (page.h ?? m.format.h) * sc]);
      const out = F.draftName(abs(A.out) ?? F.defaultOut(PROJECT, format), !!A.draft);
      // (with --mix the picture is rendered to a scratch file beside the output and the mix writes the output)
      const { partialOf, onAbort } = await import('./scratch');
      if (mixed) { const p = pic = partialOf(out); offPic = onAbort(() => rmSync(p, { force: true })); }
      const X = await import('./exports');
      release = A.wait
        ? await X.queueExport(PROJECT, out, (running, ahead) => {
          if (A.progress) console.error(JSON.stringify({ queued: true, running: running ? X.describeClaim(running) : null, ahead }));
          else if (!json) console.error(`waiting for the export slot: ${running ? `running ${X.describeClaim(running)}` : 'free'}${ahead ? `, ${ahead} queued ahead` : ''}`);
        })
        : X.claimExport(PROJECT, out, !!A.force);
      if (A.wait && A.progress) console.error(JSON.stringify({ queued: false }));
      // (the subtitles first: a project without timed words fails before it renders, not after)
      const subs = A.subtitles ? (await import('../tools/subtitles')).writeSubtitles(PROJECT, { from: num(A, 'from', 0), to: num(A, 'to') }).srt : undefined;
      const v = await exportVideo({
        url: m.url, project: PROJECT, fmt: { w: page.w ?? m.format.w, h: page.h ?? m.format.h, fps: page.fps ?? m.format.fps, scale: page.scale }, only: page.only, theme: page.theme,
        samples, shutter, from: num(A, 'from'), to: num(A, 'to'), out: pic ?? out, direct: !!pic, plan, enc, noaudio: !!A.noaudio || mixed,
        workers: int(A, 'workers', 2), chunk: int(A, 'chunk', 8), memGb: num(A, 'mem-gb', 1), spoolGb: num(A, 'spool-gb', 20), headed: !!A.headed,
        onProgress: (p) => {
          if (A.progress) console.error(JSON.stringify(p));
          else if (!json) process.stdout.write(`\r${p.frames}/${p.total} frames  ${p.fps.toFixed(1)} fps  eta ${p.eta.toFixed(0)}s   `);
        },
      });
      // (null: scene errors, and the previous output left as it was)
      const file = v.file && !mixed ? (format.kind === 'sequence' ? F.sequencePattern(v.file, format) : v.file) : undefined;
      if (A.draft) res.draft = { encoder: v.encoder ?? (enc.draft === 'videotoolbox' ? 'VideoToolbox H.264 (raw pipe)' : 'x264 ultrafast (raw pipe)'), scale: page.scale, samples: 1 };
      Object.assign(res, { gl: (await import('./chrome')).glBackend(), file, format: format.id, pixels: plan.pixels, alpha: plan.alpha, fps: plan.fps, frames: v.frames, seconds: v.seconds, workers: v.workers, subFrames: v.subFrames });
      res.errors.push(...r.explain(v.errors));
      res.logs.push(...r.explain(v.logs));
      say(`\n${file ? `wrote ${file}` : v.file ? 'rendered the picture' : `rendered with scene errors, ${out} left as it was`} (${format.id}${plan.alpha ? ', alpha' : ''}, ${v.frames} frames in ${v.seconds}s, ${v.workers} worker${v.workers > 1 ? 's' : ''}${v.spoolPeak ? `, up to ${v.spoolPeak} frames spooled to disk` : ''})`);
      say(A.draft ? `a draft (${(res.draft as { encoder: string }).encoder}, ${page.scale === 0.5 ? 'half size' : 'full size: half would not pack'}, one sample): not for delivery` : `sub-frames per frame (count:frames): ${hist(v.subFrames)}`);
      if (pic && v.file) {
        const mres = await (await import('../tools/mix')).mixVideo({ root: PROJECT, input: pic, output: out, from: num(A, 'from', 0), events: v.events, subtitles: subs });
        res.warnings.push(...mres.warnings);
        Object.assign(res, { file: out, loudness: mres.loudness, ...(subs ? { subtitles: subs } : {}) });
        say(mres.summary);
      }
    } catch (e) {
      if (e instanceof UsageError) throw e;
      res.errors.push(...r.explain([String((e as Error)?.message ?? e)]));
    } finally {
      // (the picture a mix is made from is scratch, whatever happened)
      if (pic) rmSync(pic, { force: true });
      await r.close(); release(); offPic();
    }
    res.ok = !res.errors.length;
    finish(res, () => {});
  }
  req = { op: mode as Req['op'], project: PROJECT, page, samples, shutter, args: argsOf(A) };
  // (a deep or transparent readback needs a page made for it)
  if (mode === 'perf' && /16/.test(req.args.pixels)) page.bits = 10;
  if (mode === 'perf' && /rgba/.test(req.args.pixels)) page.alpha = true;
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
    case 'check': {
      const safe = num(v, 'safe', 0.05);
      if (!(safe >= 0 && safe < 0.5)) throw new UsageError(`--safe ${v.safe}: expected a share of the side from 0 to 0.5`);
      const step = num(v, 'step', 0.5);
      if (!(step > 0)) throw new UsageError(`--step ${v.step}: expected seconds over 0`);
      return { from: num(v, 'from'), to: num(v, 'to'), step, safe, minText: num(v, 'min-text'), frozen: num(v, 'frozen', 3), out: abs(v.out) };
    }
    case 'events': return { out: abs(v.out) };
    case 'perf': {
      const pixels = (v.pixels as string | undefined) ?? 'rgb8';
      if (!['rgb8', 'yuv420', 'rgba8', 'rgb16', 'rgba16', 'linear'].includes(pixels)) throw new UsageError(`--pixels ${v.pixels}: expected rgb8, yuv420, rgba8, rgb16, rgba16 or linear`);
      return { from: num(v, 'from', 0), to: num(v, 'to', 5), pixels };
    }
    default: return {};
  }
}

/** Run a request on the project's warm renderer, or (--no-daemon, --headed) on a renderer of this command's own. */
async function render(q: Req): Promise<Result> {
  if (!A['no-daemon'] && !A.headed && !process.env.REEL_NO_DAEMON) {
    const { call } = await import('./daemon');
    return call(q);
  }
  const { Renderer } = await import('./renderer');
  const { run } = await import('./ops');
  const r = new Renderer(PROJECT, { headed: !!A.headed });
  try { return await run(r, q); } finally { await r.close(); }
}

if (mode === 'diff') {
  const { runDiff } = await import('./diff');
  let res: Result;
  try {
    const tol = int(A, 'tol', 0, 0), threshold = num(A, 'threshold', 0);
    let t: number | undefined;
    if (A.t !== undefined) {
      const ts = list(A, 't');
      if (ts.length !== 1) throw new UsageError(`--t ${A.t}: diff renders one time`);
      if (P.positionals.length !== 1) throw new UsageError('diff --t <seconds> compares a render with one image: reel diff --t 2.5 <b.png>');
      t = ts[0];
    } else if (P.positionals.length !== 2) throw new UsageError('diff compares two images: reel diff <a.png> <b.png> (or --t <seconds> <b.png>)');
    res = await runDiff({ a: t === undefined ? P.positionals[0] : undefined, b: P.positionals.at(-1)!, t, req, tol, threshold, out: abs(A.out), project: PROJECT || undefined, render });
  } catch (e) {
    if (e instanceof UsageError) fail(e.message);
    res = { ok: false, errors: [String((e as Error)?.message ?? e)], logs: [], warnings: [] };
  }
  finish(res, (x) => { say(String(x.summary)); say(String(x.file)); });
}

const res: Result = await render(req);

finish(res, (x) => {
  if (mode === 'info') {
    const tl = x.timeline as { id: string; start: number; end: number; track: number }[], [w, h] = x.size as number[];
    say(`${PROJECT}\n${w}x${h} at ${x.fps} fps, ${(x.duration as number).toFixed(3)} s, ${x.track ?? 'no audio track'}, theme ${x.theme}`);
    for (const e of tl) say(`  ${e.id.padEnd(16)} ${e.start.toFixed(3).padStart(9)} to ${e.end.toFixed(3).padStart(9)}  track ${e.track}`);
    say(`${(x.cues as unknown[]).length} sound cues, ${(x.sounds as unknown[]).length} sounds on the timeline`);
  } else if (mode === 'still') {
    for (const f of x.frames as { t: number; file: string; subFrames: number }[]) say(typeof req.samples === 'number' ? f.file : `${f.file}  (${f.subFrames} sub-frames)`);
  } else if (mode === 'sheet' || mode === 'strip') say(String(x.file));
  else if (mode === 'check') printCheck(x);
  else if (mode === 'events') say(`${x.file}: ${x.clips} clips, ${x.cues} cues, ${x.sounds} sounds on the timeline`);
  else if (mode === 'perf') say(`frames ${x.frames}  avg ${(x.avg as number).toFixed(1)}ms (render ${(x.render as number).toFixed(1)}${x.adaptive ? ' with the GPU waits of --samples auto' : ''}, gpu ${(x.gpu as number).toFixed(1)}, readback ${(x.readback as number).toFixed(1)})  p50 ${(x.p50 as number).toFixed(1)}  p95 ${(x.p95 as number).toFixed(1)}  max ${(x.max as number).toFixed(1)}  sub-frames ${hist(x.subFrames as Record<string, number>)}`);
  else if (mode === 'gpu') say(`${x.gpu}\nGL backend: ${x.gl}${x.software ? ' (software rendering: no GPU)' : ''}`);
});
