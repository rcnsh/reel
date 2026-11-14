// Themes: the look a project picks with `theme` in reel.config.ts. A theme is plain data (the CLI reads and
// resolves it outside the browser and hands the page the result as __REEL_THEME__, see cli/server.ts): the
// palette scenes and the engine colour with, the default post-processing, and an optional overlay (the HUD
// scene, `reel/scenes/hud`, placed over the whole video on a track above every clip).
import type { PostParams } from './engine/post';

/** Params of the HUD scene (`reel/scenes/hud`): as a theme's overlay, or on a clip of your own. */
export interface HudParams {
  /** Crop marks in the corners. */
  marks?: boolean;
  /** Seconds the marks take to fly in at the clip's start and out at its end (default 0.8; 0: always in place). */
  fly?: number;
  /** A caption bottom right, revealed from the clip's start and faded out at its end: a small label and a line. */
  caption?: { fig?: string; text: string };
  /** Draw for a light or a dark picture (default: the theme's `bg`). */
  tone?: 'light' | 'dark';
}

export interface Theme {
  /**
   * Named colours: '#rrggbb' (or '#rgb'), or the name of another key in the palette. Keys are identifiers
   * (`accent`, `ink2`, `accentHi`); scenes get each as `LIN.<key>`, `rgba('<key>')` and GLSL `C_<KEY>`
   * (camelCase becomes C_ACCENT_HI). Required: `bg` (the background), `fg` (text and line work on it) and
   * `accent`. The engine also reads `accentHi` and `accentLo` (a lighter and a darker accent: the spark and
   * the heat ramp), which default to the accent mixed toward white and black.
   */
  palette: Record<string, string>;
  /** Default post-processing (scene and clip overrides win). Unset values are neutral: no grain, glow or vignette. */
  post?: Partial<PostParams>;
  /** The HUD scene over the whole video, with these params; false or unset: none. */
  overlay?: HudParams | false;
}

export type ThemeName = 'print' | 'film' | 'neutral';

/** A theme as the page gets it: every colour a #rrggbb, the required keys present. */
export interface ResolvedTheme {
  name: string;
  palette: Record<string, string>;
  post: Partial<PostParams>;
  overlay: HudParams | null;
}

/** The named colours `print` and `film` share (they swap which is the background). */
const INKS = {
  ink: '#16161A', // darkest
  ink2: '#1C1C21', // a step up from ink
  graphite: '#6B6760', // secondary text, gridlines
  ash: '#9C978F', // muted text on dark
  bone: '#EEE9DF', // lightest
  paper: '#EEE9DF', // paper background
  rule: '#C9C2B4', // hairlines and rules on paper
  signal: '#C8301E', // the accent
  ember: '#E0563F', // a lighter accent
  blood: '#8E1F12', // a darker accent
};

export const themes: Record<ThemeName, Theme> = {
  /** Ink on paper, no glow, faint grain, vignette and chromatic aberration. */
  print: {
    palette: { bg: 'paper', fg: 'ink', accent: 'signal', accentHi: 'ember', accentLo: 'blood', ...INKS },
    post: { bloom: 0, bloomThreshold: 1.2, bloomKnee: 0.3, bloomRadius: 0.5, halation: 0, ca: 0.25, grain: 0.028, vignette: 0.16 },
  },
  /** Upstream pdoom-video's dark cinematic grade: bloom, red-orange halation, chromatic aberration, heavy grain and vignette, crop marks. */
  film: {
    palette: { bg: 'ink', fg: 'bone', accent: 'signal', accentHi: 'ember', accentLo: 'blood', ...INKS },
    post: { bloom: 0.55, bloomThreshold: 0.85, bloomKnee: 0.5, bloomRadius: 0.75, halation: 0.25, ca: 1.2, grain: 0.055, vignette: 0.35 },
    overlay: { marks: true, fly: 0 },
  },
  /** Clean: neutral greys and one blue accent, no grain, vignette, aberration or overlay. */
  neutral: {
    palette: { bg: '#F4F4F2', fg: '#17171A', accent: '#2F6BFF', surface: '#FFFFFF', muted: '#6F6F73', line: '#D5D5D2' },
    post: {},
  },
};

/**
 * A theme built on another: palette and post merged over the base's, overlay replaced when given. A new
 * `accent` without its own `accentHi`/`accentLo` drops the base's, so they are derived from the new accent.
 */
