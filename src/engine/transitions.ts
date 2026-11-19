// Transitions between overlapping clips on one track: the incoming clip's `transition` (reel.config.ts) says
// how it replaces the outgoing one over their overlap. Each is a pure function of the overlap's progress, so a
// wipe or a slide is motion blurred like anything else.
import * as THREE from 'three';
import { FSPass } from './gl';
import { W, H } from './format';
import { HEX, TONE, glslName } from './palette';
import { clamp, ease, hexToLinear } from './util';

export type TransitionKind = 'crossfade' | 'wipe' | 'slide' | 'zoom' | 'dip' | 'iris' | 'clock' | 'whip' | 'flash';
export type TransitionDirection = 'left' | 'right' | 'up' | 'down';
/** A curve of the engine's easing set (`ease` in `reel`). */
export type EaseName = keyof typeof ease;
/** A custom transition's uniform: a float, vec2, vec3 or vec4. */
export type TransitionUniform = number | [number, number] | [number, number, number] | [number, number, number, number];

interface Eased {
  /**
   * The curve the overlap's progress runs through (a name from `ease`). Default: `linear` for a crossfade, dip,
   * flash and custom transition, `inOutExpo` for a whip, `inOutCubic` for the rest.
   */
  ease?: EaseName;
}
/** `crossfade` mixes the two; `zoom` grows the outgoing clip as it fades into the incoming one settling from slightly small; `flash` cuts at the middle through a flash of the theme's light colour, overexposed. */
export interface PlainTransition extends Eased { kind: 'crossfade' | 'zoom' | 'flash' }
/** Reveals the incoming clip behind an edge that travels across the frame. */
export interface WipeTransition extends Eased {
  kind: 'wipe';
  /** Which way the edge moves (default 'left': the incoming clip enters from the right). */
  direction?: TransitionDirection;
  /** The soft edge, as a share of the frame (default 0.08; 0 is a hard edge). */
  softness?: number;
}
/** `slide` pushes the outgoing clip off the frame with the incoming one; `whip` is a fast push that motion blur turns into a streak. */
export interface PushTransition extends Eased {
  kind: 'slide' | 'whip';
  /** Which way the clips move (default 'left': the incoming clip enters from the right). */
  direction?: TransitionDirection;
}
/** Fades to a colour and out of it. */
export interface DipTransition extends Eased {
  kind: 'dip';
  /**
   * A palette key or '#rrggbb' (default 'bg' on track 0; on a track above it, transparent, so the tracks below
   * show through the dip instead of a colour covering them).
   */
  color?: string;
}
/** A circle that opens from `center` onto the incoming clip (or, with `close`, closes onto it over the outgoing one). */
export interface IrisTransition extends Eased {
  kind: 'iris';
  /** The circle's centre as shares of the frame from its top left (default [0.5, 0.5]). */
  center?: [number, number];
  /** The soft edge, as a share of the circle's full radius (default 0.02). */
  softness?: number;
  /** Close onto the centre instead of opening from it: the outgoing clip shrinks into a circle (default false). */
  close?: boolean;
}
/** A hand sweeps round `center` from 12 o'clock, uncovering the incoming clip. */
export interface ClockTransition extends Eased {
  kind: 'clock';
  /** The centre the hand turns round, as shares of the frame from its top left (default [0.5, 0.5]). */
  center?: [number, number];
  /** The soft edge, as a share of a full turn (default 0.01). */
  softness?: number;
  /** Turn clockwise (default true). */
  clockwise?: boolean;
}
/**
 * A transition of your own: GLSL mixing the outgoing clip (`getFromColor(uv)`) and the incoming one
 * (`getToColor(uv)`) by `progress` (eased; 0 to 1 over the overlap). `glsl` is a function
 * `vec4 transition(vec2 uv) { … }` (the gl-transitions shape: their shaders paste in), or just its body, where
 * `p` is the progress, or a single expression. `ratio` is the frame's width over its height; the palette's
 * `C_<KEY>` constants are in scope, the engine's other GLSL helpers are not. Colours are linear and premultiplied.
 */
export interface CustomTransition extends Eased {
  kind?: never;
  glsl: string;
  /**
   * Uniforms the source reads, by name: a number is a float, an array of 2 to 4 a vec. Declared for you unless the
   * source declares them (then also as int, ivec, bool or bvec of that size); a declared uniform left out is 0.
   */
  uniforms?: Record<string, TransitionUniform>;
}

