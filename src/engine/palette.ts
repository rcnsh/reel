import { hexToLinear } from './util';

// The palette. The engine uses these keys (HUD in ink/bone, the heat ramp ink -> blood -> signal -> ember)
// and GLSL gets each as a C_<KEY> constant (glsl/common.ts). A project changes the values here; its own
// extra colours belong in its scenes.
export const HEX = {
  ink: '#16161A', // darkest: type and line work on paper, backgrounds on screen
  ink2: '#1C1C21', // a step up from ink
  graphite: '#6B6760', // secondary text, gridlines
  ash: '#9C978F', // muted text on dark
  bone: '#EEE9DF', // lightest: type on dark
  paper: '#EEE9DF', // paper background
  rule: '#C9C2B4', // hairlines and rules on paper
  signal: '#C8301E', // the accent
  ember: '#E0563F', // a lighter accent (top of the heat ramp)
  blood: '#8E1F12', // a darker accent
  acid: '#C8301E', // a second accent
} as const;

export type PaletteKey = keyof typeof HEX;

/** Linear RGB triplets for GL uniforms. */
export const LIN: Record<PaletteKey, [number, number, number]> = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)]),
) as Record<PaletteKey, [number, number, number]>;

/** CSS rgba() for Canvas2D. */
export function rgba(key: PaletteKey | string, a = 1): string {
  const hex = (HEX as Record<string, string>)[key] ?? key;
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
