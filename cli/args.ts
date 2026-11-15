// The command line: the help text, the flags each command takes, and checks of their values. Pure (no I/O), so
// the CLI and its tests share it.
import { parseArgs } from 'node:util';
import type { AdaptiveSampling } from '../src/engine/engine';

export const HELP = `reel <command> [flags]

Looking at a project (headless Chrome, through a warm renderer the CLI starts per project and
reuses; each exits 1 on a scene error)
  info                       the project's format, duration, clips, tracks, cues and theme
  still   --t 1.5,23[,..]    PNG stills, the pixels the video export produces. Named after the clips
                             on screen and the time (hello_1.500s.png); never overwrites a file
                             [--out <dir>|<file.png>] [--max-size <px>] [--alpha: transparent, as
                             the alpha formats of video render]
  sheet                      a contact sheet, each frame labelled with its time and clips: --from/--to
                             with --n frames, or --times a,b,c, or --cuts (4 frames around every cut)
                             [--cols 4] [--cell 480] [--out <file.png>] [--max-size <px>]
  strip                      frames side by side in one row, to judge motion and easing: --n evenly
                             spaced from --from to --to (both included), or --frames N consecutive
                             frames from --from     [--cell 360] [--out <file.png>] [--max-size <px>]
  check                      sweep the video for problems and print findings: blank or frozen frames,
                             scene errors, and the text HTML layers and scenes report (report(),
                             reportText()): off the frame, in the safe margin, overlapping, too small,
                             low in contrast, overflowing or clipped; each with a cropped image.
                             Exits 1 on an error finding
                             [--from 0] [--to <duration>] [--step 0.5] [--safe 0.05] [--min-text <px>]
                             [--frozen 3] [--out <dir>]
  diff    <a.png> <b.png>    compare two images: changed pixels, max and mean difference, the box
          --t <s> <b.png>    around the change and a diff image; --t renders that time (at <b.png>'s
                             size) and compares it; exits 1 when more than --threshold of the pixels
                             changed                    [--tol 0] [--threshold 0] [--out <diff.png>]
  events                     write the sound-mix cues (the timeline and every cue() of the scenes)
                             [--out data/cues.json]
  perf    --from 0 --to 5    milliseconds per frame: rendering and the export's pixel readback, apart
                             [--pixels rgb8|yuv420|rgba8|rgb16|rgba16|linear: the readback to time]
  gpu                        the GPU Chrome renders with and the GL backend (software: SwiftShader)

Rendering
  video                      the video, in its own browsers (not the warm renderer), through ffmpeg with
                             the project's audio track where the format carries sound
                             [--from 0] [--to <duration>] [--out <file>] [--format <f>] [--noaudio]
                             [--workers 2] [--chunk 8] [--mem-gb 1] [--spool-gb 20] [--force]
                             [--progress (JSON lines on stderr)]
                             --format (else from the --out extension; default h264, out/video.mp4):
                               h264        .mp4  x264 [--crf 16] [--preset slow] [--x264 aq-mode=3]
                                                 [--chroma 420|444] [--depth 8|10]
                               hevc        .mp4  x265 Main10, 10-bit SDR BT.709 [--crf 18] [--preset
                                                 medium] [--x265 k=v:...]
                               prores      .mov  ProRes 422 HQ, 10-bit, PCM sound: an editing master
                               prores4444  .mov  ProRes 4444 with alpha (--opaque: without)
                               webm        .webm VP9 with alpha, Opus sound [--crf 24] (--opaque)
                               gif         .gif  a palette per video, Sierra dither [--max-fps 25]
                                                 [--max-size 640 (long side, px)]
                               webp        .webp animated [--max-fps 30] [--max-size 1080] [--quality 88]
                                                 [--alpha]
                               png, png16  .png  numbered frames, 8 or 16 bits per channel [--alpha]
                               jpeg        .jpg  numbered frames [--quality 92]
                               exr         .exr  numbered frames of the linear HDR frame before tone
                                                 mapping and post, half float [--alpha: premultiplied]
                             Sequences are named after --out with the video frame number (f.png ->
                             f_000120.png). Transparent renders clear the theme's bg to transparent
                             and write straight alpha. Every YUV stream is limited-range BT.709, tagged.
                             --draft: a quick look, not a deliverable: half size (the same layout; full
                             size when the width is not a multiple of 8 or the height not of 4), one
                             sample, H.264 encoded in the page with WebCodecs (hardware where there is
                             one); written as <name>.draft.mp4 and tagged a draft in its comment
                             (REEL_DRAFT_ENCODER=videotoolbox|x264: the raw pipe instead)
                             --mix: the finished file in one go: the render, then reel mix (the
                             track, music and cues of mix.json, at the loudness target); --subtitles:
                             as --mix, with the timed words as a soft subtitle track (mp4, mov, webm)
                             One export at a time per machine: another running one is an error unless
                             --force (parallel 4K exports exhaust memory)

Review by a person (no browser of reel's own)
  review [<video>]           a page to watch a render (default: the newest video under out/) and pin
                             notes to its frames, with an area on the frame; saved at once to
                             review/notes.json. Serves on 127.0.0.1 until Ctrl-C  [--port <n>]
  notes                      the review notes: each open one with its clips and the reel still
                             command for its moment              [--open: only open ones] [--json]
  notes add --t <s> "<text>" add a note at that time
  notes done <id>            mark a note done (notes reopen <id>: open again)
  notes move <id> --t <s>    pin a note to another moment

Working on a project
  init <folder>             a new project that renders straight away, with the reel skills in
                             .claude/skills; refuses a folder that holds anything
                             [--size 1920x1080] [--fps 60] [--theme neutral|print|film] [--narrated]
  skills update              copy this engine's skills into the project's .claude/skills
  font add "<family>"        download a Google Fonts family (its font files and licence) into the
                             project's fonts/, where HTML layers find it by its family name
  chrome install             download the Chrome for Testing build reel renders with into its cache
                             folder (used whenever CHROME_PATH is unset)
  chrome path                the Chrome binary renders would use, and its version
  daemon status              the warm renderers running, per project
  daemon stop                stop the project's warm renderer          [--all: every project's]
  golden update              re-render the golden frames of this operating system (tests/golden/<platform>/)
  mcp                        a stdio MCP server over the warm renderer, for agents (README: registering
                             it with Claude Code and other clients)
  dev                        the preview player with live reload (prints its URL)  [--port <n>]
  narrate                    voice narration.txt (Kokoro by default; say, elevenlabs, fish) and time
                             every word; caches each plate      (flags: reel narrate --help)
  align <recording|folder>   time narration.txt to a voice recording (forced alignment; --method
                             whisper for a reading that departs from it)  (flags: reel align --help)
  analyze <song> [...]       beats, envelopes and sections of a song (flags: reel analyze --help)
  mix <in.mp4> <out.mp4>     the finished sound under a render: the track, music and cue sounds
                             (mix.json), at -14 LUFS; re-mix without re-rendering   [--from 0]
  subtitles                  SRT and VTT of the timed words, as subtitles.srt and subtitles.vtt
                             in the folder --out (default out/subtitles)        [--from] [--to]
  assets                     the generated assets of assets.json: generates the missing ones with a
                             provider's key, else lists what each needs; exits 1 while any is missing
                             [--list] [--force] [--json]  (reel assets --help)

Flags for every command that renders
  --project <folder>   the project (default: the current folder)
  --only a,b           load only these clips (faster; other clips render as nothing)
  --samples N|auto     sub-frames averaged per frame for motion blur (default 1); auto picks per tile
                       [--min-samples 4] [--max-samples 324] [--tol 3] [--refine tiles|frame]
  --shutter 0.5        the share of the frame time the sub-frames span
  --scale N            render N x the pixels (2 = 3840x2160 from a 1920x1080 project; 0.5 = half size,
                       for a width that is a multiple of 8 and a height of 4, else refused with exit 2)
  --size WxH, --fps N  override the project's frame size and rate
  --theme <name>       render with a built-in theme (print, film, neutral) instead of the project's
  --no-daemon          render in a browser of its own, started and stopped by this command
                       (also REEL_NO_DAEMON=1)
  --headed             show the browser (implies --no-daemon)
  --gl <backend>       how Chrome draws: metal (macOS), egl or vulkan (a Linux GPU), swiftshader
                       (software, no GPU); default: metal on macOS, else egl with a GPU render node,
                       else swiftshader (also REEL_GL). --json reports it as gl
  --json               machine-readable output: one JSON object { ok, errors, logs, ... }

Chrome: $CHROME_PATH, else the pinned Chrome for Testing that \`reel chrome install\` fetches; it must
be Chrome 157 or later. Exit codes: 0 done, 1 failed (a scene error, an error finding of check, a
diff over its threshold), 2 bad command line or no project.`;

