import type { PostParams } from './engine/post';

export interface HudParams {
  marks?: boolean;
  /** Seconds the marks take to fly in at the clip's start and out at its end (default 0.8; 0: always in place). */
  fly?: number;
  caption?: { fig?: string; text: string };
  /** Draw for a light or a dark picture (default: the theme's `bg`). */
  tone?: 'light' | 'dark';
}

export interface Theme {
  palette: Record<string, string>;
  post?: Partial<PostParams>;
  overlay?: HudParams | false;
}

export type ThemeName = 'print' | 'film' | 'neutral';

export interface ResolvedTheme {
  name: string;
  palette: Record<string, string>;
  post: Partial<PostParams>;
  overlay: HudParams | null;
}

const INKS = {
  ink: '#16161A',
  ink2: '#1C1C21',
  graphite: '#6B6760', // secondary text, gridlines
  ash: '#9C978F', // muted text on dark
  bone: '#EEE9DF',
  paper: '#EEE9DF',
  rule: '#C9C2B4', // hairlines and rules on paper
  signal: '#C8301E',
  ember: '#E0563F',
  blood: '#8E1F12',
};

export const themes: Record<ThemeName, Theme> = {
  print: {
    palette: { bg: 'paper', fg: 'ink', accent: 'signal', accentHi: 'ember', accentLo: 'blood', ...INKS },
    post: { bloom: 0, bloomThreshold: 1.2, bloomKnee: 0.3, bloomRadius: 0.5, halation: 0, ca: 0.25, grain: 0.028, vignette: 0.16 },
  },
  film: {
    palette: { bg: 'ink', fg: 'bone', accent: 'signal', accentHi: 'ember', accentLo: 'blood', ...INKS },
    post: { bloom: 0.55, bloomThreshold: 0.85, bloomKnee: 0.5, bloomRadius: 0.75, halation: 0.25, ca: 1.2, grain: 0.055, vignette: 0.35 },
    overlay: { marks: true, fly: 0 },
  },
  neutral: {
    palette: { bg: '#F4F4F2', fg: '#17171A', accent: '#2F6BFF', surface: '#FFFFFF', muted: '#6F6F73', line: '#D5D5D2' },
    post: {},
  },
};

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

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export const isThemeName = (name: string): name is ThemeName => has(themes, name);

function themeByName(name: string): Theme {
  const t = isThemeName(name) ? themes[name] : undefined;
  if (!t) throw new Error(`theme '${name}': expected ${Object.keys(themes).join(', ')} or a theme object`);
  return t;
}

const POST_KEYS = ['exposure', 'bloom', 'bloomThreshold', 'bloomKnee', 'bloomRadius', 'halation', 'ca', 'grain', 'vignette', 'fade', 'flash', 'shake', 'zoom', 'invert'] satisfies (keyof PostParams)[] as string[];

const HEX_RE =/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const hex6 = (h: string) => (h.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h).toUpperCase();
function mixHex(a: string, b: string, k: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i]! - v) * k).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export const glslName = (key: string) => 'C_' + key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

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
  if (theme.overlay) checkHud(theme.overlay, 'theme overlay');
  return { name, palette: out, post: { ...theme.post }, overlay: theme.overlay ? { ...theme.overlay } : null };
}

export function checkHud(p: unknown, where: string): asserts p is HudParams {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error(`${where}: expected an object like { marks: true }`);
  const o = p as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['marks', 'fly', 'caption', 'tone'].includes(k)) throw new Error(`${where}: unknown key '${k}' (expected marks, fly, caption, tone)`);
  if (o.marks !== undefined && typeof o.marks !== 'boolean') throw new Error(`${where}: marks ${JSON.stringify(o.marks)} is not true or false`);
  if (o.fly !== undefined && !(typeof o.fly === 'number' && o.fly >= 0)) throw new Error(`${where}: fly ${JSON.stringify(o.fly)} is not a number of seconds`);
  if (o.tone !== undefined && o.tone !== 'light' && o.tone !== 'dark') throw new Error(`${where}: tone ${JSON.stringify(o.tone)} is not 'light' or 'dark'`);
  const c = o.caption as Record<string, unknown> | undefined;
  if (c !== undefined && (!c || typeof c !== 'object' || typeof c.text !== 'string' || (c.fig !== undefined && typeof c.fig !== 'string')))
    throw new Error(`${where}: caption ${JSON.stringify(c)} is not { fig?: string, text: string }`);
}
