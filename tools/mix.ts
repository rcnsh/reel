// `reel mix <in.mp4> <out.mp4> [--from 0]`: the finished sound under a rendered video. The project's track (the
// narration, or a song) is read from its lossless file rather than from the render, music beds and cue sounds are
// laid with it, and the sum is brought to a loudness target in two passes (EBU R128: measure, then a linear gain
// under a true-peak ceiling) and encoded once, in the output container's codec (AAC in MP4, 24-bit PCM in MOV, Opus
// in WebM). The picture is copied. `reel video --mix` runs this after
// rendering, so one command makes the finished file.
//
// mix.json in the project root says what to lay where (every key optional):
//   {
//     "music": [{ "file": "bed.flac", "from": "intro", "to": "outro", "db": -17, "fadeIn": 2, "fadeOut": 4 }],
//     "cues":  { "tick": { "file": "tick.wav", "db": 0, "minGap": 0.15 } },
//     "entryCues": { "whoosh": ["chapter2", "chapter3"] },
//     "loudness": { "integrated": -14, "truePeak": -1, "lra": 11 },
//     "voiceDb": 0
//   }
// Files are in the project's audio/ folder, or one of the cue sounds the engine ships in sounds/ (tick, click, pop,
// whoosh, swell, impact) by name: "file": "whoosh". A cue kind named after one of those needs no entry (it plays at
// -6 dB). music: looped, from the start of clip `from` (default: the video start) to the start of clip
// `to` (default: the video end), ducked while the track sounds. Fades default to 1.5 s in at the video's start, 3 s
// out at its end and 0.4 s elsewhere; a render that cuts a segment fades it at the cut. cues: the sound for each cue
// kind (data/cues.json, from `reel events`, holds the times scenes asked for); cues closer than minGap s share one.
// entryCues: extra cues of that kind at the start of the listed clips. loudness: the target (false: none, and a
// limiter at -0.4 dBFS instead). --from is the timeline time the video starts at (the render's --from).
// Sounds on the timeline (the config's `sounds` and a scene's sound(), also in data/cues.json) are laid as they say:
// from their file's `from`, at their `at`, for their `duration`, looped, at their speed, gain and fades.
import { $ } from 'bun';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { durationOf, measure } from './audio-io';
import { loudnessTarget, loudnormFilter, parseLoudnorm } from './loudness';
import { buildMix, type Events, type MixConfig } from './mix-graph';

export const MIX_HELP = `reel mix <in.mp4> <out.mp4> [--from 0]: the finished sound under a render

Lays the project's track (narration or song, from its lossless file), the music beds and cue sounds of mix.json
(cues from data/cues.json: run \`reel events\` first) and brings the sum to the loudness target (default -14 LUFS
integrated, -1 dBTP; \`loudness\` in mix.json), encoded once (AAC in .mp4, PCM in .mov, Opus in .webm); the
picture is copied. --from is the render's
--from. \`reel video --mix\` renders and mixes in one go. The format of mix.json: the comment in tools/mix.ts.`;

if (import.meta.main) {
  let a;
  try {
    a = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: true, options: { from: { type: 'string' }, subtitles: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  } catch (e) { console.error(`reel mix: ${(e as Error).message} (reel mix --help)`); process.exit(2); }
  if (a.values.help) { console.log(MIX_HELP); process.exit(0); }
  if (a.positionals.length !== 2) { console.error('reel mix: expected <in.mp4> <out.mp4> (reel mix --help)'); process.exit(2); }
  const from = Number(a.values.from ?? 0);
  if (!(from >= 0)) { console.error(`reel mix: --from ${a.values.from}: expected seconds`); process.exit(2); }
  try {
    const r = await mixVideo({ root: path.resolve(process.env.REEL_PROJECT ?? '.'), input: path.resolve(a.positionals[0]!), output: path.resolve(a.positionals[1]!), from, subtitles: a.values.subtitles });
    for (const w of r.warnings) console.error(`warning: ${w}`);
    console.log(r.summary);
  } catch (e) { console.error(`reel mix: ${(e as Error).message}`); process.exit(1); }
}

export interface MixOptions {
  root: string;
  input: string;
  output: string;
  /** The timeline time the video starts at. */
  from?: number;
  /** The clips and cues (default: data/cues.json). */
  events?: Events;
  /** A subtitle file (.srt or .vtt) to add as a soft track. */
  subtitles?: string;
}

/** The cue sounds the engine ships (tools/make_sounds.ts): tick, click, pop, whoosh, swell, impact. */
export function bundledDir() { return path.join(import.meta.dir, '..', 'sounds'); }
export function bundledSounds() { return readdirSync(bundledDir()).filter((f) => f.endsWith('.wav')).map((f) => f.slice(0, -4)); }

/**
 * A sound file named in mix.json or by a sound on the timeline: a path in the project, else in its audio/ folder,
 * else one of the engine's bundled sounds by name.
 */
export function soundFile(root: string, file: string) {
  for (const f of [path.join(root, file), path.join(root, 'audio', file)]) if (path.resolve(f).startsWith(root + path.sep) && existsSync(f) && statSync(f).isFile()) return f;
  const name = file.replace(/^reel:/, '').replace(/\.wav$/, '');
  if (bundledSounds().includes(name)) return path.join(bundledDir(), `${name}.wav`);
  throw new Error(`mix.json names ${file}, which is not in ${path.join(root, 'audio')} nor one of the bundled sounds (${bundledSounds().join(', ')})`);
}

/** The project's track (data/audio.json `track`), or null for a silent video. */
export function projectTrack(root: string): string | null {
  const f = path.join(root, 'data/audio.json');
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, 'utf8')) as { track?: string; duration?: number };
  const t = j.track ?? (j.duration ? 'audio/narration.flac' : null);
  return t && existsSync(path.join(root, t)) ? path.join(root, t) : null;
}