const str = { type: 'string' } as const, bool = { type: 'boolean' } as const;
type Opt = typeof str | typeof bool;

/** Flags of every command that renders through a page. */
const RENDER: Record<string, Opt> = {
  project: str, json: bool, help: bool, only: str, samples: str, 'min-samples': str, 'max-samples': str, tol: str, refine: str,
  shutter: str, scale: str, size: str, fps: str, theme: str, headed: bool, 'no-daemon': bool, gl: str,
};
const IMAGE: Record<string, Opt> = { out: str, 'max-size': str };

/** Each command's flags (beyond RENDER for the rendering ones) and whether it takes positionals. */
export const COMMANDS: Record<string, { render: boolean; opts: Record<string, Opt>; positionals?: [min: number, max: number] }> = {
  info: { render: true, opts: {} },
  still: { render: true, opts: { t: str, alpha: bool, ...IMAGE } },
  sheet: { render: true, opts: { from: str, to: str, n: str, times: str, cuts: bool, cols: str, cell: str, ...IMAGE } },
  check: { render: true, opts: { from: str, to: str, step: str, safe: str, 'min-text': str, frozen: str, out: str } },
  diff: { render: true, opts: { t: str, tol: str, threshold: str, out: str }, positionals: [1, 2] },
  strip: { render: true, opts: { from: str, to: str, n: str, frames: str, cell: str, ...IMAGE } },
  events: { render: true, opts: { out: str } },
  perf: { render: true, opts: { from: str, to: str, pixels: str } },
  gpu: { render: true, opts: {} },
  video: { render: true, opts: { from: str, to: str, out: str, format: str, crf: str, preset: str, x264: str, x265: str, chroma: str, depth: str, alpha: bool, opaque: bool, quality: str, 'max-fps': str, 'max-size': str, draft: bool, force: bool, noaudio: bool, mix: bool, subtitles: bool, workers: str, chunk: str, 'mem-gb': str, 'spool-gb': str, progress: bool } },
  dev: { render: false, opts: { project: str, port: str, theme: str, help: bool } },
  skills: { render: false, opts: { project: str, json: bool, help: bool }, positionals: [1, 1] },
  daemon: { render: false, opts: { project: str, all: bool, json: bool, help: bool }, positionals: [1, 1] },
  golden: { render: false, opts: { json: bool, help: bool }, positionals: [1, 1] },
  chrome: { render: false, opts: { json: bool, help: bool }, positionals: [1, 1] },
  font: { render: false, opts: { project: str, json: bool, help: bool }, positionals: [2, 2] },
  mcp: { render: false, opts: { help: bool } },
  review: { render: false, opts: { project: str, port: str, json: bool, help: bool }, positionals: [0, 1] },
  notes: { render: false, opts: { project: str, open: bool, t: str, json: bool, help: bool }, positionals: [0, 2] },
  init: { render: false, opts: { size: str, fps: str, theme: str, narrated: bool, json: bool, help: bool }, positionals: [1, 1] },
};

