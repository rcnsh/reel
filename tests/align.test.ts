import { expect, test } from 'bun:test';
import { $ } from 'bun';
import path from 'node:path';
import { splitPlates } from '../tools/align';
import { alignWords, normWord, unheardLines, type ScriptWord } from '../tools/align-words';
import { SR } from '../tools/audio-io';
import { parseScript } from '../tools/script';

const script = (text: string): ScriptWord[] => text.split(' ').map((w) => ({ w, line: 0 }));

test('normWord', () => {
  expect(normWord('Don’t,')).toBe('dont');
  expect(normWord('152,000')).toBe('152000');
});

test('matched words take the times heard', () => {
  const sw = script('The pen writes');
  const m = alignWords(sw, [{ w: 'the', s: 1, e: 1.2 }, { w: 'pen', s: 1.3, e: 1.6 }, { w: 'writes.', s: 1.7, e: 2.2 }], 0.6, 5);
  expect(m).toEqual([true, true, true]);
  expect(sw.map((x) => [x.s, x.e])).toEqual([[1, 1.2], [1.3, 1.6], [1.7, 2.2]]);
});

test('a filler heard and a word misheard: neighbours keep their times, the misheard one shares the gap', () => {
  const sw = script('one two three');
  const m = alignWords(sw, [{ w: 'one', s: 1, e: 1.2 }, { w: 'um', s: 1.3, e: 1.4 }, { w: 'too', s: 1.5, e: 1.8 }, { w: 'three', s: 2, e: 2.3 }], 0.6, 5);
  expect(m).toEqual([true, false, true]);
  expect(sw[1]!.s).toBe(1.2);
  expect(sw[1]!.e).toBeCloseTo(1.2 + 0.8 * 0.92, 9); // the whole gap to 'three', 8% left as a pause
  expect(sw[2]!.s).toBe(2);
});

test('nothing heard: the words share the span by length', () => {
  const sw = script('a bbbb');
  alignWords(sw, [], 1, 2);
  expect(sw[0]!.s).toBe(1);
  expect(sw[1]!.s).toBeCloseTo(1 + 2.5 / 8, 9); // lengths + 1.5: 2.5 and 5.5
  expect(sw[1]!.e).toBeCloseTo(sw[1]!.s! + (5.5 / 8) * 0.92, 9);
});

test('unheardLines finds a line the aligner placed on other speech (a skipped line)', () => {
  // the take says line 0, then line 2 twice; the aligner put line 1 on the first reading of line 2
  const at = (text: string, line: number, t0: number) => text.split(' ').map((w, i) => ({ w, line, start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.25 }));
  const words = [...at('The river runs north', 0, 0), ...at('It carries snow down', 1, 2), ...at('Farmers wait for floods', 2, 4)];
  const heard = [...at('the river runs north', 0, 0), ...at('farmers wait for floods', 0, 2), ...at('farmers wait for floods', 0, 4)].map((x) => ({ w: x.w, s: x.start, e: x.end }));
  const bad = unheardLines(words, heard);
  expect(bad.map((b) => b.line)).toEqual([1]);
  expect(bad[0]!.share).toBe(0);
});

test('splitPlates cuts a take at the quietest point between plates and re-times each part from its start', () => {
  const plates = parseScript('# a\nOne two.\n# b\nThree.');
  // 3 s: speech 0.2-0.8 and 1.8-2.4, quiet noise between, true silence only at 1.25-1.35
  const pcm = new Float32Array(3 * SR).map((_, n) => {
    const t = n / SR;
    if ((t >= 0.2 && t < 0.8) || (t >= 1.8 && t < 2.4)) return 0.5 * Math.sin(n / 10);
    return t >= 1.25 && t < 1.35 ? 0 : 0.003 * Math.sin(n / 3);
  });
  const words = [{ w: 'One', start: 0.2, end: 0.4 }, { w: 'two.', start: 0.5, end: 0.8 }, { w: 'Three.', start: 1.8, end: 2.4 }];
  const [a, b] = splitPlates(plates, pcm, words);
  const cut = a!.pcm.length / SR;
  expect(cut).toBeGreaterThan(1.25);
  expect(cut).toBeLessThan(1.35);
  expect(a!.pcm.length + b!.pcm.length).toBe(pcm.length);
  expect(a!.words).toEqual(words.slice(0, 2));
  expect(b!.words[0]!.w).toBe('Three.');
  expect(b!.words[0]!.start).toBeCloseTo(1.8 - cut, 9);
  expect(b!.words[0]!.end).toBeCloseTo(2.4 - cut, 9);
});

// forced_align.py's long-audio windows, against a fake aligner that knows where every word truly is (the samples
// hold their own time, so it can tell which part of the take it was given): each word comes back once, in order, at
// its true time. Needs uv (numpy, no model); skipped without it.
const uv = Bun.which('uv');
test.skipIf(!uv)('forced_align windows a long take: every word once, in order, at its time', async () => {
  const py = `
import sys, numpy as np
sys.path.insert(0, sys.argv[1])
import forced_align as fa
SR, N, STEP = fa.SR, 400, 0.6  # 400 words, one every 0.6 s: a 240 s take, four 60 s windows and then some
class Item:
    def __init__(s, text, a, b): s.text, s.start_time, s.end_time = text, a, b
class Fake:
    def align(s, audio, text, language):
        t0 = float(audio[0])
        return [Item(w, int(w[1:]) * STEP - t0, int(w[1:]) * STEP + 0.4 - t0) for w in text.split()]
audio = (np.arange(int(N * STEP * SR)) / SR).astype(np.float64)
out = fa.align(Fake(), audio, " ".join(f"w{i}" for i in range(N)))
assert [o["w"] for o in out] == [f"w{i}" for i in range(N)], [o["w"] for o in out][:50]
assert all(abs(o["start"] - i * STEP) <= 1 / SR for i, o in enumerate(out))  # (a window starts on a whole sample)
print("ok", len(out))
`;
  const r = await $`uv run -q --no-project --with numpy python -B -c ${py} ${path.join(import.meta.dir, '../tools')}`.nothrow().quiet();
  expect(r.stderr.toString()).toBe('');
  expect(r.stdout.toString().trim()).toBe('ok 400');
}, 120_000);
