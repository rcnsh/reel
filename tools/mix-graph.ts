import path from 'node:path';
import type { SoundClip } from '../src/config';

export interface Music { file: string; from?: string; at?: number; to?: string; loop?: boolean; db?: number; fadeIn?: number; fadeOut?: number }
export interface CueSound { file: string; db?: number; minGap?: number }
export interface Duck { threshold?: number; ratio?: number; attack?: number; release?: number }
export interface MixConfig {
  music?: Music[];
  duck?: false | Duck;
  cues?: Record<string, CueSound>;
  entryCues?: Record<string, string[]>;
  loudness?: false | { integrated?: number; truePeak?: number; lra?: number };
  voiceDb?: number;
}

export interface Events { duration: number; timeline: { id: string; start: number; end: number }[]; cues: { kind: string; t: number }[]; sounds?: SoundClip[] }

export const FMT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
const SR = 48000;

export interface CueLay { kind: string; file: string; gain: number; offsets: number[]; track: string }

export const CUE_TRACK_INPUT = ['-f', 'f32le', '-ar', String(SR), '-ch_layout', 'stereo'];

export function cueBlock(src: Float32Array, gain: number, offsets: number[], start: number, frames: number): Float32Array {
  const out = new Float32Array(frames * 2), n = src.length / 2;
  for (const o of offsets) {
    const a = Math.max(start, o), b = Math.min(start + frames, o + n);
    for (let i = a; i < b; i++) {
      const k = (i - start) * 2, j = (i - o) * 2;
      out[k] += src[j]! * gain;
      out[k + 1] += src[j + 1]! * gain;
    }
  }
  return out;
}

export function duckFilter(v: unknown): string | null {
  if (v === false) return null;
  if (v === undefined || v === true) return 'sidechaincompress=threshold=0.03:ratio=4:attack=80:release=600';
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('mix.json: duck must be false or { threshold, ratio, attack, release }');
  const o = v as Record<string, unknown>;
  const lim: Record<string, [number, number, string]> = { threshold: [-60, 0, 'dB'], ratio: [1, 20, ''], attack: [0.01, 2000, 'ms'], release: [0.01, 9000, 'ms'] };
  for (const [k, x] of Object.entries(o)) {
    const l = lim[k];
    if (!l) throw new Error(`mix.json: duck: unknown key '${k}' (expected threshold, ratio, attack, release)`);
    if (typeof x !== 'number' || !(x >= l[0] && x <= l[1])) throw new Error(`mix.json: duck.${k} ${JSON.stringify(x)}: expected ${l[2] ? `${l[2]} ` : ''}from ${l[0]} to ${l[1]}`);
  }
  const th = o.threshold === undefined ? 0.03 : +(10 ** ((o.threshold as number) / 20)).toPrecision(6);
  return `sidechaincompress=threshold=${th}:ratio=${o.ratio ?? 4}:attack=${o.attack ?? 80}:release=${o.release ?? 600}`;
}

