// What `reel video` writes: the output formats, which one a command line means (--format, else the --out
// extension), what each needs from the page (the readback, the bits per channel, a transparent background) and the
// ffmpeg command that encodes it. Pure (no I/O), so the CLI and its tests share it.
import path from 'node:path';
import type { Pixels } from '../src/engine/pixels';
import { int, num, UsageError, type Values } from './args';

export type FormatId = 'h264' | 'hevc' | 'prores' | 'prores4444' | 'webm' | 'gif' | 'webp' | 'png' | 'png16' | 'jpeg' | 'exr';

export interface FormatSpec {
  id: FormatId;
  /** The file extension a default output gets (and that --out infers it from). */
  ext: string;
  /** One line for --help and errors. */
  about: string;
  /** A video file, a short loop (no sound, capped rate and size) or a folder of numbered images. */
  kind: 'video' | 'loop' | 'sequence';
  /** 'always': transparent unless --opaque; 'option': with --alpha; 'never'. */
  alpha: 'always' | 'option' | 'never';
  /** The sound codec the container carries (null: no sound). */
  audio: string[] | null;
  /** The soft subtitle codec the container carries (null: none). */
  subtitles: 'mov_text' | 'webvtt' | null;
}

export const FORMATS: Record<FormatId, FormatSpec> = {
  h264: { id: 'h264', ext: '.mp4', about: 'H.264 MP4 (x264): 4:2:0 8-bit, or --chroma 444 and --depth 10', kind: 'video', alpha: 'never', audio: ['-c:a', 'aac', '-b:a', '320k'], subtitles: 'mov_text' },
  hevc: { id: 'hevc', ext: '.mp4', about: 'HEVC MP4 (x265 Main10): 10-bit 4:2:0, SDR BT.709', kind: 'video', alpha: 'never', audio: ['-c:a', 'aac', '-b:a', '320k'], subtitles: 'mov_text' },
  prores: { id: 'prores', ext: '.mov', about: 'ProRes 422 HQ MOV: a 10-bit editing master, PCM sound', kind: 'video', alpha: 'never', audio: ['-c:a', 'pcm_s24le'], subtitles: 'mov_text' },
  prores4444: { id: 'prores4444', ext: '.mov', about: 'ProRes 4444 MOV with alpha (10-bit colour, 16-bit alpha), for compositing; PCM sound', kind: 'video', alpha: 'always', audio: ['-c:a', 'pcm_s24le'], subtitles: 'mov_text' },
  webm: { id: 'webm', ext: '.webm', about: 'VP9 WebM with alpha, Opus sound', kind: 'video', alpha: 'always', audio: ['-c:a', 'libopus', '-b:a', '256k'], subtitles: 'webvtt' },
  gif: { id: 'gif', ext: '.gif', about: 'GIF loop: a palette made for the video, Sierra dither, rate and size capped', kind: 'loop', alpha: 'never', audio: null, subtitles: null },
  webp: { id: 'webp', ext: '.webp', about: 'animated WebP loop, rate and size capped (--alpha for transparency)', kind: 'loop', alpha: 'option', audio: null, subtitles: null },
  png: { id: 'png', ext: '.png', about: 'PNG sequence, 8-bit (--alpha for RGBA)', kind: 'sequence', alpha: 'option', audio: null, subtitles: null },
  png16: { id: 'png16', ext: '.png', about: '16-bit PNG sequence of the finished frame (--alpha for RGBA)', kind: 'sequence', alpha: 'option', audio: null, subtitles: null },
  jpeg: { id: 'jpeg', ext: '.jpg', about: 'JPEG sequence (4:4:4, --quality)', kind: 'sequence', alpha: 'never', audio: null, subtitles: null },
  exr: { id: 'exr', ext: '.exr', about: 'OpenEXR sequence of the linear HDR frame before tone mapping and post (half float, premultiplied alpha with --alpha), for grading', kind: 'sequence', alpha: 'option', audio: null, subtitles: null },
};

const BY_EXT: Record<string, FormatId> = { '.mp4': 'h264', '.m4v': 'h264', '.mov': 'prores', '.webm': 'webm', '.gif': 'gif', '.webp': 'webp', '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.exr': 'exr' };

