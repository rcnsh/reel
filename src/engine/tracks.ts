import * as THREE from 'three';
import { FSPass, PW, PH, SCALE } from './gl';
import { HEX, TONE, colorLinear, glslName, isColor } from './palette';

export interface Grade {
  /** Gain on the colour (default 1; 2 is a stop brighter). */
  exposure?: number;
  /** 0 is grey, 1 unchanged (default), above 1 more saturated. */
  saturation?: number;
  /** Contrast around mid-grey (linear 0.18): 1 unchanged (default), above 1 harder, below softer. */
  contrast?: number;
  /** A colour the track is multiplied by: a palette key or '#rrggbb' (white does nothing), or linear [r, g, b] gains. */
  tint?: string | [number, number, number];
  /** 0..1: the track fades out: to transparent on a track above 0 (and in a transparent render), to black on track 0. */
  fade?: number;
  flash?: number;
  /** A Gaussian blur of the track, its standard deviation in logical px (as CSS `blur()`), 0 to 100 (default 0). */
  blur?: number;
}

export type MatteMode = 'alpha' | 'alpha-inverted' | 'luma' | 'luma-inverted';
export const MATTE_MODES: readonly MatteMode[] = ['alpha', 'alpha-inverted', 'luma', 'luma-inverted'];

export interface Matte {
  mode: MatteMode;
  from?: 'above' | 'below';
}

/** Blend modes the Compositor draws with fixed-function blending (and 'replace', which hides what is below). */
export const SIMPLE_BLENDS = ['normal', 'add', 'screen', 'multiply', 'max', 'replace'] as const;
export const SHADER_BLENDS = ['overlay', 'soft-light', 'hard-light', 'difference', 'color-dodge'] as const;
export type ShaderBlend = (typeof SHADER_BLENDS)[number];
export type TrackBlend = (typeof SIMPLE_BLENDS)[number] | ShaderBlend;
const BLENDS: readonly string[] = [...SIMPLE_BLENDS, ...SHADER_BLENDS];

export interface TrackSettings {
  blend?: TrackBlend;
  opacity?: number;
  grade?: Grade;
  matte?: MatteMode | Matte;
}

const GRADE_KEYS = ['exposure', 'saturation', 'contrast', 'tint', 'fade', 'flash', 'blur'] as const;
const TRACK_KEYS = ['blend', 'opacity', 'grade', 'matte'] as const satisfies readonly (keyof TrackSettings)[];
const isObj = (o: unknown): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o);
const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function gradeOf(g: unknown, where: string): Grade {
  const fail = (m: string): never => { throw new Error(`${where}: grade ${JSON.stringify(g)}: ${m}`); };
  if (!isObj(g)) return fail(`expected an object with any of ${GRADE_KEYS.join(', ')}`);
  for (const k of Object.keys(g)) if (!(GRADE_KEYS as readonly string[]).includes(k)) fail(`unknown key '${k}' (expected ${GRADE_KEYS.join(', ')})`);
  const range: [keyof Grade, number, number, string][] = [
    ['exposure', 0, 64, 'exposure must be a gain from 0 to 64'], ['saturation', 0, 4, 'saturation must be from 0 to 4'],
    ['contrast', 0.1, 4, 'contrast must be from 0.1 to 4'], ['fade', 0, 1, 'fade must be from 0 to 1'],
    ['flash', 0, 16, 'flash must be from 0 to 16'], ['blur', 0, 100, 'blur must be a radius from 0 to 100 logical px'],
  ];
  for (const [k, lo, hi, m] of range) if (g[k] !== undefined && !num(g[k], lo, hi)) fail(m);
  const t = g.tint;
  if (t !== undefined && !(typeof t === 'string' ? isColor(t) : Array.isArray(t) && t.length === 3 && t.every((x) => num(x, 0, 64))))
    fail(`tint must be '#rrggbb', a palette key (${Object.keys(HEX).join(', ')}) or [r, g, b] linear gains from 0 to 64`);
  return g as Grade;
}