/**
 * How a finished file's container carries the mix and subtitles: AAC in MP4, 24-bit PCM in MOV (an editing
 * master), Opus and WebVTT in WebM. Throws for a container that carries no sound.
 */
export function containerOf(file: string): { audio: string[]; subtitles: string; flags: string[] } {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.mp4' || ext === '.m4v') return { audio: ['-c:a', 'aac', '-b:a', '320k'], subtitles: 'mov_text', flags: ['-movflags', '+faststart'] };
  if (ext === '.mov') return { audio: ['-c:a', 'pcm_s24le'], subtitles: 'mov_text', flags: ['-movflags', '+faststart'] };
  if (ext === '.webm') return { audio: ['-c:a', 'libopus', '-b:a', '256k'], subtitles: 'webvtt', flags: [] };
  throw new Error(`${file}: the mix goes into an .mp4, .mov or .webm (a ${ext || 'file without extension'} carries no sound)`);
}

export async function mixVideo(o: MixOptions) {
  const { root, input, output } = o, from = o.from ?? 0;
  if (!existsSync(input)) throw new Error(`${input}: no such file (the rendered video to mix under)`);
  containerOf(output);
  const cfgPath = path.join(root, 'mix.json');
  const cfg: MixConfig = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
  const target = loudnessTarget(cfg.loudness);
  let ev = o.events;
  if (!ev) {
    const cuesPath = path.join(root, 'data/cues.json');
    if (!existsSync(cuesPath)) throw new Error(`${cuesPath} is missing: run \`reel events\` first (it writes the clips and the scenes' cues)`);
    ev = JSON.parse(readFileSync(cuesPath, 'utf8')) as Events;
  }
  // (a cue kind named after a bundled sound needs no entry in mix.json)
  const bundled = bundledSounds();
  for (const c of ev.cues) if (!cfg.cues?.[c.kind] && bundled.includes(c.kind)) cfg.cues = { ...cfg.cues, [c.kind]: { file: c.kind, db: -6 } };
  const dur = await durationOf(input);
  const track = projectTrack(root);
  // the timeline's sounds: each file must hold sound, and its length is needed where a sound plays to its end
  const lengths = new Map<string, number>();
  for (const s of ev.sounds ?? []) {
    const f = soundFile(root, s.file);
    if (lengths.has(f)) continue;
    const r = await $`ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 ${f}`.quiet().nothrow();
    if (r.exitCode !== 0 || !r.stdout.toString().trim()) throw new Error(`the sound '${s.file}' (at ${s.at} s) has no audio stream`);
    lengths.set(f, await durationOf(f));
  }
  const g = buildMix(cfg, ev, dur, from, track, (f) => soundFile(root, f), (f) => lengths.get(f) ?? Infinity);
  const ins = ['-i', input, ...g.inputs];
  // (one thread through the filters: amix and the sidechain then see their inputs' frames in the same order every
  // run, so the same project mixes to the same samples)
  const det = ['-nostdin', '-hide_banner', '-filter_complex_threads', '1', '-threads', '1'];
  let tail = '[mixed]anull[a]';
  if (!g.silent && target) {
    const r = await $`ffmpeg ${det} ${ins} -filter_complex ${`${g.filter};[mixed]loudnorm=I=${target.integrated}:TP=${target.truePeak}:LRA=${target.lra ?? 11}:print_format=json[a]`} -map [a] -f null -`.quiet().nothrow();
    if (r.exitCode !== 0) throw new Error(`ffmpeg (measuring the mix): ${r.stderr.toString().slice(-1200)}`);
    tail = `[mixed]${loudnormFilter(target, parseLoudnorm(r.stderr.toString()))}[a]`;
  } else if (!g.silent) tail = '[mixed]alimiter=limit=0.955:level=false[a]';
  const subs = o.subtitles ? ['-i', o.subtitles] : [];
  const box = containerOf(output);
  const subMap = o.subtitles ? ['-map', `${ins.filter((x) => x === '-i').length}:s`, '-c:s', box.subtitles, '-metadata:s:s:0', 'language=eng'] : [];
  const r = await $`ffmpeg ${det} -loglevel error -y ${ins} ${subs} -filter_complex ${`${g.filter};${tail}`} -map 0:v -c:v copy -map [a] ${box.audio} -ar 48000 ${subMap} -fflags +bitexact -flags:a +bitexact ${box.flags} ${output}`.quiet().nothrow();
  if (r.exitCode !== 0) throw new Error(`ffmpeg (the mix): ${r.stderr.toString().slice(-1200)}`);
  const loud = g.silent ? null : await measure(output);
  const what = [track ? `the track (${path.basename(track)})` : 'no track', `${g.segments} music segment${g.segments === 1 ? '' : 's'}`, ...g.counts].join(', ');
  return {
    file: output, warnings: g.warnings, silent: g.silent, loudness: loud && { integrated: +loud.integrated.toFixed(1), truePeak: +loud.truePeak.toFixed(1), lra: +loud.lra.toFixed(1) },
    summary: `wrote ${output}: ${what}${loud ? `; ${loud.integrated.toFixed(1)} LUFS integrated, true peak ${loud.truePeak.toFixed(1)} dBTP, range ${loud.lra.toFixed(1)} LU` : '; silent'}`,
  };
}