/** A bad command line: the CLI exits 2. */
export class UsageError extends Error {}

export type Values = Record<string, string | boolean | undefined>;
export interface Parsed { mode: string; values: Values; positionals: string[] }

/** Parse a command line for one of COMMANDS (strict: an unknown flag or a missing value is a UsageError). */
export function parseCommand(argv: string[]): Parsed {
  const mode = argv[0] ?? '';
  const spec = COMMANDS[mode];
  if (!spec) throw new UsageError(`unknown command '${mode}' (reel --help)`);
  let a;
  try {
    a = parseArgs({ args: argv.slice(1), strict: true, allowPositionals: !!spec.positionals, options: spec.render ? { ...RENDER, ...spec.opts } : spec.opts });
  } catch (e) { throw new UsageError(`${(e as Error).message} (reel --help)`); }
  const values = a.values as Values, positionals = a.positionals;
  if (spec.positionals && !values.help) {
    const [lo, hi] = spec.positionals;
    if (positionals.length < lo || positionals.length > hi) throw new UsageError(`${mode}: expected ${lo === hi ? lo : `${lo} to ${hi}`} argument${hi > 1 ? 's' : ''} (reel --help)`);
  }
  return { mode, values, positionals };
}

/** A numeric flag, or `d` when absent. */
export function num(v: Values, k: string, d: number): number;
export function num(v: Values, k: string, d?: undefined): number | undefined;
export function num(v: Values, k: string, d?: number) {
  const raw = v[k];
  if (raw === undefined) return d;
  const x = Number(raw);
  if (typeof raw !== 'string' || raw.trim() === '' || !Number.isFinite(x)) throw new UsageError(`--${k} ${raw}: expected a number`);
  return x;
}

