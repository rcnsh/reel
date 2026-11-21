import { run, spawnChild } from '../cli/children';
import { rmSync } from 'node:fs';
import { EBUR128, loudnormFilter, parseEbur128, parseLoudnorm, type Loudness, type R128 } from './loudness';

export const SR = 48000;

export async function decode(file: string, sr = SR): Promise<Float32Array> {
  return new Float32Array((await run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(sr), '-'])).stdout.buffer);
}

export async function writeAudio(pcm: Float32Array, file: string, sr = SR) {
  const raw = `${file}.f32`;
  await Bun.write(raw, pcm);
  const codec = file.endsWith('.flac') ? ['-c:a', 'flac', '-compression_level', '8', '-sample_fmt', 's16'] : file.endsWith('.f32.wav') ? ['-c:a', 'pcm_f32le'] : ['-c:a', 'pcm_s16le'];
  await run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(sr), '-ac', '1', '-i', raw, ...codec, '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', file]);
  rmSync(raw, { force: true });
}

export async function durationOf(file: string) {
  return Number((await run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])).text().trim());
}

export async function measure(file: string, filter = 'anull'): Promise<Loudness> {
  const r = await run(['ffmpeg', '-nostdin', '-hide_banner', '-i', file, '-af', `${filter},loudnorm=print_format=json`, '-f', 'null', '-'], { quiet: true, nothrow: true });
  return parseLoudnorm(r.stderr);
}

export async function ffmpegR128(args: string[], what: string): Promise<R128> {
  const p = spawnChild(['ffmpeg', ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const dec = new TextDecoder();
  let tail = '';
  const read = (async () => { for await (const b of p.stdout) tail = (tail + dec.decode(b, { stream: true })).slice(-8192); })();
  const [code, , err] = await Promise.all([p.exited, read, new Response(p.stderr).text()]);
  if (code !== 0) throw new Error(`ffmpeg (${what}): ${err.slice(-1200)}`);
  return parseEbur128(tail);
}

export function loudnessOf(file: string) {
  return ffmpegR128(['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-af', EBUR128, '-f', 'null', '-'], `measuring ${file}`);
}

export async function normalize(pcm: Float32Array, target: { integrated: number; truePeak: number; lra?: number }, work: string): Promise<Float32Array> {
  const f = `${work}.norm-in.f32.wav`;
  await writeAudio(pcm, f);
  const m = await measure(f);
  if (!Number.isFinite(m.integrated)) return pcm;
  const out = new Float32Array((await run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', f, '-af', loudnormFilter(target, m), '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'])).stdout.buffer);
  rmSync(f, { force: true });
  return out;
}

export function levels(pcm: Float32Array, sr = SR, hop = 0.01): Float32Array {
  const H = Math.round(sr * hop), n = Math.floor(pcm.length / H), db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let k = i * H; k < (i + 1) * H; k++) e += pcm[k]! * pcm[k]!;
    db[i] = 10 * Math.log10(e / H + 1e-12);
  }
  return db;
}

export function trimSilence(pcm: Float32Array, sr = SR, threshold = -50, pad = 0.03): { pcm: Float32Array; offset: number } {
  const db = levels(pcm, sr), peak = Math.max(-120, ...db), hop = Math.round(sr * 0.01);
  let a = 0, b = db.length - 1;
  while (a < db.length && db[a]! < peak + threshold) a++;
  while (b > a && db[b]! < peak + threshold) b--;
  if (a >= db.length) return { pcm: new Float32Array(0), offset: 0 };
  const s = Math.max(0, a * hop - Math.round(pad * sr)), e = Math.min(pcm.length, (b + 1) * hop + Math.round(pad * sr));
  return { pcm: pcm.slice(s, e), offset: s / sr };
}
