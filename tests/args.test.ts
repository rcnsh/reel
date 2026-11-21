import { expect, test } from 'bun:test';
import { checkScale, COMMANDS, HELP, int, list, num, pageOf, parseCommand, propsOf, readProps, samplesOf, scaleFits, sizeOf, UsageError } from '../cli/args';

test('every command is in the help', () => {
  for (const c of Object.keys(COMMANDS)) expect(HELP).toMatch(new RegExp(`^  ${c}\\b`, 'm'));
});

test('parses a command strictly', () => {
  const p = parseCommand(['still', '--t', '1,2', '--only', 'a', '--json']);
  expect(p).toMatchObject({ mode: 'still', values: { t: '1,2', only: 'a', json: true } });
  expect(() => parseCommand(['still', '--bogus'])).toThrow(UsageError);
  expect(() => parseCommand(['still', '--t'])).toThrow(UsageError);
  expect(() => parseCommand(['still', '--n', '3'])).toThrow("Unknown option '--n'");
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
  expect(samplesOf({ samples: 'auto' }, { REEL_TILE_MASK: 'merge' })).toEqual({ min: 4, max: 324, tol: 3, refine: 'tiles', mask: 'merge' });
  expect(samplesOf({ samples: 'auto' }, {})).toEqual({ min: 4, max: 324, tol: 3, refine: 'tiles' });
  expect(samplesOf({ samples: '4' }, { REEL_TILE_MASK: 'subs' })).toBe(4);
  expect(() => samplesOf({ samples: 'auto' }, { REEL_TILE_MASK: 'tiles' })).toThrow('expected subs or merge');
  expect(() => samplesOf({ samples: '4' }, { REEL_TILE_MASK: 'tiles' })).toThrow('expected subs or merge');
  expect(pageOf({})).toEqual({ scale: 1 });
  expect(pageOf({ size: '1080x1920', fps: '30', scale: '2', only: 'a,b', theme: 'film' })).toEqual({ w: 1080, h: 1920, fps: 30, scale: 2, only: 'a,b', theme: 'film' });
  expect(() => pageOf({ scale: '5' })).toThrow('1 to 4');
  expect(() => pageOf({ fps: '0' })).toThrow('frame rate');
  expect(() => pageOf({ only: 'a,,b' })).toThrow('clip ids');
});

test('a scale that does not pack is refused with a frame size that would', () => {
  for (const s of [1, 2, 3, 4]) expect(scaleFits(1076, 1078, s)).toBe(true);
  expect(scaleFits(1920, 1080, 0.5)).toBe(true);
  expect(scaleFits(1080, 1350, 0.5)).toBe(false);
  expect(() => checkScale(1920, 1080, 0.5)).not.toThrow();
  expect(() => checkScale(1080, 1350, 0.5)).toThrow(UsageError);
  expect(() => checkScale(1080, 1350, 0.5)).toThrow('a 1080x1350 frame would be 540x675');
  expect(() => checkScale(1076, 1078, 0.5)).toThrow('1072x1076 (--size 1072x1076) renders at --scale 0.5');
  expect(scaleFits(1072, 1076, 0.5)).toBe(true);
});

test('--props: inline JSON or a file, a JSON object only, compact in the page options and the URL', () => {
  const read = (f: string) => { if (f === 'p.json') return '\uFEFF{ "title": "Q3" }\n'; if (f === 'bad.json') return '{ "a": 1, }'; throw new Error('ENOENT'); };
  expect(readProps(' { "a": 1 }', read)).toBe('{"a":1}');
  expect(readProps('p.json', read)).toBe('{"title":"Q3"}');
  expect(() => readProps('nope.json', read)).toThrow('neither a JSON object nor a file that can be read (ENOENT)');
  expect(() => readProps('[1]', read)).toThrow('--props [1]: neither a JSON object nor a file');
  expect(readProps('2025', (f) => (f === '2025' ? '{"year":2025}' : '')))
    .toBe('{"year":2025}');
  expect(() => readProps('bad.json', read)).toThrow('--props bad.json: not JSON');
  expect(() => readProps('{"a":', read)).toThrow('--props: not JSON');
  expect(propsOf('{ "title": "Q3", "n": [1, 2] }')).toBe('{"title":"Q3","n":[1,2]}');
  expect(() => propsOf('{"a":')).toThrow(UsageError);
  for (const [t, kind] of [['[1]', 'an array'], ['null', 'null'], ['"x"', 'a string'], ['3', 'a number']]) expect(() => propsOf(t!)).toThrow(`expected a JSON object, got ${kind}`);
  expect(pageOf({ props: '{"a":1}' })).toEqual({ scale: 1, props: '{"a":1}' });
  for (const mode of ['still', 'info', 'video', 'dev', 'check']) expect(parseCommand([mode, '--props', '{}']).values.props).toBe('{}');
});
