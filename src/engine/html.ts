import * as THREE from 'three';
import { FSPass, H, W } from './gl';
import { HEX } from './palette';
import { report, reporting, type CheckRule, type DrawnBox } from './report';
import type { Frame } from './scene';

export type HtmlUpdate = (f: Frame, layer: HtmlLayer) => void;

export interface HtmlLayerOptions {
  html?: string;
  css?: string;
  width?: number;
  height?: number;
  update?: HtmlUpdate;
  /** A name for findings and errors (default 'html'). */
  label?: string;
}

export interface HtmlDraw {
  x?: number;
  y?: number;
  /** Uniform scale, or [sx, sy] (default 1). */
  scale?: number | [number, number];
  /** Radians, clockwise (default 0). */
  rotate?: number;
  /** The point (layer px) that scale and rotation turn about (default the layer's centre). */
  anchor?: [number, number];
  opacity?: number;
  blend?: 'normal' | 'add' | 'screen';
}

export const kebab = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
export const THEME_CSS_VARS = Object.entries(HEX).map(([k, v]) => `--${kebab(k)}: ${v};`).join(' ');

export const HTML_DEFAULT_FONT = 'Archivo';

const BASE_CSS = `
:host { all: initial; display: block; position: absolute; left: 0; top: 0; overflow: hidden; contain: strict;
  ${THEME_CSS_VARS} --frame-w: ${W}px; --frame-h: ${H}px;
  color: var(--fg); font-family: '${HTML_DEFAULT_FONT}'; font-size: ${Math.round(Math.min(W, H) * 0.04)}px; line-height: 1.2;
  font-kerning: normal; text-rendering: geometricPrecision; -webkit-font-smoothing: antialiased; }
*, *::before, *::after { box-sizing: border-box; }
h1, h2, h3, h4, h5, h6, p, figure, blockquote, ul, ol, dl, pre { margin: 0; }
img, svg, video, canvas { display: block; max-width: 100%; }
`;

let owner = '';
let loading = 1;
const layers = new Set<HtmlLayer>();
const loads: { owner: string; p: Promise<unknown> }[] = [];
let host: HTMLCanvasElement | null = null;

export const htmlLayers = {
  attach(canvas: HTMLCanvasElement) {
    host = canvas;
    canvas.setAttribute('content', 'drawable');
    for (const l of layers) if (!l.el.isConnected) canvas.appendChild(l.el);
  },
  supported() {
    const c = document.createElement('canvas');
    c.setAttribute('content', 'drawable');
    return (c as unknown as { content?: string }).content === 'drawable' && 'texElementSubImage2D' in WebGL2RenderingContext.prototype;
  },
  owner(id: string) { owner = id; },
  loading(on: boolean) { loading = Math.max(0, loading + (on ? 1 : -1)); },
  async settle(): Promise<Map<string, string>> {
    const errors = new Map<string, string>();
    while (loads.length) {
      await Promise.all(loads.splice(0).map(({ owner: o, p }) => p.catch((e) => { if (!errors.has(o)) errors.set(o, String((e as Error)?.message ?? e)); })));
    }
    return errors;
  },
  drop(id: string) { for (const l of [...layers]) if (l.owner === id) l.dispose(); },
  count: () => layers.size,
  async prepare(renderer: THREE.WebGLRenderer, frames: Map<string, Frame>): Promise<Map<string, string>> {
    const errors = new Map<string, string>(), dirty: HtmlLayer[] = [];
    for (const l of layers) {
      const f = frames.get(l.owner);
      if (!f) { l.hide(); continue; }
      try { if (l.sync(f)) dirty.push(l); } catch (e) { if (!errors.has(l.owner)) errors.set(l.owner, `${l.label}: ${describe(e)}`); }
    }
    if (!dirty.length) return errors;
    rebuild(dirty.filter((l) => l.stale), frames);
    for (const l of dirty) {
      try { await l.loadImages(); } catch (e) { if (!errors.has(l.owner)) errors.set(l.owner, `${l.label}: ${describe(e)}`); }
    }
    await paint();
    for (const l of dirty) {
      try { l.upload(renderer); } catch (e) { if (!errors.has(l.owner)) errors.set(l.owner, `${l.label}: ${describe(e)}`); }
    }
    return errors;
  },
};

