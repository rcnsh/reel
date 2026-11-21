import { expect, test } from 'bun:test';
import { norm, Words } from '../src/engine/words';

const W = new Words({
  lines: [
    { text: "Don't stop", start: 1, end: 2, words: [{ w: "Don't", start: 1, end: 1.4 }, { w: 'stop', start: 1.5, end: 2 }] },
    { text: 'The pen writes', start: 3, end: 4.5, words: [{ w: 'The', start: 3, end: 3.2 }, { w: 'pen', start: 3.3, end: 3.6 }, { w: 'writes', start: 3.7, end: 4.5 }] },
  ],
});

test('lines and words are indexed, with typographic quotes', () => {
  expect(W.words.length).toBe(5);
  expect(W.lines[0]!.text).toBe('Don’t stop');
  expect(W.words[0]!.w).toBe('Don’t');
  expect(W.words.map((w) => w.gi)).toEqual([0, 1, 2, 3, 4]);
  expect(W.words[3]).toMatchObject({ line: 1, index: 1 });
});

test('get finds by text with straight or curly quotes, and throws when missing', () => {
  expect(W.get("don't").i).toBe(0);
  expect(W.get('don’t').i).toBe(0);
  expect(W.get('PEN WR').i).toBe(1);
  expect(() => W.get('nowhere')).toThrow("no line of the words contains 'nowhere'");
});

test('get matches an ellipsis and dashes however they are typed', () => {
  const T = new Words({ lines: [
    { text: 'Wait... what', start: 0, end: 1, words: [{ w: 'Wait...', start: 0, end: 0.5 }, { w: 'what', start: 0.5, end: 1 }] },
    { text: 'A pause — then 1–2', start: 1, end: 2, words: [] },
  ] });
  expect(T.lines[0]!.text).toBe('Wait… what');
  expect(T.get('Wait...').i).toBe(0);
  expect(T.get('wait… WHAT').i).toBe(0);
  expect(T.get('pause - then 1-2').i).toBe(1);
  expect(T.get('pause — then 1–2').i).toBe(1);
  expect(T.get('pause—then 1 - 2').i).toBe(1);
  expect(T.get('pause -- then').i).toBe(1);
  expect(W.find('t').length).toBe(2);
});

test('time queries', () => {
  expect(W.lineAt(1.5)?.i).toBe(0);
  expect(W.lineAt(2.5)).toBeNull();
  expect(W.lastLine(2.5)?.i).toBe(0);
  expect(W.nextLine(2.5)?.i).toBe(1);
  expect(W.linesIn(0, 3.1).length).toBe(2);
  expect(W.wordAt(3.4)?.w).toBe('pen');
  expect(W.lastWord(3.65)?.w).toBe('pen');
  expect(W.findWords('Pen')[0]?.gi).toBe(3);
  expect(norm('p(doom)!')).toBe('p(doom)');
});

test('word and line progress', () => {
  const pen = W.words[3]!;
  expect(Words.wordProgress(pen, 3)).toBe(0);
  expect(Words.wordProgress(pen, 3.45)).toBeCloseTo(0.5, 9);
  expect(Words.wordProgress(pen, 9)).toBe(1);
  const line = W.lines[1]!;
  expect(Words.lineCharProgress(line, 2)).toBe(0);
  expect(Words.lineCharProgress(line, 3.25)).toBe(4);
  expect(Words.lineCharProgress(line, 9)).toBe(line.text.length);
  const syl = { ...pen, syl: [[3.3, 3.4], [3.5, 3.6]] as [number, number][] };
  expect(Words.wordProgress(syl, 3.45)).toBe(0.5);
});