/** How a clip comes in over the clip before it on its track. */
export type Transition = PlainTransition | WipeTransition | PushTransition | DipTransition | IrisTransition | ClockTransition | CustomTransition;

export const TRANSITION_KINDS: readonly TransitionKind[] = ['crossfade', 'wipe', 'slide', 'zoom', 'dip', 'iris', 'clock', 'whip', 'flash'];
export const EASE_NAMES = Object.keys(ease) as EaseName[];
const DIRS: Record<TransitionDirection, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] };
/** What the engine knows of each kind: its own keys, its shader mode, its default curve, and how it draws. */
const KINDS: Record<TransitionKind, {
  keys: string[]; mode: number; ease: EaseName;
  /** A mix of the clips by the progress, which an overshooting curve would extrapolate past them (so it is clamped). */
  fade?: boolean;
  /** Reads the clips away from the pixel it lands on (the sampler cannot mask their tiles in place). */
  displaces?: boolean;
  softness?: number;
}> = {
  crossfade: { keys: [], mode: 0, ease: 'linear', fade: true },
  wipe: { keys: ['direction', 'softness'], mode: 1, ease: 'inOutCubic', softness: 0.08 },
  slide: { keys: ['direction'], mode: 2, ease: 'inOutCubic', displaces: true },
  whip: { keys: ['direction'], mode: 2, ease: 'inOutExpo', displaces: true },
  zoom: { keys: [], mode: 3, ease: 'inOutCubic', fade: true, displaces: true },
  dip: { keys: ['color'], mode: 4, ease: 'linear', fade: true },
  iris: { keys: ['center', 'softness', 'close'], mode: 5, ease: 'inOutCubic', softness: 0.02 },
  clock: { keys: ['center', 'softness', 'clockwise'], mode: 6, ease: 'inOutCubic', softness: 0.01 },
  flash: { keys: [], mode: 7, ease: 'linear', fade: true },
};
const CUSTOM_KEYS = ['glsl', 'uniforms'];
// the names a custom pass declares itself (its prelude is only the palette, so a pasted shader's own PI or
// helpers do not clash with the engine's)
const WRAPPER_NAMES = ['fromTex', 'toTex', 'progress', 'ratio', 'p', 'uv', 'transition', 'getFromColor', 'getToColor', 'main', 'vUv', 'fragColor'];
const PALETTE_GLSL = Object.entries(HEX).map(([k, v]) => `const vec3 ${glslName(k)} = vec3(${hexToLinear(v).map((x) => x.toFixed(5)).join(',')});`).join('\n');
const RESERVED = new Set([...WRAPPER_NAMES, ...Object.keys(HEX).map(glslName)]);
/** How many numbers a GLSL type takes (a uniform's value is a number for 1, an array for more), by type. */
const SIZE: Record<string, number> = { float: 1, int: 1, uint: 1, bool: 1 };
for (const n of [2, 3, 4]) for (const t of ['vec', 'ivec', 'uvec', 'bvec']) SIZE[`${t}${n}`] = n;
const sizeOf = (v: TransitionUniform) => (typeof v === 'number' ? 1 : v.length);
const floatType = (n: number) => (n === 1 ? 'float' : `vec${n}`);

