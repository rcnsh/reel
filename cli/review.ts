// `reel review`: a page for the person who reviews a render. A small Bun server on 127.0.0.1 (no Vite, no
// Chrome) serves one HTML file (cli/review.html), the chosen video with byte ranges, and a JSON API over the
// project's review notes (cli/notes.ts). The project's timeline comes from a cache in out/review-timeline.json,
// refreshed through the warm renderer when the config or its data changed, so the page never needs a renderer.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { addNote, clipsAt, deleteNote, frameOf, NotesError, patchNote, readNotes, type Note, type NotePatch, type TimelineClip } from './notes';
import { ENGINE } from './server';
import type { Req, Result } from './ops';
import { ownerOf } from './scratch';

const VIDEO = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };

/** The project's most recent video export under out/ (any depth; not the picture-only intermediates of --mix), or null. */
export function latestRender(project: string): string | null {
  const out = path.join(project, 'out');
  if (!existsSync(out)) return null;
  let best: { file: string; mtime: number } | null = null;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      // (scratch: a partial, or the picture a --mix made before partials)
      else if (VIDEO.has(path.extname(e.name).toLowerCase()) && !ownerOf(e.name) && !/\.picture\.\w+$/.test(e.name)) {
        const m = statSync(f).mtimeMs;
        if (!best || m > best.mtime) best = { file: f, mtime: m };
      }
    }
  };
  walk(out);
  return (best as { file: string } | null)?.file ?? null;
}

export interface Probe { w: number; h: number; fps: number; duration: number; comment: string; codec: string }

/** The video's size, frame rate, duration, codec and comment tag (drafts say so there), from ffprobe. */
export function probe(file: string): Probe {
  const p = Bun.spawnSync(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,codec_name:format=duration:format_tags=comment', '-of', 'json', file], { stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`ffprobe ${file}: ${p.stderr.toString().trim() || `exit ${p.exitCode}`}`);
  const j = JSON.parse(p.stdout.toString());
  const s = j.streams?.[0];
  if (!s) throw new Error(`${file} has no video stream`);
  const rate = (r: string | undefined) => { const [a, b] = (r ?? '0/1').split('/').map(Number); return b ? a! / b : 0; };
  return { w: s.width, h: s.height, fps: rate(s.avg_frame_rate) || rate(s.r_frame_rate) || 30, duration: Number(j.format?.duration) || 0, comment: j.format?.tags?.comment ?? '', codec: s.codec_name ?? '' };
}

/** Whether a render is a draft: its name (`.draft.` before the extension) or its comment tag says so. */
export const isDraft = (file: string, comment: string) => /\.draft\.[^./]+$/.test(file) || /^reel draft/.test(comment);

// ---- the timeline cache ----

export interface TimelineInfo { size: [number, number]; fps: number; duration: number; timeline: TimelineClip[] }
const cacheFile = (project: string) => path.join(project, 'out', 'review-timeline.json');

/** What the timeline is computed from: the config and the data its timeline() reads. */
function timelineKey(project: string) {
  return ['reel.config.ts', 'data/audio.json', 'data/words.json'].map((f) => {
    const p = path.join(project, f);
    return existsSync(p) ? `${f}:${statSync(p).mtimeMs}:${statSync(p).size}` : `${f}:-`;
  }).join('|');
}

export function writeTimelineCache(project: string, info: TimelineInfo) {
  mkdirSync(path.join(project, 'out'), { recursive: true });
  writeFileSync(cacheFile(project), JSON.stringify({ key: timelineKey(project), ...info }, null, 1));
}

function readCache(project: string): { fresh: boolean; info: TimelineInfo } | null {
  try {
    const c = JSON.parse(readFileSync(cacheFile(project), 'utf8'));
    return { fresh: c.key === timelineKey(project), info: { size: c.size, fps: c.fps, duration: c.duration, timeline: c.timeline } };
  } catch { return null; }
}

/** `reel info` for the project: through its warm renderer, or (REEL_NO_DAEMON) a renderer of this process's own. */
async function projectInfo(project: string): Promise<Result> {
  const req: Req = { op: 'info', project, page: { scale: 1 }, samples: 1, shutter: 0.5, args: {} };
  if (!process.env.REEL_NO_DAEMON) return (await import('./daemon')).call(req);
  const { Renderer } = await import('./renderer');
  const { run } = await import('./ops');
  const r = new Renderer(project, {});
  try { return await run(r, req); } finally { await r.close(); }
}

/**
 * The project's timeline: the cache when the config and data have not changed since it was written, else `reel info`
 * (the warm renderer) and a fresh cache. When that fails, the stale cache with a warning, or null.
 */
export async function timelineOf(project: string, warn: (s: string) => void): Promise<TimelineInfo | null> {
  const c = readCache(project);
  if (c?.fresh) return c.info;
  try {
    const r = await projectInfo(project);
    if (!r.ok) throw new Error(r.errors.join('; '));
    const info: TimelineInfo = { size: r.size as [number, number], fps: r.fps as number, duration: r.duration as number, timeline: (r.timeline as TimelineClip[]).map(({ id, start, end, track }) => ({ id, start, end, track })) };
    writeTimelineCache(project, info);
    return info;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).split('\n')[0];
    warn(c ? `the timeline could not be read (${msg}): using the one cached in ${cacheFile(project)}, from before the config or its data last changed` : `the timeline could not be read (${msg}): notes get no clip ids`);
    return c?.info ?? null;
  }
}

