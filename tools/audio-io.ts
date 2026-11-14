// Audio in and out of the tools: decoding anything ffmpeg reads to mono float samples, writing lossless files,
// and the pure measurements on samples (levels, silence) that narration and alignment share.
import { $ } from 'bun';
import { loudnormFilter, parseLoudnorm, type Loudness } from './loudness';

/** The sample rate of the tools' working audio and of the narration track. */
export const SR = 48000;

/** Mono float samples of any file ffmpeg reads, at `sr`. */
export async function decode(file: string, sr = SR): Promise<Float32Array> {
  return new Float32Array(await $`ffmpeg -nostdin -loglevel error -i ${file} -f f32le -ac 1 -ar ${sr} -`.arrayBuffer());
}

/** Write mono samples losslessly: FLAC for .flac, 16-bit PCM for .wav, 32-bit float for .f32.wav. */
export async function writeAudio(pcm: Float32Array, file: string, sr = SR) {
  const raw = `${file}.f32`;
  await Bun.write(raw, pcm);
  const codec = file.endsWith('.flac') ? ['-c:a', 'flac', '-compression_level', '8', '-sample_fmt', 's16'] : file.endsWith('.f32.wav') ? ['-c:a', 'pcm_f32le'] : ['-c:a', 'pcm_s16le'];
  await $`ffmpeg -nostdin -loglevel error -y -f f32le -ar ${sr} -ac 1 -i ${raw} ${codec} -map_metadata -1 -fflags +bitexact -flags:a +bitexact ${file}`;
  await $`rm -f ${raw}`;
}

/** A file's duration in seconds. */
export async function durationOf(file: string) {
  return Number((await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${file}`.text()).trim());
}

/** The integrated loudness, true peak and loudness range of a file (EBU R128, ffmpeg's loudnorm measurement). */
export async function measure(file: string, filter = 'anull'): Promise<Loudness> {
  const r = await $`ffmpeg -nostdin -hide_banner -i ${file} -af ${filter},loudnorm=print_format=json -f null -`.quiet().nothrow();
  return parseLoudnorm(r.stderr.toString());
}

/** Samples brought to an integrated loudness with a true-peak ceiling (two-pass, linear where it can be). */
export async function normalize(pcm: Float32Array, target: { integrated: number; truePeak: number; lra?: number }, work: string): Promise<Float32Array> {
  const f = `${work}.norm-in.f32.wav`;
  await writeAudio(pcm, f);
  const m = await measure(f);
  if (!Number.isFinite(m.integrated)) return pcm; // (silence)
  const out = new Float32Array(await $`ffmpeg -nostdin -loglevel error -i ${f} -af ${loudnormFilter(target, m)} -f f32le -ac 1 -ar ${SR} -`.arrayBuffer());
  await $`rm -f ${f}`;
  return out;
}

// ---- pure ----

/** Level in dB of each `hop`-second frame of the samples (RMS). */
export function levels(pcm: Float32Array, sr = SR, hop = 0.01): Float32Array {
  const H = Math.round(sr * hop), n = Math.floor(pcm.length / H), db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let k = i * H; k < (i + 1) * H; k++) e += pcm[k]! * pcm[k]!;
    db[i] = 10 * Math.log10(e / H + 1e-12);
  }
  return db;
}

/**
 * The samples without the silence at either end (below `threshold` dB relative to the loudest 10 ms), keeping
 * `pad` seconds of it each side; `offset` is the seconds cut from the start.
 */
export function trimSilence(pcm: Float32Array, sr = SR, threshold = -50, pad = 0.03): { pcm: Float32Array; offset: number } {
  const db = levels(pcm, sr), peak = Math.max(-120, ...db), hop = Math.round(sr * 0.01);
  let a = 0, b = db.length - 1;
  while (a < db.length && db[a]! < peak + threshold) a++;
  while (b > a && db[b]! < peak + threshold) b--;
  if (a >= db.length) return { pcm: new Float32Array(0), offset: 0 };
  const s = Math.max(0, a * hop - Math.round(pad * sr)), e = Math.min(pcm.length, (b + 1) * hop + Math.round(pad * sr));
  return { pcm: pcm.slice(s, e), offset: s / sr };
}