export function matteOf(m: unknown, where: string): Required<Matte> {
  const fail = (msg: string): never => { throw new Error(`${where}: matte ${JSON.stringify(m)}: ${msg}`); };
  const o = typeof m === 'string' ? { mode: m } : m;
  if (!isObj(o)) return fail(`expected ${MATTE_MODES.join(', ')} or { mode, from?: 'above' | 'below' }`);
  for (const k of Object.keys(o)) if (k !== 'mode' && k !== 'from') fail(`unknown key '${k}' (expected mode, from)`);
  if (!MATTE_MODES.includes(o.mode as MatteMode)) fail(`mode must be one of ${MATTE_MODES.join(', ')}`);
  if (o.from !== undefined && o.from !== 'above' && o.from !== 'below') fail(`from must be 'above' or 'below'`);
  return { mode: o.mode as MatteMode, from: (o.from as 'above' | 'below' | undefined) ?? 'above' };
}

export function blendOf(b: unknown, where: string): TrackBlend {
  if (!BLENDS.includes(b as string)) throw new Error(`${where}: blend ${JSON.stringify(b)}: expected one of ${BLENDS.join(', ')}`);
  return b as TrackBlend;
}

export function opacityOf(o: unknown, where: string): number {
  if (!num(o, 0, 64)) throw new Error(`${where}: opacity ${JSON.stringify(o)}: expected a number from 0 (usually up to 1)`);
  return o as number;
}

export function trackSettingsOf(tracks: unknown): Map<number, TrackSettings> {
  const out = new Map<number, TrackSettings>();
  if (tracks === undefined) return out;
  if (!isObj(tracks)) throw new Error(`tracks: expected an object keyed by track number, { 1: { blend: 'overlay' } }`);
  for (const [k, v] of Object.entries(tracks)) {
    const n = Number(k), where = `tracks[${k}]`;
    if (!Number.isInteger(n) || n < 0 || String(n) !== k) throw new Error(`${where}: a track is a whole number from 0`);
    if (!isObj(v)) throw new Error(`${where}: expected { ${TRACK_KEYS.map((x) => `${x}?`).join(', ')} }`);
    for (const key of Object.keys(v)) if (!(TRACK_KEYS as readonly string[]).includes(key)) throw new Error(`${where}: unknown key '${key}' (expected ${TRACK_KEYS.join(', ')})`);
    if (v.blend !== undefined) blendOf(v.blend, where);
    if (v.opacity !== undefined) opacityOf(v.opacity, where);
    if (v.grade !== undefined) gradeOf(v.grade, where);
    if (v.matte !== undefined) matteOf(v.matte, where);
    out.set(n, v as TrackSettings);
  }
  return out;
}

export function matteSource(tn: number, m: Required<Matte>, tracks: number[], where: string): number {
  const s = [...new Set(tracks)].sort((a, b) => a - b);
  const src = m.from === 'above' ? s.find((x) => x > tn) : s.filter((x) => x < tn).pop();
  if (src === undefined) throw new Error(`${where}: matte from ${m.from}: there is no track ${m.from} track ${tn}`);
  return src;
}

export interface GradeValues { exposure: number; saturation: number; contrast: number; tint: [number, number, number]; fade: number; flash: number; blur: number }
export const IDENTITY_GRADE: GradeValues = { exposure: 1, saturation: 1, contrast: 1, tint: [1, 1, 1], fade: 0, flash: 0, blur: 0 };

export function resolveGrade(...gs: (Grade | undefined)[]): GradeValues {
  const g: Grade = Object.assign({}, ...gs.filter(Boolean));
  const tint = g.tint === undefined ? IDENTITY_GRADE.tint : typeof g.tint === 'string' ? colorLinear(g.tint) : g.tint;
  return { exposure: g.exposure ?? 1, saturation: g.saturation ?? 1, contrast: g.contrast ?? 1, tint: [tint[0], tint[1], tint[2]], fade: g.fade ?? 0, flash: g.flash ?? 0, blur: g.blur ?? 0 };
}