/** The format a command line means: --format, else the --out extension, else H.264. */
export function formatOf(format: string | undefined, out: string | undefined): FormatSpec {
  if (format !== undefined) {
    const f = FORMATS[format as FormatId];
    if (!f || !Object.prototype.hasOwnProperty.call(FORMATS, format)) throw new UsageError(`--format ${format}: expected one of ${Object.keys(FORMATS).join(', ')}`);
    if (out) {
      const ext = path.extname(out).toLowerCase(), want = BY_EXT[ext] ? FORMATS[BY_EXT[ext]!].ext : ext;
      if (f.kind !== 'sequence' && ext && want !== f.ext && !(f.ext === '.mp4' && ext === '.m4v')) throw new UsageError(`--out ${out}: a ${f.id} file is ${f.ext}`);
      if (f.kind === 'sequence' && ext && ext !== f.ext && !(f.id === 'jpeg' && ext === '.jpeg')) throw new UsageError(`--out ${out}: ${f.id} frames are ${f.ext} files`);
    }
    return f;
  }
  if (out) {
    const ext = path.extname(out).toLowerCase();
    if (!BY_EXT[ext]) throw new UsageError(`--out ${out}: no format writes '${ext || '(no extension)'}' files; give --format (${Object.keys(FORMATS).join(', ')})`);
    return FORMATS[BY_EXT[ext]!];
  }
  return FORMATS.h264;
}

/** What the encoder is asked for beyond the format. */
export interface EncodeOpts {
  crf?: number;
  preset?: string;
  /** Extra x264 or x265 parameters (key=value:key=value). */
  params?: string;
  chroma?: '420' | '444';
  depth?: 8 | 10;
  /** A transparent background (formats that can carry it). */
  alpha?: boolean;
  /** Loops: the highest frame rate and the longest side in px. */
  maxFps?: number;
  maxSize?: number;
  /** JPEG and WebP quality, 1 to 100. */
  quality?: number;
  /** The draft tier's encoder: WebCodecs H.264 in the page, or the raw pipe into VideoToolbox (macOS) or x264 ultrafast. */
  draft?: 'webcodecs' | 'videotoolbox' | 'x264';
  /** Text for the file's comment tag (drafts say they are drafts). */
  comment?: string;
}

/** What the page is opened with and reads back for a format. */
export interface Plan {
  format: FormatSpec;
  pixels: Pixels;
  /** Bits per channel the final pass renders at (the page's ?bits=). */
  bits: 8 | 10 | 16;
  alpha: boolean;
  /** The frame rate rendered (a loop's may be capped below the project's). */
  fps: number;
  /** ffmpeg's rawvideo pixel format for `pixels`. */
  rawFormat: string;
}

const RAW: Record<Pixels, string> = { rgb8: 'rgb24', rgba8: 'rgba', rgb16: 'rgb48le', rgba16: 'rgba64le', linear: 'rgbaf16le' };

/** The plan for a format and its options at the project's frame rate. Throws a UsageError for options that do not apply. */
export function planOf(f: FormatSpec, o: EncodeOpts, fps: number): Plan {
  if (o.alpha && f.alpha === 'never') throw new UsageError(`--alpha: ${f.id} cannot carry transparency (prores4444, webm, webp, png, png16 and exr can)`);
  if (o.chroma && f.id !== 'h264') throw new UsageError(`--chroma goes with h264 (${f.id} has its own)`);
  if (o.depth && f.id !== 'h264') throw new UsageError(`--depth goes with h264 (hevc and prores are 10-bit, png16 and exr deeper)`);
  if ((o.maxFps !== undefined || o.maxSize !== undefined) && f.kind !== 'loop') throw new UsageError('--max-fps and --max-size go with the loop formats (gif, webp)');
  if (o.quality !== undefined && f.id !== 'jpeg' && f.id !== 'webp') throw new UsageError('--quality goes with jpeg and webp');
  if (o.draft && f.id !== 'h264') throw new UsageError(`--draft renders H.264 MP4, not ${f.id}`);
  const alpha = f.alpha === 'always' ? o.alpha !== false : f.alpha === 'option' ? !!o.alpha : false;
  let pixels: Pixels = alpha ? 'rgba8' : 'rgb8', bits: Plan['bits'] = 8;
  if (f.id === 'hevc' || f.id === 'prores' || f.id === 'prores4444' || (f.id === 'h264' && o.depth === 10)) { pixels = alpha ? 'rgba16' : 'rgb16'; bits = 10; }
  if (f.id === 'png16') { pixels = alpha ? 'rgba16' : 'rgb16'; bits = 16; }
  if (f.id === 'exr') pixels = 'linear';
  const cap = f.kind === 'loop' ? o.maxFps ?? (f.id === 'gif' ? 25 : 30) : Infinity;
  return { format: f, pixels, bits, alpha, fps: Math.min(fps, cap), rawFormat: RAW[pixels] };
}

