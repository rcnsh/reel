// `reel subtitles`: SRT and VTT from the project's timed words (data/words.json). Each line of the words becomes one
// or more cues of at most two lines of MAX characters and SPAN seconds, broken where a reader pauses; `reel video
// --subtitles` adds the SRT to the finished file as a soft track. The cue building is pure, so it is unit-tested.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

export interface Cue { start: number; end: number; lines: string[] }
interface W { w: string; start: number; end: number }

/** Characters per subtitle line, seconds a cue may last at most and at least, and seconds it holds after its last word. */
export const LIMITS = { max: 42, span: 7, min: 1, hold: 0.4, gap: 0.04 };

/** Text broken into at most two lines of `max` characters, balanced, preferring a break after punctuation. */
export function breakLines(text: string, max = LIMITS.max): string[] {
  if (text.length <= max) return [text];
  const words = text.split(' ');
  let best = 1, score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const over = Math.max(0, a.length - max) + Math.max(0, b.length - max);
    const s = over * 100 + Math.abs(a.length - b.length) - (/[,;:.!?]$/.test(words[i - 1]!) ? 12 : 0);
    if (s < score) { score = s; best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

/**
 * Cues from timed lines: each line's words in runs that fit two lines of `max` characters and `span` seconds,
 * a run ending early after a word that closes a clause when it is already long; each cue from its first word to
 * `hold` after its last, at least `min` long, ending `gap` before the next one.
 */
export function buildCues(lines: { words: W[] }[], o = LIMITS): Cue[] {
  const runs: W[][] = [];
  for (const l of lines) {
    let cur: W[] = [];
    for (const w of l.words) {
      const text = [...cur, w].map((x) => x.w).join(' ');
      if (cur.length && (text.length > o.max * 2 || w.end - cur[0]!.start > o.span)) { runs.push(cur); cur = []; }
      cur.push(w);
      const len = cur.map((x) => x.w).join(' ').length;
      if (/[,;:.!?]$/.test(w.w) && len > o.max * 1.2 && w !== l.words.at(-1)) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
  }
  const cues = runs.map((r) => ({ start: r[0]!.start, end: Math.max(r.at(-1)!.end + o.hold, r[0]!.start + o.min), lines: breakLines(r.map((x) => x.w).join(' '), o.max) }));
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < cues.length; i++) cues[i]!.end = Math.min(cues[i]!.end, cues[i + 1]!.start - o.gap);
  return cues.filter((c) => c.end > c.start);
}

/** Cues of a render from `from` to `to`: shifted to its start, cut at its ends. */
export function window(cues: Cue[], from = 0, to = Infinity): Cue[] {
  return cues.filter((c) => c.end > from && c.start < to).map((c) => ({ ...c, start: Math.max(0, c.start - from), end: Math.min(to, c.end) - from }));
}

const stamp = (t: number, sep: string) => {
  const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`;
};
export const toSrt = (cues: Cue[]) => cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.lines.join('\n')}\n`).join('\n');
export const toVtt = (cues: Cue[]) => `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.lines.join('\n')}\n`).join('\n')}`;

/** Write <out>/subtitles.srt and .vtt (default out/subtitles in the project) from data/words.json. */
export function writeSubtitles(root: string, o: { from?: number; to?: number; out?: string } = {}) {
  const f = path.join(root, 'data/words.json');
  if (!existsSync(f)) throw new Error(`${f} is missing: subtitles come from the timed words (reel narrate or reel align)`);
  const lines = (JSON.parse(readFileSync(f, 'utf8')) as { lines: { words: W[] }[] }).lines;
  const cues = window(buildCues(lines), o.from ?? 0, o.to ?? Infinity);
  if (!cues.length) throw new Error('no timed words in the range: nothing to subtitle');
  const dir = o.out ?? path.join(root, 'out/subtitles');
  mkdirSync(dir, { recursive: true });
  const srt = path.join(dir, 'subtitles.srt'), vtt = path.join(dir, 'subtitles.vtt');
  writeFileSync(srt, toSrt(cues));
  writeFileSync(vtt, toVtt(cues));
  return { srt, vtt, cues: cues.length };
}

if (import.meta.main) {
  let a;
  try {
    a = parseArgs({ args: process.argv.slice(2), strict: true, options: { out: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  } catch (e) { console.error(`reel subtitles: ${(e as Error).message}`); process.exit(2); }
  if (a.values.help) {
    console.log(`reel subtitles [--out out/subtitles] [--from 0] [--to <end>]: SRT and VTT of the timed words (data/words.json),
cues of at most two lines of ${LIMITS.max} characters and ${LIMITS.span} s; --from/--to match a partial render. reel video --subtitles adds them to the
finished file as a soft track.`);
    process.exit(0);
  }
  try {
    const r = writeSubtitles(path.resolve(process.env.REEL_PROJECT ?? '.'), { out: a.values.out && path.resolve(a.values.out), from: a.values.from ? Number(a.values.from) : undefined, to: a.values.to ? Number(a.values.to) : undefined });
    console.log(`${r.srt}\n${r.vtt}\n${r.cues} cues`);
  } catch (e) { console.error(`reel subtitles: ${(e as Error).message}`); process.exit(1); }
}
