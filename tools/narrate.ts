// `reel narrate`: narration.txt to a voice and word times. Each plate is voiced as one passage, trimmed,
// brought to -16 LUFS and timed (by the voice's own timestamps where it has them, else by the forced aligner),
// then cached in audio/.narration/ under a key of its text and the voice, so re-running after an edit voices only
// the plates that changed. Writes audio/narration.flac, data/words.json and data/audio.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { forcedAlign, refine } from './aligner';
import { decode, normalize, trimSilence, writeAudio } from './audio-io';
import { report, writeNarration, type PlateAudio } from './narration-files';
import { parseScript, plateText, plateWords } from './script';
import { DEFAULTS, plateKey, resolveSettings } from './settings';
import { SOURCES, voiceOf, type SynthRequest } from './voices';
import { loadConfig } from '../cli/server';

export const NARRATE_HELP = `reel narrate [flags]: voice narration.txt and time every word

Each plate (a '# name' header and its lines) is voiced as one passage and cached: a plate whose text, voice,
speed, model and language are unchanged is not voiced again. Writes audio/narration.flac (the track), data/words.json
(every word with its time) and data/audio.json (one section per plate). Settings come from \`narration\` in
reel.config.ts, overridden by these flags.

  --voice <source[:arg]>  default ${DEFAULTS.voice}
${Object.values(SOURCES).map((s) => `      ${s.about}`).join('\n')}
  --speed 1               speaking rate (0.5 to 2)
  --model <id>            a hosted voice's model
  --lead 0.6              seconds before the first word
  --hold 0.85             seconds at least between plates
  --tail 1.6              seconds after the last word
  --language English      the script's language, for the forced aligner
  --force                 voice every plate again
  --project <folder>      the project (default: the current folder)

Hosted voices are opt-in: text leaves the machine only for elevenlabs (ELEVENLABS_API_KEY) or fish (FISH_API_KEY).
Kokoro and the forced aligner run locally on Apple Silicon (MLX) and fetch their models on first use.`;

const LOUDNESS = { integrated: -16, truePeak: -1.5 };

if (import.meta.main) {
  let a;
  try {
    a = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: false, options: { voice: { type: 'string' }, speed: { type: 'string' }, model: { type: 'string' }, lead: { type: 'string' }, hold: { type: 'string' }, tail: { type: 'string' }, language: { type: 'string' }, force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  } catch (e) { console.error(`reel narrate: ${(e as Error).message} (reel narrate --help)`); process.exit(2); }
  if (a.values.help) { console.log(NARRATE_HELP); process.exit(0); }
  try {
    const root = path.resolve(process.env.REEL_PROJECT ?? '.');
    console.log(await narrate(root, a.values));
  } catch (e) { console.error(`reel narrate: ${(e as Error).message}`); process.exit(1); }
}

export async function narrate(root: string, flags: Record<string, string | boolean | undefined>) {
  const scriptFile = path.join(root, 'narration.txt');
  if (!existsSync(scriptFile)) throw new Error(`${scriptFile} is missing (plates: '# name' headers, each followed by its lines)`);
  const plates = parseScript(readFileSync(scriptFile, 'utf8'), scriptFile);
  const s = resolveSettings((await loadConfig(root)).narration, flags);
  const voice = voiceOf(s.voice);
  const cache = path.join(root, 'audio/.narration'), work = path.join(cache, 'work');
  mkdirSync(work, { recursive: true });

  const keys = plates.map((p) => plateKey(voice.id, s, plateText(p)));
  const file = (k: number) => path.join(cache, `${plates[k]!.name}-${keys[k]}`);
  const parts: (PlateAudio | null)[] = plates.map(() => null);
  const todo: number[] = [];
  for (let k = 0; k < plates.length; k++) {
    if (!flags.force && existsSync(`${file(k)}.flac`) && existsSync(`${file(k)}.json`)) parts[k] = { pcm: await decode(`${file(k)}.flac`), words: JSON.parse(readFileSync(`${file(k)}.json`, 'utf8')) };
    else todo.push(k);
  }
  if (todo.length) {
    const reqs: SynthRequest[] = todo.map((k) => ({ text: plateText(plates[k]!), previous: plates[k - 1] && plateText(plates[k - 1]!), next: plates[k + 1] && plateText(plates[k + 1]!), speed: s.speed, model: s.model }));
    const speech = await voice.synth(reqs, work);
    const toAlign: { k: number; pcm: Float32Array }[] = [];
    for (const [i, k] of todo.entries()) {
      const sp = speech[i]!;
      const trimmed = trimSilence(await normalize(await decode(sp.file), LOUDNESS, path.join(work, `n${k}`)));
      if (!trimmed.pcm.length) throw new Error(`plate '${plates[k]!.name}': the voice returned silence`);
      if (sp.words?.length) parts[k] = { pcm: trimmed.pcm, words: refine(plateWords(plates[k]!), sp.words.map((w) => ({ w: w.w, start: w.start - trimmed.offset, end: w.end - trimmed.offset })), trimmed.pcm) };
      else toAlign.push({ k, pcm: trimmed.pcm });
    }
    if (toAlign.length) {
      const timed = await forcedAlign(toAlign.map((x) => ({ pcm: x.pcm, words: plateWords(plates[x.k]!) })), path.join(work, 'align'), s.language);
      toAlign.forEach((x, i) => (parts[x.k] = { pcm: x.pcm, words: timed[i]! }));
    }
    for (const k of todo) {
      await writeAudio(parts[k]!.pcm, `${file(k)}.flac`);
      writeFileSync(`${file(k)}.json`, JSON.stringify(parts[k]!.words));
    }
  }
  // (cached plates no longer in the script, or voiced differently, are removed)
  const keep = new Set(plates.flatMap((_, k) => [`${path.basename(file(k))}.flac`, `${path.basename(file(k))}.json`]));
  for (const f of readdirSync(cache)) if (f !== 'work' && !keep.has(f)) rmSync(path.join(cache, f), { force: true });
  rmSync(work, { recursive: true, force: true });

  const timed = voice.id.startsWith('kokoro') || voice.id.startsWith('elevenlabs') ? 'the voice\'s timestamps' : 'Qwen3-ForcedAligner';
  const r = await writeNarration(root, plates, parts as PlateAudio[], s, `voice ${voice.id}, speed ${s.speed}; word times from ${timed}, snapped to pauses`);
  return `${report(r)}\n${todo.length} of ${plates.length} plate${plates.length === 1 ? '' : 's'} voiced (${voice.id}), ${plates.length - todo.length} from the cache`;
}