function rebuild(stale: HtmlLayer[], frames: Map<string, Frame>) {
  for (const l of stale) l.el.style.display = 'none';
  for (const l of stale) void getComputedStyle(l.el).display;
  for (const l of stale) { l.el.style.display = 'block'; l.retime(frames.get(l.owner)!); }
}

export function awaitBeforeFirstFrame<T>(p: Promise<T>): Promise<T> {
  if (!loading) { p.catch(() => {}); notLate('a kit component'); }
  loads.push({ owner, p });
  p.catch(() => {});
  return p;
}

const PLACE = 'make it a field of the scene or create it in init(), not at a module\'s top level or in prepare() or render()';
export function inClip(label: string) {
  if (!owner) throw new Error(`${label}: an HTML layer or kit component was made outside a scene's construction, so it belongs to no clip and would never draw: ${PLACE}`);
}
export function notLate(label: string) {
  if (!loading) throw new Error(`${label}: a kit component was made after the scenes loaded (lazily in prepare() or render()), so what it loads is not there for the frames before it lands: ${PLACE}`);
}

function paint(): Promise<void> {
  return new Promise((res) => {
    if (!host) { requestAnimationFrame(() => res()); return; }
    host.addEventListener('paint', () => res(), { once: true });
    (host as unknown as { requestPaint(): void }).requestPaint();
  });
}

export const htmlFamilies = new Map<string, string | null>();

export class LayerError extends Error {}
const describe = (e: unknown) => (e instanceof LayerError ? e.message : String((e as Error)?.stack ?? e));
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
const firstFamily = (ff: string) => (/^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/.exec(ff) ?? [])
  .slice(1).find((x) => x !== undefined)?.trim() ?? '';

const passes = new Map<string, FSPass>();
function passFor(blend: NonNullable<HtmlDraw['blend']>) {
  let p = passes.get(blend);
  if (p) return p;
  p = new FSPass(`
    uniform sampler2D tex; uniform mat3 inv; uniform vec2 size; uniform float opacity, frameH;
    void main() {
      vec2 q = (inv * vec3(FRAG_PX.x, frameH - FRAG_PX.y, 1.0)).xy;
      vec2 uv = q / size;
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
      vec4 c = texture(tex, uv);
      vec3 s = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
      fragColor = vec4(toLinear(s) * c.a, c.a) * opacity;
    }`, { tex: { value: null }, inv: { value: new THREE.Matrix3() }, size: { value: new THREE.Vector2() }, opacity: { value: 1 }, frameH: { value: H } },
  { blending: THREE.CustomBlending, transparent: true });
  const m = p.mat;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = blend === 'normal' ? THREE.OneMinusSrcAlphaFactor : blend === 'add' ? THREE.OneFactor : THREE.OneMinusSrcColorFactor;
  m.blendSrcAlpha = blend === 'normal' ? THREE.OneFactor : THREE.ZeroFactor;
  m.blendDstAlpha = blend === 'normal' ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor;
  passes.set(blend, p);
  return p;
}

export const HTML_TEXEL_GLSL = `
vec4 htmlTexel(sampler2D tex, vec2 uv) { vec4 c = texture(tex, uv); vec3 s = c.a > 0.0 ? c.rgb / c.a : vec3(0.0); return vec4(toLinear(s) * c.a, c.a); }`;

interface DomBox { kind: DrawnBox['kind']; x: number; y: number; w: number; h: number; text?: string; size?: number; color?: string; alpha: number; label?: string; exempt?: CheckRule[] | true; overflow?: DrawnBox['overflow']; flow?: string }

export class HtmlLayer {
  readonly el: HTMLElement;
  readonly root: ShadowRoot;
  readonly owner: string;
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly texture: THREE.ExternalTexture;
  private update?: HtmlUpdate;
  private glTex: WebGLTexture | null = null;
  private texSize: [number, number] = [0, 0];
  private observer: MutationObserver;
  private shown = '';
  private uploaded = false;
  private boxCache: { key: string; boxes: DomBox[] } | null = null;
  private fontsOk = new Set<string>();
  stale = false;