export function lerpGrade(a: GradeValues, b: GradeValues, k: number): GradeValues {
  const l = (x: number, y: number) => x + (y - x) * k;
  return {
    exposure: l(a.exposure, b.exposure), saturation: l(a.saturation, b.saturation), contrast: l(a.contrast, b.contrast),
    tint: [l(a.tint[0], b.tint[0]), l(a.tint[1], b.tint[1]), l(a.tint[2], b.tint[2])], fade: l(a.fade, b.fade), flash: l(a.flash, b.flash), blur: l(a.blur, b.blur),
  };
}

export function isIdentityGrade(g: GradeValues) {
  return g.exposure === 1 && g.saturation === 1 && g.contrast === 1 && g.tint.every((x) => x === 1) && g.fade === 0 && g.flash === 0 && g.blur === 0;
}

export class TrackFx {
  private downPass = new FSPass(`
    uniform sampler2D src; uniform int d;
    void main() {
      ivec2 p0 = ivec2(gl_FragCoord.xy) * d, lim = textureSize(src, 0) - 1;
      vec4 c = vec4(0.0);
      for (int y = 0; y < 64; y++) { if (y >= d) break; for (int x = 0; x < 64; x++) { if (x >= d) break; c += texelFetch(src, min(p0 + ivec2(x, y), lim), 0); } }
      fragColor = c / float(d * d);
    }`, { src: { value: null }, d: { value: 1 } });
  private blurPass = new FSPass(`
    uniform sampler2D src; uniform vec2 dir; uniform float sigma; uniform int taps;
    void main() {
      float dx = 3.0 * sigma / float(taps);
      vec4 c = texture(src, vUv);
      float wsum = 1.0;
      for (int i = 1; i <= 48; i++) {
        if (i > taps) break;
        float x = float(i) * dx, w = exp(-0.5 * x * x / (sigma * sigma));
        vec2 o = dir * x;
        c += (texture(src, vUv + o) + texture(src, vUv - o)) * w;
        wsum += 2.0 * w;
      }
      fragColor = c / wsum;
    }`, { src: { value: null }, dir: { value: new THREE.Vector2() }, sigma: { value: 1 }, taps: { value: 1 } });
  private gradePass = new FSPass(`
    uniform sampler2D src; uniform vec2 srcScale; uniform sampler2D matteTex; uniform int matte; uniform bool grade, upper;
    uniform float exposure, saturation, contrast, fade, flash; uniform vec3 tint;
    void main() {
      vec4 c = texture(src, vUv * srcScale);
      if (grade) {
        vec3 s = c.a > 1e-6 ? c.rgb / c.a : vec3(0.0);
        s *= exposure * tint;
        s = max(mix(vec3(luma(s)), s, saturation), 0.0);
        if (contrast != 1.0) s = 0.18 * pow(s / 0.18, vec3(contrast));
        s += ${glslName(TONE.light)} * flash;
        c.rgb = s * c.a;
        c.rgb *= 1.0 - fade;
        if (upper) c.a *= 1.0 - fade;
      }
      if (matte > 0) {
        vec4 m = texture(matteTex, vUv);
        float k = matte <= 2 ? m.a : toSRGB(vec3(sat(luma(m.rgb)))).x;
        if (matte == 2 || matte == 4) k = 1.0 - k;
        c *= k;
      }
      fragColor = c;
    }`, {
    src: { value: null }, srcScale: { value: new THREE.Vector2(1, 1) }, matteTex: { value: null }, matte: { value: 0 }, grade: { value: false }, upper: { value: false },
    exposure: { value: 1 }, saturation: { value: 1 }, contrast: { value: 1 }, fade: { value: 0 }, flash: { value: 0 }, tint: { value: new THREE.Vector3(1, 1, 1) },
  });
  private blurRTs: { d: number; rts: THREE.WebGLRenderTarget[] } | null = null;