/** A whole number flag at least `min`. */
export function int(v: Values, k: string, d: number, min = 1) {
  const x = num(v, k, d);
  if (!Number.isInteger(x) || x < min) throw new UsageError(`--${k} ${v[k]}: expected a whole number of at least ${min}`);
  return x;
}

/** A list of numbers: `--t 1,2.5,3`. */
export function list(v: Values, k: string): number[] {
  const raw = v[k];
  if (raw === undefined) return [];
  const xs = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  const out = xs.map(Number);
  if (!xs.length || out.some((x) => !Number.isFinite(x))) throw new UsageError(`--${k} ${raw}: expected numbers separated by commas`);
  return out;
}

/** `--size WxH`: a width that is a multiple of 4 and an even height (the packed readback and yuv420). */
export function sizeOf(s: string): [number, number] {
  const m = /^(\d+)x(\d+)$/.exec(s);
  const w = m ? Number(m[1]) : NaN, h = m ? Number(m[2]) : NaN;
  if (!m || w < 16 || h < 16 || w > 8192 || h > 8192 || w % 4 || h % 2) throw new UsageError(`--size ${s}: expected WxH from 16 to 8192, the width a multiple of 4 and the height even`);
  return [w, h];
}

/** Whether a frame of w x h logical px at `scale` still packs into the readback: the physical width a multiple of 4, the height even. */
export const scaleFits = (w: number, h: number, scale: number) => (w * scale) % 4 === 0 && (h * scale) % 2 === 0;

/**
 * Refuse a `--scale` that does not fit a frame of w x h logical px, naming a frame size that would (only 0.5 can
 * miss: every size already packs at 1 to 4). Checked before a browser starts.
 */
export function checkScale(w: number, h: number, scale: number) {
  if (scaleFits(w, h, scale)) return;
  const m = Math.round(1 / scale);
  const fw = w - (w % (4 * m)), fh = h - (h % (2 * m));
  throw new UsageError(`--scale ${scale}: a ${w}x${h} frame would be ${w * scale}x${h * scale}, and the readback needs a width that is a multiple of 4 and an even height; ${fw}x${fh} (--size ${fw}x${fh}) renders at --scale ${scale}, or leave out --scale for full size`);
}

/** The motion-blur sampling flags: a fixed count, or adaptive. */
export function samplesOf(v: Values): number | AdaptiveSampling {
  if (v.refine !== undefined && v.refine !== 'tiles' && v.refine !== 'frame') throw new UsageError(`--refine ${v.refine}: expected tiles or frame`);
  if (v.samples === 'auto') return { min: int(v, 'min-samples', 4), max: int(v, 'max-samples', 324), tol: num(v, 'tol', 3), refine: (v.refine ?? 'tiles') as 'tiles' | 'frame' };
  for (const k of ['min-samples', 'max-samples', 'refine']) if (v[k] !== undefined) throw new UsageError(`--${k} goes with --samples auto`);
  return int(v, 'samples', 1);
}

/** What a page is opened with: the format overrides, the clips to load and a built-in theme. */
export interface PageOpts { w?: number; h?: number; fps?: number; scale: number; only?: string; theme?: string; alpha?: boolean; bits?: number }

export function pageOf(v: Values): PageOpts {
  const scale = num(v, 'scale', 1);
  if (![0.5, 1, 2, 3, 4].includes(scale)) throw new UsageError(`--scale ${v.scale}: expected 1 to 4, or 0.5 (half size, the same layout)`);
  const o: PageOpts = { scale };
  if (typeof v.size === 'string') [o.w, o.h] = sizeOf(v.size);
  if (v.fps !== undefined) {
    o.fps = num(v, 'fps');
    if (!(o.fps! > 0 && o.fps! <= 240)) throw new UsageError(`--fps ${v.fps}: expected a frame rate up to 240`);
  }
  if (typeof v.only === 'string') {
    if (!v.only.split(',').every(Boolean)) throw new UsageError(`--only ${v.only}: expected clip ids separated by commas`);
    o.only = v.only;
  }
  if (typeof v.theme === 'string') o.theme = v.theme;
  if (v.alpha === true) o.alpha = true;
  return o;
}
