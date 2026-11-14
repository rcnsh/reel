#!/usr/bin/env bun
// Sound mix: lays music beds and cue sounds under a rendered video's narration.
//   bun tools/mix.ts <in.mp4> <out.mp4> [--from 0]
// --from is the timeline time the video starts at (the render's --from), so partial renders mix correctly.
// Cues come from data/cues.json (bun scripts/render.ts events): the timeline and every cue() scenes recorded.
// What to lay where comes from mix.json in the project root:
//   {
//     "music": [{ "file": "bed.mp3", "from": "intro", "to": "outro", "db": -17, "fadeIn": 2, "fadeOut": 4 }],
//     "cues":  { "tick": { "file": "tick.mp3", "db": 0, "minGap": 0.15 } },
//     "entryCues": { "turn": ["chapter2", "chapter3"] }
//   }
// music: files in audio/, looped, from the start of entry `from` (default: the video start) to the start of
// entry `to` (default: the video end), ducked while the voice speaks. cues: the sound for each cue kind;
// cues closer than minGap s share one. entryCues: extra cues of that kind at the start of the listed entries.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { $ } from 'bun';

interface Music { file: string; from?: string; to?: string; db?: number; fadeIn?: number; fadeOut?: number }
interface CueSound { file: string; db?: number; minGap?: number }
interface MixConfig { music?: Music[]; cues?: Record<string, CueSound>; entryCues?: Record<string, string[]> }

const ROOT = path.resolve(import.meta.dir, '..');
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1]! : d; };
const [inp, out] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!inp || !out) { console.error('usage: bun tools/mix.ts <in.mp4> <out.mp4> [--from 0]'); process.exit(1); }
const FROM = +opt('from', '0');

const cfgPath = path.join(ROOT, 'mix.json');
const cfg: MixConfig = existsSync(cfgPath) ? await Bun.file(cfgPath).json() : {};
const ev: { duration: number; timeline: { id: string; start: number; end: number }[]; cues: { kind: string; t: number }[] } =
  await Bun.file(path.join(ROOT, 'data/cues.json')).json();
const dur = +(await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${inp}`.text()).trim();
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
  if (e - s > 0.1) segs.push([s - T0, e - T0, m.file, m.db ?? -17, s === a ? m.fadeIn ?? 0.4 : 0, e === b ? m.fadeOut ?? 0.4 : 0]);
}
// the video's own ends fade too (partial renders)
segs.sort((x, y) => x[0] - y[0]);
if (segs.length) { segs[0]![4] ||= 1.5; segs[segs.length - 1]![5] ||= 3.0; }

// cue times per kind, in video time
const inWin = (t: number) => t >= T0 && t < T1 - 0.2;
const cueTimes = new Map<string, number[]>();
for (const c of ev.cues) (cueTimes.get(c.kind) ?? cueTimes.set(c.kind, []).get(c.kind)!).push(c.t);
for (const [kind, ids] of Object.entries(cfg.entryCues ?? {})) for (const id of ids) (cueTimes.get(kind) ?? cueTimes.set(kind, []).get(kind)!).push(entryStart(id));

const inputs: string[] = ['-i', inp];
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
  if (!snd) { console.warn(`no sound for cue kind '${kind}' in mix.json: skipped`); continue; }
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

await $`ffmpeg -hide_banner -loglevel error -y ${inputs} -filter_complex ${f.join(';')} -map 0:v -map [a] -c:v copy -c:a aac -b:a 320k ${out}`;
console.log(`wrote ${out}: ${segs.length} music segments${counts.length ? ', ' + counts.join(', ') : ''}`);
