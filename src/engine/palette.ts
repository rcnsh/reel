import { resolveTheme, type ResolvedTheme } from '../themes';
export { glslName } from '../themes';
import { clamp, hexToLinear, linearToHex } from './util';

declare const __REEL_THEME__: ResolvedTheme | undefined;

export const THEME: ResolvedTheme = (() => {
  const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('theme');
  if (q) return resolveTheme(q);
  return typeof __REEL_THEME__ === 'undefined' || !__REEL_THEME__ ? resolveTheme('neutral') : __REEL_THEME__;
})();

export type PaletteKey = string;

export const HEX: Readonly<Record<PaletteKey, string>> = THEME.palette;

const missing = (key: string) => new Error(`palette: the ${THEME.name} theme has no '${key}' (it has ${Object.keys(HEX).join(', ')})`);

export function isColor(c: unknown): c is string {
  return typeof c === 'string' && (/^#[0-9a-f]{6}$/i.test(c) || Object.prototype.hasOwnProperty.call(HEX, c));
}
export function colorLinear(c: string): [number, number, number] {
  return hexToLinear(c.startsWith('#') ? c : HEX[c]!);
}

export const LIN: Readonly<Record<PaletteKey, [number, number, number]>> = new Proxy(
  Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)])) as Record<PaletteKey, [number, number, number]>,
  { get: (o, k) => (typeof k !== 'string' || Object.prototype.hasOwnProperty.call(o, k) || k === 'then' || k === 'toJSON' ? (o as any)[k] : (() => { throw missing(k); })()) },
);

export function linearColor(c: string): [number, number, number] {
  if (Object.prototype.hasOwnProperty.call(HEX, c)) return LIN[c]!;
  if (/^#[0-9a-f]{6}$/i.test(c)) return hexToLinear(c);
  throw new Error(`colour '${c}' is not a key of the ${THEME.name} theme (${Object.keys(HEX).join(', ')}) or a #rrggbb colour`);
}

export function rgba(key: PaletteKey, a = 1): string {
  const hex = Object.prototype.hasOwnProperty.call(HEX, key) ? HEX[key] : key.startsWith('#') ? key : undefined;
  if (!hex) throw missing(key);
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export type MixInput = PaletteKey | readonly [number, number, number];
export type Mixed = {
  lin: [number, number, number];
  hex: string;
  rgba: (a?: number) => string;
};

const toLin = (c: MixInput): [number, number, number] => {
  if (typeof c !== 'string') return [c[0], c[1], c[2]];
  if (Object.prototype.hasOwnProperty.call(HEX, c)) return LIN[c]!;
  if (/^#[0-9a-f]{6}$/i.test(c)) return hexToLinear(c);
  if (c.startsWith('#')) throw new Error(`mixColor: '${c}' is not a #rrggbb colour`);
  throw missing(c);
};

export function mixColor(a: MixInput, b: MixInput, t: number): Mixed {
  const A = toLin(a), B = toLin(b), u = clamp(t);
  const lin = A.map((x, i) => x * (1 - u) + B[i]! * u) as [number, number, number];
  if (lin.some(Number.isNaN)) throw new Error(`mixColor: NaN in the mix (t = ${t})`);
  const hex = linearToHex(lin);
  return { lin, hex, rgba: (al = 1) => rgba(hex, al) };
}

const luma = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export const TONE: { light: 'bg' | 'fg'; dark: 'bg' | 'fg' } = luma(LIN.bg!) >= luma(LIN.fg!) ? { light: 'bg', dark: 'fg' } : { light: 'fg', dark: 'bg' };
