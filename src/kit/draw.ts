import { awaitBeforeFirstFrame } from '../engine/html';
import type { Frame } from '../engine/scene';
import { clamp, pointAtLength, polylineLengths } from '../engine/util';
import { cssColor, esc, HtmlComponent, lineWidth, progressOf, safeBox, UNIT, type Box, type ProgressOptions } from './common';
import { svgSize } from './image';

export { svgLength } from './image';

const DRAW_MOTION = { from: 'fade', in: 0, out: 0.3 } as const;

/**
 * How far each of `n` strokes is drawn at progress p: together, or one after another with each overlapping its
 * neighbours (the first starts at 0, the last ends at 1; one stroke draws with p).
 */
export function drawShares(p: number, n: number, stagger = true): number[] {
  return Array.from({ length: n }, (_, i) => (stagger ? clamp((p * (n + 2) - i) / 3) : clamp(p)));
}

const SHAPES = 'path, line, polyline, polygon, rect, circle, ellipse';
const FADES = 'use, text, image';
const HIDDEN = 'defs, clipPath, mask, marker, pattern, symbol';
const XLINK = 'http://www.w3.org/1999/xlink', SVG_NS = 'http://www.w3.org/2000/svg';
const DROPPED = 'script, foreignObject, animate, animateTransform, animateMotion, set';


export interface SvgPath {
  d: string;
  color?: string;
  width?: number;
  fill?: string;
}

export interface SvgDrawOptions extends ProgressOptions {
  paths?: (string | SvgPath)[];
  src?: string;
  viewBox?: [number, number, number, number];
  fit?: 'contain' | 'cover' | 'stretch';
  color?: string;
  width?: number;
  fill?: string;
  stagger?: boolean;
}

const DRAWN = ['visibility', 'stroke-dasharray', 'stroke-dashoffset', 'marker-start', 'marker-mid', 'marker-end'] as const;

interface Part { e: SVGGraphicsElement; shape: boolean; fo: number; op: number; pathLength: string | null; inline: Record<string, string>; last?: number }

export class SvgDraw extends HtmlComponent {
  private o: SvgDrawOptions;
  private parts: Part[] | null = null;
  private ready: boolean;

  constructor(o: SvgDrawOptions) {
    if (!o.paths === !o.src) throw new Error('SvgDraw: give `paths` or `src`, one of them');
    const box = o.box ?? safeBox(0.15), label = o.label ?? (o.src ? o.src : 'drawing');
    const par = { contain: 'xMidYMid meet', cover: 'xMidYMid slice', stretch: 'none' }[o.fit ?? 'contain'];
    const vb = o.viewBox ?? [0, 0, box.w, box.h];
    const sx = box.w / Math.max(1e-9, vb[2]), sy = box.h / Math.max(1e-9, vb[3]), k = o.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
    const items = (o.paths ?? []).map((p): SvgPath => (typeof p === 'string' ? { d: p } : p));
    const widthOf = (p: SvgPath) => p.width ?? o.width ?? lineWidth();
    const stroke = (p: SvgPath) => `<path class="stroke" pathLength="1" d="${esc(p.d)}" stroke="${cssColor(p.color ?? o.color ?? 'accent')}" stroke-width="${+(widthOf(p) / k).toFixed(4)}" fill="${p.fill ?? o.fill ? cssColor((p.fill ?? o.fill)!) : 'none'}"/>`;
    const stretch = o.fit === 'stretch' ? Math.max(sx, sy) / k : 1;
    const pad = o.paths ? (Math.max(0, ...items.map(widthOf)) / 2) * stretch + 2 : UNIT * 0.02;
    super({ ...o, motion: o.motion ?? DRAW_MOTION }, {
      box, label, pad,
      html: `<div class="host" data-label="${esc(label)}">${o.paths ? `<svg class="art" viewBox="${vb.join(' ')}" preserveAspectRatio="${par}">${items.map(stroke).join('')}</svg>` : ''}</div>`,
      css: `.host { position: absolute; inset: 0; }
        .host > .art { position: absolute; left: ${Math.ceil(pad)}px; top: ${Math.ceil(pad)}px; width: ${box.w}px; height: ${box.h}px; overflow: ${o.fit === 'cover' ? 'hidden' : 'visible'}; }
        .host > .art > .stroke { stroke-linecap: round; stroke-linejoin: round; }`,
    });
    this.o = o;
    this.ready = !o.src;
    if (o.src) {
      const src = o.src;
      awaitBeforeFirstFrame(this.load(src, par).catch((e: unknown) => { throw new Error(`drawing '${src}' did not load (an SVG in the project, served from its folder): ${e instanceof Error ? e.message : e}`); }));
    }
  }