/** How a render is named in a note: its path in the project (absolute outside it), modification time and whether it is a draft. */
export function renderRef(project: string, file: string, draft: boolean): Note['render'] {
  const rel = path.relative(project, file);
  return { file: rel.startsWith('..') || path.isAbsolute(rel) ? file : rel, mtime: new Date(statSync(file).mtimeMs).toISOString(), ...(draft ? { draft: true } : {}) };
}

// ---- the server ----

export interface ReviewOpts { project: string; file: string; port?: number; timeline: TimelineInfo | null }

/** Serve the review page for one render. Returns the URL and a stop function. */
export function serveReview(o: ReviewOpts) {
  const { project, file } = o;
  const pr = probe(file);
  const draft = isDraft(file, pr.comment);
  const ext = path.extname(file).toLowerCase();
  const html = readFileSync(path.join(ENGINE, 'cli/review.html'), 'utf8');
  // logical px: the project's frame when the render has its shape (a draft is half of it), else the render's own pixels
  const size = o.timeline?.size;
  const logical: [number, number] = size && Math.abs(size[0] / size[1] - pr.w / pr.h) < 0.01 ? size : [pr.w, pr.h];
  const state = () => ({
    project: path.basename(project), dir: project,
    video: { name: path.relative(project, file).startsWith('..') ? file : path.relative(project, file), mtime: new Date(statSync(file).mtimeMs).toISOString(), draft, comment: pr.comment, w: pr.w, h: pr.h, fps: pr.fps, duration: pr.duration, codec: pr.codec, playable: ext !== '.mov' || !/prores/i.test(pr.codec) },
    logical, timeline: o.timeline?.timeline ?? [],
  });
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  const notes = () => json({ notes: readNotes(project) });
  const fail = (e: unknown) => json({ error: String((e as Error)?.message ?? e) }, e instanceof NotesError || e instanceof SyntaxError ? (/^no note /.test((e as Error).message) ? 404 : 400) : 500);

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: o.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url);
      // (a page on another site may not drive this one through DNS rebinding: only this host's names)
      const host = (req.headers.get('host') ?? '').replace(/:\d+$/, '');
      if (host !== '127.0.0.1' && host !== 'localhost') return new Response('forbidden', { status: 403 });
      const p = url.pathname, m = req.method;
      try {
        if (p === '/' && m === 'GET') return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
        if (p === '/favicon.ico') return new Response(null, { status: 204 });
        if (p === '/video' && (m === 'GET' || m === 'HEAD')) return videoResponse(req, file, TYPES[ext] ?? 'application/octet-stream');
        if (p === '/api/state' && m === 'GET') {
          let list: Note[] = [], error: string | undefined;
          try { list = readNotes(project); } catch (e) { error = (e as Error).message; }
          return json({ ...state(), notes: list, error });
        }
        if (p === '/api/notes' && m === 'GET') return notes();
        if (p === '/api/notes' && m === 'POST') {
          const b = await req.json() as { t?: number; text?: string; rect?: NotePatch['rect']; status?: 'open' | 'done' };
          if (typeof b.t !== 'number' || !Number.isFinite(b.t) || b.t < 0) throw new NotesError('t: expected seconds');
          if (typeof b.text !== 'string') throw new NotesError('text: expected a string');
          const { frame, start } = frameOf(b.t, pr.fps);
          const note = addNote(project, { t: start, frame, clips: o.timeline ? clipsAt(o.timeline.timeline, start) : [], text: b.text, rect: b.rect ?? null, status: b.status, render: renderRef(project, file, draft) });
          return json({ note, notes: readNotes(project) });
        }
        const one = /^\/api\/notes\/([\w-]+)$/.exec(p);
        if (one && m === 'PATCH') {
          const b = await req.json() as NotePatch & { t?: number };
          if (b.t !== undefined && (typeof b.t !== 'number' || !Number.isFinite(b.t) || b.t < 0)) throw new NotesError('t: expected seconds');
          const at = b.t === undefined ? undefined : frameOf(b.t, pr.fps);
          const note = patchNote(project, one[1]!, { text: b.text, rect: b.rect, status: b.status, moved: at && { t: at.start, frame: at.frame, clips: o.timeline ? clipsAt(o.timeline.timeline, at.start) : [] } });
          return json({ note, notes: readNotes(project) });
        }
        if (one && m === 'DELETE') { deleteNote(project, one[1]!); return notes(); }
        return new Response('not found', { status: 404 });
      } catch (e) { return fail(e); }
    },
  });
  return { url: `http://127.0.0.1:${server.port}/`, port: server.port, draft, probe: pr, stop: () => server.stop(true) };
}

/** The video file, whole or the byte range asked for (a <video> seeks with ranges). */
function videoResponse(req: Request, file: string, type: string): Response {
  const size = statSync(file).size;
  const base = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (!m || (!m[1] && !m[2])) return new Response(req.method === 'HEAD' ? null : Bun.file(file), { headers: { ...base, 'content-length': String(size) } });
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])), end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } });
  return new Response(req.method === 'HEAD' ? null : Bun.file(file).slice(start, end + 1), { status: 206, headers: { ...base, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) } });
}
