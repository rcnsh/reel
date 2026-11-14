// An image in a box, drawn in GL from the source file: cover or contain, rounded corners, and a Ken Burns pan and
// zoom that is a pure function of time (evaluated per sub-frame, so it is smooth and motion blurred).
import * as THREE from 'three';
import { FSPass, H, SCALE } from '../engine/gl';
import { assetPlaceholder, declaredAsset } from '../engine/assets';
import { awaitBeforeFirstFrame } from '../engine/html';
import { decodePng16, pngDepth } from '../engine/png16';
import { report, reporting } from '../engine/report';
import type { Frame } from '../engine/scene';
import { clamp, ease } from '../engine/util';
import { motionAt, safeBox, type Box, type ComponentOptions, type Motion } from './common';

/** A framing of the image: zoom (1 = fitted) and a pan from -1 to 1 across the room the zoom leaves. */
export interface Framing { zoom?: number; x?: number; y?: number }

export interface ImageBoxOptions extends Omit<ComponentOptions, 'css'> {
  /**
   * The image, a path in the project (`assets/photo.jpg`). Loaded before the first frame; one that does not load is
   * an error, unless assets.json declares it: then a labelled placeholder of its declared size stands in.
   */
  src: string;
  /** 'cover' (default) fills the box and crops; 'contain' shows all of it. */
  fit?: 'cover' | 'contain';
  /** Corner radius in px (default 0). */
  radius?: number;
  /** A pan and zoom over the component's window: from one framing to another (true: a slow push in). */
  kenBurns?: boolean | { from?: Framing; to?: Framing };
  /** Alt text: the image's name in `reel check` findings. */
  alt?: string;
}

let pass: FSPass | null = null;
function picturePass() {
  pass ??= new FSPass(/* glsl */ `
    uniform sampler2D tex, tex2; uniform vec4 box; uniform vec2 extent, centre; uniform float radius, opacity, frameH, mixw;
    uniform int alphaMode;
    float encode(float x) { return x <= 0.0031308 ? x * 12.92 : 1.055 * pow(x, 1.0 / 2.4) - 0.055; }
    // a texel of the picture; stacked alpha: colour in the top (1) or left (2) half, its matte in the other
    vec4 pick(sampler2D t, vec2 uv) {
      if (alphaMode == 0) return texture(t, uv);
      vec2 c = alphaMode == 1 ? vec2(uv.x, uv.y * 0.5) : vec2(uv.x * 0.5, uv.y);
      vec2 a = alphaMode == 1 ? c + vec2(0.0, 0.5) : c + vec2(0.5, 0.0);
      return vec4(texture(t, c).rgb, encode(texture(t, a).g));
    }
    void main() {
      vec2 p = vec2(FRAG_PX.x, frameH - FRAG_PX.y), q = (p - box.xy) / box.zw;
      vec2 d = abs(p - box.xy - box.zw * 0.5) - (box.zw * 0.5 - radius);
      float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
      float m = clamp(0.5 - sd * PX_SCALE, 0.0, 1.0);   // the box with rounded corners, antialiased over a physical px
      if (m <= 0.0) discard;
      vec2 uv = centre + (q - 0.5) * extent;             // the image's uv, row 0 at the top
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
      vec4 c = pick(tex, uv);
      if (mixw > 0.0) c = mix(c, pick(tex2, uv), mixw);
      fragColor = vec4(c.rgb * c.a, c.a) * m * opacity;
    }`, { tex: { value: null }, tex2: { value: null }, mixw: { value: 0 }, alphaMode: { value: 0 }, box: { value: new THREE.Vector4() }, extent: { value: new THREE.Vector2() }, centre: { value: new THREE.Vector2() }, radius: { value: 0 }, opacity: { value: 1 }, frameH: { value: H } },
  { blending: THREE.CustomBlending, transparent: true });
  const mt = pass.mat;
  mt.blendEquation = THREE.AddEquation;
  mt.blendSrc = THREE.OneFactor; mt.blendDst = THREE.OneMinusSrcAlphaFactor;
  mt.blendSrcAlpha = THREE.OneFactor; mt.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return pass;
}

