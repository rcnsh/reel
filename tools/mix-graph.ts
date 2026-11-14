// The sound mix's ffmpeg filter graph (tools/mix.ts): pure, so it is unit-tested.
import path from 'node:path';

export interface Music { file: string; from?: string; to?: string; db?: number; fadeIn?: number; fadeOut?: number }
export interface CueSound { file: string; db?: number; minGap?: number }
export interface MixConfig { music?: Music[]; cues?: Record<string, CueSound>; entryCues?: Record<string, string[]> }

export interface Events { duration: number; timeline: { id: string; start: number; end: number }[]; cues: { kind: string; t: number }[] }

/**
 * The inputs and filter graph that lay `cfg`'s music and cue sounds under a video of `dur` seconds that starts at
 * timeline time `from`, its own audio being input 0 (`inputs` are the ffmpeg arguments after it). Files are in
 * `root`/audio. `counts`: cues laid per kind;
 * `warnings`: cue kinds with no sound in mix.json.
 */
export function buildMix(cfg: MixConfig, ev: Events, dur: number, from: number, root: string) {
  const FROM = from, ROOT = root;
  const warnings: string[] = [];
  const T0 = FROM, T1 = FROM + dur;
  const entryStart = (id: string) => {
    const e = ev.timeline.find((x) => x.id === id);
    if (!e) throw new Error(`mix.json: no timeline entry '${id}'`);
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

  const inputs: string[] = []; // (after the video, which is input 0)
  const f: string[] = [];
  let n = 1;
  const mus: string[] = [];
  segs.forEach(([s, e, file, db, fi, fo], k) => {
    inputs.push('-stream_loop', '-1', '-i', path.join(ROOT, 'audio', file));
    const L = e - s;
    let c = `[${n}:a]atrim=0:${L.toFixed(3)},asetpts=PTS-STARTPTS,volume=${db}dB`;
    if (fi) c += `,afade=t=in:d=${fi}`;
    if (fo) c += `,afade=t=out:st=${(L - fo).toFixed(3)}:d=${fo}`;
    c += `,adelay=${Math.round(s * 1000)}:all=1[m${k}]`;
    f.push(c); mus.push(`[m${k}]`); n++;
  });
  // the voice also drives the music's ducking (sidechain), so it is split only when there is music
  f.push(mus.length ? `[0:a]asplit=2[voice][sc]` : `[0:a]anull[voice]`);
  if (mus.length) {
    f.push(`${mus.join('')}amix=inputs=${mus.length}:normalize=0:duration=longest[mraw]`);
    f.push(`[mraw][sc]sidechaincompress=threshold=0.03:ratio=4:attack=80:release=600[music]`);
  }
  const parts: string[] = ['[voice]'];
  if (mus.length) parts.push('[music]');
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
    inputs.push('-i', path.join(ROOT, 'audio', snd.file));
    const outs = v.map((_, i) => `[${id}_${i}]`);
    f.push(`[${n}:a]volume=${snd.db ?? 0}dB,asplit=${v.length}${outs.join('')}`);
    v.forEach((t, i) => f.push(`[${id}_${i}]adelay=${Math.round(t * 1000)}:all=1[${id}d${i}]`));
    f.push(`${v.map((_, i) => `[${id}d${i}]`).join('')}amix=inputs=${v.length}:normalize=0:duration=longest[${id}]`);
    parts.push(`[${id}]`);
    n++;
  }
  f.push(`${parts.join('')}amix=inputs=${parts.length}:normalize=0:duration=first,alimiter=limit=0.95[a]`);
  return { inputs, filter: f.join(';'), segments: segs.length, counts, warnings };
}