export function buildMix(cfg: MixConfig, ev: Events, dur: number, from: number, voice: string | null, sound: (file: string) => string, length: (file: string) => number = () => Infinity, cueTrack: (kind: string) => string = (k) => `cues-${k}.f32`) {
  const T0 = from, T1 = from + dur;
  const warnings: string[] = [];
  const entryStart = (id: string) => {
    const e = ev.timeline.find((x) => x.id === id);
    if (!e) throw new Error(`mix.json: no clip '${id}' on the timeline`);
    return e.start;
  };

  const duck = duckFilter(cfg.duck);
  type Seg = [number, number, string, number, number, number, number, boolean];
  const segs: Seg[] = [];
  for (const m of cfg.music ?? []) {
    if (m.at !== undefined && m.from !== undefined) throw new Error(`mix.json: music ${m.file}: give from (a clip) or at (seconds), not both`);
    if (m.at !== undefined && !(typeof m.at === 'number' && m.at >= 0)) throw new Error(`mix.json: music ${m.file}: at ${JSON.stringify(m.at)}: expected seconds`);
    if (m.loop !== undefined && typeof m.loop !== 'boolean') throw new Error(`mix.json: music ${m.file}: loop ${JSON.stringify(m.loop)}: expected true or false`);
    const loop = m.loop ?? true, len = length(sound(m.file));
    const a = m.at ?? (m.from ? entryStart(m.from) : 0), to = m.to ? entryStart(m.to) : ev.duration;
    const b = loop ? to : Math.min(to, a + len);
    const s = Math.max(a, T0), e = Math.min(b, T1);
    const L = e - s;
    if (L <= 0.1) continue;
    const skip = loop && Number.isFinite(len) && len > 0 ? (s - a) % len : s - a;
    const fi = s === a ? m.fadeIn ?? (a === 0 ? 1.5 : 0.4) : 1.5;
    const fo = e === b ? m.fadeOut ?? (b === ev.duration ? 3.0 : 0.4) : 3.0;
    segs.push([s - T0, e - T0, m.file, m.db ?? -17, Math.min(fi, L / 2), Math.min(fo, L / 2), skip, loop]);
  }

  const inWin = (t: number) => t >= T0 && t < T1 - 0.2;
  const cueTimes = new Map<string, number[]>();
  for (const c of ev.cues) (cueTimes.get(c.kind) ?? cueTimes.set(c.kind, []).get(c.kind)!).push(c.t);
  for (const [kind, ids] of Object.entries(cfg.entryCues ?? {})) for (const id of ids) (cueTimes.get(kind) ?? cueTimes.set(kind, []).get(kind)!).push(entryStart(id));

  const inputs: string[] = [];
  const f: string[] = [];
  let n = 1;
  const parts: string[] = [];
  if (voice) {
    inputs.push('-ss', T0.toFixed(6), '-t', dur.toFixed(6), '-i', voice);
    const v = n++;
    f.push(`[${v}:a]${FMT},asetnsamples=n=1024:p=0${cfg.voiceDb ? `,volume=${cfg.voiceDb}dB` : ''}${segs.length && duck ? ',asplit=2[voice][sc]' : '[voice]'}`);
    parts.push('[voice]');
  }
  const mus: string[] = [];
  segs.forEach(([s, e, file, db, fi, fo, skip, loop], k) => {
    if (loop) inputs.push('-stream_loop', '-1');
    inputs.push('-i', sound(file));
    const L = e - s;
    let c = `[${n}:a]${FMT},atrim=${skip.toFixed(3)}:${(skip + L).toFixed(3)},asetpts=PTS-STARTPTS,volume=${db}dB`;
    if (fi) c += `,afade=t=in:d=${fi}`;
    if (fo) c += `,afade=t=out:st=${(L - fo).toFixed(3)}:d=${fo}`;
    c += `,adelay=${Math.round(s * 1000)}:all=1,asetnsamples=n=1024:p=0[m${k}]`;
    f.push(c); mus.push(`[m${k}]`); n++;
  });
  if (mus.length) {
    const m = mus.length > 1 ? `${mus.join('')}amix=inputs=${mus.length}:normalize=0:duration=longest` : `${mus[0]}anull`;
    if (voice && duck) f.push(`${m}[mraw]`, `[mraw][sc]${duck}[music]`);
    else f.push(`${m}[music]`);
    parts.push('[music]');
  }
  const counts: string[] = [];
  const cues: CueLay[] = [];
  let tag = 0;
  for (const [kind, raw] of cueTimes) {
    const snd = cfg.cues?.[kind];
    if (!snd) { warnings.push(`no sound for cue kind '${kind}' in mix.json: skipped`); continue; }
    const times: number[] = [];
    for (const t of raw.sort((a, b) => a - b)) if (!times.length || t - times[times.length - 1]! > (snd.minGap ?? 0.15)) times.push(t);
    const v = times.filter(inWin).map((t) => t - T0);
    counts.push(`${v.length} ${kind}`);
    if (!v.length) continue;
    const id = `c${tag++}`, ms = v.map((t) => Math.round(t * 1000));
    const track = cueTrack(kind);
    cues.push({ kind, file: sound(snd.file), gain: 10 ** ((snd.db ?? 0) / 20), offsets: ms.map((x) => (x * SR) / 1000), track });
    inputs.push(...CUE_TRACK_INPUT, '-i', track);
    f.push(`[${n}:a]${FMT}[${id}]`);
    parts.push(`[${id}]`);
    n++;
  }
  let laid = 0;
  for (const s of ev.sounds ?? []) {
    const file = sound(s.file), speed = s.speed ?? 1;
    const play = s.duration ?? (s.loop ? ev.duration - s.at : (length(file) - (s.from ?? 0)) / speed);
    const a = s.at, b = a + play, ws = Math.max(a, T0), we = Math.min(b, T1), L = we - ws;
    if (!(L > 0.01)) continue;
    const skip = (s.from ?? 0) + (ws - a) * speed;
    if (s.loop) inputs.push('-stream_loop', '-1');
    inputs.push('-i', file);
    const fi = ws === a ? Math.min(s.fadeIn ?? 0.02, L / 2) : 0, fo = we === b ? Math.min(s.fadeOut ?? 0.02, L / 2) : 0;
    const tempo: string[] = [];
    for (let k = speed; Math.abs(k - 1) > 1e-6;) { const x = Math.min(2, Math.max(0.5, k)); tempo.push(`atempo=${x}`); k /= x; }
    let c = `[${n}:a]${FMT},atrim=start=${skip.toFixed(6)},asetpts=PTS-STARTPTS${tempo.map((x) => `,${x}`).join('')},atrim=0:${L.toFixed(6)},asetpts=PTS-STARTPTS,volume=${s.db ?? 0}dB`;
    if (fi) c += `,afade=t=in:d=${fi.toFixed(3)}`;
    if (fo) c += `,afade=t=out:st=${(L - fo).toFixed(3)}:d=${fo.toFixed(3)}`;
    c += `,adelay=${Math.round((ws - T0) * 1000)}:all=1,asetnsamples=n=1024:p=0[s${laid}]`;
    f.push(c); parts.push(`[s${laid}]`); n++; laid++;
  }
  if (ev.sounds?.length) counts.push(`${laid} sound${laid === 1 ? '' : 's'} on the timeline`);
  const len = dur.toFixed(6), silence = `anullsrc=r=48000:cl=stereo,atrim=0:${len}`, cut = `atrim=0:${len},asetpts=PTS-STARTPTS[mixed]`;
  if (!parts.length) f.push(`${silence}[mixed]`);
  else f.push(`${silence}[silence]`, `[silence]${parts.join('')}amix=inputs=${parts.length + 1}:normalize=0:duration=first,${cut}`);
  return { inputs, filter: f.join(';'), silent: !parts.length, segments: segs.length, counts, warnings, cues };
}
