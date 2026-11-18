// The palette: the project's theme's named colours (src/themes.ts). The CLI resolves the theme from the
// project's config and the dev server hands it to the page as __REEL_THEME__, a compile-time constant, so it
// is in place before any module runs: GLSL gets every key as a C_<KEY> constant (glsl/common.ts) baked into
// shader strings at import time. Every theme has `bg`, `fg`, `accent`, `accentHi` and `accentLo`; the rest
// are the theme's own.
import { resolveTheme, type ResolvedTheme } from '../themes';
export { glslName } from '../themes';
import { hexToLinear } from './util';

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

/** Linear RGB triplets for GL uniforms (a key the theme lacks throws). */
export const LIN: Readonly<Record<PaletteKey, [number, number, number]>> = new Proxy(
  Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)])) as Record<PaletteKey, [number, number, number]>,
  { get: (o, k) => (typeof k !== 'string' || Object.prototype.hasOwnProperty.call(o, k) || k === 'then' || k === 'toJSON' ? (o as any)[k] : (() => { throw missing(k); })()) },
);

/** Linear RGB for GL from a palette key or a '#rrggbb' colour (anything else throws). */
export function linearColor(c: string): [number, number, number] {
  if (Object.prototype.hasOwnProperty.call(HEX, c)) return LIN[c]!;
  if (/^#[0-9a-f]{6}$/i.test(c)) return hexToLinear(c);
  throw new Error(`colour '${c}' is not a key of the ${THEME.name} theme (${Object.keys(HEX).join(', ')}) or a #rrggbb colour`);
}

/** CSS rgba() for Canvas2D: a palette key, or a '#rrggbb' colour. */
export function rgba(key: PaletteKey, a = 1): string {
  const hex = Object.prototype.hasOwnProperty.call(HEX, key) ? HEX[key] : key.startsWith('#') ? key : undefined;
  if (!hex) throw missing(key);
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const luma = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** Which of `bg` and `fg` is the light colour and which the dark one (the flash, the HUD and the heat ramp use them). */
export const TONE: { light: 'bg' | 'fg'; dark: 'bg' | 'fg' } = luma(LIN.bg!) >= luma(LIN.fg!) ? { light: 'bg', dark: 'fg' } : { light: 'fg', dark: 'bg' };
