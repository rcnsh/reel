// `reel mcp`: a stdio MCP server for agents, over the same warm renderer as the CLI. Rendering and inspection
// only: agents author a video by editing its files (reel.config.ts, scenes/*.ts) and use these tools to look.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { pageOf, samplesOf, UsageError, type Values } from './args';
import { run, spawnChild } from './children';
import { call } from './daemon';
import { runDiff } from './diff';
import { type Op, type Req, type Result } from './ops';
import { listed, notesPath, patchNote, readNotes } from './notes';
import { downscale, encodePng, readPng } from './png';
import { ENGINE, projectDir } from './server';

/** Inline images: at most this long side unless full size is asked for, and at most this many per call. */
const PREVIEW = 1280, MAX_IMAGES = 12;

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
interface ToolResult { content: Content[]; isError?: boolean; [k: string]: unknown }

const project = z.string().describe('The video project: the folder holding reel.config.ts (absolute, or relative to where the server was started).');
const page = {
  project,
  only: z.array(z.string()).optional().describe('Load only these clip ids: faster, and isolates them from errors in other scenes. Clips not loaded render as nothing.'),
  size: z.string().regex(/^\d+x\d+$/).optional().describe("Render at another frame size, 'WxH' (e.g. '1080x1920' to see whether a layout survives a vertical frame). Width a multiple of 4, height even."),
  fps: z.number().positive().max(240).optional().describe('Render at another frame rate.'),
  scale: z.number().int().min(1).max(4).optional().describe('Physical px per logical px (2 renders 3840x2160 from a 1920x1080 project). Default 1.'),
  theme: z.enum(['print', 'film', 'neutral']).optional().describe("Render with a built-in theme instead of the project's."),
  samples: z.union([z.number().int().min(1), z.string().regex(/^(auto|[1-9]\d*)$/, "expected a whole number such as 1, or 'auto'")]).optional().describe("Motion-blur sub-frames per frame: a whole number, 1 by default (fast), or 'auto' (adaptive, what a final export of moving pictures uses)."),
  shutter: z.number().positive().max(1).optional().describe('Share of the frame time the sub-frames span (default 0.5).'),
};
const imageOpts = {
  full_size: z.boolean().optional().describe(`Return images at full resolution instead of at most ${PREVIEW} px on the long side. The files on disk are always full size.`),
  max_size: z.number().int().min(128).max(4096).optional().describe(`The long side of the images returned, in px (default ${PREVIEW}): 640 makes a cheap overview of a contact sheet. The files on disk are always full size.`),
};

/** A request from a tool's arguments, checked by the same rules as the CLI's flags. */
function reqOf(op: Op, a: Record<string, any>, args: Record<string, unknown>): Req {
  const v: Values = {
    size: a.size, fps: a.fps === undefined ? undefined : String(a.fps), scale: a.scale === undefined ? undefined : String(a.scale),
    only: a.only?.length ? a.only.join(',') : undefined, theme: a.theme, samples: a.samples === undefined ? undefined : String(a.samples),
  };
  return { op, project: projectDir(a.project), page: pageOf(v), samples: samplesOf(v), shutter: a.shutter ?? 0.5, args };
}

const text = (x: unknown): Content => ({ type: 'text', text: typeof x === 'string' ? x : JSON.stringify(x, null, 1) });
const image = (b64: string): Content => ({ type: 'image', data: b64, mimeType: 'image/png' });
/** A PNG file as an inline image (downscaled unless full size is asked for). */
const fileImage = (file: string, full?: boolean, max = PREVIEW) => image((full ? readFileSync(file) : encodePng(downscale(readPng(file), max))).toString('base64'));

/** A result's JSON for the model: without the inline image data (that goes in image blocks). */
function summary(r: Result, drop: string[] = ['previews']) {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (!drop.includes(k) && !(Array.isArray(v) && !v.length && (k === 'logs' || k === 'warnings'))) o[k] = v;
  return o;
}

/** Run a tool body; a thrown error becomes an error result the model can read. */
async function guard(f: () => Promise<ToolResult>): Promise<ToolResult> {
  pending++;
  try { return await f(); } catch (e) { return { content: [text(String((e as Error)?.message ?? e))], isError: true }; } finally { pending--; }
}
/** Tool calls being answered now: the server does not exit under them when its input ends. */
let pending = 0;

