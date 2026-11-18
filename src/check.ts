// `reel check`: the times it samples, what it measures in a rendered frame, and the findings it draws from that.
// Pure functions (no DOM, no GL): the page measures pixels with them and the CLI turns samples into findings;
// both are unit-tested under bun.
import type { CheckRule, ReportedBox } from './engine/report';

// ---- colour ----
const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
/** WCAG relative luminance of an 8-bit sRGB colour. */
export const relLum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
/** WCAG contrast ratio of two relative luminances (1 to 21). */
export const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export const hexRgb = (h: string): [number, number, number] => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** A rendered frame: RGBA8 rows bottom-up (the engine's readback), `pw` x `ph` physical px, `scale` per logical px. */
export interface Pixels { data: Uint8Array; pw: number; ph: number; scale: number }

/** The pixel under logical point (x, y): its index into data. */
function idx(p: Pixels, x: number, y: number) {
  const px = Math.min(p.pw - 1, Math.max(0, Math.floor(x * p.scale))), py = Math.min(p.ph - 1, Math.max(0, Math.floor(y * p.scale)));
  return ((p.ph - 1 - py) * p.pw + px) * 4;
}
const luma8 = (d: Uint8Array, i: number) => 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;

// ---- whole frames ----
export interface FrameStats {
  /** Mean brightness (8-bit luma) of each cell of a cols x rows grid, row by row from the top. */
  sig: number[];
  cols: number;
  rows: number;
  /** Brightest cell minus darkest: under a few levels the frame is one flat colour. */
  spread: number;
}

export function frameStats(p: Pixels, cols = 32): FrameStats {
  const W = p.pw / p.scale, H = p.ph / p.scale;
  const rows = Math.max(1, Math.round((cols * H) / W)), cw = W / cols, ch = H / rows, k = 12;
  const sig: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let s = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += luma8(p.data, idx(p, c * cw + ((i + 0.5) * cw) / k, r * ch + ((j + 0.5) * ch) / k));
    sig.push(s / (k * k));
  }
  return { sig, cols, rows, spread: Math.max(...sig) - Math.min(...sig) };
}

/**
 * How far a frame rendered again moved from the first render: the most any cell's brightness moved, and the share
 * of cells that moved by `level` levels or more.
 */
export function frameChange(a: FrameStats, b: FrameStats, level = 2) {
  let most = 0, cells = 0;
  for (let i = 0; i < a.sig.length; i++) { const d = Math.abs(a.sig[i]! - (b.sig[i] ?? a.sig[i]!)); most = Math.max(most, d); if (d >= level) cells++; }
  return { most, share: a.sig.length ? cells / a.sig.length : 0 };
}
/**
 * A change between two renders of one time that is the scene's doing, not the browser's: Chrome rasterises an
 * HTML layer's text a sub-pixel differently after a different history of DOM changes, which moves a few cells by a
 * few levels; a random draw moves a cell by more, or many cells.
 */
export const NONDETERMINISTIC = { most: 12, share: 0.1 };

/** Two frames look the same: no cell's brightness moved by `tol` levels or more (grain averages out in a cell). */
export const sameFrame = (a: FrameStats, b: FrameStats, tol = 1) => a.sig.length === b.sig.length && a.sig.every((v, i) => Math.abs(v - b.sig[i]!) < tol);

/**
 * Whether a sample's second render can be judged for the `nondeterministic` rule: not with a clip exempt from it
 * on screen (it varies on purpose), nor where a stateful clip stepped on from the frame before (the second render
 * reaches the time by a seek, which such a clip may well draw differently).
 */
export function judgeable(s: Pick<Sample, 'clips' | 'stepped'>, clips: readonly ClipSpan[]) {
  if (s.stepped?.length) return false;
  return !s.clips.some((c) => { const e = clips.find((x) => x.id === c)?.exempt; return e === true || !!e?.includes('nondeterministic'); });
}

