// Transitions between overlapping clips on one track: the incoming clip's `transition` (reel.config.ts) says
// how it replaces the outgoing one over their overlap. Each is a pure function of the overlap's progress, so a
// wipe or a slide is motion blurred like anything else.
import * as THREE from 'three';
import { FSPass } from './gl';
import { HEX } from './palette';
import { hexToLinear } from './util';

export type TransitionKind = 'crossfade' | 'wipe' | 'slide' | 'zoom' | 'dip';
export type TransitionDirection = 'left' | 'right' | 'up' | 'down';

/** How a clip comes in over the clip before it on its track. */
export interface Transition {
  /**
   * `crossfade` (the default) mixes the two; `wipe` reveals the incoming clip behind an edge that travels across
   * the frame; `slide` pushes the outgoing clip off the frame with the incoming one; `zoom` grows the outgoing clip
   * as it fades into the incoming one settling from slightly small; `dip` fades to a colour and out of it.
   */
  kind: TransitionKind;
  /** Which way a wipe's edge or a slide moves (default 'left': the incoming clip enters from the right). */
  direction?: TransitionDirection;
  /** A wipe's soft edge, as a share of the frame (default 0.08; 0 is a hard edge). */
  softness?: number;
  /** A dip's colour: a palette key or '#rrggbb' (default 'bg'). */
  color?: string;
}

export const TRANSITION_KINDS: readonly TransitionKind[] = ['crossfade', 'wipe', 'slide', 'zoom', 'dip'];
const DIRS: Record<TransitionDirection, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] };

/** A clip's `transition` as a Transition, checked (a misspelt kind or key is an error, not a crossfade). */
export function transitionOf(t: unknown, where: string): Transition {
  if (t === undefined) return { kind: 'crossfade' };
  const o = (typeof t === 'string' ? { kind: t } : t) as Record<string, unknown>;
  const fail = (m: string): never => { throw new Error(`${where}: transition ${JSON.stringify(t)}: ${m}`); };
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail(`expected ${TRANSITION_KINDS.join(', ')} or { kind, direction?, softness?, color? }`);
  for (const k of Object.keys(o)) if (!['kind', 'direction', 'softness', 'color'].includes(k)) fail(`unknown key '${k}' (expected kind, direction, softness, color)`);
  if (!TRANSITION_KINDS.includes(o.kind as TransitionKind)) fail(`kind must be one of ${TRANSITION_KINDS.join(', ')}`);
  if (o.direction !== undefined && !Object.prototype.hasOwnProperty.call(DIRS, o.direction as string)) fail(`direction must be left, right, up or down`);
  if (o.softness !== undefined && !(typeof o.softness === 'number' && o.softness >= 0 && o.softness <= 1)) fail('softness must be a share of the frame from 0 to 1');
  if (o.color !== undefined && !(typeof o.color === 'string' && (/^#[0-9a-f]{6}$/i.test(o.color) || Object.prototype.hasOwnProperty.call(HEX, o.color)))) fail(`color must be '#rrggbb' or a palette key (${Object.keys(HEX).join(', ')})`);
  return o as unknown as Transition;
}

const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/**
 * How much of each clip shows at overlap progress k (0..1): what `reel check` scales the alpha of their text by.
 */
export function transitionWeights(t: Transition, k: number): [outgoing: number, incoming: number] {
  if (t.kind === 'dip') return [Math.max(0, 1 - 2 * k), Math.max(0, 2 * k - 1)];
  const e = t.kind === 'crossfade' ? k : inOut(k);
  return [1 - e, e];
}

/** Draws a transition of two clip textures into a target. */
export class TransitionPass {
  private pass = new FSPass(/* glsl */ `
    uniform sampler2D a; uniform sampler2D b; uniform float k, soft; uniform int mode; uniform vec2 dir; uniform vec3 col;
    vec4 at(sampler2D t, vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(t, uv); }
    void main() {
      vec2 uv = vUv;
      if (mode == 0) { fragColor = mix(texture(a, uv), texture(b, uv), k); return; }
      if (mode == 1) {
        // the edge travels along dir from the side dir points away from: p is 0 there and 1 at the far side, and
        // the incoming clip shows where p is behind the edge
        float p = dot(uv - 0.5, dir) + 0.5, e = k * (1.0 + soft);
        float m = soft > 0.0 ? 1.0 - smoothstep(e - soft, e, p) : step(p, e);
        fragColor = mix(texture(a, uv), texture(b, uv), m);
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
      vec4 c = vec4(col, 1.0);
      fragColor = k < 0.5 ? mix(texture(a, uv), c, k * 2.0) : mix(c, texture(b, uv), k * 2.0 - 1.0);
    }`, { a: { value: null }, b: { value: null }, k: { value: 0 }, soft: { value: 0 }, mode: { value: 0 }, dir: { value: new THREE.Vector2() }, col: { value: new THREE.Vector3() } });

  /** Draw the transition from `a` (outgoing) to `b` (incoming) at overlap progress k into `out`. */
  draw(renderer: THREE.WebGLRenderer, t: Transition, a: THREE.Texture, b: THREE.Texture, k: number, out: THREE.WebGLRenderTarget) {
    const u = this.pass.u, mode = TRANSITION_KINDS.indexOf(t.kind);
    u.a!.value = a;
    u.b!.value = b;
    u.mode!.value = mode;
    u.k!.value = t.kind === 'crossfade' || t.kind === 'dip' ? k : inOut(k);
    u.soft!.value = t.softness ?? 0.08;
    (u.dir!.value as THREE.Vector2).set(...DIRS[t.direction ?? 'left']);
    const c = t.color ?? 'bg';
    (u.col!.value as THREE.Vector3).set(...(c.startsWith('#') ? hexToLinear(c) : hexToLinear(HEX[c]!)));
    this.pass.render(renderer, out);
  }
}
