import type * as THREE from 'three';
import type { AudioData, AudioSample } from './audio';
import type { Words } from './words';
import type { Compositor } from './gl';
import type { PostParams } from './post';
import type { ClipTime } from './cliptime';
import type { Grade } from './tracks';

export interface SceneCtx {
  renderer: THREE.WebGLRenderer;
  audio: AudioData;
  words: Words;
  props: Readonly<Record<string, any>>;
  comp: Compositor;
  W: number;
  H: number;
  id: string;
  params: Record<string, unknown>;
  start: number;
  end: number;
  clip(id: string): { id: string; start: number; end: number; track: number };
  /**
   * For a `moving` entry of Scene.tileMasked, before drawing into it in a sub-frame: its texel at uv is read
   * on screen at uv * map.xy + map.zw this sub-frame (a zoom or pan), so its tile mask is mapped there; null
   * draws it whole. A no-op outside masked sub-frames.
   */
  mapTileMask(rt: THREE.WebGLRenderTarget, map: THREE.Vector4 | null): void;
  maskDepth(rt: THREE.WebGLRenderTarget): void;
  /**
   * A default cap on the clip's adaptive sub-frames, for a scene whose noise converges slowly (a `Stage3D` asks
   * for 108). Only calls from the constructor or init() count. The clip's own `maxSamples` wins; called more than once, the lowest counts.
   */
  capSamples(n: number): void;
}

export const LOADING: { clip: { id: string; start: number; end: number; time: ClipTime } | null } = { clip: null };

export interface Frame {
  t: number;
  vt: number;
  /**
   * How much scene time the step from the previous rendered frame covers (1/fps on export at speed 1; 0 after a seek,
   * at the start of each chunk a worker of a multi-worker export renders unless a scene is stateful, or while frozen
   * or held; not for drawing: a frame depends on t alone). Never negative: on a reversed clip f.t falls by dt.
   */
  dt: number;
  lt: number;
  p: number;
  start: number;
  end: number;
  /**
   * The span of scene time this frame's sub-frames cover, centred on t (s): 0 in a one-sample render (previews,
   * stills, check), dt x shutter (times the clip's speed) in an export with --samples. What prepare() must have
   * ready for render().
   */
  exposure: number;
  /** True when time jumped (scrub/seek, a new export chunk) — stateful scenes should reset. */
  seeked: boolean;
  preroll: boolean;
  beat: number;
  bar: number;
  beatPhase: number;
  barPhase: number;
  a: AudioSample;
  under: THREE.Texture | null;
  /** 0..1 progress through the overlap with the previous scene (1 when not overlapping). */
  tin: number;
  /** 0..1 progress through the overlap with the next scene (0 when not overlapping). */
  tout: number;
}

/**
 * What render() may return: post-processing overrides for the whole frame, and `grade`, a grade of the scene's own
 * track (over its clip's and track's, field by field; see Grade in tracks.ts).
 */
export type PostOverrides = Partial<PostParams> & { grade?: Grade };

export abstract class Scene {
  stateful = false;
  prerollMax = 6;
  handlesTransition = false;
  tileMasked: { rt: THREE.WebGLRenderTarget; margin: 0 | 1; moving?: boolean }[] = [];

  constructor(protected ctx: SceneCtx) {}

  init(): Promise<void> | void {}

  reset(): void {}

  prepare(_f: Frame): void | Promise<void> {}

  abstract render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides | void;

  dispose(): void {}
}

export type SceneClass = new (ctx: SceneCtx) => Scene;
