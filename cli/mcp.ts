// `reel mcp`: a stdio MCP server for agents, over the same warm renderer as the CLI. Rendering and inspection
// only: agents author a video by editing its files (reel.config.ts, scenes/*.ts) and use these tools to look.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { pageOf, samplesOf, UsageError, type Values } from './args';
import { call } from './daemon';
import { runDiff } from './diff';
import { type Op, type Req, type Result } from './ops';
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
  samples: z.union([z.number().int().min(1), z.literal('auto')]).optional().describe("Motion-blur sub-frames per frame: 1 (default, fast) or 'auto' (adaptive, what a final export uses)."),
  shutter: z.number().positive().max(1).optional().describe('Share of the frame time the sub-frames span (default 0.5).'),
};
const imageOpts = {
  full_size: z.boolean().optional().describe(`Return images at full resolution instead of at most ${PREVIEW} px on the long side. The files on disk are always full size.`),
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
const fileImage = (file: string, full?: boolean) => image((full ? readFileSync(file) : encodePng(downscale(readPng(file), PREVIEW))).toString('base64'));

/** A result's JSON for the model: without the inline image data (that goes in image blocks). */
function summary(r: Result, drop: string[] = ['previews']) {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (!drop.includes(k) && !(Array.isArray(v) && !v.length && (k === 'logs' || k === 'warnings'))) o[k] = v;
  return o;
}

/** Run a tool body; a thrown error becomes an error result the model can read. */
async function guard(f: () => Promise<ToolResult>): Promise<ToolResult> {
  try { return await f(); } catch (e) { return { content: [text(String((e as Error)?.message ?? e))], isError: true }; }
}

// ---- video jobs: `reel video` in a child process, polled and cancellable ----
interface Job { id: string; project: string; out: string; state: 'running' | 'done' | 'failed' | 'cancelled'; progress: { frames: number; total: number; fps: number; eta: number } | null; started: number; result?: unknown; output: string; proc: ReturnType<typeof Bun.spawn> }
const jobs = new Map<string, Job>();

function startVideo(a: Record<string, any>): Job {
  const proj = projectDir(a.project);
  const out = a.out ? path.resolve(a.out) : path.join(proj, 'out/video.mp4');
  const args = ['video', '--project', proj, '--json', '--progress', '--out', out];
  const flag = (k: string, v: unknown) => { if (v !== undefined && v !== false) args.push(`--${k}`, ...(v === true ? [] : [Array.isArray(v) ? v.join(',') : String(v)])); };
  flag('from', a.from); flag('to', a.to); flag('only', a.only); flag('size', a.size); flag('fps', a.fps); flag('scale', a.scale); flag('theme', a.theme);
  flag('samples', a.samples); flag('shutter', a.shutter); flag('preset', a.preset); flag('crf', a.crf); flag('noaudio', a.noaudio);
  const proc = Bun.spawn(['bun', path.join(ENGINE, 'cli/reel.ts'), ...args], { stdout: 'pipe', stderr: 'pipe', env: process.env });
  const job: Job = { id: `video-${jobs.size + 1}-${Date.now().toString(36)}`, project: proj, out, state: 'running', progress: null, started: Date.now(), output: '', proc };
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
        try { const p = JSON.parse(line); if (typeof p.frames === 'number') { job.progress = p; continue; } } catch {}
        job.output = (job.output + line + '\n').slice(-4000);
      }
    }
  })();
  void (async () => {
    const stdout = await new Response(proc.stdout as ReadableStream).text();
    const code = await proc.exited;
    try { job.result = JSON.parse(stdout); } catch { job.result = stdout.slice(-4000); }
    if (job.state === 'running') job.state = code === 0 ? 'done' : 'failed';
  })();
  return job;
}
const jobView = (j: Job) => ({ job: j.id, state: j.state, out: j.out, progress: j.progress, seconds: +((Date.now() - j.started) / 1000).toFixed(1), ...(j.state !== 'running' ? { result: j.result } : {}), ...(j.output && j.state !== 'running' ? { output: j.output } : {}) });

/** A project tool (narrate, align, analyze, mix) run to completion: its output and exit code. */
async function tool(name: string, proj: string, args: string[]): Promise<ToolResult> {
  const p = Bun.spawn(['bun', path.join(ENGINE, 'cli/reel.ts'), name, '--project', projectDir(proj), ...args], { stdout: 'pipe', stderr: 'pipe', env: process.env });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { content: [text(`exit ${code}\n${(out + (err ? `\n${err}` : '')).trim().slice(-6000)}`)], isError: code !== 0 };
}