// ---- text against what is behind it ----
export interface TextMeasure {
  /** Relative luminance of the text as rendered (its solid core) and of what is behind it, and their WCAG ratio. */
  fg: number;
  bg: number;
  ratio: number;
  /** Share of the box's pixels that look like the text (closer to its colour than to the background). */
  coverage: number;
  bgHex: string;
}

/**
 * Measure a text box in a rendered frame. The background is read from a ring just outside the box (and the box's
 * pixels that look unlike the text); the text from the box's pixels nearest the colour the scene reported, so
 * grading, opacity and post-processing are all in the number. Null when the box is outside the frame.
 */
export function measureText(p: Pixels, box: { x: number; y: number; w: number; h: number; size?: number }, color: [number, number, number]): TextMeasure | null {
  const W = p.pw / p.scale, H = p.ph / p.scale;
  const x0 = Math.max(0, box.x), y0 = Math.max(0, box.y), x1 = Math.min(W, box.x + box.w), y1 = Math.min(H, box.y + box.h);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  const take = (ax: number, ay: number, bx: number, by: number, n: number, keep: (x: number, y: number) => boolean) => {
    const step = Math.max(1 / p.scale, Math.sqrt(((bx - ax) * (by - ay)) / n));
    const out: number[] = [];
    for (let y = ay + step / 2; y < by; y += step) for (let x = ax + step / 2; x < bx; x += step) if (keep(x, y)) out.push(idx(p, x, y));
    return out;
  };
  const inner = take(x0, y0, x1, y1, 6000, () => true);
  const pad = Math.min(24, Math.max(4, (box.size ?? 20) * 0.3));
  const inBox = (x: number, y: number) => x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
  const ring = take(Math.max(0, box.x - pad), Math.max(0, box.y - pad), Math.min(W, box.x + box.w + pad), Math.min(H, box.y + box.h + pad), 3000, (x, y) => !inBox(x, y));
  const d = p.data;
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1]! : 0; };
  const ref = ring.length >= 16 ? ring : inner;
  const b0 = [0, 1, 2].map((c) => median(ref.map((i) => d[i + c]!)));
  const dist = (i: number, c: number[]) => (d[i]! - c[0]!) ** 2 + (d[i + 1]! - c[1]!) ** 2 + (d[i + 2]! - c[2]!) ** 2;
  const text: number[] = [], back: number[] = [...ring];
  for (const i of inner) (dist(i, color) < dist(i, b0) ? text : back).push(i);
  const lum = (i: number) => relLum(d[i]!, d[i + 1]!, d[i + 2]!);
  const core = text.sort((a, b) => dist(a, color) - dist(b, color)).slice(0, Math.max(1, Math.ceil(text.length / 2)));
  const fg = text.length ? median(core.map(lum)) : relLum(...(b0 as [number, number, number]));
  const bgi = back.length ? back : inner;
  const bg = median(bgi.map(lum));
  const bgRgb = [0, 1, 2].map((c) => median(bgi.map((i) => d[i + c]!)));
  return { fg, bg, ratio: contrastRatio(fg, bg), coverage: inner.length ? text.length / inner.length : 0, bgHex: '#' + bgRgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase() };
}

// ---- the times to look at ----
export interface ClipSpan { id: string; start: number; end: number; track: number; exempt?: CheckRule[] | true }

/**
 * Frame times to sample in [from, to): every `step` seconds, plus frames bunched at every clip's start and end
 * (its first and last frame always), where cuts, fades and entrances go wrong. Each time is a frame's time.
 */
export function checkTimes(clips: ClipSpan[], duration: number, fps: number, from = 0, to = duration, step = 0.5): number[] {
  const last = Math.ceil(Math.min(to, duration) * fps - 1e-6) - 1, first = Math.ceil(from * fps - 1e-6);
  const frames = new Set<number>();
  for (let t = from; t < to; t += step) frames.add(Math.round(t * fps));
  for (const c of clips) {
    const a = Math.ceil(c.start * fps - 1e-6), b = Math.ceil(c.end * fps - 1e-6) - 1; // the clip's first and last frame
    if (b < a) continue;
    for (const k of [0, 1, 3, 8, 15]) { frames.add(Math.min(b, a + k)); frames.add(Math.max(a, b - k)); }
    for (const s of [0.25, 0.5]) { frames.add(Math.min(b, a + Math.round(s * fps))); frames.add(Math.max(a, b - Math.round(s * fps))); }
  }
  return [...frames].filter((f) => f >= first && f <= last).sort((x, y) => x - y).map((f) => f / fps);
}

