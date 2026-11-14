// An image in a box, drawn in GL from the source file: cover or contain, rounded corners, and a Ken Burns pan and
// zoom that is a pure function of time (evaluated per sub-frame, so it is smooth and motion blurred).
import * as THREE from 'three';
import { FSPass, H } from '../engine/gl';
import { assetPlaceholder, declaredAsset } from '../engine/assets';
import { awaitBeforeFirstFrame } from '../engine/html';
import { report, reporting } from '../engine/report';
import type { Frame } from '../engine/scene';
import { clamp, ease } from '../engine/util';
import { motionAt, safeBox, type Box, type ComponentOptions } from './common';

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
function imagePass() {
  pass ??= new FSPass(/* glsl */ `
    uniform sampler2D tex; uniform vec4 box; uniform vec2 extent, centre; uniform float radius, opacity, frameH;
    void main() {
      vec2 p = vec2(FRAG_PX.x, frameH - FRAG_PX.y), q = (p - box.xy) / box.zw;
      vec2 d = abs(p - box.xy - box.zw * 0.5) - (box.zw * 0.5 - radius);
      float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
      float m = clamp(0.5 - sd * PX_SCALE, 0.0, 1.0);   // the box with rounded corners, antialiased over a physical px
      if (m <= 0.0) discard;
      vec2 uv = centre + (q - 0.5) * extent;             // the image's uv, row 0 at the top
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
      vec4 c = texture(tex, uv);
      fragColor = vec4(c.rgb * c.a, c.a) * m * opacity;
    }`, { tex: { value: null }, box: { value: new THREE.Vector4() }, extent: { value: new THREE.Vector2() }, centre: { value: new THREE.Vector2() }, radius: { value: 0 }, opacity: { value: 1 }, frameH: { value: H } },
  { blending: THREE.CustomBlending, transparent: true });
  const mt = pass.mat;
  mt.blendEquation = THREE.AddEquation;
  mt.blendSrc = THREE.OneFactor; mt.blendDst = THREE.OneMinusSrcAlphaFactor;
  mt.blendSrcAlpha = THREE.OneFactor; mt.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return pass;
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
    const img = new Image();
    img.src = o.src;
    const use = (src: HTMLImageElement | HTMLCanvasElement, w: number, h: number) => {
      const t = new THREE.Texture(src);
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = 8;
      t.needsUpdate = true;
      this.tex = t;
      this.size = [w, h];
    };
    awaitBeforeFirstFrame(img.decode().then(() => use(img, img.naturalWidth, img.naturalHeight), async () => {
      const a = await declaredAsset(o.src);
      if (!a) throw new Error(`image '${o.src}' did not load (a path in the project, served from its folder)`);
      this.missing = a.id;
      const c = assetPlaceholder(a);
      use(c, c.width, c.height);
    }));
  }

  /** The framing at clip time lt: the Ken Burns move across the component's window, eased. */
  private framing(lt: number, w0: number, w1: number): Required<Framing> {
    const kb = this.o.kenBurns;
    if (!kb) return { zoom: 1, x: 0, y: 0 };
    const from = { zoom: 1, x: 0, y: 0, ...(kb === true ? {} : kb.from) }, to = { zoom: 1.12, x: 0.25, y: -0.15, ...(kb === true ? {} : kb.to) };
    const k = ease.inOutQuad(clamp((lt - w0) / Math.max(1e-3, w1 - w0)));
    return { zoom: from.zoom + (to.zoom - from.zoom) * k, x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
  }

  draw(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, f: Frame, o: { opacity?: number } = {}) {
    if (!this.tex) return;
    const [w0, w1] = this.o.at ?? [0, f.end - f.start];
    const m = motionAt(this.o.motion ?? { from: 'fade' }, f.lt, w0, w1);
    if (!m) return;
    const b = this.box, [iw, ih] = this.size, fr = this.framing(f.lt, w0, w1);
    // the share of the image across the box: cover crops one axis, contain leaves room on one (then zoom crops)
    const s = this.o.fit === 'contain' ? Math.min(b.w / iw, b.h / ih) : Math.max(b.w / iw, b.h / ih);
    const ex = b.w / (iw * s) / fr.zoom, ey = b.h / (ih * s) / fr.zoom;
    const cx = 0.5 + fr.x * Math.max(0, (1 - ex) / 2), cy = 0.5 + fr.y * Math.max(0, (1 - ey) / 2);
    const p = imagePass(), x = b.x + m.dx, y = b.y + m.dy;
    p.u.tex!.value = this.tex;
    (p.u.box!.value as THREE.Vector4).set(x + (b.w * (1 - m.scale)) / 2, y + (b.h * (1 - m.scale)) / 2, b.w * m.scale, b.h * m.scale);
    (p.u.extent!.value as THREE.Vector2).set(ex, ey);
    (p.u.centre!.value as THREE.Vector2).set(cx, cy);
    p.u.radius!.value = Math.min(this.o.radius ?? 0, b.w / 2, b.h / 2);
    p.u.opacity!.value = m.opacity * (o.opacity ?? 1);
    p.render(renderer, out);
    if (reporting()) {
      // (contain: the image's own rectangle inside the box)
      const vw = Math.min(b.w, iw * s * fr.zoom), vh = Math.min(b.h, ih * s * fr.zoom);
      report({ kind: 'image', x: x + (b.w - vw) / 2, y: y + (b.h - vh) / 2, w: vw, h: vh, alpha: m.opacity * (o.opacity ?? 1), label: this.missing ? `missing asset ${this.missing}` : this.o.label ?? this.o.alt ?? this.o.src });
    }
  }
}
