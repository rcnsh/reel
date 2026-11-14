// Matching a script's words to timed tokens (from a transcriber, an aligner or a voice) and refining their edges. Pure,
// so it is unit-tested.

/** A word as compared: lower case, letters and digits only. */
export const normWord = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export interface ScriptWord { w: string; line: number; s?: number; e?: number }
export interface HeardWord { w: string; s: number; e: number }

/**
 * Give each script word the time of the heard word it matches (edit-distance alignment on normalised tokens: a
 * script word not heard costs 1, an extra heard word 0.5, a substitution 1.2), then share the time between
 * matched neighbours among the unmatched words by length (`start` and `end` bound a run at either end).
 * Fills in `s` and `e` of every word; returns which were matched.
 */
export function alignWords(sw: ScriptWord[], heard: HeardWord[], start: number, end: number): boolean[] {
  const A = sw.map((x) => normWord(x.w)), B = heard.map((x) => normWord(x.w));
  const n = A.length, m = B.length;
  const cost = new Float64Array((n + 1) * (m + 1)), back = new Uint8Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = 1; i <= n; i++) { cost[at(i, 0)] = i; back[at(i, 0)] = 1; }
  for (let j = 1; j <= m; j++) { cost[at(0, j)] = j * 0.5; back[at(0, j)] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const sub = cost[at(i - 1, j - 1)]! + (A[i - 1] === B[j - 1] ? 0 : 1.2);
    const del = cost[at(i - 1, j)]! + 1; // script word not heard
    const ins = cost[at(i, j - 1)]! + 0.5; // extra word heard (a retake, a filler)
    const best = Math.min(sub, del, ins);
    cost[at(i, j)] = best;
    back[at(i, j)] = best === sub ? 0 : best === del ? 1 : 2;
  }
  const matched = new Array<boolean>(n).fill(false);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const b = back[at(i, j)];
    if (i > 0 && j > 0 && b === 0) {
      if (A[i - 1] === B[j - 1]) { sw[i - 1]!.s = heard[j - 1]!.s; sw[i - 1]!.e = heard[j - 1]!.e; matched[i - 1] = true; }
      i--; j--;
    } else if (i > 0 && (j === 0 || b === 1)) i--;
    else j--;
  }
  // unmatched words: share the time between the matched neighbours, by length
  for (let i = 0; i < n;) {
    if (matched[i]) { i++; continue; }
    let k = i;
    while (k < n && !matched[k]) k++;
    const t0 = i > 0 ? sw[i - 1]!.e! : start, t1 = k < n ? sw[k]!.s! : end;
    const len = sw.slice(i, k).map((x) => normWord(x.w).length + 1.5);
    const sum = len.reduce((a, b) => a + b, 0);
    let x = t0;
    for (let q = i; q < k; q++) {
      const d = (len[q - i]! / sum) * Math.max(0, t1 - t0);
      sw[q]!.s = x; sw[q]!.e = x + d * 0.92; x += d;
    }
    i = k;
  }
  return matched;
}

/**
 * Script words timed from tokens timed by a voice or an aligner (their own spelling: "3.5" may come back as "35",
 * punctuation dropped): each script word takes the time of the token it matches, and words with no match share
 * the time between their matched neighbours (`start` and `end` bound the passage).
 */
export function timeScript(script: { w: string }[], tokens: { w: string; start: number; end: number }[], start: number, end: number): { w: string; start: number; end: number }[] {
  const sw: ScriptWord[] = script.map((x) => ({ w: x.w, line: 0 }));
  alignWords(sw, tokens.map((t) => ({ w: t.w, s: t.start, e: t.end })), start, end);
  return sw.map((x) => ({ w: x.w, start: x.s!, end: Math.max(x.e!, x.s!) }));
}

/**
 * Word edges moved onto the pauses in the audio. `db`: levels of 10 ms frames (audio-io's levels); a pause is a
 * run of at least `min` frames 40 dB under the loudest. A start that falls in a pause or up to 80 ms after it
 * moves to the pause's end (where the sound begins); an end up to 80 ms before a pause or inside it moves to the
 * pause's start (the end of the audio is a pause too). Words stay in order and never overlap. Inside continuous
 * speech nothing moves. Aligners place words on a coarse grid (80 ms for
 * Qwen3), so this halves their error at phrase edges, where cuts and reveals land.
 */
export function snapToPauses(words: { w: string; start: number; end: number }[], db: Float32Array, min = 4) {
  let peak = -120;
  for (const v of db) peak = Math.max(peak, v);
  const runs: [number, number][] = [];
  for (let i = 0; i < db.length;) {
    if (db[i]! >= peak - 40) { i++; continue; }
    let j = i;
    while (j < db.length && db[j]! < peak - 40) j++;
    if (j - i >= min || j === db.length) runs.push([i, j]);
    i = j;
  }
  // (the end of the audio counts as a pause)
  runs.push([db.length, Infinity]);
  const out = words.map((w) => {
    const si = Math.round(w.start * 100), ei = Math.round(w.end * 100);
    let start = w.start, end = w.end;
    const rs = runs.find(([a, b]) => b !== Infinity && si >= a - 1 && si <= b + 8);
    if (rs) start = rs[1] / 100;
    const re = runs.find(([a, b]) => ei >= a - 8 && ei <= b + 1 && a / 100 > start);
    if (re) end = re[0] / 100;
    return { w: w.w, start, end: Math.max(end, start + 0.02) };
  });
  // (edges stay in order: a word ends by the time the next begins)
  for (let i = 0; i + 1 < out.length; i++) {
    out[i + 1]!.start = Math.max(out[i + 1]!.start, out[i]!.start);
    out[i]!.end = Math.min(out[i]!.end, out[i + 1]!.start);
    if (out[i]!.end < out[i]!.start) out[i]!.end = out[i]!.start;
  }
  return out;
}

/**
 * Lines whose aligned times hold few of their words in what a transcriber heard there: a forced aligner places
 * every script word somewhere, so a take that skips, repeats or rewords a line shifts words onto the wrong speech
 * without failing. `words` are the script words with the aligner's times (`line` groups them), `heard` a
 * transcription of the same audio. A line is reported when under `min` of its words are heard within `pad` s of its
 * span (lines of fewer than two words are not judged).
 */
export function unheardLines(words: { w: string; line: number; start: number; end: number }[], heard: HeardWord[], min = 0.5, pad = 0.4): { line: number; text: string; share: number; start: number; end: number }[] {
  const out: { line: number; text: string; share: number; start: number; end: number }[] = [];
  for (const line of [...new Set(words.map((w) => w.line))]) {
    const ws = words.filter((w) => w.line === line), toks = ws.map((w) => normWord(w.w)).filter(Boolean);
    if (toks.length < 2) continue;
    const a = ws[0]!.start - pad, b = ws.at(-1)!.end + pad;
    const there = heard.filter((h) => (h.s + h.e) / 2 >= a && (h.s + h.e) / 2 <= b).map((h) => normWord(h.w));
    let found = 0;
    for (const t of toks) { const i = there.indexOf(t); if (i >= 0) { found++; there.splice(i, 1); } }
    const share = found / toks.length;
    if (share < min) out.push({ line, text: ws.map((w) => w.w).join(' '), share, start: ws[0]!.start, end: ws.at(-1)!.end });
  }
  return out;
}