export function extendTheme(base: ThemeName | Theme, over: Partial<Theme>): Theme {
  const b = typeof base === 'string' ? themeByName(base) : base;
  const palette = { ...b.palette, ...over.palette };
  if (over.palette && has(over.palette, 'accent')) for (const k of ['accentHi', 'accentLo']) if (!has(over.palette, k)) delete palette[k];
  return {
    palette,
    post: { ...b.post, ...over.post },
    overlay: over.overlay !== undefined ? over.overlay : b.overlay,
  };
}

/** Own keys only: a theme name or palette key such as 'constructor' must not find Object.prototype. */
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Whether `name` is a built-in theme. */
export const isThemeName = (name: string): name is ThemeName => has(themes, name);

function themeByName(name: string): Theme {
  const t = isThemeName(name) ? themes[name] : undefined;
  if (!t) throw new Error(`theme '${name}': expected ${Object.keys(themes).join(', ')} or a theme object`);
  return t;
}

const POST_KEYS = ['exposure', 'bloom', 'bloomThreshold', 'bloomKnee', 'bloomRadius', 'halation', 'ca', 'grain', 'vignette', 'fade', 'flash', 'shake', 'zoom', 'invert'] satisfies (keyof PostParams)[] as string[];

const HEX_RE =/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const hex6 = (h: string) => (h.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h).toUpperCase();
/** sRGB mix of two #rrggbb colours. */
function mixHex(a: string, b: string, k: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i]! - v) * k).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** GLSL name of a palette key: accentHi -> C_ACCENT_HI. */
export const glslName = (key: string) => 'C_' + key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

/** Check a theme (a name or an object) and resolve its palette's references: what the page is given. */
export function resolveTheme(t: ThemeName | Theme | string): ResolvedTheme {
  const name = typeof t === 'string' ? t : 'custom';
  const theme = typeof t === 'string' ? themeByName(t) : t;
  if (!theme || typeof theme !== 'object' || !theme.palette || typeof theme.palette !== 'object') throw new Error('theme: expected a name or an object with a palette');
  const raw = theme.palette, out: Record<string, string> = {};
  const look = (key: string, seen: string[]): string => {
    if (has(out, key)) return out[key]!;
    const v = has(raw, key) ? raw[key] : undefined;
    if (typeof v !== 'string') throw new Error(`theme palette: '${seen.at(-1) ?? key}' names '${key}', which is not in the palette`);
    if (HEX_RE.test(v)) return (out[key] = hex6(v));
    if ([...seen, key].includes(v)) throw new Error(`theme palette: ${[...seen, key, v].join(' -> ')} is a loop`);
    if (!has(raw, v)) throw new Error(`theme palette: '${key}' is '${v}', which is neither a #rrggbb colour nor a key of the palette`);
    return (out[key] = look(v, [...seen, key]));
  };
  for (const key of Object.keys(raw)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(key)) throw new Error(`theme palette: key '${key}' must be an identifier starting with a lowercase letter (it becomes C_${key.toUpperCase()} in GLSL)`);
    look(key, []);
  }
  for (const k of ['bg', 'fg', 'accent']) if (!has(out, k)) throw new Error(`theme palette: '${k}' is required (bg, fg and accent are)`);
  if (!has(out, 'accentHi')) out.accentHi = mixHex(out.accent!, '#FFFFFF', 0.3);
  if (!has(out, 'accentLo')) out.accentLo = mixHex(out.accent!, '#000000', 0.4);
  const glsl = new Map<string, string>();
  for (const k of Object.keys(out)) {
    const g = glslName(k);
    if (glsl.has(g)) throw new Error(`theme palette: '${glsl.get(g)}' and '${k}' would both be ${g} in GLSL`);
    glsl.set(g, k);
  }
  for (const [k, v] of Object.entries(theme.post ?? {})) {
    if (!POST_KEYS.includes(k)) throw new Error(`theme post: unknown parameter '${k}' (expected ${POST_KEYS.join(', ')})`);
    const ok = k === 'shake' ? Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number') : typeof v === 'number' && Number.isFinite(v);
    if (!ok) throw new Error(`theme post: ${k} ${JSON.stringify(v)} is not a number`);
  }
  return { name, palette: out, post: { ...theme.post }, overlay: theme.overlay ? { ...theme.overlay } : null };
}
