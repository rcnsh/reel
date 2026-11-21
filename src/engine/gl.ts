import * as THREE from 'three';
import { GLSL_COMMON } from './glsl/common';
import { W, H, FPS, SCALE, ALPHA } from './format';
import { LIN } from './palette';

export { W, H, FPS, SCALE, ALPHA };
export const PW = W * SCALE;
export const PH = H * SCALE;

export const SS_TAP: THREE.IUniform<number> = { value: -1 };
export const SS_TAP_GLSL = /* glsl */ `
uniform int ssTap;
int ssK0() { return ssTap < 0 ? 0 : ssTap; }
int ssK1() { return ssTap < 0 ? 4 : ssTap + 1; }
float ssWeight() { return ssTap < 0 ? 0.25 : 1.0; }`;

export const SUB_FRAME = { index: -1 };

const RT_SCALE = new WeakMap<THREE.WebGLRenderTarget, number>();
/** Physical px per logical px of a render target made by makeRT (1 for other targets; SCALE for the canvas). */
export function rtScale(rt: THREE.WebGLRenderTarget | null) { return rt ? RT_SCALE.get(rt) ?? 1 : SCALE; }

export function makeRT(w = W, h = H, opts: Partial<THREE.RenderTargetOptions> & { pxScale?: number } = {}) {
  const { pxScale = SCALE, ...o } = opts;
  const rt = new THREE.WebGLRenderTarget(Math.max(1, Math.round(w * pxScale)), Math.max(1, Math.round(h * pxScale)), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    ...o,
  });
  RT_SCALE.set(rt, pxScale);
  return rt;
}

const FS_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

let fsGeom: THREE.BufferGeometry | null = null;
function fullscreenGeometry() {
  if (!fsGeom) {
    fsGeom = new THREE.BufferGeometry();
    fsGeom.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  }
  return fsGeom;
}

export class FSPass {
  mat: THREE.RawShaderMaterial;
  mesh: THREE.Mesh;
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** `prelude`: GLSL put before `frag` in place of GLSL_COMMON (for source written elsewhere, whose names it must not clash with). */
  constructor(frag: string, uniforms: Record<string, THREE.IUniform> = {}, opts: { blending?: THREE.Blending; transparent?: boolean; prelude?: string } = {}) {
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: `precision highp float;\nin vec3 position;\n${FS_VERT}`,
      fragmentShader: `precision highp float;\nprecision highp int;\nin vec2 vUv;\nout vec4 fragColor;\n${opts.prelude ?? GLSL_COMMON}\n${frag}`,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: opts.blending ?? THREE.NoBlending,
      transparent: opts.transparent ?? false,
    });
    this.mesh = new THREE.Mesh(fullscreenGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  get u() { return this.mat.uniforms; }
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null, clear = false) {
    renderer.setRenderTarget(target);
    if (clear) renderer.clear();
    renderer.render(this.scene, this.cam);
  }
}

export type BlendMode = 'normal' | 'add' | 'screen' | 'multiply' | 'max' | 'replace';

export function compositorFrag(opacity: { uniform: string; expr: string }) {
  return /* glsl */ `
    uniform sampler2D tex; ${opacity.uniform} uniform vec3 tint; uniform vec4 uvXform; uniform bool premult;
    void main() {
      vec2 uv = (vUv - 0.5) * uvXform.xy + 0.5 + uvXform.zw;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
      vec4 c = texture(tex, uv);
      c.rgb *= tint;
      if (premult) c.rgb *= c.a;
      fragColor = vec4(c.rgb, c.a) * ${opacity.expr};
    }`;
}

export class Compositor {
  private passes = new Map<BlendMode, FSPass>();
  private frag = compositorFrag({ uniform: 'uniform float opacity;', expr: 'opacity' });
  private get(mode: BlendMode) {
    let p = this.passes.get(mode);
    if (!p) {
      const u = { tex: { value: null }, opacity: { value: 1 }, tint: { value: new THREE.Vector3(1, 1, 1) }, uvXform: { value: new THREE.Vector4(1, 1, 0, 0) }, premult: { value: true } };
      p = new FSPass(this.frag, u, { blending: THREE.CustomBlending, transparent: true });
      const m = p.mat;
      m.blendEquation = THREE.AddEquation;
      if (mode === 'normal') { m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor; }
      if (mode === 'add') { m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; }
      if (mode === 'screen') { m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcColorFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; }
      if (mode === 'multiply') { m.blendSrc = THREE.DstColorFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; }
      if (mode === 'max') { m.blendEquation = THREE.MaxEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor; }
      if (mode === 'replace') { m.blending = THREE.NoBlending; }
      this.passes.set(mode, p);
    }
    return p;
  }
  draw(renderer: THREE.WebGLRenderer, tex: THREE.Texture, target: THREE.WebGLRenderTarget | null, o: { mode?: BlendMode; opacity?: number; tint?: [number, number, number]; scale?: [number, number]; offset?: [number, number]; premult?: boolean } = {}) {
    const p = this.get(o.mode ?? 'normal');
    p.u.tex!.value = tex;
    p.u.opacity!.value = o.opacity ?? 1;
    (p.u.tint!.value as THREE.Vector3).set(...(o.tint ?? [1, 1, 1]));
    (p.u.uvXform!.value as THREE.Vector4).set(o.scale?.[0] ?? 1, o.scale?.[1] ?? 1, o.offset?.[0] ?? 0, o.offset?.[1] ?? 0);
    p.u.premult!.value = o.premult ?? o.mode !== 'multiply';
    p.render(renderer, target);
  }
}