/** Where a sequence's frames go: --out as a pattern (`%05d` added before the extension when it has none). */
export function sequencePattern(out: string, f: FormatSpec) {
  if (/%0?\d*d/.test(path.basename(out))) return out;
  const ext = path.extname(out) || f.ext;
  return path.join(path.dirname(out), `${path.basename(out, path.extname(out))}_%06d${ext}`);
}

/** The default output for a project folder. */
export function defaultOut(project: string, f: FormatSpec, draft = false) {
  if (f.kind === 'sequence') return path.join(project, 'out', f.id, `frame${f.ext}`);
  return path.join(project, 'out', `video${draft ? '.draft' : ''}${f.id === 'h264' ? '' : f.id === 'hevc' ? '.hevc' : f.id === 'prores4444' ? '.4444' : ''}${f.ext}`);
}

// BT.709 tags for every YUV stream reel writes (SDR, limited range)
const TAGS709 = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
const SRGB = 'setparams=color_trc=iec61966-2-1:color_primaries=bt709';
/** Full-range RGB to limited-range BT.709 YUV: chroma averaged over its block, accurate rounding, tagged. */
export const toYuv709 = (pixFmt: string) => `scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=area+accurate_rnd+full_chroma_int,format=${pixFmt},setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709`;

export interface FfmpegInput { width: number; height: number; fps: number; out: string; audio?: { file: string; from: number; duration: number } | null; startNumber?: number; webpFrames?: string }

/**
 * The ffmpeg command that reads raw frames (bottom-up, `plan.rawFormat`) on stdin and writes the format, with the
 * project's sound when the container carries it. Loops and sequences take no sound.
 */
