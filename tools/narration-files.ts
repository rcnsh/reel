// Writing a timed narration: the plates' audio laid end to end with the pauses asked for, as the project's track
// (audio/narration.flac, lossless) with data/words.json and data/audio.json. What `reel narrate` and
// `reel align` both end with.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SR, writeAudio } from './audio-io';
import { narrationAudioJSON, timing, type Plate, type TimedWord } from './script';

/** The narration's track, relative to the project. */
export const TRACK = 'audio/narration.flac';

/** Pauses in seconds: before the first word, between plates, and after the last word. */
export interface Pauses { lead: number; hold: number; tail: number }

/** A plate's audio (mono, at SR) and its script words' times within it. */
export interface PlateAudio { pcm: Float32Array; words: TimedWord[] }

/**
 * The plates laid end to end: `lead` seconds before the first word, at least `hold` between one plate's last word
 * and the next one's first (silence a part already has at its ends counts), `tail` after the last word, with
 * 10 ms fades where parts meet. Pure: returns the samples and every word in video time.
 */
export function assemble(parts: PlateAudio[], p: Pauses): { pcm: Float32Array; words: TimedWord[][]; duration: number } {
  const F = Math.round(0.01 * SR);
  const gaps = parts.map((part, k) => {
    const head = part.words[0]!.start;
    if (k === 0) return Math.max(0, p.lead - head);
    const prev = parts[k - 1]!, prevTail = prev.pcm.length / SR - prev.words.at(-1)!.end;
    return Math.max(0, p.hold - prevTail - head);
  });
  const last = parts.at(-1)!, tail = Math.max(0, p.tail - (last.pcm.length / SR - last.words.at(-1)!.end));
  const lens = gaps.map((g) => Math.round(g * SR));
  const n = parts.reduce((a, part, k) => a + lens[k]! + part.pcm.length, 0) + Math.round(tail * SR);
  const pcm = new Float32Array(n), words: TimedWord[][] = [];
  let o = 0;
  parts.forEach((part, k) => {
    o += lens[k]!;
    const seg = part.pcm.slice();
    for (let i = 0; i < F && i < seg.length; i++) { seg[i]! *= i / F; seg[seg.length - 1 - i]! *= i / F; }
    pcm.set(seg, o);
    const t0 = o / SR;
    words.push(part.words.map((w) => ({ w: w.w, start: t0 + w.start, end: t0 + w.end })));
    o += seg.length;
  });
  return { pcm, words, duration: n / SR };
}

/** Assemble the plates and write the track, data/words.json and data/audio.json. Returns what was written. */
export async function writeNarration(root: string, plates: Plate[], parts: PlateAudio[], pauses: Pauses, notes: string) {
  const a = assemble(parts, pauses);
  const { lines, sections } = timing(plates, a.words, a.duration);
  mkdirSync(path.join(root, 'audio'), { recursive: true });
  mkdirSync(path.join(root, 'data'), { recursive: true });
  await writeAudio(a.pcm, path.join(root, TRACK));
  writeFileSync(path.join(root, 'data/words.json'), JSON.stringify({ lines, notes }, null, 1) + '\n');
  writeFileSync(path.join(root, 'data/audio.json'), JSON.stringify(narrationAudioJSON(a.duration, sections, TRACK, notes), null, 1) + '\n');
  return { duration: a.duration, lines, sections };
}

/** A summary of the timing for the terminal: each plate's span. */
export function report(r: { duration: number; lines: unknown[]; sections: { name: string; start: number; end: number }[] }) {
  const out = [`duration ${r.duration.toFixed(2)} s, ${r.lines.length} lines`];
  for (const s of r.sections) out.push(`  ${s.name.padEnd(12)} ${s.start.toFixed(2).padStart(7)} to ${s.end.toFixed(2).padStart(7)}  (${(s.end - s.start).toFixed(2)} s)`);
  return out.join('\n');
}
