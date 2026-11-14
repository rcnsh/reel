// Matching a script's words to the words a transcriber heard: what tools/align.ts times a recording with. Pure,
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