/** What drawPicture draws: a picture of `size` (its own px) fitted to `box`, at a framing, through a motion. */
export interface Picture {
  tex: THREE.Texture;
  /** A second picture mixed in by `mix` (a video's next frame). */
  tex2?: THREE.Texture | null;
  mix?: number;
  /** Stacked alpha: the matte below the colour or to its right (`size` is then the colour's half). */
  alpha?: 'none' | 'below' | 'right';
  size: [number, number];
  box: Box;
  fit?: 'cover' | 'contain';
  radius?: number;
  framing: Required<Framing>;
  label: string;
}

/**
 * The image kit's drawing: a picture fitted to a box (cover or contain), at a framing, through the component's
 * motion at f.lt over window [w0, w1]; reported to check as an image. ImageBox and VideoClip draw with it.
 */
export function drawPicture(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, f: Frame, pic: Picture, motion: Motion | false | undefined, w0: number, w1: number, opacity = 1) {
  const m = motionAt(motion, f.lt, w0, w1);
  if (!m) return;
  const b = pic.box, [iw, ih] = pic.size, fr = pic.framing;
  // the share of the image across the box: cover crops one axis, contain leaves room on one (then zoom crops)
  const s = pic.fit === 'contain' ? Math.min(b.w / iw, b.h / ih) : Math.max(b.w / iw, b.h / ih);
  const ex = b.w / (iw * s) / fr.zoom, ey = b.h / (ih * s) / fr.zoom;
  const cx = 0.5 + fr.x * Math.max(0, (1 - ex) / 2), cy = 0.5 + fr.y * Math.max(0, (1 - ey) / 2);
  const p = picturePass(), x = b.x + m.dx, y = b.y + m.dy;
  p.u.tex!.value = pic.tex;
  p.u.tex2!.value = pic.tex2 ?? pic.tex;
  p.u.mixw!.value = pic.tex2 ? pic.mix ?? 0 : 0;
  p.u.alphaMode!.value = pic.alpha === 'below' ? 1 : pic.alpha === 'right' ? 2 : 0;
  (p.u.box!.value as THREE.Vector4).set(x + (b.w * (1 - m.scale)) / 2, y + (b.h * (1 - m.scale)) / 2, b.w * m.scale, b.h * m.scale);
  (p.u.extent!.value as THREE.Vector2).set(ex, ey);
  (p.u.centre!.value as THREE.Vector2).set(cx, cy);
  p.u.radius!.value = Math.min(pic.radius ?? 0, b.w / 2, b.h / 2);
  p.u.opacity!.value = m.opacity * opacity;
  p.render(renderer, out);
  if (reporting()) {
    // (contain: the image's own rectangle inside the box)
    const vw = Math.min(b.w, iw * s * fr.zoom), vh = Math.min(b.h, ih * s * fr.zoom);
    report({ kind: 'image', x: x + (b.w - vw) / 2, y: y + (b.h - vh) / 2, w: vw, h: vh, alpha: m.opacity * opacity, label: pic.label });
  }
}