  draw(renderer: THREE.WebGLRenderer, src: THREE.Texture, out: THREE.WebGLRenderTarget, g: GradeValues | null, matte: { tex: THREE.Texture; mode: MatteMode } | null, upper: boolean) {
    let tex = src;
    const u = this.gradePass.u, scale = u.srcScale!.value as THREE.Vector2;
    scale.set(1, 1);
    if (g && g.blur > 0) {
      const sigmaPx = g.blur * SCALE, d = Math.max(1, Math.floor(sigmaPx / 8)), w = Math.ceil(PW / d), h = Math.ceil(PH / d);
      if (this.blurRTs?.d !== d) {
        for (const rt of this.blurRTs?.rts ?? []) rt.dispose();
        const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
        this.blurRTs = { d, rts: [0, 1, 2].map(() => new THREE.WebGLRenderTarget(w, h, opts)) };
      }
      const [small, a, b] = this.blurRTs.rts as [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
      if (d > 1) {
        this.downPass.u.src!.value = tex; this.downPass.u.d!.value = d;
        this.downPass.render(renderer, small);
        tex = small.texture;
      }
      const bu = this.blurPass.u, sigma = sigmaPx / d;
      bu.sigma!.value = sigma; bu.taps!.value = Math.max(1, Math.min(48, Math.ceil(3 * sigma)));
      bu.src!.value = tex; (bu.dir!.value as THREE.Vector2).set(1 / w, 0);
      this.blurPass.render(renderer, a);
      bu.src!.value = a.texture; (bu.dir!.value as THREE.Vector2).set(0, 1 / h);
      this.blurPass.render(renderer, b);
      tex = b.texture;
      scale.set(PW / (w * d), PH / (h * d));
    }
    u.src!.value = tex;
    u.grade!.value = !!g;
    u.upper!.value = upper;
    if (g) {
      u.exposure!.value = g.exposure; u.saturation!.value = g.saturation; u.contrast!.value = g.contrast;
      u.fade!.value = g.fade; u.flash!.value = g.flash; (u.tint!.value as THREE.Vector3).set(...g.tint);
    }
    u.matte!.value = matte ? MATTE_MODES.indexOf(matte.mode) + 1 : 0;
    u.matteTex!.value = matte?.tex ?? null;
    this.gradePass.render(renderer, out);
  }
}

export class BlendPass {
  private pass = new FSPass(`
    uniform sampler2D base; uniform sampler2D top; uniform float opacity; uniform int mode;
    float softD(float x) { return x <= 0.25 ? ((16.0 * x - 12.0) * x + 4.0) * x : sqrt(x); }
    vec3 hard(vec3 b, vec3 s) { return mix(b * 2.0 * s, b + (2.0 * s - 1.0) - b * (2.0 * s - 1.0), step(0.5, s)); }
    vec3 soft(vec3 b, vec3 s) {
      vec3 d = vec3(softD(b.r), softD(b.g), softD(b.b));
      return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
    }
    vec3 blendFn(vec3 cb, vec3 cs) {
      if (mode == 3) return abs(cb - cs);
      if (mode == 4) return mix(min(cb / max(1.0 - cs, 1.0 / 16.0), vec3(16.0)), vec3(0.0), step(cb, vec3(0.0)));
      vec3 b = toSRGB(sat(cb)), s = toSRGB(sat(cs));
      return toLinear(mode == 0 ? hard(s, b) : mode == 1 ? soft(b, s) : hard(b, s));
    }
    void main() {
      vec4 s = texture(top, vUv) * opacity, b = texture(base, vUv);
      vec3 cs = s.a > 1e-6 ? s.rgb / s.a : vec3(0.0), cb = b.a > 1e-6 ? b.rgb / b.a : vec3(0.0);
      fragColor = vec4(s.rgb * (1.0 - b.a) + b.rgb * (1.0 - s.a) + s.a * b.a * blendFn(cb, cs), s.a + b.a - s.a * b.a);
    }`, { base: { value: null }, top: { value: null }, opacity: { value: 1 }, mode: { value: 0 } });

  draw(renderer: THREE.WebGLRenderer, base: THREE.Texture, top: THREE.Texture, out: THREE.WebGLRenderTarget, mode: ShaderBlend, opacity = 1) {
    const u = this.pass.u;
    u.base!.value = base; u.top!.value = top; u.opacity!.value = opacity; u.mode!.value = SHADER_BLENDS.indexOf(mode);
    this.pass.render(renderer, out);
  }
}

export const isShaderBlend = (m: string): m is ShaderBlend => (SHADER_BLENDS as readonly string[]).includes(m);