// ---- findings ----
export type Severity = 'error' | 'warning' | 'info';
export interface Finding {
  kind: CheckRule | 'sceneError' | 'missingAsset';
  severity: Severity;
  /** The first sampled time it was seen, the last, and how many sampled frames showed it. */
  t: number;
  until: number;
  frames: number;
  /** The sampled time of the worst frame: `rect`, `value` and `image` are from it. */
  at: number;
  clip: string;
  /** Where, in logical px [x, y, w, h] (the worst frame's). */
  rect?: [number, number, number, number];
  text?: string;
  message: string;
  /** The measure behind it (px off the frame, contrast ratio, font size …) at the worst frame. */
  value?: number;
  /** A cropped image of the worst frame, filled in by the CLI. */
  image?: string;
}

/** One sampled frame: what was on screen, what the scenes reported, its stats, and errors first seen there. */
export interface Sample {
  t: number;
  clips: string[];
  boxes: (ReportedBox & { m?: TextMeasure | null })[];
  stats: FrameStats;
  errors: string[];
  /** Canvas2D fillText and strokeText calls per clip in this frame (text the clip may not have reported). */
  textDraws?: Record<string, number>;
  /** Math.random, Date.now and performance.now calls per clip (and per name) in this frame. */
  clocks?: Record<string, Record<string, number>>;
  /** Stateful clips this frame stepped on from the frame before rather than reaching by a seek. */
  stepped?: string[];
  /** The same time rendered again later in the check, out of order: a pure function of t gives the same stats. */
  again?: FrameStats;
}

/**
 * Which samples to render a second time for the `nondeterministic` rule: up to `n` spread evenly across them, plus
 * the middle sample of each clip the spread missed (`clips`: the clips on screen in each sample; null for a sample
 * that cannot be judged, never picked), latest first with the very last moved to the end. (The page renders each
 * by a seek, whatever came before: `__reel.recheck`.)
 */
export function recheckOrder(clips: readonly (readonly string[] | null)[], n = 12): number[] {
  const ok = [...clips.keys()].filter((i) => clips[i]);
  if (!ok.length) return [];
  const k = Math.min(n, ok.length), out = new Set<number>();
  for (let i = 0; i < k; i++) out.add(ok[k === 1 ? 0 : Math.round((i * (ok.length - 1)) / (k - 1))]!);
  const at = new Map<string, number[]>();
  for (const i of ok) for (const c of clips[i]!) if (c !== 'overlay') { const is = at.get(c); if (is) is.push(i); else at.set(c, [i]); }
  // (only for clips the spread missed: a check of many short clips stays cheap)
  for (const is of at.values()) if (!is.some((i) => out.has(i))) out.add(is[is.length >> 1]!);
  const order = [...out].sort((a, b) => b - a);
  if (order.length > 1 && order[0] === clips.length - 1) order.push(order.shift()!);
  return order;
}

export interface CheckOpts {
  W: number;
  H: number;
  /** The safe margin as a share of each side (0.05: 5% of the width left and right, of the height top and bottom). */
  safe: number;
  /** The smallest text in logical px. */
  minText: number;
  /** Seconds a frame may stay unchanged before it is reported as frozen. */
  frozen: number;
  /** Clips' exemptions, by id. */
  clips: ClipSpan[];
  /** The theme's palette (#rrggbb per key), for suggesting a colour that reads. */
  palette: Record<string, string>;
  /** Timeline problems the page found while loading, by clip (a transition with nothing to overlap). */
  warnings?: { clip: string; message: string }[];
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const fmt = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));
const quote = (s?: string) => (s ? `'${s.length > 48 ? s.slice(0, 47) + '…' : s}'` : 'a text box');

