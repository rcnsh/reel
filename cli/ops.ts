// What the CLI, the warm renderer and the MCP server ask a project's page to do. A request is plain data (it
// crosses a socket to the warm renderer): the op, the project, how to open the page, the sampling and the op's
// arguments, with every path in it absolute. Each op returns the fields it adds to the result.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AdaptiveSampling } from '../src/engine/engine';
import { checkTimes, findingsOf, type Finding, type Sample } from '../src/check';
import { UsageError, type PageOpts } from './args';
import { isGone, type PageHandle, type Renderer } from './renderer';
import { describe, missingAssets } from '../tools/asset-manifest';

export type Op = 'info' | 'still' | 'sheet' | 'strip' | 'check' | 'events' | 'perf' | 'gpu';
export interface Req {
  op: Op;
  project: string;
  page: PageOpts;
  samples: number | AdaptiveSampling;
  shutter: number;
  args: Record<string, any>;
}
/** What every command prints with --json; `errors` (scene, shader and page errors) make it exit 1, `usage` 2. */
export interface Result { ok: boolean; errors: string[]; logs: string[]; warnings: string[]; usage?: boolean; [k: string]: unknown }

export interface ClipInfo { id: string; start: number; end: number; track: number; exempt?: import('../src/engine/report').CheckRule[] | true }
export interface PageMeta { duration: number; timeline: ClipInfo[]; cues: { kind: string; t: number }[]; sounds: import('../src/config').SoundClip[]; track: string | null; theme: string; W: number; H: number; fps: number; scale: number }

export const meta = (h: PageHandle): Promise<PageMeta> => h.page.evaluate(() => {
  const R = (window as any).__reel;
  return { duration: R.duration, timeline: R.timeline, cues: R.cues, sounds: R.sounds, track: R.track, theme: R.theme, W: R.W, H: R.H, fps: R.fps, scale: R.scale };
});

/** `dir/base.png`, or `dir/base-2.png`, `-3` … when that is taken: stills and sheets never overwrite each other. */
export function freeName(dir: string, base: string, ext = '.png') {
  let f = path.join(dir, base + ext);
  for (let i = 2; existsSync(f); i++) f = path.join(dir, `${base}-${i}${ext}`);
  return f;
}

/** A still's name: the clips on screen (the theme's overlay only when alone) and the time, `hello_2.500s`. */
export function stillName(clips: string[], t: number) {
  const ids = clips.length > 1 ? clips.filter((c) => c !== 'overlay') : clips;
  return `${ids.map((c) => c.replace(/[^\w.-]+/g, '-')).join('+') || 'nothing'}_${t.toFixed(3)}s`;
}

/** Frame times n evenly spaced from `from` to `to`, both included. */
export const spaced = (from: number, to: number, n: number) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / Math.max(1, n - 1));

interface Ctx { r: Renderer; req: Req; warn: (s: string) => void; error: (s: string) => void; wrote: (file: string) => void }

function writeB64(ctx: Ctx, file: string, b64: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(b64, 'base64'));
  ctx.wrote(file);
}

function warnOutside(ctx: Ctx, m: PageMeta, times: number[]) {
  for (const t of times) if (t < 0 || t >= m.duration) ctx.warn(`t=${t} is outside the video (0 to ${m.duration.toFixed(3)} s): nothing is on screen`);
}

