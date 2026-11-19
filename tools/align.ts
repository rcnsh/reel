// `reel align <recording | folder>`: re-time the video to a real voice. The script is known, so its words are
// force-aligned to the audio (Qwen3-ForcedAligner) rather than transcribed; `--method whisper` transcribes
// with Whisper and matches the words heard to the script instead, for a reading that departs from it. Writes the
// same files as `reel narrate`: audio/narration.flac, data/words.json, data/audio.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { forcedAlign, refine } from './aligner';
import { unheardLines } from './align-words';
import { decode, levels, normalize, SR, trimSilence, writeAudio } from './audio-io';
import { report, writeNarration, type PlateAudio } from './narration-files';
import { parseScript, plateWords, type Plate, type TimedWord } from './script';
import { DEFAULTS, resolveSettings } from './settings';
import { run } from '../cli/children';
import { loadConfig } from '../cli/server';

export const ALIGN_HELP = `reel align <recording | folder> [flags]: time narration.txt to a voice recording

<recording> is one take reading narration.txt top to bottom (any format ffmpeg reads); <folder> holds one file
per plate, named after its header (intro.m4a, setup.wav, …). The take is cleaned (high-pass, -16 LUFS), its
words timed, and the plates laid out with the pauses below. Writes audio/narration.flac, data/words.json and
data/audio.json, like reel narrate.

  --method qwen|whisper   qwen (default): force-align the script's words (Qwen3-ForcedAligner, through MLX
                          on Apple Silicon, PyTorch elsewhere; the model, about 1.2 GB, is fetched on first use). whisper: transcribe
                          (faster-whisper small.en) and match the words heard to the script, for a reading
                          that departs from it; less precise
  --lead ${DEFAULTS.lead}              seconds before the first word
  --hold ${DEFAULTS.hold}             seconds at least between plates (silence is added at a quiet point)
  --tail ${DEFAULTS.tail}              seconds after the last word
  --language English      the script's language (qwen)
  --no-verify             skip the check that each line's words are heard where they were placed (qwen:
                          a faster-whisper transcription; a take that skips, repeats or rewords a line is
                          aligned anyway, so a line heard elsewhere is a warning and the command exits 1)
  --project <folder>      the project (default: the current folder)

Settings also come from \`narration\` in reel.config.ts.`;

const CLEAN = 'highpass=f=70';
const LOUDNESS = { integrated: -16, truePeak: -1.5 };

