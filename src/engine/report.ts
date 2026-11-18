// What a scene drew this frame, for `reel check`: labelled rectangles (text, images, shapes) with the text, its
// size and its colour. Scenes call report() / reportText() as they draw; outside a check nobody collects, and both
// return at once (reportText measures nothing), so reporting costs nothing in previews and exports.
import { HEX } from './palette';

/** The rules of `reel check` a box or a clip can be exempt from. */
export type CheckRule = 'blank' | 'frozen' | 'offFrame' | 'safeArea' | 'overlap' | 'minSize' | 'contrast' | 'overflow' | 'clipped' | 'tiny' | 'empty' | 'unreported';
export const CHECK_RULES: readonly CheckRule[] = ['blank', 'frozen', 'offFrame', 'safeArea', 'overlap', 'minSize', 'contrast', 'overflow', 'clipped', 'tiny', 'empty', 'unreported'];

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
  /**
   * Text that does not fit its container (HTML layers report it): `clipped` when an ancestor's `overflow` cuts
   * it off (`truncated` when that is an ellipsis or a line clamp, on purpose), else it spills out of its own
   * box; `container` is that box in frame px, `px` how far the text passes it.
   */
  overflow?: { clipped: boolean; truncated?: boolean; container: [number, number, number, number]; px: number };
  /** Boxes with the same flow are parts of one run of text (a word in a span of a paragraph): they never overlap. */
  flow?: string;
  /** A 3D object entirely behind the camera (its rectangle is empty). */
  behind?: boolean;
  /** A stage's objects in the camera's view. */
  visible?: number;
}

/**
 * A box as the check gets it: the clip that reported it and the clip's track, its colour resolved to #rrggbb, its
 * alpha including the clip's share of a transition and its track's opacity.
 */
export interface ReportedBox extends DrawnBox { clip: string; track?: number; index: number }

let sink: ReportedBox[] | null = null;
let clip = '';
let track = 0;
let paused = false;
/** fillText and strokeText calls of this frame, by clip: text the check can only see when it is also reported. */
let draws: Record<string, number> = {};
let lastDraws: Record<string, number> = {};

let scratch = 0;
/**
 * Run `f` without counting its fillText calls toward `unreported`: the engine's own text on scratch canvases that
 * never reach the frame as text (textPoints rasterising a word into particles, a missing asset's placeholder).
 */
export function uncounted<T>(f: () => T): T {
  scratch++;
  try { return f(); } finally { scratch--; }
}

/** Count the Canvas2D text draws while boxes are collected (installed on the first check, never in a preview or export). */
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
}

/** Whether this frame's boxes are being collected (to skip work that only feeds report()). */
export const reporting = () => sink !== null && !paused;

/** Report a rectangle the scene drew this frame. */
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

/**
 * Report text drawn into a Canvas2D context as paths: its rectangle [left, top, right, bottom] and `size` in the
 * context's own coordinates (the transform is applied here), its colour from `style` (a fillStyle or strokeStyle)
 * and globalAlpha.
 */
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

/** '#rrggbb' or 'rgb(a)(…)' or a palette key -> [#rrggbb, alpha], or null. */
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

/** The engine's side: collect the boxes of the next draws, naming the clip that draws. */
export const boxes = {
  begin() { hookTextDraws(); sink = []; draws = {}; paused = false; },
  clip(id: string, onTrack = 0) { clip = id; track = onTrack; },
  /** Scale the alpha of what `id` reported by `k` (its weight in a crossfade, its track's opacity). */
  fade(id: string, k: number) {
    if (sink && k !== 1) for (const b of sink) if (b.clip === id) b.alpha = (b.alpha ?? 1) * k;
  },
  /** Draws that are not the frame's own (a stateful scene fast-forwarding) report nothing. */
  pause(on: boolean) { paused = on; },
  end(): ReportedBox[] { const b = sink ?? []; sink = null; clip = ''; lastDraws = draws; draws = {}; return b; },
  /** The fillText and strokeText calls per clip between the last begin() and end(). */
  textDraws(): Record<string, number> { return lastDraws; },
};
