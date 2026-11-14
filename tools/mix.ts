#!/usr/bin/env bun
// Sound mix: lays music beds and cue sounds under a rendered video's narration.
//   reel mix <in.mp4> <out.mp4> [--from 0]
// --from is the timeline time the video starts at (the render's --from), so partial renders mix correctly.
// Cues come from data/cues.json (reel events): the timeline and every cue() scenes recorded.
// What to lay where comes from mix.json in the project root:
//   {
//     "music": [{ "file": "bed.mp3", "from": "intro", "to": "outro", "db": -17, "fadeIn": 2, "fadeOut": 4 }],
//     "cues":  { "tick": { "file": "tick.mp3", "db": 0, "minGap": 0.15 } },
//     "entryCues": { "turn": ["chapter2", "chapter3"] }
//   }
// music: files in audio/, looped, from the start of entry `from` (default: the video start) to the start of
// entry `to` (default: the video end), ducked while the voice speaks. Fades default to 1.5 s in at the video's
// start, 3 s out at its end and 0.4 s elsewhere; a render that cuts a segment fades it at the cut. cues: the sound for each cue kind;
// cues closer than minGap s share one. entryCues: extra cues of that kind at the start of the listed entries.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { $ } from 'bun';
import { buildMix, type Events, type MixConfig } from './mix-graph';

// the project folder: the one `reel` was pointed at, else the current folder
const ROOT = path.resolve(process.env.REEL_PROJECT ?? '.');
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1]! : d; };
const [inp, out] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!inp || !out) { console.error('usage: bun tools/mix.ts <in.mp4> <out.mp4> [--from 0]'); process.exit(1); }
const FROM = +opt('from', '0');

const cfgPath = path.join(ROOT, 'mix.json');
const cfg: MixConfig = existsSync(cfgPath) ? await Bun.file(cfgPath).json() : {};
const ev: Events =
  await Bun.file(path.join(ROOT, 'data/cues.json')).json();
const dur = +(await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${inp}`.text()).trim();
const g = buildMix(cfg, ev, dur, FROM, ROOT);
for (const w of g.warnings) console.warn(w);
const inputs = ['-i', inp, ...g.inputs];

await $`ffmpeg -hide_banner -loglevel error -y ${inputs} -filter_complex ${g.filter} -map 0:v -map [a] -c:v copy -c:a aac -b:a 320k ${out}`;
console.log(`wrote ${out}: ${g.segments} music segments${g.counts.length ? ', ' + g.counts.join(', ') : ''}`);