// ---- video jobs: `reel video` in a child process, polled and cancellable ----
interface Job { id: string; project: string; out: string; state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; queue?: { running: string | null; ahead: number }; progress: { frames: number; total: number; fps: number; eta: number } | null; started: number; result?: unknown; output: string; proc: ReturnType<typeof spawnChild> }
const jobs = new Map<string, Job>();

/**
 * The `reel video` command line for video_start's arguments. Without `out` the CLI picks the default for the format
 * (out/video.mp4, out/video.hevc.mp4, out/video.draft.mp4, out/png/frame_NNNNNN.png, ...).
 */
export function videoArgs(a: Record<string, any>, proj: string): string[] {
  const args = ['video', '--project', proj, '--json', '--progress'];
  if (a.out) args.push('--out', path.resolve(a.out));
  const flag = (k: string, v: unknown) => { if (v !== undefined && v !== false) args.push(`--${k}`, ...(v === true ? [] : [Array.isArray(v) ? v.join(',') : String(v)])); };
  flag('from', a.from); flag('to', a.to); flag('only', a.only); flag('size', a.size); flag('fps', a.fps); flag('scale', a.scale); flag('theme', a.theme);
  flag('samples', a.samples); flag('shutter', a.shutter); flag('preset', a.preset); flag('crf', a.crf); flag('noaudio', a.noaudio); if (a.noaudio === false) args.push('--audio'); flag('mix', a.mix); flag('subtitles', a.subtitles);
  flag('format', a.format); flag('chroma', a.chroma); flag('depth', a.depth); flag('alpha', a.alpha); flag('opaque', a.opaque); flag('quality', a.quality); flag('max-fps', a.max_fps); flag('max-size', a.max_size); flag('draft', a.draft); flag('wait', a.wait);
  return args;
}

function startVideo(a: Record<string, any>): Job {
  const proj = projectDir(a.project);
  const out = a.out ? path.resolve(a.out) : '(the format\'s default under out/; the result names the file)';
  const args = videoArgs(a, proj);
  const proc = spawnChild(['bun', path.join(ENGINE, 'cli/reel.ts'), ...args], { stdout: 'pipe', stderr: 'pipe', env: process.env });
  const job: Job = { id: `video-${jobs.size + 1}-${Date.now().toString(36)}`, project: proj, out, state: a.wait ? 'queued' : 'running', progress: null, started: Date.now(), output: '', proc };
  jobs.set(job.id, job);
  void (async () => {
    // progress: one JSON line per update on stderr; anything else there is kept as output
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const p = JSON.parse(line);
          if (typeof p.frames === 'number') { job.progress = p; if (job.state === 'queued') { job.state = 'running'; job.queue = undefined; } continue; }
          if (p.queued === true) { job.queue = { running: p.running, ahead: p.ahead }; continue; }
          if (p.queued === false) { if (job.state === 'queued') job.state = 'running'; job.queue = undefined; continue; }
        } catch {}
        job.output = (job.output + line + '\n').slice(-4000);
      }
    }
  })();
  void (async () => {
    const stdout = await new Response(proc.stdout as ReadableStream).text();
    const code = await proc.exited;
    try { job.result = JSON.parse(stdout); } catch { job.result = stdout.slice(-4000); }
    if (job.state === 'running' || job.state === 'queued') job.state = code === 0 ? 'done' : 'failed';
  })();
  return job;
}
const jobView = (j: Job) => ({ job: j.id, state: j.state, out: j.out, ...(j.state === 'queued' && j.queue ? { queue: j.queue } : {}), progress: j.progress, seconds: +((Date.now() - j.started) / 1000).toFixed(1), ...(j.state !== 'running' && j.state !== 'queued' ? { result: j.result } : {}), ...(j.output && j.state !== 'running' && j.state !== 'queued' ? { output: j.output } : {}) });

/** A project tool (narrate, align, analyze, mix) run to completion: its output and exit code. */
async function tool(name: string, proj: string, args: string[]): Promise<ToolResult> {
  const r = await run(['bun', path.join(ENGINE, 'cli/reel.ts'), name, '--project', projectDir(proj), ...args], { quiet: true, nothrow: true });
  const out = r.text(), err = r.stderr, code = r.exitCode;
  return { content: [text(`exit ${code}\n${(out + (err ? `\n${err}` : '')).trim().slice(-6000)}`)], isError: code !== 0 };
}