/** The uniforms a GLSL source declares itself, by name: their types (`uniform highp vec2 a, b;` declares two). */
export function declaredUniforms(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const code = src.replace(/\/\*[^]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const m of code.matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+([^;]+);/g))
    for (const n of m[2]!.split(',')) { const name = /^\s*(\w+)/.exec(n)?.[1]; if (name) out.set(name, m[1]!); }
  return out;
}
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** A clip's `transition` as a Transition, checked (a misspelt kind or key is an error, not a crossfade). */
export function transitionOf(t: unknown, where: string): Transition {
  if (t === undefined) return { kind: 'crossfade' };
  const o = (typeof t === 'string' ? { kind: t } : t) as Record<string, unknown>;
  const fail = (m: string): never => { throw new Error(`${where}: transition ${JSON.stringify(t)}: ${m}`); };
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail(`expected ${TRANSITION_KINDS.join(', ')}, { kind, … } or { glsl, uniforms? }`);
  const custom = o.kind === undefined && has(o, 'glsl');
  if (!custom && !TRANSITION_KINDS.includes(o.kind as TransitionKind)) fail(`kind must be one of ${TRANSITION_KINDS.join(', ')} (or give glsl for a transition of your own)`);
  const allowed = custom ? [...CUSTOM_KEYS, 'ease'] : ['kind', ...KINDS[o.kind as TransitionKind].keys, 'ease'];
  for (const k of Object.keys(o)) {
    if (allowed.includes(k)) continue;
    if (k === 'dur' || k === 'duration') fail(`a transition lasts as long as its clip overlaps the one before it: start the clip earlier, or end the one before later`);
    fail(`unknown key '${k}' for ${custom ? 'a custom transition' : `a ${o.kind as string}`} (expected ${allowed.join(', ')})`);
  }
  if (o.ease !== undefined && !EASE_NAMES.includes(o.ease as EaseName)) fail(`ease must be one of ${EASE_NAMES.join(', ')}`);
  if (o.direction !== undefined && !has(DIRS, o.direction as string)) fail(`direction must be left, right, up or down`);
  if (o.softness !== undefined && !(typeof o.softness === 'number' && o.softness >= 0 && o.softness <= 1)) fail('softness must be a share from 0 to 1');
  if (o.color !== undefined && !(typeof o.color === 'string' && (/^#[0-9a-f]{6}$/i.test(o.color) || has(HEX, o.color)))) fail(`color must be '#rrggbb' or a palette key (${Object.keys(HEX).join(', ')})`);
  if (o.center !== undefined && !(Array.isArray(o.center) && o.center.length === 2 && o.center.every((v) => typeof v === 'number' && Number.isFinite(v)))) fail('center must be [x, y], shares of the frame from its top left');
  for (const k of ['close', 'clockwise']) if (o[k] !== undefined && typeof o[k] !== 'boolean') fail(`${k} must be true or false`);
  if (custom) {
    if (typeof o.glsl !== 'string' || !o.glsl.trim()) fail('glsl must be GLSL source: vec4 transition(vec2 uv) { … }, its body, or an expression');
    const u = o.uniforms;
    if (u !== undefined) {
      if (!u || typeof u !== 'object' || Array.isArray(u)) fail('uniforms must be { name: number | [x, y] | [x, y, z] | [x, y, z, w] }');
      const declared = declaredUniforms(o.glsl as string);
      for (const [name, v] of Object.entries(u as object)) {
        if (!/^[A-Za-z_]\w*$/.test(name) || name.startsWith('gl_') || RESERVED.has(name)) fail(`uniform '${name}' is not a free GLSL name (${RESERVED.has(name) ? `the custom pass declares ${WRAPPER_NAMES.join(', ')} and the palette's C_<KEY>` : 'a letter or _, then letters, digits or _, not gl_…'})`);
        const ok = (typeof v === 'number' && Number.isFinite(v)) || (Array.isArray(v) && v.length >= 2 && v.length <= 4 && v.every((x) => typeof x === 'number' && Number.isFinite(x)));
        if (!ok) fail(`uniform '${name}' must be a number or an array of 2 to 4 numbers`);
        const type = declared.get(name);
        if (type !== undefined && SIZE[type] !== sizeOf(v as TransitionUniform))
          fail(`uniform '${name}' is declared ${type} in the glsl, which takes ${SIZE[type] === undefined ? 'no value from uniforms' : SIZE[type] === 1 ? 'a number' : `an array of ${SIZE[type]}`}`);
      }
    }
  }
  return o as unknown as Transition;
}

/** The transition's easing curve: its `ease`, else its kind's default (linear for a custom transition). */
export function transitionEase(t: Transition): (x: number) => number {
  return ease[t.ease ?? (t.kind === undefined ? 'linear' : KINDS[t.kind].ease)];
}

/** A flash's strength at eased progress e: it builds to the light colour at the cut (e = 0.5) and decays from it. */
const flashAt = (e: number) => (1 - Math.min(1, Math.abs(2 * e - 1))) ** 2;

/**
 * How much of each clip shows at overlap progress k (0..1): what `reel check` scales the alpha of their text by.
 */
export function transitionWeights(t: Transition, k: number): [outgoing: number, incoming: number] {
  const e = clamp(transitionEase(t)(k));
  if (t.kind === 'dip') return [clamp(1 - 2 * e), clamp(2 * e - 1)];
  if (t.kind === 'flash') return e < 0.5 ? [1 - flashAt(e), 0] : [0, 1 - flashAt(e)];
  // (an iris uncovers an area that grows with the square of its radius)
  const i = t.kind === 'iris' ? (t.close ? 1 - (1 - e) ** 2 : e * e) : e;
  return [1 - i, i];
}

/** Transitions that read their clips away from the pixel they land on (the sampler cannot mask those clips' tiles in place). */
export function transitionDisplaces(t: Transition): boolean {
  return t.kind === undefined || !!KINDS[t.kind].displaces;
}

/** A custom transition's fragment source: the helpers it is promised, its uniforms and its glsl, wrapped. */
export function customSource(t: CustomTransition): string {
  const src = t.glsl.trim(), own = declaredUniforms(src);
  const decls = Object.entries(t.uniforms ?? {}).filter(([name]) => !own.has(name)).map(([name, v]) => `uniform ${floatType(sizeOf(v))} ${name};`);
  const fn = /\bvec4\s+transition\s*\(/.test(src) ? src
    : /\breturn\b/.test(src) ? `vec4 transition(vec2 uv) {\n  float p = progress;\n${src}\n}`
      : `vec4 transition(vec2 uv) {\n  float p = progress;\n  return (${src.replace(/;\s*$/, '')});\n}`;
  return `uniform sampler2D fromTex; uniform sampler2D toTex; uniform float progress; uniform float ratio;
${decls.join('\n')}
vec4 getFromColor(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(fromTex, uv); }
vec4 getToColor(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(toTex, uv); }
${fn}
void main() { fragColor = transition(vUv); }`;
}

/** Draws a transition of two clip textures into a target. */
export class TransitionPass {
  private pass = new FSPass(/* glsl */ `
    uniform sampler2D a; uniform sampler2D b; uniform float k, soft, aspect; uniform int mode; uniform bool rev;
    uniform vec2 dir, ctr; uniform vec3 col; uniform float colA;
    vec4 at(sampler2D t, vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(t, uv); }
    // the incoming clip shows where p (0..1 over the frame) is behind an edge at k, soft over soft
    float behind(float p) {
      float e = k * (1.0 + soft);
      return soft > 0.0 ? 1.0 - smoothstep(e - soft, e, p) : step(p, e);
    }
    void main() {
      vec2 uv = vUv;
      if (mode == 0) { fragColor = mix(texture(a, uv), texture(b, uv), k); return; }
      if (mode == 1 || mode == 5 || mode == 6) {
        float p;
        // a wipe's edge travels along dir from the side dir points away from
        if (mode == 1) p = dot(uv - 0.5, dir) + 0.5;
        else {
          vec2 q = (uv - ctr) * vec2(aspect, 1.0);
          if (mode == 5) {
            // an iris: the distance from the centre over the distance to the farthest corner
            p = length(q) / length(max(ctr, 1.0 - ctr) * vec2(aspect, 1.0));
            if (rev) p = 1.0 - p;
          } else {
            // a clock: the angle from 12 o'clock, clockwise (uv's y is up), as a share of a turn
            p = atan(q.x, q.y) / 6.283185307;
            if (p < 0.0) p += 1.0;
            if (rev) p = 1.0 - p;
          }
        }
        fragColor = mix(texture(a, uv), texture(b, uv), behind(p));
        return;
      }
      if (mode == 2) {
        // both move along dir by k frames: the outgoing clip leaves, the incoming one arrives from behind it
        vec2 ub = uv + dir * (1.0 - k);
        bool inB = ub.x >= 0.0 && ub.y >= 0.0 && ub.x <= 1.0 && ub.y <= 1.0;
        fragColor = inB ? texture(b, ub) : at(a, uv - dir * k);
        return;
      }
      if (mode == 3) {
        vec4 ca = at(a, (uv - 0.5) / (1.0 + 0.25 * k) + 0.5), cb = at(b, (uv - 0.5) / (0.85 + 0.15 * k) + 0.5);
        fragColor = mix(ca, cb, k);
        return;
      }
      if (mode == 7) {
        // a cut at the middle through the light colour overexposed (it burns out to white and blooms, even on a
        // light theme whose light colour is the background), over what the clips cover (premultiplied)
        float w = 1.0 - min(1.0, abs(2.0 * k - 1.0)); w *= w;
        vec4 base = k < 0.5 ? texture(a, uv) : texture(b, uv);
        fragColor = vec4(mix(base.rgb, col * (4.0 * base.a), w), base.a);
        return;
      }
      vec4 c = vec4(col * colA, colA); // (premultiplied: transparent on an upper track)
      fragColor = k < 0.5 ? mix(texture(a, uv), c, k * 2.0) : mix(c, texture(b, uv), k * 2.0 - 1.0);
    }`, {
    a: { value: null }, b: { value: null }, k: { value: 0 }, soft: { value: 0 }, aspect: { value: W / H }, mode: { value: 0 }, rev: { value: false },
    dir: { value: new THREE.Vector2() }, ctr: { value: new THREE.Vector2(0.5, 0.5) }, col: { value: new THREE.Vector3() }, colA: { value: 1 },
  });
  /**
   * Custom transitions' passes, one per distinct source, and each clip's (its transition is one object) with the
   * values of its uniforms: every uniform the source declares, 0 where the clip gives none (passes of one source
   * share a GL program, so a uniform left unset would show another clip's value).
   */
  private custom = new Map<string, FSPass>();
  private customOf = new WeakMap<CustomTransition, { pass: FSPass; values: [string, number | number[]][] }>();
  private scratch: THREE.WebGLRenderTarget | null = null;

  private customPass(t: CustomTransition) {
    let c = this.customOf.get(t);
    if (!c) {
      const src = customSource(t);
      let pass = this.custom.get(src);
      if (!pass) {
        pass = new FSPass(src, { fromTex: { value: null }, toTex: { value: null }, progress: { value: 0 }, ratio: { value: W / H } }, { prelude: PALETTE_GLSL });
        this.custom.set(src, pass);
      }
      const values = new Map<string, number | number[]>();
      for (const [name, type] of declaredUniforms(src)) {
        const n = SIZE[type];
        if (n !== undefined && !WRAPPER_NAMES.includes(name)) values.set(name, n === 1 ? 0 : new Array<number>(n).fill(0));
      }
      for (const [name, v] of Object.entries(t.uniforms ?? {})) values.set(name, typeof v === 'number' ? v : [...v]);
      c = { pass, values: [...values] };
      this.customOf.set(t, c);
    }
    // (plain arrays: three uploads them as they are to float, int and bool vectors alike)
    for (const [name, v] of c.values) (c.pass.u[name] ??= { value: v }).value = v;
    return c.pass;
  }

  /**
   * Compile a custom transition's shader now, by drawing it once off screen, so a source that does not compile
   * fails when the video loads rather than when its clip first comes in.
   */
  compile(renderer: THREE.WebGLRenderer, t: Transition) {
    if (t.kind !== undefined) return;
    this.scratch ??= new THREE.WebGLRenderTarget(1, 1);
    const prev = renderer.getRenderTarget();
    this.customPass(t).render(renderer, this.scratch);
    renderer.setRenderTarget(prev);
  }

  /**
   * Draw the transition from `a` (outgoing) to `b` (incoming) at overlap progress k into `out`. `upper`: the clips
   * are on a track above 0 (a dip without a colour of its own goes through transparent).
   */
  draw(renderer: THREE.WebGLRenderer, t: Transition, a: THREE.Texture, b: THREE.Texture, k: number, out: THREE.WebGLRenderTarget, upper = false) {
    const e = transitionEase(t)(k);
    if (t.kind === undefined) {
      const pass = this.customPass(t);
      pass.u.fromTex!.value = a;
      pass.u.toTex!.value = b;
      pass.u.progress!.value = e;
      pass.render(renderer, out);
      return;
    }
    const u = this.pass.u;
    u.a!.value = a;
    u.b!.value = b;
    const kind = KINDS[t.kind], o = t as Partial<Omit<WipeTransition, 'kind'> & Omit<PushTransition, 'kind'> & Omit<IrisTransition, 'kind'> & Omit<ClockTransition, 'kind'> & Omit<DipTransition, 'kind'>>;
    u.mode!.value = kind.mode;
    // (a mix past its ends extrapolates colours: an overshooting curve moves an edge or a push, not a fade)
    u.k!.value = kind.fade ? clamp(e) : e;
    u.soft!.value = o.softness ?? kind.softness ?? 0;
    (u.dir!.value as THREE.Vector2).set(...DIRS[o.direction ?? 'left']);
    const c = o.center ?? [0.5, 0.5];
    (u.ctr!.value as THREE.Vector2).set(c[0]!, 1 - c[1]!);
    u.rev!.value = !!o.close || o.clockwise === false;
    const color = o.color;
    u.colA!.value = upper && color === undefined ? 0 : 1;
    const hex = t.kind === 'flash' ? HEX[TONE.light]! : color === undefined ? HEX.bg! : color.startsWith('#') ? color : HEX[color]!;
    (u.col!.value as THREE.Vector3).set(...hexToLinear(hex));
    this.pass.render(renderer, out);
  }
}
