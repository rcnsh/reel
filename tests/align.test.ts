import { expect, test } from 'bun:test';
import { alignWords, normWord, unheardLines, type ScriptWord } from '../tools/align-words';

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