  private async load(src: string, par: string) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.localName !== 'svg' || svg.namespaceURI !== SVG_NS || doc.querySelector('parsererror')) throw new Error('not an SVG file');
    for (const s of svg.querySelectorAll(DROPPED)) s.remove();
    for (const e of [svg, ...svg.querySelectorAll('*')]) for (const a of [...e.attributes]) if (/^on/i.test(a.name)) e.removeAttribute(a.name);
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${svgSize(text).join(' ')}`);
    svg.classList.add('art');
    svg.setAttribute('preserveAspectRatio', par);
    svg.removeAttribute('width'); svg.removeAttribute('height');
    for (const k of ['width', 'height', 'overflow', 'position', 'left', 'top', 'inset']) (svg as unknown as SVGSVGElement).style.removeProperty(k);
    const base = new URL(src, location.href);
    for (const e of svg.querySelectorAll('[href]:not([href^="#"]), image, use, feImage')) {
      const href = e.getAttribute('href') ?? e.getAttributeNS(XLINK, 'href');
      if (!href || href.startsWith('#') || href.startsWith('data:')) continue;
      e.removeAttributeNS(XLINK, 'href');
      e.setAttribute('href', new URL(href, base).href);
    }
    this.layer.set('.host', { html: new XMLSerializer().serializeToString(svg) });
    this.ready = true;
  }

  private partsOf(): Part[] {
    if (this.parts) return this.parts;
    const parts: Part[] = [];
    const root = this.layer.$('.host > .art');
    for (const e of root.querySelectorAll<SVGGraphicsElement>(`:is(${SHAPES}, ${FADES})`)) {
      if (e.parentElement?.closest(`${HIDDEN}, text`)) continue;
      const cs = getComputedStyle(e);
      let shown = cs.visibility === 'visible';
      for (let n: Element | null = e; shown && n && n !== root; n = n.parentElement) shown = getComputedStyle(n).display !== 'none';
      if (!shown) continue;
      const shape = e.matches(SHAPES);
      parts.push({ e, shape, fo: Number(cs.fillOpacity || 1), op: Number(cs.opacity || 1), pathLength: e.getAttribute('pathLength'), inline: Object.fromEntries(DRAWN.map((k) => [k, e.style.getPropertyValue(k)])) });
      if (shape) e.style.setProperty('vector-effect', 'none');
    }
    return (this.parts = parts);
  }

  protected update(f: Frame) {
    if (!this.ready) return;
    const parts = this.partsOf(), ks = drawShares(progressOf(this.o, f, this.window(f)[0]), parts.length, this.o.stagger ?? true);
    parts.forEach((p, i) => {
      const k = ks[i]!, fade = clamp((k - 0.6) / 0.4);
      if (k === p.last) return;
      p.last = k;
      if (!p.shape) { this.layer.set(p.e, { style: { opacity: (p.op * fade).toFixed(4) } }); return; }
      if (k >= 1) {
        this.layer.set(p.e, { style: { 'fill-opacity': p.fo.toFixed(4), ...p.inline }, attr: { pathLength: p.pathLength } });
        return;
      }
      this.layer.set(p.e, {
        style: { visibility: k > 0 ? p.inline.visibility! : 'hidden', 'fill-opacity': (p.fo * fade).toFixed(4), 'stroke-dasharray': `${k.toFixed(5)} 2`, 'stroke-dashoffset': '0', 'marker-start': 'none', 'marker-mid': 'none', 'marker-end': 'none' },
        attr: { pathLength: 1 },
      });
    });
  }
}

export interface Point { x: number; y: number }
export type Side = 'top' | 'right' | 'bottom' | 'left' | 'center' | 'auto';

const isBox = (p: Point | Box): p is Box => 'w' in p;

/** The point of `box` at `side` ('auto': the side facing `toward`), and the way out of that side (0 for the centre). */
export function anchor(box: Box, side: Side, toward?: Point): { x: number; y: number; nx: number; ny: number } {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  let s = side;
  if (s === 'auto') {
    if (!toward) s = 'center';
    else {
      const dx = (toward.x - cx) / Math.max(1e-9, box.w / 2), dy = (toward.y - cy) / Math.max(1e-9, box.h / 2);
      s = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
    }
  }
  switch (s) {
    case 'top': return { x: cx, y: box.y, nx: 0, ny: -1 };
    case 'bottom': return { x: cx, y: box.y + box.h, nx: 0, ny: 1 };
    case 'left': return { x: box.x, y: cy, nx: -1, ny: 0 };
    case 'right': return { x: box.x + box.w, y: cy, nx: 1, ny: 0 };
    default: return { x: cx, y: cy, nx: 0, ny: 0 };
  }
}

/** A line sampled along its length: points and the length run up to each. */
export interface Track { pts: Point[]; len: Float32Array; length: number; d: string }

export function arrowTrack(a: Point, b: Point, curve = 0, n = 64): Track {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  const c = { x: (a.x + b.x) / 2 + 2 * dy * curve, y: (a.y + b.y) / 2 - 2 * dx * curve };
  const steps = curve === 0 ? 1 : n, pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    pts.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
  }
  const len = polylineLengths(pts);
  const f = (v: number) => +v.toFixed(3);
  const d = curve === 0 || L === 0 ? `M${f(a.x)} ${f(a.y)} L${f(b.x)} ${f(b.y)}` : `M${f(a.x)} ${f(a.y)} Q${f(c.x)} ${f(c.y)} ${f(b.x)} ${f(b.y)}`;
  return { pts, len, length: len[len.length - 1]!, d };
}

/** The point `s` px along a track, and the angle (radians, y down) the track runs at there. */
export const pointAlong = (tr: Track, s: number): { x: number; y: number; angle: number } => pointAtLength(tr.pts, tr.len, s);

export interface ArrowOptions extends Omit<ProgressOptions, 'box'> {
  from: Point | Box;
  to: Point | Box;
  fromSide?: Side;
  toSide?: Side;
  gap?: number;
  curve?: number;
  heads?: 'end' | 'start' | 'both' | 'none';
  color?: string;
  width?: number;
  head?: number;
}

export class Arrow extends HtmlComponent {
  private o: ArrowOptions;
  readonly track: Track;
  private hl: number;

  constructor(o: ArrowOptions) {
    const width = o.width ?? lineWidth(), hl = o.head ?? Math.max(10, width * 4.5);
    const fixed = (p: Point | Box, side: Side | undefined) => (!isBox(p) ? p : (side ?? 'auto') !== 'auto' ? anchor(p, side!) : null);
    const centre = (p: Point | Box) => (isBox(p) ? { x: p.x + p.w / 2, y: p.y + p.h / 2 } : p);
    const ends = (p: Point | Box, side: Side | undefined, other: Point | Box, otherSide: Side | undefined) => {
      if (!isBox(p)) return { x: p.x, y: p.y, nx: 0, ny: 0, gap: o.gap ?? 0 };
      return { ...anchor(p, side ?? 'auto', fixed(other, otherSide) ?? centre(other)), gap: o.gap ?? 12 };
    };
    const ea = ends(o.from, o.fromSide, o.to, o.toSide), eb = ends(o.to, o.toSide, o.from, o.fromSide);
    const shift = (e: typeof ea, other: typeof ea) => {
      if (e.nx || e.ny) return { x: e.x + e.nx * e.gap, y: e.y + e.ny * e.gap };
      const dx = other.x - e.x, dy = other.y - e.y, l = Math.hypot(dx, dy) || 1;
      return { x: e.x + (dx / l) * e.gap, y: e.y + (dy / l) * e.gap };
    };
    const a = shift(ea, eb), b = shift(eb, ea), track = arrowTrack(a, b, o.curve ?? 0);
    const pad = Math.ceil(hl + width + 2), xs = track.pts.map((p) => p.x), ys = track.pts.map((p) => p.y);
    const x0 = Math.floor(Math.min(...xs)), y0 = Math.floor(Math.min(...ys));
    const box = { x: x0, y: y0, w: Math.max(1, Math.ceil(Math.max(...xs)) - x0), h: Math.max(1, Math.ceil(Math.max(...ys)) - y0) };
    const color = cssColor(o.color ?? 'accent'), label = o.label ?? 'arrow';
    const tri = `M0 0 L${-hl} ${-hl * 0.5} L${-hl * 0.78} 0 L${-hl} ${hl * 0.5} Z`;
    super({ ...o, motion: o.motion ?? DRAW_MOTION }, {
      box, label, pad,
      html: `<svg class="art" width="${box.w}" height="${box.h}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" data-label="${esc(label)}">
        <path class="line" d="${track.d}" pathLength="${track.length.toFixed(3)}"/><path class="head" d="${tri}"/><path class="tail" d="${tri}"/></svg>`,
      css: `.art { position: absolute; left: ${pad}px; top: ${pad}px; overflow: visible; }
        .line { fill: none; stroke: ${color}; stroke-width: ${width}; stroke-linecap: round; }
        .head, .tail { fill: ${color}; stroke: ${color}; stroke-width: ${Math.max(1, width * 0.5)}; stroke-linejoin: round; }`,
    });
    this.o = o; this.track = track; this.hl = hl;
  }

  protected update(f: Frame) {
    const heads = this.o.heads ?? 'end', tr = this.track, L = tr.length, s = progressOf(this.o, f, this.window(f)[0]) * L;
    const end = heads === 'end' || heads === 'both', start = heads === 'start' || heads === 'both';
    const tuck = this.hl * 0.7, s0 = start ? Math.min(tuck, L / 2) : 0, s1 = end ? Math.max(s0, s - tuck) : s;
    const on = s > 0 && L > 0, f3 = (v: number) => v.toFixed(3);
    this.layer.set('.line', { style: {
      visibility: on && s1 > s0 ? 'visible' : 'hidden',
      'stroke-dasharray': `${f3(Math.max(0, s1 - s0))} ${f3(2 * L + 1)}`, 'stroke-dashoffset': f3(-s0),
    } });
    const grow = clamp(s / this.hl);
    const place = (sel: string, show: boolean, p: { x: number; y: number; angle: number }, flip: boolean) => this.layer.set(sel, {
      attr: { transform: `translate(${f3(p.x)} ${f3(p.y)}) rotate(${((p.angle * 180) / Math.PI + (flip ? 180 : 0)).toFixed(3)}) scale(${grow.toFixed(4)})` },
      style: { visibility: on && show ? 'visible' : 'hidden' },
    });
    place('.head', end, pointAlong(tr, s), false);
    place('.tail', start, pointAlong(tr, 0), true);
  }
}