export function ffmpegArgs(plan: Plan, o: EncodeOpts, i: FfmpegInput): string[] {
  const f = plan.format;
  const a = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', plan.rawFormat, '-s', `${i.width}x${i.height}`, '-r', String(i.fps), '-i', 'pipe:0'];
  const sound = !!i.audio && !!f.audio;
  if (sound) a.push('-ss', String(i.audio!.from), '-t', String(i.audio!.duration), '-i', i.audio!.file);
  const v: string[] = [];
  switch (f.id) {
    case 'h264': {
      if (o.draft === 'videotoolbox') {
        v.push('-vf', `vflip,${toYuv709('nv12')}`, '-c:v', 'h264_videotoolbox', '-b:v', `${Math.max(2, Math.round((i.width * i.height * i.fps) / 1e6 * 0.12))}M`, '-realtime', '1', '-prio_speed', '1', ...TAGS709);
        break;
      }
      if (o.draft === 'x264') {
        v.push('-vf', `vflip,${toYuv709('yuv420p')}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-tune', 'zerolatency', ...TAGS709);
        break;
      }
      const pix = `yuv${o.chroma === '444' ? '444' : '420'}p${o.depth === 10 ? '10le' : ''}`;
      v.push('-vf', `vflip,${toYuv709(pix)}`, '-c:v', 'libx264', '-preset', o.preset ?? 'slow', '-crf', String(o.crf ?? 16), '-pix_fmt', pix, '-tune', 'grain', '-x264-params', o.params ?? 'aq-mode=3', ...TAGS709);
      break;
    }
    case 'hevc':
      v.push('-vf', `vflip,${toYuv709('yuv420p10le')}`, '-c:v', 'libx265', '-preset', o.preset ?? 'medium', '-crf', String(o.crf ?? 18), '-pix_fmt', 'yuv420p10le', '-profile:v', 'main10', '-tag:v', 'hvc1',
        '-x265-params', ['log-level=error', 'colorprim=bt709', 'transfer=bt709', 'colormatrix=bt709', 'range=limited', o.params].filter(Boolean).join(':'), ...TAGS709);
      break;
    case 'prores':
      v.push('-vf', `vflip,${toYuv709('yuv422p10le')}`, '-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le', ...TAGS709);
      break;
    case 'prores4444': {
      // (straight alpha in the alpha plane; ProRes 4444 is read as straight by editors and ffmpeg)
      const pix = plan.alpha ? 'yuva444p10le' : 'yuv444p10le';
      v.push('-vf', `vflip,${toYuv709(pix)}`, '-c:v', 'prores_ks', '-profile:v', '4', '-vendor', 'apl0', '-pix_fmt', pix, ...(plan.alpha ? ['-alpha_bits', '16'] : []), ...TAGS709);
      break;
    }
    case 'webm': {
      // (VP9 keeps alpha as a second stream libvpx encodes from yuva420p; browsers composite it as straight alpha)
      const pix = plan.alpha ? 'yuva420p' : 'yuv420p';
      v.push('-vf', `vflip,${toYuv709(pix)}`, '-c:v', 'libvpx-vp9', '-pix_fmt', pix, '-crf', String(o.crf ?? 24), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', ...(plan.alpha ? ['-auto-alt-ref', '0'] : []), ...TAGS709);
      break;
    }
    case 'gif': {
      // one palette for the whole loop from the frames' differences, Sierra dither, only the changed rectangle per frame
      const size = loopScale(i.width, i.height, o.maxSize ?? 640);
      v.push('-vf', `vflip${size},split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, '-loop', '0');
      break;
    }
    case 'webp': {
      const size = loopScale(i.width, i.height, o.maxSize ?? 1080);
      // (an ffmpeg without libwebp writes PNG frames that img2webp, from libwebp's tools, then assembles: webpArgs)
      if (i.webpFrames) {
        a.push('-vf', `vflip${size}`, '-c:v', 'png', '-pix_fmt', plan.alpha ? 'rgba' : 'rgb24', path.join(i.webpFrames, '%06d.png'));
        return a;
      }
      v.push('-vf', `vflip${size},format=${plan.alpha ? 'yuva420p' : 'yuv420p'}`, '-c:v', 'libwebp_anim', '-lossless', '0', '-quality', String(o.quality ?? 80), '-loop', '0');
      break;
    }
    case 'png':
      // (tagged sRGB: the PNG gets its sRGB, gAMA and cHRM chunks)
      v.push('-vf', `vflip,${SRGB}`, '-c:v', 'png', '-pix_fmt', plan.alpha ? 'rgba' : 'rgb24', '-start_number', String(i.startNumber ?? 0));
      break;
    case 'png16':
      v.push('-vf', `vflip,${SRGB}`, '-c:v', 'png', '-pix_fmt', plan.alpha ? 'rgba64be' : 'rgb48be', '-start_number', String(i.startNumber ?? 0));
      break;
    case 'jpeg':
      // (JPEG is full-range BT.601 YCbCr by its standard)
      v.push('-vf', 'vflip,scale=in_range=pc:out_range=pc:out_color_matrix=bt601:flags=accurate_rnd+full_chroma_int,format=yuvj444p', '-c:v', 'mjpeg', '-q:v', String(jpegQ(o.quality ?? 92)), '-start_number', String(i.startNumber ?? 0));
      break;
    case 'exr':
      // (the linear frame's alpha is premultiplied, as EXR's is: said so, ffmpeg converts nothing)
      v.push('-vf', `setparams=alpha_mode=premultiplied,format=${plan.alpha ? 'gbrapf32le' : 'gbrpf32le'},vflip`, '-c:v', 'exr', '-format', '1', '-compression', '3', '-start_number', String(i.startNumber ?? 0));
      break;
  }
  a.push(...v);
  if (sound) a.push(...f.audio!, '-shortest');
  if (o.comment && f.kind === 'video') a.push('-metadata', `comment=${o.comment}`);
  if (f.ext === '.mp4' || f.ext === '.mov') a.push('-movflags', '+faststart');
  a.push(f.kind === 'sequence' ? sequencePattern(i.out, f) : i.out);
  return a;
}

/** A loop's downscale to at most `max` px on its long side (an empty string when it fits). */
function loopScale(w: number, h: number, max: number) {
  if (Math.max(w, h) <= max) return '';
  const k = max / Math.max(w, h), even = (x: number) => Math.max(2, 2 * Math.round((x * k) / 2));
  return `,scale=${even(w)}:${even(h)}:flags=lanczos`;
}

/** ffmpeg's mjpeg -q:v (2 best .. 31) for a quality of 1 to 100. */
export const jpegQ = (q: number) => Math.max(2, Math.min(31, Math.round(2 + ((100 - q) / 99) * 29)));

/**
 * img2webp's command for `n` PNG frames in `dir` at `fps`: each frame's duration in whole milliseconds, rounded so
 * the running total stays on the frame clock (a 30 fps loop alternates 33 and 34 ms).
 */
export function webpArgs(dir: string, n: number, fps: number, o: EncodeOpts, out: string) {
  const a = ['img2webp', '-loop', '0', '-lossy', '-q', String(o.quality ?? 80), '-m', '4'];
  for (let k = 0; k < n; k++) {
    const d = Math.round(((k + 1) * 1000) / fps) - Math.round((k * 1000) / fps);
    a.push('-d', String(d), path.join(dir, `${String(k + 1).padStart(6, '0')}.png`));
  }
  a.push('-o', out);
  return a;
}

const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo'];

/** The encoder options of `reel video`'s flags, checked against the format. */
export function encodeOptsOf(v: Values, f: FormatSpec): EncodeOpts {
  const o: EncodeOpts = {};
  if (v.crf !== undefined) {
    if (f.id !== 'h264' && f.id !== 'hevc' && f.id !== 'webm') throw new UsageError(`--crf goes with h264, hevc and webm (${f.id} has none)`);
    const crf = o.crf = num(v, 'crf', 0);
    if (!(crf >= 0 && crf <= 63)) throw new UsageError(`--crf ${v.crf}: expected 0 to 51 (63 for webm)`);
  }
  if (v.preset !== undefined) {
    if (f.id !== 'h264' && f.id !== 'hevc') throw new UsageError(`--preset goes with h264 and hevc`);
    if (!PRESETS.includes(String(v.preset))) throw new UsageError(`--preset ${v.preset}: expected one of ${PRESETS.join(', ')}`);
    o.preset = String(v.preset);
  }
  if (v.x264 !== undefined) { if (f.id !== 'h264') throw new UsageError('--x264 goes with h264'); o.params = String(v.x264); }
  if (v.x265 !== undefined) { if (f.id !== 'hevc') throw new UsageError('--x265 goes with hevc'); o.params = String(v.x265); }
  if (v.chroma !== undefined) {
    if (v.chroma !== '420' && v.chroma !== '444') throw new UsageError(`--chroma ${v.chroma}: expected 420 or 444`);
    o.chroma = v.chroma;
  }
  if (v.depth !== undefined) {
    if (v.depth !== '8' && v.depth !== '10') throw new UsageError(`--depth ${v.depth}: expected 8 or 10`);
    o.depth = Number(v.depth) as 8 | 10;
  }
  if (v.alpha && v.opaque) throw new UsageError('--alpha and --opaque contradict each other');
  if (v.alpha) o.alpha = true;
  if (v.opaque) { if (f.alpha !== 'always') throw new UsageError(`--opaque goes with prores4444 and webm (${f.id} is opaque unless --alpha)`); o.alpha = false; }
  if (v.quality !== undefined) o.quality = int(v, 'quality', 80, 1);
  if (o.quality !== undefined && o.quality > 100) throw new UsageError(`--quality ${v.quality}: expected 1 to 100`);
  if (v['max-fps'] !== undefined) { const mf = o.maxFps = num(v, 'max-fps', 0); if (!(mf > 0)) throw new UsageError(`--max-fps ${v['max-fps']}: expected a frame rate over 0`); }
  if (v['max-size'] !== undefined) o.maxSize = int(v, 'max-size', 640, 16);
  return o;
}

/**
 * The draft tier's encoder: H.264 encoded in the page with WebCodecs (fastest: no raw frames leave the page; hardware
 * where the browser has it), falling back to the raw pipe into VideoToolbox or x264 ultrafast when the browser cannot.
 * REEL_DRAFT_ENCODER (webcodecs, videotoolbox or x264) picks one.
 */
export function draftEncoder(has: (encoder: string) => boolean = hasFfmpegEncoder): 'webcodecs' | 'videotoolbox' | 'x264' {
  const env = process.env.REEL_DRAFT_ENCODER;
  if (env === 'webcodecs' || env === 'x264') return env;
  if (env === 'videotoolbox') return has('h264_videotoolbox') ? env : 'x264';
  return 'webcodecs';
}

/** A draft's file name: `.draft` before the extension (added when missing), so a draft is never taken for a final. */
export function draftName(out: string, draft: boolean) {
  if (!draft || /\.draft\.[^./]+$/.test(out)) return out;
  const ext = path.extname(out);
  return out.slice(0, out.length - ext.length) + '.draft' + ext;
}

const encoders = new Set<string>();
/** Whether this machine's ffmpeg has an encoder (`ffmpeg -encoders`, asked once per process). */
export function hasFfmpegEncoder(name: string) {
  if (!encoders.size) {
    const out = Bun.spawnSync(['ffmpeg', '-hide_banner', '-encoders'], { stdout: 'pipe', stderr: 'ignore' }).stdout.toString();
    for (const m of out.matchAll(/^\s*[VAS][.A-Z]{5}\s+(\S+)/gm)) encoders.add(m[1]!);
    encoders.add('');
  }
  return encoders.has(name);
}