  constructor(o: HtmlLayerOptions | string = {}, css?: string) {
    const opts: HtmlLayerOptions = typeof o === 'string' ? { html: o, css } : o;
    this.width = opts.width ?? W;
    this.height = opts.height ?? H;
    this.update = opts.update;
    this.label = opts.label ?? 'html';
    inClip(this.label);
    this.owner = owner;
    this.el = document.createElement('div');
    this.el.setAttribute('drawable', '');
    this.el.style.width = `${this.width}px`;
    this.el.style.height = `${this.height}px`;
    this.el.style.display = 'none';
    this.root = this.el.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${BASE_CSS}</style><style>${opts.css ?? ''}</style>${opts.html ?? ''}`;
    this.texture = new THREE.ExternalTexture(null);
    this.observer = new MutationObserver(() => {});
    this.observer.observe(this.root, { subtree: true, childList: true, attributes: true, characterData: true });
    layers.add(this);
    host?.appendChild(this.el);
  }

  $<E extends Element = HTMLElement>(sel: string): E {
    const e = this.root.querySelector<E>(sel);
    if (!e) throw new Error(`${this.label}: no element matches '${sel}'`);
    return e;
  }
  $$<E extends Element = HTMLElement>(sel: string): E[] { return [...this.root.querySelectorAll<E>(sel)]; }

  set(sel: string | Element, c: { text?: string | number; html?: string; class?: Record<string, boolean>; style?: Record<string, string | number>; vars?: Record<string, string | number>; attr?: Record<string, string | number | null> }) {
    const els = typeof sel === 'string' ? this.$$(sel) : [sel];
    if (typeof sel === 'string' && !els.length) throw new Error(`${this.label}: no element matches '${sel}'`);
    for (const e of els as HTMLElement[]) {
      if (c.text !== undefined && e.textContent !== String(c.text)) e.textContent = String(c.text);
      if (c.html !== undefined && e.innerHTML !== c.html) e.innerHTML = c.html;
      for (const [k, on] of Object.entries(c.class ?? {})) if (e.classList.contains(k) !== on) e.classList.toggle(k, on);
      for (const [k, v] of Object.entries(c.style ?? {})) { const s = String(v), key = kebab(k); if (e.style.getPropertyValue(key) !== s) e.style.setProperty(key, s); }
      for (const [k, v] of Object.entries(c.vars ?? {})) { const key = k.startsWith('--') ? k : `--${k}`; if (e.style.getPropertyValue(key) !== String(v)) e.style.setProperty(key, String(v)); }
      for (const [k, v] of Object.entries(c.attr ?? {})) {
        if (v === null) { if (e.hasAttribute(k)) e.removeAttribute(k); } else if (e.getAttribute(k) !== String(v)) e.setAttribute(k, String(v));
      }
    }
  }
  text(sel: string, s: string | number) { this.set(sel, { text: s }); }
  vars(v: Record<string, string | number>) {
    for (const [k, x] of Object.entries(v)) {
      const key = k.startsWith('--') ? k : `--${k}`;
      if (this.el.style.getPropertyValue(key) !== String(x)) this.el.style.setProperty(key, String(x));
    }
  }

  sync(f: Frame): boolean {
    const hidden = this.el.style.display === 'none';
    if (hidden) this.el.style.display = 'block';
    this.update?.(f, this);
    this.timeAnimations(f);
    this.observer.takeRecords();
    const now = this.state();
    if (this.uploaded && now === this.shown) return false;
    this.checkFonts();
    this.shown = now;
    this.stale = !hidden;
    return true;
  }

  retime(f: Frame) { this.timeAnimations(f); }

  hide() { if (this.el.style.display !== 'none') this.el.style.display = 'none'; }

  private timeAnimations(f: Frame) {
    const anims = this.root.getAnimations();
    for (const a of anims) {
      if ((a as CSSTransition).transitionProperty !== undefined) { a.finish(); continue; }
      const target = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null;
      const at = target?.closest?.('[data-at]')?.getAttribute('data-at');
      const ms = Math.max(0, (f.lt - (at ? Number(at) : 0)) * 1000);
      if (a.playState !== 'paused') a.pause();
      if (a.currentTime !== ms) a.currentTime = ms;
    }
  }

  private state() {
    let s = this.root.innerHTML + '|' + (this.el.getAttribute('style') ?? '');
    for (const a of this.root.getAnimations()) {
      const t = a.effect?.getComputedTiming();
      s += `|${(a as CSSAnimation).animationName ?? a.id}:${t?.progress ?? 'x'}:${t?.currentIteration ?? 'x'}`;
    }
    return s;
  }

  private checkFonts() {
    for (const e of this.root.querySelectorAll<HTMLElement>('*')) {
      if (!hasText(e)) continue;
      const ff = getComputedStyle(e).fontFamily;
      if (this.fontsOk.has(ff)) continue;
      const fam = firstFamily(ff).toLowerCase();
      if (!htmlFamilies.has(fam)) {
        const known = [...new Set([...htmlFamilies.values()].filter((x): x is string => !!x))].sort().join(', ');
        throw new LayerError(`font '${firstFamily(ff)}' is not loaded${GENERIC.has(fam) ? ' (a generic family is a system font, different on every machine)' : ''}: put its files in the project's fonts/ folder or run \`reel font add "${GENERIC.has(fam) ? '<family>' : firstFamily(ff)}"\`. Loaded: ${known}`);
      }
      this.fontsOk.add(ff);
    }
  }

  async loadImages() {
    const waits: Promise<unknown>[] = [];
    for (const img of this.root.querySelectorAll('img')) {
      if (img.complete && img.naturalWidth > 0) continue;
      waits.push(img.decode().catch(() => { throw new LayerError(`image '${img.getAttribute('src')}' did not load (a path in the project, served from its folder)`); }));
    }
    for (const img of this.root.querySelectorAll<SVGImageElement>('svg image')) {
      const href = img.href.baseVal;
      if (!href || svgImagesDone.get(img) === href) continue;
      waits.push((img as SVGImageElement & { decode(): Promise<void> }).decode().then(() => { svgImagesDone.set(img, href); }, () => { throw new LayerError(`image '${href}' in an SVG did not load (a path in the project, served from its folder)`); }));
    }
    for (const e of this.root.querySelectorAll<HTMLElement>('*')) {
      const bg = getComputedStyle(e).backgroundImage;
      if (bg && bg !== 'none') for (const m of bg.matchAll(/url\("?([^")]+)"?\)/g)) waits.push(preload(m[1]!));
    }
    await Promise.all(waits);
  }

  upload(renderer: THREE.WebGLRenderer) {
    const gl = renderer.getContext() as WebGL2RenderingContext & { texElementSubImage2D(t: number, l: number, x: number, y: number, e: Element): void };
    const canvas = gl.canvas as HTMLCanvasElement & { getElementImageDefaultSize(e: Element): { width: number; height: number } };
    const d = canvas.getElementImageDefaultSize(this.el);
    const w = Math.max(1, Math.ceil(d.width)), h = Math.max(1, Math.ceil(d.height));
    if (!this.glTex || w !== this.texSize[0] || h !== this.texSize[1]) {
      if (this.glTex) gl.deleteTexture(this.glTex);
      this.glTex = gl.createTexture()!;
      renderer.state.bindTexture(gl.TEXTURE_2D, this.glTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.texSize = [w, h];
      this.texture.sourceTexture = this.glTex;
    }
    renderer.state.bindTexture(gl.TEXTURE_2D, this.glTex);
    const st = renderer.state as unknown as { pixelStorei(name: number, value: number | boolean): void };
    st.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    st.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.el);
    this.uploaded = true;
  }

  private matrix(o: HtmlDraw) {
    const [sx, sy] = typeof o.scale === 'number' ? [o.scale, o.scale] : o.scale ?? [1, 1];
    const [ax, ay] = o.anchor ?? [this.width / 2, this.height / 2];
    const r = o.rotate ?? 0, c = Math.cos(r), s = Math.sin(r);
    const m = new THREE.Matrix3().set(c * sx, -s * sy, 0, s * sx, c * sy, 0, 0, 0, 1);
    const tx = (o.x ?? 0) + ax - (m.elements[0]! * ax + m.elements[3]! * ay), ty = (o.y ?? 0) + ay - (m.elements[1]! * ax + m.elements[4]! * ay);
    m.elements[6] = tx; m.elements[7] = ty;
    return m;
  }

  draw(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget | null, o: HtmlDraw = {}) {
    if (!this.uploaded) return;
    const m = this.matrix(o), p = passFor(o.blend ?? 'normal');
    p.u.tex!.value = this.texture;
    (p.u.inv!.value as THREE.Matrix3).copy(m).invert();
    (p.u.size!.value as THREE.Vector2).set(this.width, this.height);
    p.u.opacity!.value = o.opacity ?? 1;
    p.render(renderer, out);
    if (reporting()) this.report(m, o.opacity ?? 1);
  }

  private report(m: THREE.Matrix3, opacity: number) {
    const e = m.elements;
    this.reportThrough((px, py) => [e[0]! * px + e[3]! * py + e[6]!, e[1]! * px + e[4]! * py + e[7]!], opacity);
  }

  /**
   * Report the layer's text and images to `reel check` (in a check only; a no-op otherwise) through `map`, which
   * takes a point of the layer (px, origin top left) to the frame (logical px), or null when it is not in view
   * (behind a 3D camera). A box is reported as the rectangle around its mapped corners, its font size scaled by
   * how much the mapping enlarges it there. For a layer shown some other way than draw(): a texture on a 3D plane.
   */
  reportThrough(map: (x: number, y: number) => [number, number] | null, opacity = 1) {
    if (!reporting() || opacity < 0.01 || !this.uploaded) return;
    const key = this.shown;
    if (this.boxCache?.key !== key) this.boxCache = { key, boxes: domBoxes(this) };
    const rect = (x: number, y: number, w: number, h: number): [number, number, number, number] | null => {
      const pts = [map(x, y), map(x + w, y), map(x, y + h), map(x + w, y + h)];
      if (pts.some((q) => !q)) return null;
      const xs = pts.map((q) => q![0]), ys = pts.map((q) => q![1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    };
    for (const b of this.boxCache.boxes) {
      const r = rect(b.x, b.y, b.w, b.h);
      if (!r) continue;
      const [x, y, w, h] = r;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, o = map(cx, cy), ox = map(cx + 1, cy), oy = map(cx, cy + 1);
      const k = o && ox && oy ? Math.sqrt(Math.abs((ox[0] - o[0]) * (oy[1] - o[1]) - (ox[1] - o[1]) * (oy[0] - o[0]))) : 1;
      const c = b.overflow && rect(...b.overflow.container);
      report({
        kind: b.kind, x, y, w, h, text: b.text, size: b.size === undefined ? undefined : b.size * k, color: b.color, alpha: b.alpha * opacity, label: b.label, exempt: b.exempt, flow: b.flow,
        overflow: b.overflow && c ? { ...b.overflow, container: c, px: b.overflow.px * k } : undefined,
      });
    }
  }

  /** Whether the layer has been painted and uploaded at least once (its texture holds a picture). */
  get ready() { return this.uploaded; }

  dispose() {
    this.observer.disconnect();
    this.el.remove();
    layers.delete(this);
  }
}

const images = new Map<string, Promise<void>>();
const svgImagesDone = new WeakMap<SVGImageElement, string>();
function preload(url: string) {
  let p = images.get(url);
  if (!p) {
    const img = new Image();
    img.src = url;
    p = img.decode().catch(() => { throw new LayerError(`CSS background image '${url}' did not load`); });
    images.set(url, p);
  }
  return p;
}

function hasText(e: Element) {
  for (const n of e.childNodes) if (n.nodeType === Node.TEXT_NODE && n.textContent!.trim()) return true;
  return false;
}

const rgbaOf = (c: string): [string, number] | null => {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(c);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
  return ['#' + [m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('').toUpperCase(), a];
};

function exemptOf(e: Element): CheckRule[] | true | undefined {
  const x = e.closest('[data-exempt]')?.getAttribute('data-exempt');
  if (x === undefined || x === null) return undefined;
  return x.trim() ? (x.trim().split(/[\s,]+/) as CheckRule[]) : true;
}

const flowIds = new WeakMap<Element, string>();
let flowCount = 0;
function flowOf(e: Element) {
  let n: Element = e.closest('[data-flow]') ?? e;
  while (n.parentElement && /^(inline|contents)$/.test(getComputedStyle(n).display)) n = n.parentElement;
  let id = flowIds.get(n);
  if (!id) flowIds.set(n, (id = `html${++flowCount}`));
  return id;
}

function domBoxes(l: HtmlLayer): DomBox[] {
  const out: DomBox[] = [];
  const base = l.el.getBoundingClientRect();
  const sx = l.width / Math.max(1e-6, base.width), sy = l.height / Math.max(1e-6, base.height);
  const rel = (r: DOMRect | { left: number; top: number; width: number; height: number }) => ({ x: (r.left - base.left) * sx, y: (r.top - base.top) * sy, w: r.width * sx, h: r.height * sy });
  const opacityOf = (e: Element) => { let a = 1; for (let n: Element | null = e; n; n = n.parentElement) a *= Number(getComputedStyle(n).opacity); return a; };
  for (const e of l.root.querySelectorAll<HTMLElement>('*')) {
    if (e instanceof HTMLStyleElement) continue;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const label = e.closest('[data-label]')?.getAttribute('data-label') ?? undefined, exempt = exemptOf(e);
    if (e instanceof HTMLImageElement || e instanceof SVGSVGElement || (cs.backgroundImage && cs.backgroundImage.includes('url('))) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && !(e instanceof SVGSVGElement && e.ownerSVGElement)) out.push({ kind: 'image', ...rel(r), alpha: opacityOf(e), label: label ?? e.getAttribute('alt') ?? undefined, exempt });
      if (e instanceof SVGSVGElement) continue;
    }
    if (!hasText(e)) continue;
    const range = document.createRange();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, text = '';
    for (const n of e.childNodes) {
      if (n.nodeType !== Node.TEXT_NODE || !n.textContent!.trim()) continue;
      text += n.textContent;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width <= 0 || r.height <= 0) continue;
        x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
      }
    }
    if (x1 <= x0) continue;
    const [color, ca] = rgbaOf(cs.color) ?? [undefined, 1];
    const box: DomBox = { kind: 'text', ...rel({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }), text: text.replace(/\s+/g, ' ').trim(), size: parseFloat(cs.fontSize), color, alpha: ca * opacityOf(e), label, exempt, flow: flowOf(e) };
    const own = e.getBoundingClientRect(), size = parseFloat(cs.fontSize), ty = Math.max(2, 0.2 * size);
    const spillX = Math.max(own.left - x0, x1 - own.right, e.scrollWidth - e.clientWidth), spillY = Math.max(own.top - y0, y1 - own.bottom, e.scrollHeight - e.clientHeight);
    const spill = Math.max(spillX - 1, spillY - ty);
    const clamp = (cs as unknown as Record<string, string | undefined>).webkitLineClamp;
    const truncated = cs.textOverflow === 'ellipsis' || (!!clamp && clamp !== 'none');
    let clipper: Element | null = null, cut = 0;
    for (let n: Element | null = e; n; n = n.parentElement) {
      const ns = getComputedStyle(n);
      if (!/hidden|clip|auto|scroll/.test(ns.overflowX + ns.overflowY)) continue;
      const r = n.getBoundingClientRect();
      const c = Math.max(Math.max(r.left - x0, x1 - r.right) - 1, Math.max(r.top - y0, y1 - r.bottom) - ty, n === e ? spill : 0);
      if (c > 0) { clipper = n; cut = c; break; }
    }
    const ownSpill = spill > 0 && !/hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflowY);
    if (!clipper && !ownSpill) {
      const c = Math.max(Math.max(base.left - x0, x1 - base.right) - 1, Math.max(base.top - y0, y1 - base.bottom) - ty);
      if (c > 0) { clipper = l.el; cut = c; }
    }
    const rectOf = (r: DOMRect): [number, number, number, number] => { const q = rel(r); return [q.x, q.y, q.w, q.h]; };
    if (clipper) {
      const c = clipper.getBoundingClientRect();
      box.overflow = { clipped: true, truncated, container: rectOf(c), px: cut * sx };
      const v = rel({ left: Math.max(x0, c.left), top: Math.max(y0, c.top), width: Math.max(0, Math.min(x1, c.right) - Math.max(x0, c.left)), height: Math.max(0, Math.min(y1, c.bottom) - Math.max(y0, c.top)) });
      Object.assign(box, v);
    }
    else if (ownSpill) box.overflow = { clipped: false, container: rectOf(own), px: spill * sx };
    out.push(box);
  }
  return out;
}