/** The framing at clip time lt of a Ken Burns move across window [w0, w1], eased (none: fitted). */
export function kenBurnsAt(kb: boolean | { from?: Framing; to?: Framing } | undefined, lt: number, w0: number, w1: number): Required<Framing> {
  if (!kb) return { zoom: 1, x: 0, y: 0 };
  const from = { zoom: 1, x: 0, y: 0, ...(kb === true ? {} : kb.from) }, to = { zoom: 1.12, x: 0.25, y: -0.15, ...(kb === true ? {} : kb.to) };
  const k = ease.inOutQuad(clamp((lt - w0) / Math.max(1e-3, w1 - w0)));
  return { zoom: from.zoom + (to.zoom - from.zoom) * k, x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

/** An SVG's size in its own units: width and height when absolute, else its viewBox, else 300 x 150 as in HTML. */
export function svgSize(text: string): [number, number] {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? '';
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  const abs = (v?: string) => (v && /^\s*[\d.]+\s*(px)?\s*$/.test(v) ? parseFloat(v) : NaN);
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  let w = abs(attr('width')), h = abs(attr('height'));
  const vw = vb?.length === 4 ? vb[2]! : NaN, vh = vb?.length === 4 ? vb[3]! : NaN;
  if (!(w > 0) && !(h > 0)) { w = vw; h = vh; }
  else if (!(w > 0)) w = (h * vw) / vh;
  else if (!(h > 0)) h = (w * vh) / vw;
  return w > 0 && h > 0 ? [w, h] : [300, 150];
}

/** Linear floats as half-float bits for a HalfFloatType texture. */
function halfFloats(f: Float32Array): Uint16Array {
  const F16 = (globalThis as { Float16Array?: new (a: Float32Array) => { buffer: ArrayBuffer } }).Float16Array;
  if (F16) return new Uint16Array(new F16(f).buffer);
  const o = new Uint16Array(f.length);
  for (let i = 0; i < f.length; i++) o[i] = THREE.DataUtils.toHalfFloat(f[i]!);
  return o;
}

/**
 * An image fitted to a box. Make it in a scene's field; it loads before the first frame. Draw it with
 * `image.draw(renderer, out, f)`.
 */
export class ImageBox {
  readonly box: Box;
  private o: ImageBoxOptions;
  private tex: THREE.Texture | null = null;
  private size: [number, number] = [1, 1];
  /** The asset id when this is a placeholder for a missing generated asset. */
  missing: string | null = null;

  constructor(o: ImageBoxOptions) {
    this.o = o;
    this.box = o.box ?? safeBox();
    awaitBeforeFirstFrame(this.load().catch(async (e: unknown) => {
      const a = await declaredAsset(o.src);
      if (!a) throw new Error(`image '${o.src}' did not load (a path in the project, served from its folder): ${e instanceof Error ? e.message : e}`);
      this.missing = a.id;
      const c = assetPlaceholder(a);
      this.use(new THREE.Texture(c), c.width, c.height);
    }));
  }

  private use(t: THREE.Texture, w: number, h: number) {
    t.flipY = false;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 8;
    t.needsUpdate = true;
    this.tex = t;
    this.size = [w, h];
  }

  /**
   * Decode the file in the colours it was made in: through an ImageBitmap, which converts an image with a colour
   * profile (Display P3, Adobe RGB) to sRGB (an <img> uploaded to GL keeps its numbers and shows them as sRGB); a
   * 16-bit PNG by reel's own decoder into a half-float texture (the browser keeps 8 bits); an SVG rasterised at the
   * size it is shown, times the output scale and the furthest zoom.
   */
  private async load() {
    const res = await fetch(this.o.src);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get('content-type') ?? '';
    if (pngDepth(bytes) === 16) {
      const p = await decodePng16(bytes);
      if (p) {
        const t = new THREE.DataTexture(halfFloats(p.data), p.width, p.height, THREE.RGBAFormat, THREE.HalfFloatType);
        t.colorSpace = THREE.LinearSRGBColorSpace;
        this.use(t, p.width, p.height);
        return;
      }
    }
    if (type.includes('svg') || /\.svg$/i.test(this.o.src)) { await this.loadSvg(new TextDecoder().decode(bytes)); return; }
    const bm = await createImageBitmap(new Blob([bytes], { type }), { colorSpaceConversion: 'default', premultiplyAlpha: 'none', imageOrientation: 'from-image' });
    const t = new THREE.Texture(bm as unknown as HTMLImageElement);
    t.colorSpace = THREE.SRGBColorSpace;
    this.use(t, bm.width, bm.height);
  }

  private async loadSvg(text: string) {
    const [iw, ih] = svgSize(text);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    try { img.src = url; await img.decode(); } finally { URL.revokeObjectURL(url); }
    // the image's size on screen at its furthest zoom, in physical px
    const b = this.box, kb = this.o.kenBurns, zoom = Math.max(1, ...(kb === true ? [1.12] : kb ? [kb.from?.zoom ?? 1, kb.to?.zoom ?? 1] : [1]));
    const s = (this.o.fit === 'contain' ? Math.min(b.w / iw, b.h / ih) : Math.max(b.w / iw, b.h / ih)) * zoom * SCALE;
    const k = Math.min(s, 8192 / Math.max(iw, ih));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(iw * k)); c.height = Math.max(1, Math.ceil(ih * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const t = new THREE.Texture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.use(t, iw, ih);
  }

  draw(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, f: Frame, o: { opacity?: number } = {}) {
    if (!this.tex) return;
    const [w0, w1] = this.o.at ?? [0, f.end - f.start];
    drawPicture(renderer, out, f, {
      tex: this.tex, size: this.size, box: this.box, fit: this.o.fit, radius: this.o.radius, framing: kenBurnsAt(this.o.kenBurns, f.lt, w0, w1),
      label: this.missing ? `missing asset ${this.missing}` : this.o.label ?? this.o.alt ?? this.o.src,
    }, this.o.motion ?? { from: 'fade' }, w0, w1, o.opacity ?? 1);
  }
}