if (import.meta.main) {
  let a;
  try {
    a = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: true, options: { method: { type: 'string' }, lead: { type: 'string' }, hold: { type: 'string' }, tail: { type: 'string' }, language: { type: 'string' }, 'no-verify': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  } catch (e) { console.error(`reel align: ${(e as Error).message} (reel align --help)`); process.exit(2); }
  if (a.values.help) { console.log(ALIGN_HELP); process.exit(0); }
  if (a.positionals.length !== 1) { console.error('reel align: expected one recording or folder (reel align --help)'); process.exit(2); }
  const method = a.values.method ?? 'qwen';
  if (method !== 'qwen' && method !== 'whisper') { console.error(`reel align: --method ${method}: expected qwen or whisper`); process.exit(2); }
  try {
    const r = await align(path.resolve(process.env.REEL_PROJECT ?? '.'), path.resolve(a.positionals[0]!), method, a.values);
    console.log(r.summary);
    for (const w of r.warnings) console.error(`warning: ${w}`);
    if (r.warnings.length) process.exit(1);
  } catch (e) { console.error(`reel align: ${(e as Error).message}`); process.exit(1); }
}

export async function align(root: string, src: string, method: 'qwen' | 'whisper', flags: Record<string, string | boolean | undefined>) {
  if (!existsSync(src)) throw new Error(`${src}: no such file or folder`);
  const scriptFile = path.join(root, 'narration.txt');
  if (!existsSync(scriptFile)) throw new Error(`${scriptFile} is missing`);
  const plates = parseScript(readFileSync(scriptFile, 'utf8'), scriptFile);
  const s = resolveSettings((await loadConfig(root)).narration, flags);
  const work = path.join(root, 'audio/.align');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  // a recording, high-passed, at -16 LUFS, without the silence at its ends
  const load = async (f: string, k: string) => {
    const o = path.join(work, `${k}.f32.wav`);
    await run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', f, '-af', CLEAN, '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_f32le', o]);
    return trimSilence(await normalize(await decode(o), LOUDNESS, path.join(work, k)), SR, -45, 0.05).pcm;
  };

  let parts: PlateAudio[];
  const warnings: string[] = [];
  // (every recording is transcribed by one Whisper process, so its model loads once)
  const verify = async (checks: { pcm: Float32Array; words: TimedWord[]; ps: Plate[] }[]) => {
    if (method !== 'qwen' || flags['no-verify']) return;
    const heard = await transcribe(checks.map((c) => ({ pcm: c.pcm, script: '' })), work, 'v');
    for (const [k, { words, ps }] of checks.entries()) {
      const lines = ps.flatMap((p) => p.lines.map((_, li) => `${p.name}:${li}`));
      const sw = ps.flatMap((p) => plateWords(p).map((w) => lines.indexOf(`${p.name}:${w.line}`)));
      const bad = unheardLines(words.map((w, i) => ({ ...w, line: sw[i]! })), heard[k]!.map((h) => ({ w: h.w, s: h.start, e: h.end })));
      for (const b of bad) warnings.push(`'${b.text}' (${b.start.toFixed(2)} to ${b.end.toFixed(2)} s${ps.length > 1 ? ' of the take' : ` of ${ps[0]!.name}`}): only ${Math.round(b.share * 100)}% of its words are heard there. The recording may skip, repeat or reword it; fix the recording or narration.txt and align again (--method whisper follows a reading that departs from the script)`);
    }
  };
  if (statSync(src).isDirectory()) {
    const files = readdirSync(src);
    const pcms = await Promise.all(plates.map(async (p, k) => {
      const f = files.find((x) => path.parse(x).name === p.name);
      if (!f) throw new Error(`no recording for plate '${p.name}' in ${src} (files are named after the plates: ${p.name}.wav, …)`);
      return load(path.join(src, f), `p${k}`);
    }));
    const timed = await timeWords(pcms.map((pcm, k) => ({ pcm, words: plateWords(plates[k]!) })), method, work, s.language);
    parts = pcms.map((pcm, k) => ({ pcm, words: timed[k]! }));
    await verify(parts.map((p, k) => ({ ...p, ps: [plates[k]!] })));
  } else {
    const pcm = await load(src, 'take');
    const all = plates.flatMap((p) => plateWords(p));
    const [words] = await timeWords([{ pcm, words: all }], method, work, s.language);
    await verify([{ pcm, words: words!, ps: plates }]);
    parts = splitPlates(plates, pcm, words!);
  }
  rmSync(work, { recursive: true, force: true });
  const how = method === 'qwen' ? 'Qwen3-ForcedAligner' : 'faster-whisper small.en matched to the script';
  const r = await writeNarration(root, plates, parts, s, `recording ${path.basename(src)}; word times from ${how}, snapped to pauses`);
  return { summary: report(r), warnings };
}

/** Times of each passage's script words: force-aligned, or transcribed with Whisper and matched. */
async function timeWords(passages: { pcm: Float32Array; words: { w: string }[] }[], method: 'qwen' | 'whisper', work: string, language: string): Promise<TimedWord[][]> {
  if (method === 'qwen') return forcedAlign(passages, path.join(work, 'fa'), language);
  const heard = await transcribe(passages.map((p) => ({ pcm: p.pcm, script: p.words.map((x) => x.w).join(' ') })), work, 'wh');
  return passages.map((p, i) => refine(p.words, heard[i]!, p.pcm));
}

/**
 * What faster-whisper (small.en) hears in each recording, figures joined; a recording's `script` primes its
 * vocabulary. One process for all of them, so the model loads once.
 */
async function transcribe(items: { pcm: Float32Array; script: string }[], work: string, name: string): Promise<TimedWord[][]> {
  const jobs = await Promise.all(items.map(async (it, i) => {
    const w48 = path.join(work, `${name}${i}.f32.wav`), w16 = path.join(work, `${name}${i}.wav`);
    await writeAudio(it.pcm, w48);
    await run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', w48, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', w16]);
    return { audio: w16, out: path.join(work, `${name}${i}.json`), script: it.script };
  }));
  const jf = path.join(work, `${name}-jobs.json`);
  await Bun.write(jf, JSON.stringify(jobs));
  const r = await run(['uv', 'run', '-q', '--with', 'faster-whisper==1.2.1', '--with', 'numpy', 'python', path.join(import.meta.dir, 'whisper_words.py'), jf], { stdout: 'inherit', nothrow: true });
  if (r.exitCode !== 0) throw new Error(`whisper failed:\n${r.stderr.slice(-1500)}`);
  return jobs.map((j) => joinFigures(JSON.parse(readFileSync(j.out, 'utf8'))));
}

/** Whisper splits figures ("152" ",000", "2" ".06"): join them back into one word. */
export function joinFigures(heard: { w: string; s: number; e: number }[]): TimedWord[] {
  const out: TimedWord[] = [];
  for (const h of heard) {
    const prev = out.at(-1);
    if (prev && /^[,.]\d/.test(h.w) && /\d$/.test(prev.w)) { prev.w += h.w; prev.end = h.e; }
    else out.push({ w: h.w, start: h.s, end: h.e });
  }
  return out;
}

/**
 * One take cut into plates: each cut at the quietest 20 ms in the gap between one plate's last word and the
 * next one's first, so it never falls in a breath or a word; each part's words re-timed from its start.
 */
export function splitPlates(plates: Plate[], pcm: Float32Array, words: TimedWord[]): PlateAudio[] {
  const db = levels(pcm, SR, 0.005);
  const counts = plates.map((p) => plateWords(p).length);
  const cuts = [0];
  let i = 0;
  for (let k = 0; k + 1 < plates.length; k++) {
    i += counts[k]!;
    const a = words[i - 1]!.end, b = words[i]!.start;
    let best = a, lo = Infinity;
    for (let t = a; t + 0.02 <= b; t += 0.005) {
      const f = Math.round(t / 0.005), v = Math.max(db[f] ?? -120, db[f + 1] ?? -120, db[f + 2] ?? -120, db[f + 3] ?? -120);
      if (v < lo - 0.5) { lo = v; best = t + 0.01; }
    }
    cuts.push(Math.round(best * SR));
  }
  cuts.push(pcm.length);
  let w0 = 0;
  return plates.map((_, k) => {
    const t0 = cuts[k]! / SR, ws = words.slice(w0, w0 + counts[k]!).map((w) => ({ w: w.w, start: w.start - t0, end: w.end - t0 }));
    w0 += counts[k]!;
    return { pcm: pcm.slice(cuts[k]!, cuts[k + 1]!), words: ws };
  });
}