export async function serveMcp() {
  const server = new McpServer({ name: 'reel', version: '1.0.0' }, {
    instructions: 'reel renders deterministic WebGL videos from a project folder (reel.config.ts and scenes/*.ts). Author by editing those files; use these tools to look: project_info first, then render_still / motion_strip / contact_sheet to see frames, check_video to find layout and render problems, video_start to export. Every tool takes the project folder. Renders go through a warm background renderer per project, so repeated calls are fast, and it picks up file edits on the next call.',
  });

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
    const r = await call(reqOf('still', a, { times: a.times, preview: a.full_size ? undefined : PREVIEW }));
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
    const r = await call(reqOf('sheet', a, { from: a.from, to: a.to, n: a.n, times: a.times, cuts: a.cuts, cols: a.cols ?? 4, preview: a.full_size ? undefined : PREVIEW }));
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
    const r = await call(reqOf('strip', a, { from: a.from, to: a.to, n: a.n ?? 8, frames: a.frames, preview: a.full_size ? undefined : PREVIEW }));
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
    return { content: [text(summary(r)), ...(r.file ? [fileImage(r.file as string, a.full_size)] : [])], isError: !r.ok };
  }));

  server.registerTool('video_start', {
    title: 'Start a video render',
    description: 'Start exporting the video (or a range) to an MP4 in the background (x264, with the project\'s audio track) and return a job id at once. Poll video_status until state is done or failed; video_cancel stops it. Use samples \'auto\' for the final motion blur, preset \'veryfast\' for a quick draft. Default output: out/video.mp4 in the project.',
    inputSchema: {
      ...page, from: z.number().min(0).optional(), to: z.number().optional(), out: z.string().optional().describe('Output .mp4 path.'),
      preset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']).optional().describe('x264 preset (default slow).'),
      crf: z.number().min(0).max(51).optional().describe('x264 quality (default 16; lower is better).'), noaudio: z.boolean().optional().describe('Leave the audio track out.'),
    },
  }, (a) => guard(async () => {
    reqOf('still', a, {}); // (the flags checked here, before a process is started)
    return { content: [text(jobView(startVideo(a)))] };
  }));

  server.registerTool('video_status', {
    title: 'Video render status',
    description: 'The state of a video job (running, done, failed, cancelled), its progress (frames written of total, fps, seconds left) and, once finished, the result (file, frames, errors).',
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
    if (j.state === 'running') { j.state = 'cancelled'; j.proc.kill('SIGTERM'); await j.proc.exited; }
    return { content: [text(jobView(j))] };
  }));

  server.registerTool('narrate', {
    title: 'Scratch narration',
    description: "Time the project's narration.txt (plates: '# name' headers and their lines) with a scratch voice (macOS say): writes audio/narration.mp3, data/words.json and data/audio.json (one section per plate). Takes seconds per line.",
    inputSchema: { project },
  }, (a) => guard(() => tool('narrate', a.project, [])));

  server.registerTool('align_recording', {
    title: 'Align a recording',
    description: "Time narration.txt to a real voice recording (one take, or a folder of per-plate files named after the plates) with Whisper word times: replaces audio/narration.mp3, data/words.json and data/audio.json. The first run downloads a model (minutes).",
    inputSchema: { project, recording: z.string().describe('The recording file or folder.') },
  }, (a) => guard(() => tool('align', a.project, [path.resolve(a.recording)])));

  server.registerTool('analyze_song', {
    title: 'Analyze a song',
    description: "Beats, downbeats, loudness envelopes, drum and vocal onsets and sections of a song into data/audio.json (the song becomes the track). Extra flags as in `reel analyze --help`, e.g. ['--sections', 'sections.json'] or ['--keep-sections', '--offset', '12']. The first run fetches Python packages (minutes).",
    inputSchema: { project, song: z.string().describe('The audio file.'), args: z.array(z.string()).optional().describe('Extra flags for reel analyze.') },
  }, (a) => guard(() => tool('analyze', a.project, [path.resolve(a.song), ...(a.args ?? [])])));

  server.registerTool('mix_audio', {
    title: 'Mix music and cues',
    description: "Lay the project's music beds and cue sounds (mix.json, data/cues.json from the events of a render) under a rendered video's narration into a new MP4. `from` must match the render's start when it was a partial render. Run after video_start finished; data/cues.json comes from `reel events` (the CLI) or an earlier mix.",
    inputSchema: { project, input: z.string().describe('The rendered .mp4.'), output: z.string().describe('The mixed .mp4 to write.'), from: z.number().min(0).optional() },
  }, (a) => guard(async () => {
    // (the cues the mix needs, from the project as it is now)
    const ev = await call(reqOf('events', a, {}));
    if (!ev.ok) return { content: [text(summary(ev))], isError: true };
    return tool('mix', a.project, [path.resolve(a.input), path.resolve(a.output), ...(a.from !== undefined ? ['--from', String(a.from)] : [])]);
  }));

  // (a job left running when the client goes away would hold Chromes and ffmpeg)
  const cleanup = () => { for (const j of jobs.values()) if (j.state === 'running') j.proc.kill('SIGTERM'); };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { cleanup(); process.exit(0); });
  const transport = new StdioServerTransport();
  transport.onclose = () => { cleanup(); process.exit(0); };
  await server.connect(transport);
}
