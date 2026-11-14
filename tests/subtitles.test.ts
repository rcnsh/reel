import { expect, test } from 'bun:test';
import { breakLines, buildCues, toSrt, toVtt, window } from '../tools/subtitles';

const words = (text: string, t0: number, per = 0.3) => text.split(' ').map((w, i) => ({ w, start: t0 + i * per, end: t0 + i * per + per * 0.9 }));

test('lines break balanced, after punctuation when it is near the middle', () => {
  expect(breakLines('Short line.')).toEqual(['Short line.']);
  const l = breakLines('Every frame is a function of time, and the export is the same as the preview');
  expect(l.length).toBe(2);
  for (const x of l) expect(x.length).toBeLessThanOrEqual(42);
  expect(l[0]).toBe('Every frame is a function of time,');
});

test('cues fit two lines and seven seconds, hold a little, never overlap, and last at least a second', () => {
  const cues = buildCues([{ words: words('One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty.', 1) }, { words: words('Hi.', 9) }]);
  for (const c of cues) { expect(c.lines.length).toBeLessThanOrEqual(2); for (const l of c.lines) expect(l.length).toBeLessThanOrEqual(42); }
  for (let i = 0; i + 1 < cues.length; i++) expect(cues[i]!.end).toBeLessThanOrEqual(cues[i + 1]!.start - 0.04 + 1e-9);
  const last = cues.at(-1)!;
  expect(last.lines).toEqual(['Hi.']);
  expect(last.end - last.start).toBeCloseTo(1, 6);
  expect(cues.map((c) => c.lines.join(' ')).join(' ').split(' ').length).toBe(21);
});

test('a window shifts cues to the render and drops the rest; SRT and VTT stamps', () => {
  const cues = [{ start: 1, end: 2.5, lines: ['a'] }, { start: 3, end: 4, lines: ['b', 'c'] }, { start: 10, end: 11, lines: ['d'] }];
  const w = window(cues, 2, 5);
  expect(w).toEqual([{ start: 0, end: 0.5, lines: ['a'] }, { start: 1, end: 2, lines: ['b', 'c'] }]);
  expect(toSrt(w)).toBe('1\n00:00:00,000 --> 00:00:00,500\na\n\n2\n00:00:01,000 --> 00:00:02,000\nb\nc\n');
  expect(() => window(cues, 5, 2)).toThrow('empty range');
  expect(toVtt([{ start: 3725.5, end: 3726, lines: ['x'] }])).toBe('WEBVTT\n\n01:02:05.500 --> 01:02:06.000\nx\n');
});

test('a run whose words cannot break into two lines of 42 is cut, and no cue has an empty line', () => {
  const cues = buildCues([{ words: words('The quick brown fox jumps over the lazy dog while the farmer watches from the porch and sips his coffee slowly', 0) }]);
  for (const c of cues) for (const l of c.lines) { expect(l.length).toBeLessThanOrEqual(42); expect(l.length).toBeGreaterThan(0); }
  // one long CJK word breaks between characters; one long Latin word stays whole
  expect(breakLines('一二三四五六七八九十'.repeat(5))).toEqual(['一二三四五六七八九十'.repeat(2) + '一二三四五', '六七八九十' + '一二三四五六七八九十'.repeat(2)]);
  expect(breakLines('x'.repeat(50))).toEqual(['x'.repeat(50)]);
});
