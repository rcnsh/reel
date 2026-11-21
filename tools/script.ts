
export interface Plate { name: string; lines: string[] }

export interface TimedWord { w: string; start: number; end: number }

export interface TimedLine { i: number; plate: string; text: string; start: number; end: number; words: TimedWord[] }

export interface Section { name: string; start: number; end: number }

export function parseScript(text: string, file = 'narration.txt'): Plate[] {
  const plates: Plate[] = [];
  text.split('\n').forEach((raw, n) => {
    const l = raw.trim();
    if (!l || l.startsWith('//')) return;
    if (l.startsWith('#')) {
      const name = l.replace(/^#+/, '').trim();
      if (!/^[A-Za-z0-9][\w-]*$/.test(name)) throw new Error(`${file}:${n + 1}: plate name '${name}' must be letters, digits, - and _ (it names a scene file)`);
      if (plates.some((p) => p.name === name)) throw new Error(`${file}:${n + 1}: plate '${name}' appears twice`);
      plates.push({ name, lines: [] });
    } else {
      if (!plates.length) throw new Error(`${file}:${n + 1}: text before the first '# name' header`);
      plates.at(-1)!.lines.push(l.replace(/\s+/g, ' '));
    }
  });
  if (!plates.length) throw new Error(`${file}: no plates (a plate is a '# name' header and its lines)`);
  for (const p of plates) if (!p.lines.length) throw new Error(`${file}: plate '${p.name}' has no lines`);
  return plates;
}

export const plateText = (p: Plate) => p.lines.join(' ');

export const plateWords = (p: Plate) => p.lines.flatMap((text, line) => text.split(' ').map((w) => ({ w, line })));

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function timing(plates: Plate[], words: TimedWord[][], duration: number, cutLead = 0.25): { lines: TimedLine[]; sections: Section[] } {
  const lines: TimedLine[] = [];
  plates.forEach((p, k) => {
    const pw = plateWords(p), ws = words[k]!;
    if (ws.length !== pw.length) throw new Error(`plate '${p.name}': ${ws.length} timed words for ${pw.length} script words`);
    p.lines.forEach((text, li) => {
      const own = ws.filter((_, j) => pw[j]!.line === li).map((w) => ({ w: w.w, start: r3(w.start), end: r3(w.end) }));
      lines.push({ i: lines.length, plate: p.name, text, start: own[0]!.start, end: own.at(-1)!.end, words: own });
    });
  });
  const sections: Section[] = plates.map((p, k) => {
    const first = lines.find((l) => l.plate === p.name)!;
    const prevEnd = k > 0 ? lines.filter((l) => l.plate === plates[k - 1]!.name).at(-1)!.end : 0;
    return { name: p.name, start: k === 0 ? 0 : r3(Math.max(prevEnd + 0.05, first.start - cutLead)), end: 0 };
  });
  sections.forEach((s, i) => (s.end = i < sections.length - 1 ? sections[i + 1]!.start : r3(duration)));
  return { lines, sections };
}

export function narrationAudioJSON(duration: number, sections: Section[], track: string, notes: string) {
  const bpm = 100, period = 60 / bpm, beats: number[] = [];
  for (let b = 0; b * period < duration; b++) beats.push(r3(b * period));
  return {
    duration: r3(duration), bpm, beat_period: period, time_signature: 4, beats, downbeats: beats.filter((_, i) => i % 4 === 0),
    sections, fps: 100, features: {}, onsets: {}, track, notes,
  };
}
