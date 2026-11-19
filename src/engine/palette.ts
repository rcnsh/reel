// The palette: the project's theme's named colours (src/themes.ts). The CLI resolves the theme from the
// project's config and the dev server hands it to the page as __REEL_THEME__, a compile-time constant, so it
// is in place before any module runs: GLSL gets every key as a C_<KEY> constant (glsl/common.ts) baked into
// shader strings at import time. Every theme has `bg`, `fg`, `accent`, `accentHi` and `accentLo`; the rest
// are the theme's own.
import { resolveTheme, type ResolvedTheme } from '../themes';
export { glslName } from '../themes';
import { clamp, hexToLinear, linearToHex } from './util';

declare const __REEL_THEME__: ResolvedTheme | undefined;

/**
 * The project's theme, resolved: a built-in theme named by the page URL (`?theme=film`, what `--theme` sets), else
 * the config's (without a dev server, e.g. under bun: `neutral`).
 */
export const THEME: ResolvedTheme = (() => {
  const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('theme');
  if (q) return resolveTheme(q);
  return typeof __REEL_THEME__ === 'undefined' || !__REEL_THEME__ ? resolveTheme('neutral') : __REEL_THEME__;
})();

/** A palette key: `bg`, `fg`, `accent`, `accentHi`, `accentLo`, or one the theme adds. */
export type PaletteKey = string;

/** '#RRGGBB' per key. */
export const HEX: Readonly<Record<PaletteKey, string>> = THEME.palette;

const missing = (key: string) => new Error(`palette: the ${THEME.name} theme has no '${key}' (it has ${Object.keys(HEX).join(', ')})`);

/** Whether `c` names a colour: '#rrggbb' or a key of the theme's palette. */
export function isColor(c: unknown): c is string {
  return typeof c === 'string' && (/^#[0-9a-f]{6}$/i.test(c) || Object.prototype.hasOwnProperty.call(HEX, c));
}
/** A colour named as '#rrggbb' or a palette key, linear. */
export function colorLinear(c: string): [number, number, number] {
  return hexToLinear(c.startsWith('#') ? c : HEX[c]!);
}

/** Linear RGB triplets for GL uniforms (a key the theme lacks throws). */
export const LIN: Readonly<Record<PaletteKey, [number, number, number]>> = new Proxy(
  Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)])) as Record<PaletteKey, [number, number, number]>,
  { get: (o, k) => (typeof k !== 'string' || Object.prototype.hasOwnProperty.call(o, k) || k === 'then' || k === 'toJSON' ? (o as any)[k] : (() => { throw missing(k); })()) },
);

/** CSS rgba() for Canvas2D: a palette key, or a '#rrggbb' colour. */
export function rgba(key: PaletteKey, a = 1): string {
  const hex = Object.prototype.hasOwnProperty.call(HEX, key) ? HEX[key] : key.startsWith('#') ? key : undefined;
  if (!hex) throw missing(key);
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** A colour to mix: a palette key, a '#rrggbb' colour, or a linear RGB triplet. */
export type MixInput = PaletteKey | readonly [number, number, number];
/** A mixed colour in each form its consumers take. */
export type Mixed = {
  /** Linear RGB, for GL uniforms and LineBatch colours. */
  lin: [number, number, number];
  /** '#rrggbb' (sRGB, 8 bits), for HTML and CSS. */
  hex: string;
  /** CSS rgba() with an alpha, for Canvas2D and HTML. */
  rgba: (a?: number) => string;
};

const toLin = (c: MixInput): [number, number, number] => {
  if (typeof c !== 'string') return [c[0], c[1], c[2]];
  if (Object.prototype.hasOwnProperty.call(HEX, c)) return LIN[c]!;
  if (/^#[0-9a-f]{6}$/i.test(c)) return hexToLinear(c);
  if (c.startsWith('#')) throw new Error(`mixColor: '${c}' is not a #rrggbb colour`);
  throw missing(c);
};

/**
 * Mix two colours in linear light (`t` 0 gives a, 1 gives b, clamped), the way the GPU blends, so a fade between two
 * colours does not dip dark in the middle as a mix of sRGB values does.
 */
export function mixColor(a: MixInput, b: MixInput, t: number): Mixed {
  const A = toLin(a), B = toLin(b), u = clamp(t);
  const lin = A.map((x, i) => x * (1 - u) + B[i]! * u) as [number, number, number];
  if (lin.some(Number.isNaN)) throw new Error(`mixColor: NaN in the mix (t = ${t})`);
  const hex = linearToHex(lin);
  return { lin, hex, rgba: (al = 1) => rgba(hex, al) };
}

const luma = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** Which of `bg` and `fg` is the light colour and which the dark one (the flash, the HUD and the heat ramp use them). */
export const TONE: { light: 'bg' | 'fg'; dark: 'bg' | 'fg' } = luma(LIN.bg!) >= luma(LIN.fg!) ? { light: 'bg', dark: 'fg' } : { light: 'fg', dark: 'bg' };
