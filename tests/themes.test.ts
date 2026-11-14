import { expect, test } from 'bun:test';
import { checkHud, extendTheme, glslName, isThemeName, resolveTheme, themes } from '../src/themes';

const base = { bg: '#000', fg: '#fff', accent: '#f00' };

test('every built-in theme resolves', () => {
  for (const name of Object.keys(themes)) {
    const t = resolveTheme(name);
    expect(t.name).toBe(name);
    for (const k of ['bg', 'fg', 'accent', 'accentHi', 'accentLo']) expect(t.palette[k]).toMatch(/^#[0-9A-F]{6}$/);
  }
  expect(resolveTheme('print').palette.bg).toBe('#EEE9DF');
  expect(resolveTheme('film').overlay).toEqual({ marks: true, fly: 0 });
});

test('aliases, short hex and derived accents', () => {
  const t = resolveTheme({ palette: { ...base, paper: '#eee', bg: 'paper', note: 'paper' } });
  expect(t.palette.bg).toBe('#EEEEEE');
  expect(t.palette.note).toBe('#EEEEEE');
  expect(t.palette.accentHi).toBe('#FF4D4D');
  expect(t.palette.accentLo).toBe('#990000');
  expect(t.name).toBe('custom');
});

test('bad palettes are errors that name the problem', () => {
  expect(() => resolveTheme({ palette: { bg: '#000', fg: '#fff' } })).toThrow("'accent' is required");
  expect(() => resolveTheme({ palette: { ...base, a: 'b', b: 'a' } })).toThrow('is a loop');
  expect(() => resolveTheme({ palette: { ...base, x: 'nope' } })).toThrow("'x' is 'nope'");
  expect(() => resolveTheme({ palette: { ...base, Bad: '#000' } })).toThrow('identifier');
  expect(() => resolveTheme({ palette: { ...base, aB: '#000', a_b: '#111' } })).toThrow();
  expect(() => resolveTheme({ palette: base, post: { glow: 1 } as never })).toThrow("unknown parameter 'glow'");
  expect(() => resolveTheme({ palette: base, post: { shake: [1] } as never })).toThrow('not a number');
  expect(() => resolveTheme('sepia')).toThrow("theme 'sepia'");
});

test('names and keys never resolve through Object.prototype', () => {
  expect(isThemeName('constructor')).toBe(false);
  expect(() => resolveTheme('constructor')).toThrow("theme 'constructor'");
  expect(() => resolveTheme({ palette: { ...base, fg: 'toString' } })).toThrow("'fg' is 'toString'");
  const palette: Record<string, string> = resolveTheme({ palette: { ...base, constructor: '#123456' } }).palette;
  expect(palette['constructor']).toBe('#123456');
});

test('extendTheme merges palette and post, replaces the overlay, re-derives a new accent', () => {
  const t = extendTheme('print', { palette: { accent: '#1F6F5C' }, post: { grain: 0 } });
  const r = resolveTheme(t);
  expect(r.palette.accent).toBe('#1F6F5C');
  expect(r.palette.accentHi).not.toBe(resolveTheme('print').palette.accentHi);
  expect(r.post.grain).toBe(0);
  expect(r.post.vignette).toBe(themes.print.post!.vignette);
  expect(resolveTheme(extendTheme('film', {})).overlay).toEqual({ marks: true, fly: 0 });
  expect(resolveTheme(extendTheme('film', { overlay: false })).overlay).toBeNull();
  expect(resolveTheme(extendTheme('print', { palette: { accent: '#00f', accentHi: '#88f' } })).palette.accentHi).toBe('#8888FF');
});

test('overlays are checked', () => {
  expect(() => checkHud({ marks: true, fly: 0.5, tone: 'dark', caption: { fig: 'A', text: 'b' } }, 'x')).not.toThrow();
  expect(() => checkHud({ mark: true }, 'theme overlay')).toThrow("unknown key 'mark'");
  expect(() => checkHud({ caption: 'Fig 1' }, 'x')).toThrow('caption');
  expect(() => checkHud({ tone: 'grey' }, 'x')).toThrow('tone');
  expect(() => resolveTheme({ palette: base, overlay: { marks: 'yes' } as never })).toThrow('marks');
});

test('glslName', () => {
  expect(glslName('accentHi')).toBe('C_ACCENT_HI');
  expect(glslName('ink2')).toBe('C_INK2');
});
