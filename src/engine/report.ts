import { HEX } from './palette';

export type CheckRule = 'blank' | 'frozen' | 'offFrame' | 'safeArea' | 'overlap' | 'minSize' | 'contrast' | 'overflow' | 'clipped' | 'tiny' | 'empty' | 'unreported' | 'nondeterministic' | 'timeline';
export const CHECK_RULES: readonly CheckRule[] = ['blank', 'frozen', 'offFrame', 'safeArea', 'overlap', 'minSize', 'contrast', 'overflow', 'clipped', 'tiny', 'empty', 'unreported', 'nondeterministic', 'timeline'];

export interface DrawnBox {
  /**
   * What was drawn: text is checked for size, overlap and contrast; every kind for leaving the frame. `object` is a
   * labelled 3D object's projected box (also checked for being behind the camera or too small to see); `stage` is a
   * 3D stage as a whole, with `visible`, the number of its objects in the camera's view (none: an empty frame).
   */
  kind: 'text' | 'image' | 'shape' | 'object' | 'stage';
  /** The rectangle in logical px, frame coordinates (origin top left, y down). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** A name for findings (default: the text, or the kind). Give one when the text changes over time. */
  label?: string;
  /** The text drawn, and its font size in logical px. */
  text?: string;
  size?: number;
  /** The foreground colour: '#rrggbb', 'rgb()'/'rgba()' or a palette key. */
  color?: string;
  /** The opacity it was drawn with, 0..1 (default 1). Boxes under 0.05 are not checked. */
  alpha?: number;
  /** Rules this box is meant to break (a title flying in from off the frame: ['offFrame']); true: all. */
  exempt?: CheckRule[] | true;
  overflow?: { clipped: boolean; truncated?: boolean; container: [number, number, number, number]; px: number };
  flow?: string;
  /** A 3D object entirely behind the camera (its rectangle is empty). */
  behind?: boolean;
  /** A stage's objects in the camera's view. */
  visible?: number;
}

export interface ReportedBox extends DrawnBox { clip: string; track?: number; index: number }

let sink: ReportedBox[] | null = null;
let clip = '';
let track = 0;
let paused = false;
let draws: Record<string, number> = {};
let lastDraws: Record<string, number> = {};
let clocks: Record<string, Record<string, number>> = {};
let lastClocks: Record<string, Record<string, number>> = {};
let stacks = 0;

let scratch = 0;
export function uncounted<T>(f: () => T): T {
  scratch++;
  try { return f(); } finally { scratch--; }
}

let hooked = false;
function hookTextDraws() {
  if (hooked) return;
  hooked = true;
  const protos = [globalThis.CanvasRenderingContext2D?.prototype, globalThis.OffscreenCanvasRenderingContext2D?.prototype];
  for (const p of protos) {
    if (!p) continue;
    for (const k of ['fillText', 'strokeText'] as const) {
      const orig = p[k] as (...a: unknown[]) => void;
      Object.defineProperty(p, k, {
        configurable: true, writable: true,
        value(this: unknown, ...a: unknown[]) {
          if (sink && !paused && !scratch && clip && a[0]) draws[clip] = (draws[clip] ?? 0) + 1;
          return orig.apply(this, a);
        },
      });
    }
  }
  const wrap = (o: object | undefined, k: string, name: string) => {
    const orig = (o as Record<string, unknown> | undefined)?.[k];
    if (typeof orig !== 'function') return;
    Object.defineProperty(o, k, {
      configurable: true, writable: true,
      value(this: unknown, ...a: unknown[]) {
        if (sink && !paused && clip && !clocks[clip]?.[name] && stacks++ < 1024) {
          const E = Error as { stackTraceLimit?: number }, was = E.stackTraceLimit;
          E.stackTraceLimit = 2;
          let stack: string | undefined;
          try { stack = new Error().stack; } finally { E.stackTraceLimit = was; }
          if (fromProject(stack)) (clocks[clip] ??= {})[name] = 1;
        }
        return (orig as (...x: unknown[]) => unknown).apply(this, a);
      },
    });
  };
  wrap(Math, 'random', 'Math.random()');
  wrap(Date, 'now', 'Date.now()');
  wrap(globalThis.performance, 'now', 'performance.now()');
}