export function scaleContext2D(c: CanvasRenderingContext2D, s: number) {
  if (s === 1) return c;
  const proto = CanvasRenderingContext2D.prototype;
  const setT = proto.setTransform as (this: CanvasRenderingContext2D, a: number, b: number, c: number, d: number, e: number, f: number) => void;
  const getT = proto.getTransform;
  c.setTransform = function (this: CanvasRenderingContext2D, a?: number | DOMMatrix2DInit, b?: number, cc?: number, d?: number, e?: number, f?: number) {
    if (typeof a === 'number') return setT.call(this, a * s, b! * s, cc! * s, d! * s, e! * s, f! * s);
    const m = new DOMMatrix([(a?.a ?? a?.m11 ?? 1), (a?.b ?? a?.m12 ?? 0), (a?.c ?? a?.m21 ?? 0), (a?.d ?? a?.m22 ?? 1), (a?.e ?? a?.m41 ?? 0), (a?.f ?? a?.m42 ?? 0)]);
    return setT.call(this, m.a * s, m.b * s, m.c * s, m.d * s, m.e * s, m.f * s);
  } as CanvasRenderingContext2D['setTransform'];
  c.resetTransform = function (this: CanvasRenderingContext2D) { setT.call(this, s, 0, 0, s, 0, 0); };
  c.getTransform = function (this: CanvasRenderingContext2D) {
    const m = getT.call(this);
    return new DOMMatrix([m.a / s, m.b / s, m.c / s, m.d / s, m.e / s, m.f / s]);
  };
  for (const k of ['shadowBlur', 'shadowOffsetX', 'shadowOffsetY'] as const) {
    const d = Object.getOwnPropertyDescriptor(proto, k)!;
    Object.defineProperty(c, k, { configurable: true, get() { return d.get!.call(this) / s; }, set(v: number) { d.set!.call(this, v * s); } });
  }
  const fd = Object.getOwnPropertyDescriptor(proto, 'filter')!;
  const px = (v: string, k: number) => v.replace(/(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)px/gi, (_, n: string) => `${+n * k}px`);
  Object.defineProperty(c, 'filter', { configurable: true, get() { return px(fd.get!.call(this), 1 / s); }, set(v: string) { fd.set!.call(this, px(String(v), s)); } });
  setT.call(c, s, 0, 0, s, 0, 0);
  return c;
}

let cpuCanvases = false;
export function setCpuCanvases(on: boolean) { cpuCanvases = on; }
export function context2D(canvas: HTMLCanvasElement) { return canvas.getContext('2d', cpuCanvases ? { willReadFrequently: true } : undefined)!; }

export class Layer2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  constructor(public w = W, public h = H, scale = SCALE) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(w * scale);
    this.canvas.height = Math.round(h * scale);
    this.ctx = scaleContext2D(context2D(this.canvas), scale);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = true;
  }
  clear(color?: string) {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.filter = 'none';
    c.shadowBlur = 0;
    if (color) { c.fillStyle = color; c.fillRect(0, 0, this.w, this.h); }
    else c.clearRect(0, 0, this.w, this.h);
  }
  upload() { this.texture.needsUpdate = true; return this.texture; }
}

export function clearRT(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget | null, rgb: [number, number, number] = [0, 0, 0], a = 1) {
  if (ALPHA && a === 1 && isBg(rgb)) { rgb = [0, 0, 0]; a = 0; }
  const prev = renderer.getClearColor(new THREE.Color()).clone();
  const prevA = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace), a);
  renderer.clear(true, true, true);
  renderer.setClearColor(prev, prevA);
}

export function isBg(rgb: ArrayLike<number>) {
  const bg = LIN.bg;
  return Math.abs(rgb[0]! - bg[0]) < 1e-6 && Math.abs(rgb[1]! - bg[1]) < 1e-6 && Math.abs(rgb[2]! - bg[2]) < 1e-6;
}
