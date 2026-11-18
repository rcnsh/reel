// Scene API. A scene owns a time window of the video and renders HDR linear colour
// into the render target it is given. Everything must be a deterministic function of
// time (plus internal state advanced only through render() calls, see `stateful`).
import type * as THREE from 'three';
import type { AudioData, AudioSample } from './audio';
import type { Words } from './words';
import type { Compositor } from './gl';
import type { PostParams } from './post';

export interface SceneCtx {
  renderer: THREE.WebGLRenderer;
  audio: AudioData;
  /** The project's timed words (narration, sung lyrics, captions). */
  words: Words;
  comp: Compositor;
  W: number;
  H: number;
  /** The clip's id and its free-form params (lets one scene module serve several clips). */
  id: string;
  params: Record<string, unknown>;
  /** The clip's window (seconds). */
  start: number;
  end: number;
  /**
   * Another clip of the timeline by id: its window and track (throws when there is none, so a renamed clip fails
   * loudly). For a clip that follows another: `f.t - this.ctx.clip('orbit').start` is that clip's local time.
   */
  clip(id: string): { id: string; start: number; end: number; track: number };
  /**
   * For a `moving` entry of Scene.tileMasked, before drawing into it in a sub-frame: its texel at uv is read
   * on screen at uv * map.xy + map.zw this sub-frame (a zoom or pan), so its tile mask is mapped there; null
   * draws it whole. A no-op outside masked sub-frames.
   */
  mapTileMask(rt: THREE.WebGLRenderTarget, map: THREE.Vector4 | null): void;
  /**
   * Clear the depth (and stencil) of the scene's own target `rt` before drawing depth-tested 3D into it, instead of
   * clearing it yourself. In a sub-frame of per-tile adaptive sampling it also puts the tiles that have converged at
   * the near plane, so the 3D's own depth test rejects them before shading. Only for a target the size of the
   * output (or a multiple of it) whose texels are composited back at their own screen position.
   */
  maskDepth(rt: THREE.WebGLRenderTarget): void;
}

/**
 * The clip whose scene is being constructed and initialised (null at any other time): what a component made as a
 * scene's field reads to place things in video time, such as a video's own sound.
 */
export const LOADING: { clip: { id: string; start: number; end: number } | null } = { clip: null };

export interface Frame {
  /** Time in the video (s). */
  t: number;
  /** Time since the previous rendered frame (1/fps on export; 0 after a seek). */
  dt: number;
  /** Local time since this scene's start, and 0..1 progress through its window. */
  lt: number;
  p: number;
  start: number;
  end: number;
  /**
   * The span of video time this frame's sub-frames cover, centred on t (s): 0 in a one-sample render (previews,
   * stills, check), dt x shutter in an export with --samples. What prepare() must have ready for render().
   */
  exposure: number;
  /** True when time jumped (scrub/seek) — stateful scenes should reset. */
  seeked: boolean;
  /** True while the engine fast-forwards a stateful scene after a seek (skip non-essential work). */
  preroll: boolean;
  /** Continuous beat/bar indices from the analysed grid, and their fractional phases. */
  beat: number;
  bar: number;
  beatPhase: number;
  barPhase: number;
  /** Audio features at t (envelopes 0..1 and decaying hit pulses). */
  a: AudioSample;
  /**
   * When this scene overlaps the previous one (a transition), the previous scene's
   * output texture for this frame; otherwise null. Scenes that set
   * `handlesTransition = true` composite it themselves.
   */
  under: THREE.Texture | null;
  /** 0..1 progress through the overlap with the previous scene (1 when not overlapping). */
  tin: number;
  /** 0..1 progress through the overlap with the next scene (0 when not overlapping). */
  tout: number;
}

export type PostOverrides = Partial<PostParams>;

export abstract class Scene {
  /** If true, the engine fast-forwards (calls render with preroll=true) after seeks. */
  stateful = false;
  /** Max seconds of history the engine re-simulates when seeking into a stateful scene. */
  prerollMax = 6;
  /** If true, this scene composites `f.under` itself during its incoming transition. */
  handlesTransition = false;
  /**
   * The scene's own render targets (with a depth buffer) that adaptive per-tile refinement may mask like
   * `out`: once a tile has converged, later sub-frames skip shading it there too. Only for a target whose
   * texels are read back at their own screen position, or at most a few px off it (`margin: 1` widens the
   * mask by a tile, 32 logical px), or, if `moving`, at a place the scene gives with ctx.mapTileMask before
   * each sub-frame's draws. Targets read elsewhere (warped, blurred far) must not be listed.
   */
  tileMasked: { rt: THREE.WebGLRenderTarget; margin: 0 | 1; moving?: boolean }[] = [];

  constructor(protected ctx: SceneCtx) {}

  /** Load/create resources. Called once before first render. */
  init(): Promise<void> | void {}

  /** Reset internal state (called on seeks for stateful scenes). */
  reset(): void {}

  /**
   * Once per output frame while the clip is on screen, before the frame's sub-frames are rendered (and before
   * the engine updates the scene's HTML layers): change HTML layers here or in their own `update`, or await
   * anything the frame needs. Optional; render() stays synchronous.
   */
  prepare(_f: Frame): void | Promise<void> {}

  /** Render into `out` (HalfFloat, linear HDR; the engine clears it to transparent first). On track 0 cover it opaque. Return post-processing overrides. */
  abstract render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides | void;

  dispose(): void {}
}

export type SceneClass = new (ctx: SceneCtx) => Scene;