export async function serveMcp() {
  const server = new McpServer({ name: 'reel', version: '1.0.0' }, {
    instructions: 'reel renders deterministic WebGL videos from a project folder (reel.config.ts and scenes/*.ts). Author by editing those files; use these tools to look: project_info first, then render_still / motion_strip / contact_sheet to see frames, check_video to find layout and render problems, video_start to export, review_notes for what a person asked to change in a render (resolve_note once fixed). Every tool takes the project folder. Renders go through a warm background renderer per project, so repeated calls are fast, and it picks up file edits on the next call.',
  });

  // (arguments are strict, like the CLI's flags: a misspelt `size` is an error, not a check of the wrong frame)
  const register = server.registerTool.bind(server);
  server.registerTool = ((name: string, cfg: { inputSchema: z.ZodRawShape }, cb: never) => register(name, { ...cfg, inputSchema: z.strictObject(cfg.inputSchema) }, cb)) as typeof server.registerTool;

  server.registerTool('project_info', {
    title: 'Project info',
    description: "A project's format (size, fps), duration, audio track, theme, tracks, every clip (id, start, end, track) and the sound cues scenes recorded. Call it first: clip ids and times for the other tools come from here.",
    inputSchema: { project },
    annotations: { readOnlyHint: true },
  }, (a) => guard(async () => {
    const r = await call(reqOf('info', a, {}));
    return { content: [text(summary(r))], isError: !r.ok };
  }));

  server.registerTool('render_still', {
    title: 'Render stills',
    description: 'Render frames at the given times and return them as images: the exact pixels the video export produces. Files are saved under the project\'s out/stills, named after the clips on screen and the time (never overwritten); their paths are in the text. Use `only` to render one clip in isolation, `size` to try another aspect ratio.',
    inputSchema: { ...page, times: z.array(z.number().min(0)).min(1).max(24).describe('Seconds into the video, e.g. [1.5, 3]. Look at a clip\'s first and last frame as well as its middle.'), ...imageOpts, max_images: z.number().int().min(0).max(MAX_IMAGES).optional().describe('How many of the stills to return inline (default 6; the rest are only saved).') },
    annotations: { readOnlyHint: false },
  }, (a) => guard(async () => {
    const max = a.max_images ?? 6;
    const r = await call(reqOf('still', a, { times: a.times, preview: a.full_size ? undefined : (a.max_size ?? PREVIEW) }));
    const imgs = a.full_size ? (r.files as string[] ?? []).slice(0, max).map((f) => fileImage(f, true)) : ((r.previews as string[]) ?? []).slice(0, max).map(image);
    return { content: [text(summary(r)), ...imgs], isError: !r.ok };
  }));

  server.registerTool('contact_sheet', {
    title: 'Contact sheet',
    description: 'One image of many frames in a grid, each labelled with its time and the clips on screen: an overview of a stretch of the video or the whole of it. Give from/to with n (evenly spaced), or times, or cuts=true for 4 frames around every cut (checks transitions).',
    inputSchema: {
      ...page, from: z.number().min(0).optional().describe('Start (s), default 0.'), to: z.number().optional().describe('End (s), default the last frame.'), n: z.number().int().min(1).max(64).optional().describe('Frames between from and to (default 12).'),
      times: z.array(z.number().min(0)).max(64).optional().describe('Exact times instead of from/to/n.'), cuts: z.boolean().optional().describe('Frames around every cut instead.'), cols: z.number().int().min(1).max(12).optional().describe('Columns (default 4).'), ...imageOpts,
    },
  }, (a) => guard(async () => {
    const r = await call(reqOf('sheet', a, { from: a.from, to: a.to, n: a.n, times: a.times, cuts: a.cuts, cols: a.cols ?? 4, preview: a.full_size ? undefined : (a.max_size ?? PREVIEW) }));
    const img = a.full_size && r.file ? [fileImage(r.file as string, true)] : ((r.previews as string[]) ?? []).map(image);
    return { content: [text(summary(r)), ...img], isError: !r.ok };
  }));

  server.registerTool('motion_strip', {
    title: 'Motion strip',
    description: 'Frames of a short time range side by side in one row, labelled with their times: judge an animation\'s motion, spacing and easing without a video. Either n frames evenly spaced from `from` to `to` (both included), or `frames` consecutive frames starting at `from`.',
    inputSchema: {
      ...page, from: z.number().min(0).describe('Start (s).'), to: z.number().optional().describe('End (s), with n.'), n: z.number().int().min(2).max(32).optional().describe('Evenly spaced frames (default 8).'),
      frames: z.number().int().min(2).max(32).optional().describe('Consecutive frames from `from` instead (1/fps apart).'), ...imageOpts,
    },
  }, (a) => guard(async () => {
    const r = await call(reqOf('strip', a, { from: a.from, to: a.to, n: a.n ?? 8, frames: a.frames, preview: a.full_size ? undefined : (a.max_size ?? PREVIEW) }));
    const img = a.full_size && r.file ? [fileImage(r.file as string, true)] : ((r.previews as string[]) ?? []).map(image);
    return { content: [text(summary(r)), ...img], isError: !r.ok };
  }));

  server.registerTool('check_video', {
    title: 'Check the video',
    description: 'Sweep the video (or a range) for problems and return findings as JSON, each with kind, severity (error, warning, info), time span, clip, rectangle, a message saying how to fix it and a cropped image file; the worst crops come inline. Finds blank and frozen frames, scene and shader errors, and from the boxes scenes report (reportText/report) text off the frame, in the safe margin, overlapping, too small, or low in contrast against the rendered pixels. isError is true when any finding is an error. Run it after every round of edits, and with size \'1080x1920\' for vertical.',
    inputSchema: {
      ...page, from: z.number().min(0).optional(), to: z.number().optional(), step: z.number().positive().optional().describe('Seconds between sampled frames (default 0.5; clip starts and ends are sampled densely anyway).'),
      safe: z.number().min(0).max(0.45).optional().describe('Safe margin as a share of each side (default 0.05).'), min_text: z.number().positive().optional().describe('Smallest text size in px (default 2.2% of the shorter side).'),
      frozen: z.number().positive().optional().describe('Seconds without change before a frame counts as frozen (default 3).'), max_images: z.number().int().min(0).max(MAX_IMAGES).optional().describe('Crops to return inline, most severe first (default 6).'),
    },
  }, (a) => guard(async () => {
    const r = await call(reqOf('check', a, { from: a.from, to: a.to, step: a.step, safe: a.safe, minText: a.min_text, frozen: a.frozen, preview: true }));
    const imgs = ((r.previews as string[]) ?? []).slice(0, a.max_images ?? 6).map(image);
    return { content: [text(summary(r)), ...imgs], isError: !r.ok };
  }));

  server.registerTool('diff_images', {
    title: 'Compare images',
    description: 'Compare two PNGs (a and b), or a fresh render of time t against b (a still or golden saved earlier; rendered at b\'s size): changed pixel count and share, max and mean difference, the bounding box of the change, and a diff image (b in grey, changes in red). isError when more than `threshold` of the pixels changed. Grain differs per frame, so compare the same time, and use tol (e.g. 8) to ignore it.',
    inputSchema: {
      b: z.string().describe('The reference PNG.'), a: z.string().optional().describe('The other PNG (or give project and t).'), project: project.optional(), t: z.number().min(0).optional().describe('Render this time and compare it to b.'),
      only: page.only, size: page.size, theme: page.theme, samples: page.samples,
      tol: z.number().int().min(0).max(255).optional().describe('Channel difference (0-255) a pixel may have and still count as unchanged (default 0).'),
      threshold: z.number().min(0).max(1).optional().describe('Share of pixels that may change (default 0).'), ...imageOpts,
    },
  }, (a) => guard(async () => {
    if (a.t === undefined && !a.a) throw new UsageError('give a and b, or project, t and b');
    const req = a.t !== undefined ? reqOf('still', { ...a, project: a.project ?? '' }, {}) : undefined;
    const r = await runDiff({ a: a.a, b: a.b, t: a.t, req, tol: a.tol ?? 0, threshold: a.threshold ?? 0, project: a.project ? projectDir(a.project) : undefined, render: call });
    return { content: [text(summary(r)), ...(r.file ? [fileImage(r.file as string, a.full_size, a.max_size)] : [])], isError: !r.ok };
  }));

  server.registerTool('video_start', {
    title: 'Start a video render',
    description: "Start exporting the video (or a range) in the background and return a job id at once. Poll video_status until state is done or failed; video_cancel stops it. The format comes from `format`, else from the `out` extension: h264 (.mp4, default: x264 with the project's sound), hevc (.mp4, 10-bit), prores (.mov, 422 HQ editing master), prores4444 (.mov with alpha), webm (VP9 with alpha), gif and webp (short loops, rate and size capped), png, png16, jpeg (numbered frames) and exr (the linear HDR frame, for grading). Transparent formats clear the theme's background to transparent. Use samples 'auto' for the final motion blur. Default output: out/video.mp4 in the project (out/video.hevc.mp4, out/video.4444.mov and so on for other formats; out/<format>/frame_NNNNNN.<ext> for sequences). One export runs at a time on a machine: a start while another export is running fails with that export's details, unless `wait` is true, which queues it (state 'queued', with the export ahead, until the slot frees; queued exports run in the order they started). The project's config can set export defaults (`export: { crf, preset, noaudio, samples }`); arguments given here override them.",
    inputSchema: {
      ...page, from: z.number().min(0).optional(), to: z.number().optional(), out: z.string().optional().describe('Output path (its extension picks the format when `format` is not given; for sequences, the frames are named after it with the frame number).'),
      format: z.enum(['h264', 'hevc', 'prores', 'prores4444', 'webm', 'gif', 'webp', 'png', 'png16', 'jpeg', 'exr']).optional().describe('Output format (default from the out extension, else h264).'),
      preset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']).optional().describe('x264/x265 preset (default slow for h264, medium for hevc).'),
      crf: z.number().min(0).max(63).optional().describe('Quality for h264 (default 16), hevc (18) and webm (24); lower is better.'),
      chroma: z.enum(['420', '444']).optional().describe('h264 chroma subsampling (default 420).'), depth: z.union([z.literal(8), z.literal(10)]).optional().describe('h264 bits per channel (default 8).'),
      alpha: z.boolean().optional().describe('A transparent background for webp, png, png16 and exr (prores4444 and webm have it unless opaque).'), opaque: z.boolean().optional().describe('prores4444 or webm without alpha.'),
      quality: z.number().int().min(1).max(100).optional().describe('jpeg (default 92) and webp (default 88) quality.'), max_fps: z.number().positive().optional().describe('gif/webp: the highest frame rate (default 25 / 30).'), max_size: z.number().int().min(16).optional().describe('gif/webp: the longest side in px (default 640 / 1080).'),
      noaudio: z.boolean().optional().describe("Leave the audio track out (true), or keep it despite the project config's export.noaudio (false)."),
      wait: z.boolean().optional().describe('Queue behind the export that holds the machine\'s slot instead of failing (use it when several agents export on one machine).'),
      draft: z.boolean().optional().describe('A quick look while iterating, never a deliverable: half size with the same layout (full size when half would not pack), one sample, H.264 encoded in the browser; written as <name>.draft.mp4. Leave out samples and scale.'),
      mix: z.boolean().optional().describe('The finished file: render, then mix the track, music and cues at the loudness target (mp4, mov, webm).'), subtitles: z.boolean().optional().describe('Like mix, with the timed words as a soft subtitle track.'),
    },
  }, (a) => guard(async () => {
    reqOf('still', a, {}); // (the flags checked here, before a process is started)
    return { content: [text(jobView(startVideo(a)))] };
  }));

  server.registerTool('video_status', {
    title: 'Video render status',
    description: 'The state of a video job (queued, running, done, failed, cancelled), its progress (frames written of total, fps, seconds left) and, once finished, the result (file, frames, errors).',
    inputSchema: { job: z.string().describe('The id video_start returned.') },
    annotations: { readOnlyHint: true },
  }, (a) => guard(async () => {
    const j = jobs.get(a.job);
    if (!j) throw new Error(`no job '${a.job}' (jobs: ${[...jobs.keys()].join(', ') || 'none'})`);
    return { content: [text(jobView(j))], isError: j.state === 'failed' };
  }));

  server.registerTool('video_cancel', {
    title: 'Cancel a video render',
    description: 'Stop a running video job; the partial file is removed by the encoder being killed (it is not playable).',
    inputSchema: { job: z.string() },
  }, (a) => guard(async () => {
    const j = jobs.get(a.job);
    if (!j) throw new Error(`no job '${a.job}'`);
    if (j.state === 'running' || j.state === 'queued') { j.state = 'cancelled'; j.proc.kill('SIGTERM'); await j.proc.exited; }
    return { content: [text(jobView(j))] };
  }));

  server.registerTool('narrate', {
    title: 'Voice the narration',
    description: "Voice the project's narration.txt (plates: '# name' headers and their lines) and time every word: writes audio/narration.flac, data/words.json and data/audio.json (one section per plate). Plates are cached, so after an edit only changed plates are voiced again. The voice comes from `narration` in reel.config.ts unless given: 'kokoro[:voice]' (local model, default kokoro:af_heart), 'say[:name]' (macOS scratch), 'elevenlabs:<voice-id>' or 'fish:<voice-id>' (hosted, only with ELEVENLABS_API_KEY / FISH_API_KEY set). The first local run downloads models (minutes).",
    inputSchema: {
      project, voice: z.string().optional().describe("Voice, e.g. 'kokoro:bm_george', 'say:Daniel', 'elevenlabs:<voice-id>'."), speed: z.number().min(0.5).max(2).optional(),
      lead: z.number().min(0).optional().describe('Seconds before the first word (default 0.6).'), hold: z.number().min(0).optional().describe('Seconds at least between plates (default 0.85).'), tail: z.number().min(0).optional().describe('Seconds after the last word (default 1.6).'),
      force: z.boolean().optional().describe('Voice every plate again, ignoring the cache.'),
    },
  }, (a) => guard(() => tool('narrate', a.project, [
    ...(['voice', 'speed', 'lead', 'hold', 'tail'] as const).flatMap((k) => (a[k] !== undefined ? [`--${k}`, String(a[k])] : [])), ...(a.force ? ['--force'] : []),
  ])));

  server.registerTool('align_recording', {
    title: 'Align a recording',
    description: "Time narration.txt to a real voice recording (one take, or a folder of per-plate files named after the plates): the script's words are force-aligned to it (Qwen3-ForcedAligner: MLX on Apple Silicon, PyTorch on CPU elsewhere), or with method 'whisper' transcribed and matched, for a reading that departs from the script. Replaces audio/narration.flac, data/words.json and data/audio.json, then warns (and fails) about lines whose words are not heard where they were placed: a take that skips, repeats or rewords a line. The first run downloads a model (minutes).",
    inputSchema: { project, recording: z.string().describe('The recording file or folder.'), method: z.enum(['qwen', 'whisper']).optional(), lead: z.number().min(0).optional(), hold: z.number().min(0).optional(), tail: z.number().min(0).optional() },
  }, (a) => guard(() => tool('align', a.project, [path.resolve(a.recording), ...(['method', 'lead', 'hold', 'tail'] as const).flatMap((k) => (a[k] !== undefined ? [`--${k}`, String(a[k])] : []))])));

  server.registerTool('analyze_song', {
    title: 'Analyze a song',
    description: "Beats and downbeats (Beat This!), loudness envelopes of the mix and of Demucs stems (drums, bass, other, vocal), drum and vocal onsets and sections of a song into data/audio.json (the song becomes the track). Extra flags as in `reel analyze --help`, e.g. ['--sections', 'sections.json'], ['--keep-sections', '--offset', '12'] or ['--fast'] (no models, a draft). The first run fetches packages and models (minutes).",
    inputSchema: { project, song: z.string().describe('The audio file.'), args: z.array(z.string()).optional().describe('Extra flags for reel analyze.') },
  }, (a) => guard(() => tool('analyze', a.project, [path.resolve(a.song), ...(a.args ?? [])])));

  server.registerTool('mix_audio', {
    title: 'Mix music and cues',
    description: "The finished sound under a rendered video, into a new file of the same container (.mp4 with AAC, .mov with PCM, .webm with Opus): the project's track (narration or song, from its lossless file), the music beds and cue sounds of mix.json and the config's timeline sounds, brought to the loudness target (default -14 LUFS, -1 dBTP), encoded once; the picture is copied. `from` must match the render's start when it was a partial render. (video_start with mix: true renders and mixes in one job.)",
    inputSchema: { project, input: z.string().describe('The rendered .mp4, .mov or .webm.'), output: z.string().describe('The mixed file to write (.mp4, .mov or .webm).'), from: z.number().min(0).optional() },
  }, (a) => guard(async () => {
    // (the cues the mix needs, from the project as it is now)
    const ev = await call(reqOf('events', a, {}));
    if (!ev.ok) return { content: [text(summary(ev))], isError: true };
    return tool('mix', a.project, [path.resolve(a.input), path.resolve(a.output), ...(a.from !== undefined ? ['--from', String(a.from)] : [])]);
  }));

  server.registerTool('subtitles', {
    title: 'Subtitles',
    description: "Write SRT and VTT subtitles from the project's timed words (data/words.json) into out/subtitles: cues of at most two lines of 42 characters and 7 s. from/to match a partial render. (video_start with subtitles: true adds them to the finished file.)",
    inputSchema: { project, from: z.number().min(0).optional(), to: z.number().optional() },
  }, (a) => guard(() => tool('subtitles', a.project, [...(a.from !== undefined ? ['--from', String(a.from)] : []), ...(a.to !== undefined ? ['--to', String(a.to)] : [])])));

  server.registerTool('assets', {
    title: 'Generated assets',
    description: "The images and sounds the project declares in assets.json ({ assets: [{ id, kind: 'image'|'sfx'|'music', prompt, size|duration, out }] }) and their state. Generates the missing ones when the provider's key is set (OPENAI_API_KEY for images, ELEVENLABS_API_KEY for sounds and music; only the prompt and size or duration are sent); otherwise returns each missing asset's prompt, size and path so a person can make it. isError while any is missing. Renders show a labelled placeholder for a missing image.",
    inputSchema: { project, list: z.boolean().optional().describe('Only list, generate nothing.'), force: z.boolean().optional().describe('Generate the generated ones again.') },
  }, (a) => guard(() => tool('assets', a.project, ['--json', ...(a.list ? ['--list'] : []), ...(a.force ? ['--force'] : [])])));

  server.registerTool('review_notes', {
    title: 'Review notes',
    description: "The notes a person left on a render with `reel review` (the project's review/notes.json): each with id, t (seconds), frame, the clips on screen, text, an optional rect on the frame in logical px, status (open or done), the render it was made on, and `still`, the command that renders that moment. Work through the open ones: look at each moment (render_still at t, the rect shows where), fix, re-render, then resolve_note.",
    inputSchema: { project, open_only: z.boolean().optional().describe('Only the open notes (default: all).') },
    annotations: { readOnlyHint: true },
  }, (a) => guard(async () => {
    const proj = projectDir(a.project);
    const all = readNotes(proj), shown = a.open_only ? all.filter((n) => n.status === 'open') : all;
    return { content: [text({ file: notesPath(proj), open: all.filter((n) => n.status === 'open').length, total: all.length, notes: shown.map((n) => listed(proj, n)) })] };
  }));

  server.registerTool('resolve_note', {
    title: 'Resolve a review note',
    description: "Mark a review note done once the render no longer has the problem it describes (or open again with reopen: true). The note stays in review/notes.json for the person to see; the review page shows the change within seconds.",
    inputSchema: { project, id: z.string().describe('The note id, from review_notes.'), reopen: z.boolean().optional().describe('Mark it open again instead.') },
  }, (a) => guard(async () => {
    const proj = projectDir(a.project);
    return { content: [text(listed(proj, patchNote(proj, a.id, { status: a.reopen ? 'open' : 'done' })))] };
  }));

  // (a job left running when the client goes away would hold Chromes and ffmpeg)
  const cleanup = () => { for (const j of jobs.values()) if (j.state === 'running') j.proc.kill('SIGTERM'); };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { cleanup(); process.exit(0); });
  const transport = new StdioServerTransport();
  transport.onclose = () => { cleanup(); process.exit(0); };
  // (the client went away without a goodbye: the transport does not notice its input ending, and the server
  // would outlive it, holding its video jobs)
  // (calls already sent are answered first: a script may pipe its requests in and close)
  let leaving = false;
  const leave = () => {
    if (leaving) return;
    leaving = true;
    const t = setInterval(() => { if (!pending) { clearInterval(t); cleanup(); process.stdout.write('', () => process.exit(0)); } }, 50);
  };
  for (const ev of ['end', 'close'] as const) process.stdin.on(ev, leave);
  await server.connect(transport);
}