const OPS: Record<Op, (h: PageHandle, ctx: Ctx) => Promise<Record<string, unknown>>> = {
  async info(h, ctx) {
    const m = await meta(h);
    const tracks = [...new Set(m.timeline.map((c) => c.track))].sort((a, b) => a - b);
    return { project: ctx.req.project, size: [m.W, m.H], fps: m.fps, scale: m.scale, theme: m.theme, duration: m.duration, track: m.track, tracks, timeline: m.timeline, cues: m.cues, sounds: m.sounds };
  },

  async still(h, ctx) {
    const { req } = ctx, a = req.args as { times: number[]; out?: string; maxSize?: number; preview?: number };
    if (!a.times?.length) throw new UsageError('still needs --t <seconds>[,<seconds>...]');
    const one = a.out?.toLowerCase().endsWith('.png');
    if (one && a.times.length > 1) throw new UsageError(`--out ${a.out}: one file holds one still; give a folder for ${a.times.length} times`);
    const dir = one ? path.dirname(a.out!) : a.out ?? path.join(req.project, 'out/stills');
    warnOutside(ctx, await meta(h), a.times);
    const frames: { t: number; file: string; clips: string[]; subFrames: number }[] = [], previews: string[] = [];
    for (const t of a.times) {
      const subFrames: number = await h.page.evaluate(([t, s, sh]) => (window as any).__reel.still(t, s, sh), [t, req.samples, req.shutter] as const);
      const clips: string[] = await h.page.evaluate((t) => (window as any).__reel.clipsAt(t), t);
      // (the pixel buffer the video export reads, not a screenshot of the page)
      const png: string = await h.page.evaluate((o) => (window as any).__reel.png(o), { maxSize: a.maxSize });
      const file = one ? a.out! : freeName(dir, stillName(clips, t));
      writeB64(ctx, file, png);
      frames.push({ t, file, clips, subFrames });
      if (a.preview) previews.push(a.preview === a.maxSize ? png : await h.page.evaluate((o) => (window as any).__reel.png(o), { maxSize: a.preview }));
    }
    return { files: frames.map((f) => f.file), frames, ...(a.preview ? { previews } : {}) };
  },

  async sheet(h, ctx) {
    const { req } = ctx, a = req.args as { from?: number; to?: number; n?: number; times?: number[]; cuts?: boolean; cols?: number; cell?: number; out?: string; maxSize?: number; preview?: number };
    const m = await meta(h);
    let times: number[];
    if (a.cuts) {
      // 4 frames around every cut: 2 before, 2 after
      const starts = [...new Set(m.timeline.map((e) => e.start))].sort((x, y) => x - y).filter((s) => s > 0);
      if (!starts.length) throw new UsageError('sheet --cuts: the timeline has no cuts');
      times = starts.flatMap((s) => [s - 0.1, s - 1 / m.fps, s + 1 / m.fps, s + 0.1]);
    } else if (a.times?.length) times = a.times;
    else {
      const from = a.from ?? 0, to = a.to ?? m.duration - 1 / m.fps;
      if (!(to > from)) throw new UsageError(`--from ${from} --to ${to}: an empty range`);
      times = spaced(from, to, a.n ?? 12);
    }
    warnOutside(ctx, m, times);
    return grid(h, ctx, times, a.cols ?? 4, a.cell ?? 480, a.out ?? freeName(path.join(req.project, 'out/sheets'), `sheet_${times[0]!.toFixed(2)}-${times.at(-1)!.toFixed(2)}`), a);
  },

  async strip(h, ctx) {
    const { req } = ctx, a = req.args as { from?: number; to?: number; n?: number; frames?: number; cell?: number; out?: string; maxSize?: number; preview?: number };
    const m = await meta(h), dt = 1 / m.fps;
    const from = a.from ?? 0;
    let times: number[];
    if (a.frames) times = Array.from({ length: a.frames }, (_, i) => +(from + i * dt).toFixed(6));
    else {
      const to = a.to ?? m.duration - dt;
      if (!(to > from)) throw new UsageError(`--from ${from} --to ${to}: an empty range`);
      times = spaced(from, to, a.n ?? 8);
    }
    if (times.length > 32) throw new UsageError(`strip: ${times.length} frames do not fit in one row (at most 32; a sheet takes more)`);
    warnOutside(ctx, m, times);
    return grid(h, ctx, times, times.length, a.cell ?? 360, a.out ?? freeName(path.join(req.project, 'out/strips'), `strip_${times[0]!.toFixed(3)}-${times.at(-1)!.toFixed(3)}`), a);
  },

  async check(h, ctx) {
    const { req } = ctx, a = req.args as { from?: number; to?: number; step?: number; safe?: number; minText?: number; frozen?: number; out?: string; preview?: boolean; maxImages?: number };
    const m = await meta(h);
    const palette: Record<string, string> = await h.page.evaluate(() => (window as any).__reel.palette);
    const times = checkTimes(m.timeline, m.duration, m.fps, a.from ?? 0, a.to ?? m.duration, a.step ?? 0.5);
    if (!times.length) throw new UsageError(`check: no frames between ${a.from ?? 0} and ${a.to ?? m.duration} s`);
    // one session: every time rendered and measured in this page, errors attributed to the frame that raised them
    const samples: Sample[] = [], seen = new Set<string>();
    for (const t of times) {
      const r: Omit<Sample, 't'> = await h.page.evaluate(([t, s, sh]) => (window as any).__reel.inspect(t, s, sh), [t, req.samples, req.shutter] as const);
      const fresh = r.errors.filter((e) => !seen.has(e));
      for (const e of fresh) seen.add(e);
      samples.push({ ...r, t, errors: fresh });
    }
    const minSide = Math.min(m.W, m.H);
    const findings: Finding[] = findingsOf(samples, {
      W: m.W, H: m.H, safe: a.safe ?? 0.05, minText: a.minText ?? Math.round(minSide * 0.022), frozen: a.frozen ?? 3, clips: m.timeline, palette,
    });
    // a crop of the worst frame of each finding (the whole frame, small, for frame-wide ones)
    const dir = a.out ?? path.join(req.project, 'out/check');
    if (!a.out && existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.png')) rmSync(path.join(dir, f));
    const previews: string[] = [];
    for (const f of findings.slice(0, a.maxImages ?? 40)) {
      await h.page.evaluate(([t, s, sh]) => (window as any).__reel.still(t, s, sh), [f.at, req.samples, req.shutter] as const);
      let crop: [number, number, number, number] | undefined;
      if (f.rect) {
        const [x, y, w, hh] = f.rect, pad = 32, cw = Math.max(w + 2 * pad, 240), ch = Math.max(hh + 2 * pad, 140);
        crop = [Math.max(0, x + w / 2 - cw / 2), Math.max(0, y + hh / 2 - ch / 2), cw, ch];
      }
      const png: string = await h.page.evaluate((o) => (window as any).__reel.png(o), { crop, marks: f.rect ? [f.rect] : [], maxSize: 640 });
      f.image = freeName(dir, `${f.kind}_${(f.clip || 'video').replace(/[^\w.+-]+/g, '-')}_${f.at.toFixed(3)}s`);
      writeB64(ctx, f.image, png);
      if (a.preview) previews.push(png);
    }
    // generated assets declared in assets.json whose files are not there yet (renders show a placeholder)
    for (const x of missingAssets(req.project)) findings.push({
      kind: 'missingAsset', severity: 'warning', t: 0, until: m.duration, frames: 0, at: 0, clip: '', text: x.out,
      message: `asset '${x.id}' (${describe(x)}) is declared in assets.json but ${x.out} does not exist: run \`reel assets\` with the provider's key, or make it from its prompt and save it there`,
    });
    const summary = { error: 0, warning: 0, info: 0 };
    for (const f of findings) summary[f.severity]++;
    if (summary.error) ctx.error(`check: ${summary.error} error finding${summary.error > 1 ? 's' : ''} (${[...new Set(findings.filter((f) => f.severity === 'error').map((f) => f.kind))].join(', ')})`);
    return { findings, summary, frames: times.length, duration: m.duration, ...(a.preview ? { previews } : {}) };
  },

  async events(h, ctx) {
    // sound-mix cues: the timeline (clip starts), every cue() a scene recorded and the sounds on the timeline
    const { duration, timeline, cues, sounds } = await meta(h);
    const out = ctx.req.args.out ?? path.join(ctx.req.project, 'data/cues.json');
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ duration, timeline, cues, sounds }, null, 1));
    ctx.wrote(out);
    return { file: out, clips: timeline.length, cues: cues.length, sounds: sounds.length };
  },

  async perf(h, ctx) {
    const { req } = ctx;
    return h.page.evaluate(async ({ from, to, samples, shutter }) => {
      const P = (window as any).__reel, dt = 1 / P.fps;
      const ms: number[] = [];
      const buf = new Uint8Array(P.width * P.height * 4);
      await P.still(from);
      const used: Record<number, number> = {};
      for (let t = from; t < to; t += dt) {
        const a = performance.now();
        const k = await P.engine.renderFrame(t, dt, false, samples, shutter);
        used[k] = (used[k] ?? 0) + 1;
        await P.engine.readPixelsAsync(buf);
        ms.push(performance.now() - a);
      }
      ms.sort((a, b) => a - b);
      return { frames: ms.length, avg: ms.reduce((a, b) => a + b, 0) / ms.length, p50: ms[ms.length >> 1]!, p95: ms[Math.floor(ms.length * 0.95)]!, max: ms[ms.length - 1]!, subFrames: used };
    }, { from: req.args.from ?? 0, to: req.args.to ?? 5, samples: req.samples, shutter: req.shutter });
  },

  async gpu(h) {
    const gpu = await h.page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2')!;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    return { gpu };
  },
};

