// The sound mix's ffmpeg inputs and filter graph (tools/mix.ts): pure, so it is unit-tested.
import path from 'node:path';

export interface Music { file: string; from?: string; to?: string; db?: number; fadeIn?: number; fadeOut?: number }
export interface CueSound { file: string; db?: number; minGap?: number }
export interface MixConfig {
  music?: Music[];
  cues?: Record<string, CueSound>;
  entryCues?: Record<string, string[]>;
  /** The finished mix's loudness: false for none, or over the default { integrated: -14, truePeak: -1, lra: 11 }. */
  loudness?: false | { integrated?: number; truePeak?: number; lra?: number };
  /** The voice's level in dB (default 0). */
  voiceDb?: number;
}

export interface Events { duration: number; timeline: { id: string; start: number; end: number }[]; cues: { kind: string; t: number }[] }

/** The working sample rate and layout of the mix. */
const FMT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

/**
 * The inputs and filter graph that mix `cfg`'s music and cue sounds with the voice (`voice`: the narration track, or
 * null for a silent video) for a video of `dur` seconds starting at timeline time `from`. Input 0 is the video (its
 * picture is copied; its own sound, an encode of the same track, is not used), so `inputs` are the ffmpeg arguments
 * after it. The graph ends in [mixed], `dur` seconds of 48 kHz stereo before loudness normalisation. `sound(file)`
 * resolves a file named in mix.json. `counts`: cues laid per kind; `warnings`: cue kinds with no sound.
 */
export function buildMix(cfg: MixConfig, ev: Events, dur: number, from: number, voice: string | null, sound: (file: string) => string) {
  const T0 = from, T1 = from + dur;
  const warnings: string[] = [];
  const entryStart = (id: string) => {
    const e = ev.timeline.find((x) => x.id === id);
    if (!e) throw new Error(`mix.json: no clip '${id}' on the timeline`);
    return e.start;
  };

  // music segments in video time: [start, end, file, db, fade-in, fade-out]
  type Seg = [number, number, string, number, number, number];
  const segs: Seg[] = [];
  for (const m of cfg.music ?? []) {
    const a = m.from ? entryStart(m.from) : 0, b = m.to ? entryStart(m.to) : ev.duration;
    const s = Math.max(a, T0), e = Math.min(b, T1);
    const L = e - s;
    if (L <= 0.1) continue;
    // (a segment cut by the render's window fades at the cut, like the video's own ends)
    const fi = s === a ? m.fadeIn ?? (a === 0 ? 1.5 : 0.4) : 1.5;
    const fo = e === b ? m.fadeOut ?? (b === ev.duration ? 3.0 : 0.4) : 3.0;
    // fades longer than half the segment would overlap (or start before it: ffmpeg refuses a negative st)
    segs.push([s - T0, e - T0, m.file, m.db ?? -17, Math.min(fi, L / 2), Math.min(fo, L / 2)]);
  }

  // cue times per kind, in video time
  const inWin = (t: number) => t >= T0 && t < T1 - 0.2;
  const cueTimes = new Map<string, number[]>();
  for (const c of ev.cues) (cueTimes.get(c.kind) ?? cueTimes.set(c.kind, []).get(c.kind)!).push(c.t);
  for (const [kind, ids] of Object.entries(cfg.entryCues ?? {})) for (const id of ids) (cueTimes.get(kind) ?? cueTimes.set(kind, []).get(kind)!).push(entryStart(id));

  const inputs: string[] = [];
  const f: string[] = [];
  let n = 1;
  const parts: string[] = [];
  if (voice) {
    // (the track from the render's start, decoded exactly: it is lossless)
    inputs.push('-ss', T0.toFixed(6), '-t', dur.toFixed(6), '-i', voice);
    const v = n++;
    f.push(`[${v}:a]${FMT},asetnsamples=n=1024:p=0${cfg.voiceDb ? `,volume=${cfg.voiceDb}dB` : ''}${segs.length ? ',asplit=2[voice][sc]' : '[voice]'}`);
    parts.push('[voice]');
  }
  const mus: string[] = [];
  segs.forEach(([s, e, file, db, fi, fo], k) => {
    inputs.push('-stream_loop', '-1', '-i', sound(file));
    const L = e - s;
    let c = `[${n}:a]${FMT},atrim=0:${L.toFixed(3)},asetpts=PTS-STARTPTS,volume=${db}dB`;
    if (fi) c += `,afade=t=in:d=${fi}`;
    if (fo) c += `,afade=t=out:st=${(L - fo).toFixed(3)}:d=${fo}`;
    c += `,adelay=${Math.round(s * 1000)}:all=1,asetnsamples=n=1024:p=0[m${k}]`;
    f.push(c); mus.push(`[m${k}]`); n++;
  });
  if (mus.length) {
    const m = mus.length > 1 ? `${mus.join('')}amix=inputs=${mus.length}:normalize=0:duration=longest` : `${mus[0]}anull`;
    // the voice drives the music's ducking (sidechain)
    if (voice) f.push(`${m}[mraw]`, `[mraw][sc]sidechaincompress=threshold=0.03:ratio=4:attack=80:release=600[music]`);
    else f.push(`${m}[music]`);
    parts.push('[music]');
  }
  const counts: string[] = [];
  let tag = 0;
  for (const [kind, raw] of cueTimes) {
    const snd = cfg.cues?.[kind];
    if (!snd) { warnings.push(`no sound for cue kind '${kind}' in mix.json: skipped`); continue; }
    const times: number[] = [];
    for (const t of raw.sort((a, b) => a - b)) if (!times.length || t - times[times.length - 1]! > (snd.minGap ?? 0.15)) times.push(t);
    const v = times.filter(inWin).map((t) => t - T0);
    counts.push(`${v.length} ${kind}`);
    if (!v.length) continue;
    const id = `c${tag++}`;
    inputs.push('-i', sound(snd.file));
    const outs = v.map((_, i) => `[${id}_${i}]`);
    f.push(`[${n}:a]${FMT},volume=${snd.db ?? 0}dB${v.length > 1 ? `,asplit=${v.length}${outs.join('')}` : outs[0]}`);
    v.forEach((t, i) => f.push(`[${id}_${i}]adelay=${Math.round(t * 1000)}:all=1[${id}d${i}]`));
    f.push(v.length > 1 ? `${v.map((_, i) => `[${id}d${i}]`).join('')}amix=inputs=${v.length}:normalize=0:duration=longest[${id}]` : `[${id}d0]anull[${id}]`);
    parts.push(`[${id}]`);
    n++;
  }
  // everything summed, padded or cut to the video's length
  const end = `apad,atrim=0:${dur.toFixed(6)},asetpts=PTS-STARTPTS[mixed]`;
  if (!parts.length) f.push(`anullsrc=r=48000:cl=stereo,${end}`);
  else f.push(`${parts.join('')}${parts.length > 1 ? `amix=inputs=${parts.length}:normalize=0:duration=longest,` : ''}${end}`);
  return { inputs, filter: f.join(';'), silent: !parts.length, segments: segs.length, counts, warnings };
}
