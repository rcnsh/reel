import { expect, test } from 'bun:test';
import { COMMANDS, HELP, int, list, num, pageOf, parseCommand, samplesOf, sizeOf, UsageError } from '../cli/args';

test('every command is in the help', () => {
  for (const c of Object.keys(COMMANDS)) expect(HELP).toMatch(new RegExp(`^  ${c}\\b`, 'm'));
});

test('parses a command strictly', () => {
  const p = parseCommand(['still', '--t', '1,2', '--only', 'a', '--json']);
  expect(p).toMatchObject({ mode: 'still', values: { t: '1,2', only: 'a', json: true } });
  expect(() => parseCommand(['still', '--bogus'])).toThrow(UsageError);
  expect(() => parseCommand(['still', '--t'])).toThrow(UsageError);
  expect(() => parseCommand(['still', '--n', '3'])).toThrow("Unknown option '--n'"); // a flag of another command
  expect(() => parseCommand(['frobnicate'])).toThrow("unknown command 'frobnicate'");
  expect(() => parseCommand(['still', 'extra'])).toThrow(UsageError);
  expect(parseCommand(['diff', 'a.png', 'b.png']).positionals).toEqual(['a.png', 'b.png']);
  expect(() => parseCommand(['diff', 'a', 'b', 'c'])).toThrow('expected 1 to 2 arguments');
  expect(() => parseCommand(['init'])).toThrow('expected 1 argument');
  expect(parseCommand(['init', '--help']).values.help).toBe(true);
});

test('numbers, lists and sizes', () => {
  expect(num({ x: '2.5' }, 'x', 0)).toBe(2.5);
  expect(num({}, 'x', 7)).toBe(7);
  expect(() => num({ x: 'abc' }, 'x', 0)).toThrow('--x abc: expected a number');
  expect(() => num({ x: '' }, 'x', 0)).toThrow(UsageError);
  expect(int({ n: '3' }, 'n', 1)).toBe(3);
  expect(() => int({ n: '2.5' }, 'n', 1)).toThrow('whole number');
  expect(() => int({ n: '0' }, 'n', 1)).toThrow('at least 1');
  expect(list({ t: '1, 2.5,3' }, 't')).toEqual([1, 2.5, 3]);
  expect(list({}, 't')).toEqual([]);
  expect(() => list({ t: '1,x' }, 't')).toThrow('numbers separated by commas');
  expect(sizeOf('1080x1920')).toEqual([1080, 1920]);
  expect(() => sizeOf('1082x1920')).toThrow(UsageError);
  expect(() => sizeOf('1080x1921')).toThrow(UsageError);
  expect(() => sizeOf('big')).toThrow(UsageError);
});

test('sampling and page options', () => {
  expect(samplesOf({})).toBe(1);
  expect(samplesOf({ samples: '8' })).toBe(8);
  expect(samplesOf({ samples: 'auto' })).toEqual({ min: 4, max: 324, tol: 3, refine: 'tiles' });
  expect(samplesOf({ samples: 'auto', refine: 'frame', 'max-samples': '36' })).toEqual({ min: 4, max: 36, tol: 3, refine: 'frame' });
  expect(() => samplesOf({ samples: 'lots' })).toThrow(UsageError);
  expect(() => samplesOf({ refine: 'tiles' })).toThrow('goes with --samples auto');
  expect(() => samplesOf({ samples: 'auto', refine: 'pixels' })).toThrow('tiles or frame');
  expect(pageOf({})).toEqual({ scale: 1 });
  expect(pageOf({ size: '1080x1920', fps: '30', scale: '2', only: 'a,b', theme: 'film' })).toEqual({ w: 1080, h: 1920, fps: 30, scale: 2, only: 'a,b', theme: 'film' });
  expect(() => pageOf({ scale: '5' })).toThrow('1 to 4');
  expect(() => pageOf({ fps: '0' })).toThrow('frame rate');
  expect(() => pageOf({ only: 'a,,b' })).toThrow('clip ids');
});