/** Frames in a labelled grid, written to `out`; with `preview`, also a copy at most that size (base64). */
async function grid(h: PageHandle, ctx: Ctx, times: number[], cols: number, cell: number, out: string, a: { maxSize?: number; preview?: number }) {
  const g: { png: string; width: number; height: number; cells: unknown[] } = await h.page.evaluate((o) => (window as any).__reel.grid(o), {
    times, cols, cell, samples: ctx.req.samples, shutter: ctx.req.shutter, maxSize: a.maxSize,
  });
  writeB64(ctx, out, g.png);
  const res: Record<string, unknown> = { file: out, times, size: [g.width, g.height], cells: g.cells };
  if (a.preview) res.previews = [Math.max(g.width, g.height) <= a.preview ? g.png : await h.page.evaluate((m) => (window as any).__reel.lastGridPng(m), a.preview)];
  return res;
}

/**
 * Run a request on the renderer. A page that crashed or closed under it is replaced and the request run once
 * more; anything else that throws becomes an error of the result.
 */
export async function run(r: Renderer, req: Req, wrote: (file: string) => void = () => {}): Promise<Result> {
  const res: Result = { ok: true, errors: [], logs: [], warnings: [] };
  const ctx: Ctx = { r, req, warn: (s) => res.warnings.push(s), error: (s) => res.errors.push(s), wrote };
  if (!OPS[req.op]) throw new Error(`unknown op '${req.op}'`);
  for (let attempt = 0; ; attempt++) {
    let h: PageHandle | undefined;
    try {
      h = await r.page(req.page);
      Object.assign(res, await OPS[req.op](h, ctx));
      res.errors.push(...await h.errors());
      res.logs.push(...h.logs);
      break;
    } catch (e) {
      if (attempt === 0 && (h?.dead || isGone(e) || (h && await h.lost()))) {
        if (h) await r.drop(h);
        res.warnings.push(`the page went away (${String((e as Error)?.message ?? e).split('\n')[0]}): ran the request again on a new one`);
        continue;
      }
      if (h && !h.dead) res.errors.push(...await h.errors());
      if (h) res.logs.push(...h.logs);
      if (h?.dead) await r.drop(h);
      if (e instanceof UsageError) res.usage = true;
      res.errors.push(String((e as Error)?.message ?? e));
      break;
    }
  }
  res.errors = [...new Set(r.explain(res.errors))];
  res.logs = r.explain(res.logs);
  res.ok = res.errors.length === 0;
  return res;
}