export function fromProject(stack: string | undefined) {
  const line = stack?.split('\n')[2] ?? '';
  const url = /\(?((?:https?|file):\/\/[^\s)]+?):\d+:\d+\)?\s*$/.exec(line)?.[1];
  if (!url) return false;
  let p: string;
  try { p = new URL(url).pathname; } catch { return false; }
  return !p.startsWith('/src/') && !p.includes('/node_modules/');
}

export const reporting = () => sink !== null && !paused;

export function report(b: DrawnBox) {
  if (!sink || paused) return;
  sink.push({ ...b, color: b.color === undefined ? undefined : cssHex(b.color) ?? b.color, clip, track, index: sink.filter((x) => x.clip === clip).length });
}

/**
 * Report text just drawn (or about to be) with `c.fillText(text, x, y)`: its box from the context's font,
 * alignment, baseline and transform, its size from the font, its colour from fillStyle and globalAlpha.
 */
export function reportText(c: CanvasRenderingContext2D, text: string, x: number, y: number, o: Pick<DrawnBox, 'label' | 'exempt' | 'color' | 'alpha'> = {}) {
  if (!sink || paused || !text) return;
  const m = c.measureText(text);
  const px = /(\d+(?:\.\d+)?)px/.exec(c.font);
  reportDrawn(c, text, [x - m.actualBoundingBoxLeft, y - m.actualBoundingBoxAscent, x + m.actualBoundingBoxRight, y + m.actualBoundingBoxDescent], px ? Number(px[1]) : undefined, c.fillStyle, o);
}

export function reportDrawn(c: CanvasRenderingContext2D, text: string, [l, t, r, b]: [number, number, number, number], size: number | undefined, style: unknown, o: Pick<DrawnBox, 'label' | 'exempt' | 'color' | 'alpha'> = {}) {
  if (!sink || paused || !text) return;
  const T = c.getTransform();
  const pts = [[l, t], [r, t], [l, b], [r, b]].map(([px, py]) => [T.a * px! + T.c * py! + T.e, T.b * px! + T.d * py! + T.f] as const);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const fill = typeof style === 'string' ? style : undefined;
  const [, a0] = fill ? parseCss(fill) ?? [null, 1] : [null, 1];
  report({
    kind: 'text', text, label: o.label, exempt: o.exempt,
    x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
    size: size === undefined ? undefined : size * Math.sqrt(Math.abs(T.a * T.d - T.b * T.c)),
    color: o.color ?? fill,
    alpha: o.alpha ?? c.globalAlpha * (a0 as number),
  });
}

function parseCss(s: string): [string, number] | null {
  if (Object.prototype.hasOwnProperty.call(HEX, s)) return [HEX[s]!, 1];
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) return ['#' + (m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!).toUpperCase(), 1];
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
    return ['#' + [m[1], m[2], m[3]].map((v) => Math.round(Math.min(255, Number(v))).toString(16).padStart(2, '0')).join('').toUpperCase(), a];
  }
  return null;
}
const cssHex = (s: string) => parseCss(s)?.[0];

export const boxes = {
  begin() { hookTextDraws(); sink = []; draws = {}; clocks = {}; stacks = 0; paused = false; },
  clip(id: string, onTrack = 0) { clip = id; track = onTrack; },
  fade(id: string, k: number) {
    if (sink && k !== 1) for (const b of sink) if (b.clip === id) b.alpha = (b.alpha ?? 1) * k;
  },
  pause(on: boolean) { paused = on; },
  end(): ReportedBox[] { const b = sink ?? []; sink = null; clip = ''; lastDraws = draws; draws = {}; lastClocks = clocks; clocks = {}; return b; },
  textDraws(): Record<string, number> { return lastDraws; },
  clocks(): Record<string, Record<string, number>> { return lastClocks; },
};