/** Turn sampled frames into findings, one per problem (frames showing the same problem are merged). */
export function findingsOf(samples: Sample[], o: CheckOpts): Finding[] {
  const exemptClip = new Map(o.clips.map((c) => [c.id, c.exempt]));
  const exempt = (rule: CheckRule, clip: string, box?: { exempt?: CheckRule[] | true }) => {
    const c = exemptClip.get(clip), b = box?.exempt;
    return c === true || (Array.isArray(c) && c.includes(rule)) || b === true || (Array.isArray(b) && b.includes(rule));
  };
  const raw: (Finding & { key: string; worst: number })[] = [];
  const add = (f: Omit<Finding, 'until' | 'frames' | 'at'>, key: string, worst: number) => raw.push({ ...f, until: f.t, frames: 1, at: f.t, key: `${f.kind}|${f.clip}|${key}`, worst });
  const mx = o.W * o.safe, my = o.H * o.safe;
  const keys = Object.keys(o.palette);

  // blank frames merge only with blank frames next to them (two fades to black are two findings)
  let blankRun = 0, prevBlank = false;
  for (const s of samples) {
    for (const e of s.errors) {
      const clip = /^\[([^\]]+)\]/.exec(e)?.[1] ?? '';
      add({ kind: 'sceneError', severity: 'error', t: s.t, clip, message: e }, e, 0);
    }
    const onScreen = s.clips.filter((c) => c !== 'overlay');
    const blank = s.stats.spread < 4 && !onScreen.every((c) => exempt('blank', c));
    if (blank) {
      if (!prevBlank) blankRun++;
      add({ kind: 'blank', severity: 'warning', t: s.t, clip: onScreen.join('+'), value: +s.stats.spread.toFixed(2), message: `the frame is one flat colour (its brightest and darkest areas differ by ${s.stats.spread.toFixed(1)} levels): ${onScreen.length ? 'a scene that draws nothing, or a fade held too long' : 'no clip is on screen here'}` }, `run${blankRun}`, -s.stats.spread);
    }
    prevBlank = blank;
    const texts = s.boxes.filter((b) => b.kind === 'text' && (b.alpha ?? 1) >= 0.05);
    for (const b of s.boxes) {
      if ((b.alpha ?? 1) < 0.05) continue;
      const name = b.label ?? `${b.kind}#${b.index}`, rect: [number, number, number, number] = [b.x, b.y, b.w, b.h];
      const base = { t: s.t, clip: b.clip, rect, text: b.text ?? b.label };
      // 3D: a stage with nothing in view, an object behind the camera or too small to make out
      if (b.kind === 'stage') {
        if (b.visible === 0 && !exempt('empty', b.clip, b)) add({ ...base, rect: undefined, text: undefined, kind: 'empty', severity: 'warning', value: 0, message: `the 3D stage${b.label ? ` '${b.label}'` : ''} has nothing in the camera's view: the camera looks away from the objects, they are behind it, or outside its near and far planes` }, name, 1);
        continue;
      }
      if (b.kind === 'object' && b.behind) {
        if (!exempt('offFrame', b.clip, b)) add({ ...base, rect: undefined, kind: 'offFrame', severity: 'info', message: `${quote(b.label)} is behind the camera: it is in the scene but never seen` }, name, 0);
        continue;
      }
      if (b.kind === 'object' && !exempt('tiny', b.clip, b) && b.x < o.W && b.y < o.H && b.x + b.w > 0 && b.y + b.h > 0) {
        const short = Math.min(b.w, b.h), need = Math.min(o.W, o.H) * 0.02;
        if (short < need) add({ ...base, kind: 'tiny', severity: 'info', value: +short.toFixed(1), message: `${quote(b.label)} is ${fmt(b.w)}x${fmt(b.h)} px on screen: too small to make out (under ${fmt(need)} px across); bring the camera closer or narrow its field of view` }, name, need - short);
      }
      // off the frame
      const over = { left: -b.x, top: -b.y, right: b.x + b.w - o.W, bottom: b.y + b.h - o.H };
      const out = Object.entries(over).filter(([, v]) => v > 1);
      const gone = b.x >= o.W || b.y >= o.H || b.x + b.w <= 0 || b.y + b.h <= 0;
      if (out.length && !exempt('offFrame', b.clip, b)) {
        const worst = out.reduce((a, [, v]) => a + v, 0);
        const where = out.map(([k, v]) => `${fmt(v)} px past the ${k}`).join(', ');
        if (gone) add({ ...base, kind: 'offFrame', severity: 'info', value: +Math.max(...out.map(([, v]) => v)).toFixed(1), message: `${quote(b.text ?? b.label)} is entirely outside the frame (${where}): it is drawn but never seen` }, name, worst);
        else add({
          ...base, kind: 'offFrame', severity: b.kind === 'text' ? 'error' : 'info', value: +Math.max(...out.map(([, v]) => v)).toFixed(1),
          message: b.kind === 'text'
            ? `${quote(b.text)}${b.size ? ` (${fmt(b.size)} px)` : ''} runs ${where} edge of the ${o.W}x${o.H} frame. Lay it out from W and H: in an HTML layer give it a width in % and let it wrap (or fit it with a text block); in Canvas2D size it with fitSize(text, family, W - ${fmt(2 * mx)}, size) or break it into lines`
            : `${b.label ? quote(b.label) : `this ${b.kind}`} runs ${where} edge of the frame`,
        }, name, worst);
      }
      if (b.kind !== 'text') continue;
      // text that does not fit its box (HTML layers)
      const ov = b.overflow;
      if (ov && !exempt(ov.clipped ? 'clipped' : 'overflow', b.clip, b)) {
        if (ov.clipped) add({
          ...base, rect: ov.container, kind: 'clipped', severity: ov.truncated ? 'info' : 'warning', value: +ov.px.toFixed(1),
          message: ov.truncated
            ? `${quote(b.text)} is truncated (an ellipsis or a line clamp) to fit its ${fmt(ov.container[2])}x${fmt(ov.container[3])} px box: the viewer does not see all of it`
            : `${quote(b.text)} is cut off by ${fmt(ov.px)} px by a container with overflow: hidden (${fmt(ov.container[2])}x${fmt(ov.container[3])} px): shorten it, make it smaller (a text block can fit it to its box), or give it room`,
        }, `${name}|clipped`, ov.px);
        else add({
          ...base, kind: 'overflow', severity: 'error', value: +ov.px.toFixed(1),
          message: `${quote(b.text)} overflows its ${fmt(ov.container[2])}x${fmt(ov.container[3])} px box by ${fmt(ov.px)} px: let it wrap (no fixed width or white-space: nowrap), make it smaller, or fit it to the box`,
        }, `${name}|overflow`, ov.px);
      }
      // the safe margin (only for text that is inside the frame)
      if (!out.length && !exempt('safeArea', b.clip, b)) {
        const into = { left: mx - b.x, top: my - b.y, right: b.x + b.w - (o.W - mx), bottom: b.y + b.h - (o.H - my) };
        const ins = Object.entries(into).filter(([, v]) => v > 0.5);
        if (ins.length) {
          const worst = Math.max(...ins.map(([, v]) => v));
          add({ ...base, kind: 'safeArea', severity: 'warning', value: +worst.toFixed(1), message: `${quote(b.text)} reaches ${ins.map(([k, v]) => `${fmt(v)} px into the ${k}`).join(', ')} safe margin (${fmt(o.safe * 100)}% of each side): keep text within x ${fmt(mx)} to ${fmt(o.W - mx)}, y ${fmt(my)} to ${fmt(o.H - my)}` }, name, worst);
        }
      }
      // too small
      if (b.size !== undefined && b.size < o.minText - 0.01 && !exempt('minSize', b.clip, b)) {
        add({ ...base, kind: 'minSize', severity: 'warning', value: +b.size.toFixed(1), message: `${quote(b.text)} is ${fmt(b.size)} px, under the ${fmt(o.minText)} px that reads at ${o.W}x${o.H} on a phone: make it at least ${fmt(o.minText)} px` }, name, o.minText - b.size);
      }
      // contrast with what is actually behind it
      // (a box smaller than a glyph, such as a word's first stroke, is too few pixels to measure)
      // (nor is text still fading in or out: under 0.9 opacity its contrast is meant to be low)
      const measurable = b.w >= (b.size ?? 16) * 0.5 && b.h >= (b.size ?? 16) * 0.3 && (b.alpha ?? 1) >= 0.9;
      if (b.m && measurable && !exempt('contrast', b.clip, b)) {
        const large = (b.size ?? 0) >= o.minText * 1.4, need = large ? 3 : 4.5, r = b.m.ratio;
        if (b.m.coverage < 0.01 || r < need) {
          const best = keys.map((k) => ({ k, r: contrastRatio(relLum(...hexRgb(o.palette[k]!)), b.m!.bg) })).sort((x, y) => y.r - x.r)[0];
          const fix = best && best.r >= need ? `rgba('${best.k}') reads at ${best.r.toFixed(1)}:1 on it` : `no palette colour reaches ${need}:1 on it: darken or lighten what is behind the text, or put a panel under it`;
          add({
            ...base, kind: 'contrast', severity: r < 3 || b.m.coverage < 0.01 ? 'error' : 'warning', value: +r.toFixed(2),
            message: b.m.coverage < 0.01
              ? `${quote(b.text)} cannot be seen: almost none of its box looks like its colour against the background (${b.m.bgHex}). If it is plainly there, the box reported is much larger than what is drawn (report the part drawn: reportStrokeText for text being written); else ${fix}`
              : `${quote(b.text)} has a contrast of ${r.toFixed(2)}:1 with what is behind it (${b.m.bgHex}); ${large ? 'large' : 'body'} text needs ${need}:1. ${fix}`,
          }, name, -r);
        }
      }
    }
    // text over text
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]!, b = texts[j]!;
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (w <= 1 || h <= 1 || w * h < 0.02 * Math.min(a.w * a.h, b.w * b.h)) continue;
      // (two clips of one track share the screen only while one replaces the other in a transition)
      if (a.clip !== b.clip && a.track !== undefined && a.track === b.track) continue;
      if (a.flow !== undefined && a.flow === b.flow) continue;
      if (exempt('overlap', a.clip, a) || exempt('overlap', b.clip, b)) continue;
      const na = a.label ?? `text#${a.index}`, nb = b.label ?? `text#${b.index}`;
      add({
        kind: 'overlap', severity: 'warning', t: s.t, clip: a.clip === b.clip ? a.clip : `${a.clip}+${b.clip}`, rect: [Math.max(a.x, b.x), Math.max(a.y, b.y), w, h], text: a.text, value: Math.round(w * h),
        message: `${quote(a.text)} and ${quote(b.text)} overlap by ${fmt(w)}x${fmt(h)} px: move one, or show them at different times`,
      }, `${a.clip}:${na}|${b.clip}:${nb}`, w * h);
    }
  }

  // frames that do not change for too long
  for (let i = 0; i < samples.length;) {
    let j = i;
    while (j + 1 < samples.length && sameFrame(samples[j + 1]!.stats, samples[i]!.stats)) j++;
    const a = samples[i]!, b = samples[j]!, span = b.t - a.t;
    const clips = [...new Set(samples.slice(i, j + 1).flatMap((s) => s.clips))].filter((c) => c !== 'overlay');
    if (span >= o.frozen && !clips.every((c) => exempt('frozen', c))) {
      raw.push({ kind: 'frozen', severity: 'warning', t: a.t, until: b.t, frames: j - i + 1, at: a.t, clip: clips.join('+'), value: +span.toFixed(2), key: `frozen|${a.t}`, worst: span, message: `nothing moves for ${span.toFixed(1)} s (${a.t.toFixed(2)} to ${b.t.toFixed(2)} s): hold a still this long on purpose, or give it some motion` });
    }
    i = j + 1;
  }

  // the same time rendered twice gives a different frame: something other than t decides what is drawn
  for (const s of samples) {
    if (!s.again || !judgeable(s, o.clips)) continue;
    const onScreen = s.clips.filter((c) => c !== 'overlay');
    const { most: moved, share } = frameChange(s.stats, s.again);
    if (moved < NONDETERMINISTIC.most && share < NONDETERMINISTIC.share) continue;
    const seen = onScreen.flatMap((c) => Object.keys(s.clocks?.[c] ?? {}).map((k) => `'${c}' ${k}`));
    add({
      kind: 'nondeterministic', severity: 'error', t: s.t, clip: onScreen.join('+'), value: +moved.toFixed(1),
      message: `rendering ${s.t.toFixed(3)} s a second time gave a different frame (${share >= 0.01 ? `${Math.round(share * 100)}% of it` : 'part of it'} changed, by up to ${moved.toFixed(1)} brightness levels), so the frame is not a pure function of t: the preview, stills and the export will not agree, and adaptive motion blur turns it into noise. ${seen.length ? `While drawing, ${seen.join(', ')} ${seen.length > 1 ? 'were' : 'was'} called. ` : ''}Take randomness from hash() or mulberry32() with a fixed seed and jitter from frameIdx(f.t), never Math.random(), Date.now() or performance.now(); nothing may count render() calls or change between them (a scene that simulates state sets stateful = true)`,
    }, 'again', moved);
  }

  // clips that draw text with fillText or strokeText and never report any: everything above is blind to that text
  const drawn = new Map<string, { n: number; t: number; until: number; frames: number }>(), told = new Set<string>();
  for (const s of samples) {
    for (const b of s.boxes) if (b.kind === 'text') told.add(b.clip);
    for (const [clip, n] of Object.entries(s.textDraws ?? {})) {
      if (!n) continue;
      const d = drawn.get(clip);
      if (d) { d.n += n; d.until = s.t; d.frames++; } else drawn.set(clip, { n, t: s.t, until: s.t, frames: 1 });
    }
  }
  for (const [clip, d] of drawn) {
    if (told.has(clip) || exempt('unreported', clip)) continue;
    raw.push({
      kind: 'unreported', severity: 'warning', t: d.t, until: d.until, frames: d.frames, at: d.t, clip, value: d.n, key: `unreported|${clip}`, worst: d.n,
      message: `'${clip}' draws text with fillText or strokeText (${d.n} call${d.n > 1 ? 's' : ''} in ${d.frames} frame${d.frames > 1 ? 's' : ''}) but reports none, so this check cannot see it: follow each fillText with reportText(c, text, x, y), or report({ kind: 'text', ... }) for text drawn another way (text drawn only on a scratch canvas that never shows as text: exempt the clip with check: { exempt: ['unreported'] })`,
    });
  }

  // timeline problems, for the clips this check looked at, over the times it saw them
  for (const w of o.warnings ?? []) {
    const seen = samples.filter((s) => s.clips.includes(w.clip));
    if (!seen.length || exempt('timeline', w.clip)) continue;
    raw.push({ kind: 'timeline', severity: 'warning', t: seen[0]!.t, until: seen.at(-1)!.t, frames: seen.length, at: seen[0]!.t, clip: w.clip, message: w.message, key: `timeline|${w.clip}|${w.message}`, worst: 0 });
  }

  // merge: one finding per problem, at its worst frame, spanning every frame that showed it
  const groups = new Map<string, Finding & { key: string; worst: number }>();
  for (const f of raw) {
    const g = groups.get(f.key);
    if (!g) { groups.set(f.key, { ...f }); continue; }
    const keep = RANK[f.severity] < RANK[g.severity] || (RANK[f.severity] === RANK[g.severity] && f.worst > g.worst) ? f : g;
    groups.set(f.key, { ...keep, t: Math.min(g.t, f.t), until: Math.max(g.until, f.until), frames: g.frames + f.frames });
  }
  return [...groups.values()]
    .map(({ key: _k, worst: _w, ...f }) => f as Finding)
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.t - b.t);
}
