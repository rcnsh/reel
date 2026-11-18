// The engine: owns the renderer, loads the scenes of the timeline's clips, renders any time deterministically
// (with preroll for stateful scenes), composites tracks and transitions, post.
import * as THREE from 'three';
import { AudioData } from './audio';
import { Words } from './words';
import { Compositor, FSPass, W, H, PW, PH, SCALE, FPS, SS_TAP, SUB_FRAME, makeRT, clearRT } from './gl';
import { ALPHA, BITS } from './format';
import { PIXELS, yuvFits, type Pixels } from './pixels';
export { PIXELS, type Pixels };
import { DEFAULT_POST, Post, SHOULDER_GLSL, type PostParams } from './post';
import { THEME } from './palette';
import { LOADING, type Frame, type Scene, type SceneClass, type SceneCtx, type PostOverrides } from './scene';
import { loadFonts } from './type';
import { loadStrokeFonts } from './stroke';
import { boxes, CHECK_RULES, type ReportedBox } from './report';
import { htmlLayers } from './html';
import { TransitionPass, transitionOf, transitionWeights } from './transitions';
import { BUNDLED_SOUNDS, type Clip, type SoundClip, type VideoConfig } from '../config';

/** A clip on the engine's timeline (see Clip in config.ts). */
export type TimelineEntry = Clip;

/** The id of the clip that shows the theme's overlay. */
export const OVERLAY_ID = 'overlay';

/** A track's targets: three for its scenes, two for transitions (a third overlapping clip reads one mix and writes the other). */
interface TrackRTs { rts: THREE.WebGLRenderTarget[]; mix: THREE.WebGLRenderTarget[] }

/** A scene module as imported, or why it did not import. */
type Imported = { m?: { default: SceneClass }; err?: unknown };

interface Loaded { entry: TimelineEntry; scene: Scene | null; error?: string; renderError?: string; lastT: number }

/**
 * Per-frame adaptive motion-blur sampling (see Engine.render): the sub-frame count steps through
 * 4, 12, 36, 108, 324 … from `min` up to at most `max` (both rounded to that series) until the
 * estimated remaining sampling error is below `tol` 8-bit levels (worst 2x2-logical-px block).
 * `refine: 'tiles'` (the default) decides that per 32x32-logical-px tile, `'frame'` for the whole frame.
 */
export interface AdaptiveSampling { min: number; max: number; tol: number; refine?: 'tiles' | 'frame' }

/**
 * Shutter offsets (-0.5..0.5) of an adaptive run's sub-frames in rendering order: 4 evenly spread, then
 * each step splits every interval in three, adding a sub-frame either side of each old one. Every
 * prefix of 4·3^l is then evenly spread and centred on the frame's time, and so is each step's new set:
 * comparing the new set's average with the old one's measures sampling error, not a shift in time
 * (with doublings the new half sits half a step later, and any motion at all would read as error).
 */
function ternaryOffsets(steps: number) {
  const u = [0, 1, 2, 3].map((i) => (i + 0.5) / 4 - 0.5);
  for (let l = 0, n = 4; l < steps; l++, n *= 3)
    for (let m = 0; m < n; m++) u.push((3 * m + 0.5) / (3 * n) - 0.5, (3 * m + 2.5) / (3 * n) - 0.5);
  return u;
}

/** Resolve on the next task (a MessageChannel message: no timer clamping), to poll GPU fences cheaply. */
const yieldChannel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const yieldQueue: (() => void)[] = [];
if (yieldChannel) yieldChannel.port1.onmessage = () => yieldQueue.shift()?.();
function yieldTask() {
  return new Promise<void>((res) => {
    if (!yieldChannel) { setTimeout(res, 0); return; }
    yieldQueue.push(res);
    yieldChannel.port2.postMessage(0);
  });
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  ctx!: SceneCtx;
  audio!: AudioData;
  words!: Words;
  post!: Post;
  comp = new Compositor();
  loaded = new Map<string, Loaded>();
  // (the scene targets and the motion-blur sums have a depth buffer: it carries the tile mask of per-tile refinement)
  // per track: three scene targets (clips overlapping in a transition) and the transition's mix; then the stack of tracks
  private trackRTs: TrackRTs[] = [];
  private stackRT = makeRT();
  private _duration = 0;
  // motion-blur sub-frame sums (float: up to hundreds of sub-frames), their average, and the error estimate
  private sumRT = makeRT(W, H, { type: THREE.FloatType });
  private newRT = makeRT(W, H, { type: THREE.FloatType });
  private avgRT = makeRT(W, H, { depthBuffer: false });
  private errRT: THREE.WebGLRenderTarget;
  private maxRT: THREE.WebGLRenderTarget;
  private errPass: FSPass;
  private maxPass: FSPass;
  private errBuf: Float32Array;
  // per-tile refinement: a tile is one texel of maxRT (R x R error blocks); which tiles still refine (255), and
  // the gain (1 / its sub-frame count) each tile's sum is averaged with
  private tileOn: Uint8Array;
  private tileTex: THREE.DataTexture;
  private gainBuf: Float32Array;
  private gainTex: THREE.DataTexture;
  private maskPass: FSPass;
  private errTilePass: FSPass;
  private gainPass: FSPass;
  /**
   * The targets that carry the tile mask, with the margin (in tiles) it is widened by: the engine's own
   * (everything a sub-frame's scenes draw into) and the targets scenes declare in Scene.tileMasked.
   */
  private maskedRTs = new Map<THREE.WebGLRenderTarget, { margin: number; moving?: boolean }>();
  private tileOnWide: Uint8Array;
  private tileTexWide: THREE.DataTexture;
  /** Masking: draws into maskedRTs are depth-tested against the mask. `depthSeen`: a draw there wanted its own depth test. */
  private masking = false;
  private depthSeen = false;
  /** Timeline entries seen drawing with a depth test of their own: never masked (their 3D needs the depth buffer). */
  private depthEntries = new Set<string>();
  /** Sub-frames used for the last rendered frame, and its estimated sampling error after each step. */
  lastSamples = 1;
  lastErrors: number[] = [];
  /** Share of the last frame's extra sub-frames (beyond the first set) actually shaded (1 = every tile). */
  lastShaded = 1;
  // (a float target when the output keeps more than 8 bits: the final pass's dither is then at that depth)
  private finalRT = new THREE.WebGLRenderTarget(PW, PH, { type: BITS > 8 ? THREE.FloatType : THREE.UnsignedByteType, depthBuffer: false });
  /** The last frame before post: linear HDR, premultiplied (what the 'linear' readback reads). */
  private linearTex: THREE.Texture | null = null;
  private blit: FSPass;
  private transition = new TransitionPass();
  private accum: FSPass;
  private lastT = -1;
  lastPost: PostParams = { ...DEFAULT_POST };
  /**
   * Errors that hold for as long as the page does: a scene whose module or init() failed, a shader that did not
   * compile (three.js compiles a program once). `renderErrors`: render() throws, once per clip until
   * clearRenderErrors() (a warm renderer clears them per request, so each request reports its own).
   */
  loadErrors: string[] = [];
  renderErrors: string[] = [];
  get errors() { return [...this.loadErrors, ...this.renderErrors]; }
  clearRenderErrors() {
    this.renderErrors = [];
    for (const rec of this.loaded.values()) rec.renderError = undefined;
  }

  timeline: TimelineEntry[] = [];
  /** The config's sounds on the timeline (scenes add theirs with sound(); see sounds()). */
  private configSounds: SoundClip[] = [];
  /** The span of the frame being prepared or rendered (Frame.exposure). */
  private exposure = 0;
  /** Every sound on the timeline: the config's, then those scenes put there with sound() in init(), by start time. */
  sounds(): SoundClip[] {
    return [...this.configSounds, ...((globalThis as { __reelSounds?: SoundClip[] }).__reelSounds ?? [])].sort((a, b) => a.at - b.at);
  }
  /**
   * Collect what scenes report drawing (report(), reportText()) during the next render() into lastBoxes: for
   * `reel check`. With several sub-frames, the boxes are those of the sub-frame nearest the frame's time.
   */
  collectBoxes = false;
  lastBoxes: ReportedBox[] = [];
  /** The Canvas2D text draws (fillText, strokeText) of the same render, per clip: text a clip may not have reported. */
  lastTextDraws: Record<string, number> = {};
  /** The clip whose scene is being initialised or drawn (names errors that surface inside three.js). */
  private drawing = '';

  constructor(public canvas: HTMLCanvasElement, private config: VideoConfig) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(PW, PH, false);
    this.renderer.autoClear = false;
    htmlLayers.attach(canvas);
    // a shader that does not compile (a palette key the theme lacks, a typo) is an error, not a black draw
    // (named after the clip drawing when it compiled, with the source line each error points at: the line
    // numbers count the engine's GLSL prepended to the scene's)
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const quote = (sh: WebGLShader, log: string | null) => {
        const src = (gl.getShaderSource(sh) ?? '').split('\n');
        return (log ?? '').trim().split('\n').filter(Boolean).map((l) => {
          const m = /^ERROR: \d+:(\d+):/.exec(l);
          const line = m ? src[Number(m[1]) - 1]?.trim() : undefined;
          return line ? `${l}\n    in: ${line}` : l;
        }).join('\n');
      };
      const log = [gl.getProgramInfoLog(program)?.trim(), quote(vs, gl.getShaderInfoLog(vs)), quote(fs, gl.getShaderInfoLog(fs))].filter(Boolean).join('\n');
      const msg = `${this.drawing ? `[${this.drawing}] ` : ''}shader failed to compile: ${log}`;
      if (!this.loadErrors.includes(msg)) { this.loadErrors.push(msg); console.error(msg); }
    };
    this.blit = new FSPass(`uniform sampler2D src; void main(){ fragColor = texture(src, vUv); }`, { src: { value: null } });
    // adds a sub-frame to a sum; a non-finite pixel (a stray NaN from some shader in one sub-frame out of
    // hundreds) is dropped, or it would poison the average and bloom into a disc
    this.accum = new FSPass(`uniform sampler2D src;
      void main() {
        vec4 c = texture(src, vUv);
        bool ok = abs(c.r) <= 6e4 && abs(c.g) <= 6e4 && abs(c.b) <= 6e4 && abs(c.a) <= 6e4;
        fragColor = ok ? c : vec4(0.0);
      }`, { src: { value: null } }, { blending: THREE.CustomBlending, transparent: true });
    const am = this.accum.mat;
    am.blendEquation = THREE.AddEquation;
    am.blendSrc = THREE.OneFactor; am.blendDst = THREE.OneFactor;
    // (alpha is summed too: a transparent render averages coverage like colour; opaque renders never read it)
    am.blendSrcAlpha = THREE.OneFactor; am.blendDstAlpha = THREE.OneFactor;
    // sampling error: per block of B x B physical px (2x2 logical), how far the displayed average moves when a
    // step's new sub-frames (2n, summed in b) are merged with the n before them (summed in a): 2/3 of the gap
    const B = 2 * SCALE, ew = Math.ceil(PW / B), eh = Math.ceil(PH / B), R = 16;
    const small = { depthBuffer: false, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, pxScale: 1 } as const;
    this.errRT = makeRT(ew, eh, small);
    this.maxRT = makeRT(Math.ceil(ew / R), Math.ceil(eh / R), small);
    this.errBuf = new Float32Array(this.maxRT.width * this.maxRT.height * 4);
    this.errPass = new FSPass(/* glsl */ `
      uniform sampler2D a; uniform sampler2D b; uniform float invA, invB;
      ${SHOULDER_GLSL}
      vec3 disp(vec3 x) { return toSRGB(sat(shoulder(max(x, 0.0)))); }
      void main() {
        ivec2 p0 = ivec2(gl_FragCoord.xy) * ${B}, lim = ivec2(${PW - 1}, ${PH - 1});
        vec3 sa = vec3(0.0), sb = vec3(0.0);
        for (int y = 0; y < ${B}; y++) for (int x = 0; x < ${B}; x++) {
          ivec2 p = min(p0 + ivec2(x, y), lim);
          sa += texelFetch(a, p, 0).rgb; sb += texelFetch(b, p, 0).rgb;
        }
        vec3 e = abs(disp(sa * (invA / ${B * B}.0)) - disp(sb * (invB / ${B * B}.0)));
        fragColor = vec4(170.0 * max(e.r, max(e.g, e.b)), 0.0, 0.0, 1.0);
      }`, { a: { value: null }, b: { value: null }, invA: { value: 1 }, invB: { value: 1 } });
    this.maxPass = new FSPass(/* glsl */ `
      uniform sampler2D e;
      void main() {
        ivec2 p0 = ivec2(gl_FragCoord.xy) * ${R};
        float m = 0.0;
        for (int y = 0; y < ${R}; y++) for (int x = 0; x < ${R}; x++) {
          ivec2 p = p0 + ivec2(x, y);
          if (p.x < ${ew} && p.y < ${eh}) m = max(m, texelFetch(e, p, 0).r);
        }
        fragColor = vec4(m, 0.0, 0.0, 1.0);
      }`, { e: { value: null } });

    // per-tile refinement (see render): TP = physical px per tile side
    const tw = this.maxRT.width, th = this.maxRT.height, TP = B * R;
    this.tileOn = new Uint8Array(tw * th);
    this.tileTex = new THREE.DataTexture(this.tileOn, tw, th, THREE.RedFormat, THREE.UnsignedByteType);
    this.tileOnWide = new Uint8Array(tw * th);
    this.tileTexWide = new THREE.DataTexture(this.tileOnWide, tw, th, THREE.RedFormat, THREE.UnsignedByteType);
    this.gainBuf = new Float32Array(tw * th);
    this.gainTex = new THREE.DataTexture(this.gainBuf, tw, th, THREE.RedFormat, THREE.FloatType);
    for (const t of [this.tileTex, this.tileTexWide, this.gainTex]) { t.unpackAlignment = 1; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; }
    // the tile mask in a depth buffer: 1 where a tile still refines, 0 where it has converged
    // (map: the target's px to output px, gl_FragCoord.xy * map.xy + map.zw)
    this.maskPass = new FSPass(/* glsl */ `
      uniform sampler2D tiles; uniform vec4 map;
      void main() {
        vec2 p = gl_FragCoord.xy * map.xy + map.zw;
        if (p.x < 0.0 || p.y < 0.0 || p.x >= ${PW}.0 || p.y >= ${PH}.0) discard;
        if (texelFetch(tiles, ivec2(floor(p / ${TP}.0)), 0).r < 0.5) discard;
        gl_FragDepth = 1.0;
        fragColor = vec4(0.0);
      }`, { tiles: { value: this.tileTex }, map: { value: new THREE.Vector4(1, 1, 0, 0) } });
    const mm = this.maskPass.mat;
    mm.colorWrite = false; mm.depthTest = true; mm.depthWrite = true; mm.depthFunc = THREE.AlwaysDepth;
    // the inverse, for scenes' own depth-tested targets (maskDepth): depth 0 (the near plane) where a tile has
    // converged, so their own depth test rejects it; live tiles keep the cleared depth
    this.nearPass = new FSPass(/* glsl */ `
      uniform sampler2D tiles; uniform vec4 map;
      void main() {
        vec2 p = gl_FragCoord.xy * map.xy + map.zw;
        if (p.x < 0.0 || p.y < 0.0 || p.x >= ${PW}.0 || p.y >= ${PH}.0) discard;
        if (texelFetch(tiles, ivec2(floor(p / ${TP}.0)), 0).r >= 0.5) discard;
        gl_FragDepth = 0.0;
        fragColor = vec4(0.0);
      }`, { tiles: { value: this.tileTex }, map: { value: new THREE.Vector4(1, 1, 0, 0) } });
    const nm = this.nearPass.mat;
    nm.colorWrite = false; nm.depthTest = true; nm.depthWrite = true; nm.depthFunc = THREE.AlwaysDepth;
    for (const rt of [this.stackRT, this.newRT, this.sumRT]) this.maskedRTs.set(rt, { margin: 0 });
    this.hookDepthState();
    // errPass with the error of tiles no longer refining forced to 0 (their sums hold nothing new)
    this.errTilePass = new FSPass(/* glsl */ `
      uniform sampler2D a; uniform sampler2D b; uniform float invA, invB; uniform sampler2D tiles;
      ${SHOULDER_GLSL}
      vec3 disp(vec3 x) { return toSRGB(sat(shoulder(max(x, 0.0)))); }
      void main() {
        ivec2 p0 = ivec2(gl_FragCoord.xy) * ${B}, lim = ivec2(${PW - 1}, ${PH - 1});
        vec3 sa = vec3(0.0), sb = vec3(0.0);
        for (int y = 0; y < ${B}; y++) for (int x = 0; x < ${B}; x++) {
          ivec2 p = min(p0 + ivec2(x, y), lim);
          sa += texelFetch(a, p, 0).rgb; sb += texelFetch(b, p, 0).rgb;
        }
        vec3 e = abs(disp(sa * (invA / ${B * B}.0)) - disp(sb * (invB / ${B * B}.0)));
        float on = texelFetch(tiles, ivec2(gl_FragCoord.xy) / ${R}, 0).r;
        fragColor = vec4(170.0 * max(e.r, max(e.g, e.b)) * on, 0.0, 0.0, 1.0);
      }`, { a: { value: null }, b: { value: null }, invA: { value: 1 }, invB: { value: 1 }, tiles: { value: this.tileTex } });
    // the final average with a gain per tile: the Compositor's 'replace' draw (same uv maths, so a tile
    // comes out exactly as the whole-frame average at its count would) with opacity read from gainTex
    this.gainPass = new FSPass(/* glsl */ `
      uniform sampler2D tex; uniform vec3 tint; uniform vec4 uvXform; uniform bool premult; uniform sampler2D gain;
      void main() {
        vec2 uv = (vUv - 0.5) * uvXform.xy + 0.5 + uvXform.zw;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
        vec4 c = texture(tex, uv);
        c.rgb *= tint;
        if (premult) c.rgb *= c.a;
        fragColor = vec4(c.rgb, c.a) * texelFetch(gain, ivec2(gl_FragCoord.xy) / ${TP}, 0).r;
      }`, { tex: { value: null }, tint: { value: new THREE.Vector3(1, 1, 1) }, uvXform: { value: new THREE.Vector4(1, 1, 0, 0) }, premult: { value: false }, gain: { value: this.gainTex } });
  }

  /**
   * Masked drawing for per-tile refinement. While `masking` is on, every draw into one of maskedRTs is
   * depth-tested (LEQUAL, no depth writes, clears included) against the tile mask, whatever its material
   * says: the draws scenes make are at depth <= 1, so they pass where the mask is 1 and converged tiles
   * (mask 0) are rejected before their fragments are shaded (early-Z). Draws into other targets (scenes'
   * own) keep their materials' depth state. A material that wants its own depth test while drawing into a
   * masked target sets depthSeen (its sub-frame is then drawn again unmasked, see render).
   */
  private hookDepthState() {
    const r = this.renderer, st = r.state, d = st.buffers.depth;
    const setTest = d.setTest.bind(d), setFunc = d.setFunc.bind(d), setMask = d.setMask.bind(d);
    let forced = false;
    const force = (on: boolean) => {
      if (on === forced) return;
      forced = on;
      if (on) { setTest(true); setFunc(THREE.LessEqualDepth); setMask(false); }
    };
    d.setTest = (v: boolean) => { if (!forced) setTest(v); };
    d.setFunc = (f: THREE.DepthModes) => { if (!forced) setFunc(f); };
    d.setMask = (m: boolean) => { if (!forced) setMask(m); };
    const setRenderTarget = r.setRenderTarget.bind(r);
    r.setRenderTarget = (target, ...rest) => {
      setRenderTarget(target, ...rest);
      force(this.masking && !!target && this.maskedRTs.has(target as THREE.WebGLRenderTarget));
    };
    const setMaterial = st.setMaterial.bind(st);
    st.setMaterial = (m, ...rest) => {
      if (forced && m.depthTest) this.depthSeen = true;
      setMaterial(m, ...rest);
    };
    this.setMasking = (on: boolean) => {
      this.masking = on;
      const t = r.getRenderTarget();
      force(on && !!t && this.maskedRTs.has(t));
    };
  }
  private setMasking: (on: boolean) => void = () => {};

  /**
   * Scene targets read away from the pixel they land on this frame: during a slide or a zoom transition the
   * transition samples its clips' targets at a moved position, so their tiles cannot be masked in place.
   */
  private displaced = new Set<THREE.WebGLRenderTarget>();
  private displacedAt(t: number, w: number) {
    this.displaced.clear();
    const moving = this.timeline.some((e) => {
      const kind = transitionOf(e.transition, e.id).kind;
      if (kind !== 'slide' && kind !== 'zoom') return false;
      // (the transition runs from the clip's start to the end of the clip before it on its track)
      return this.timeline.some((o) => o !== e && (o.track ?? 0) === (e.track ?? 0) && o.start < e.start && o.end > e.start && o.end > t - w / 2 && e.start < t + w / 2);
    });
    if (moving) for (const tr of this.trackRTs) for (const rt of tr.rts) this.displaced.add(rt);
  }

  /** Write tileOn into the depth buffer of the masked targets (1 = still refining, 0 = converged). */
  private writeTileMask() {
    const r = this.renderer, was = this.masking;
    if (was) this.setMasking(false);
    this.tileTex.needsUpdate = true;
    // the mask widened by a tile, for scene targets read a little off the pixel
    const on = this.tileOn, wide = this.tileOnWide, tw = this.maxRT.width, th = this.maxRT.height;
    wide.fill(0);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      if (!on[y * tw + x]) continue;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(th - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(tw - 1, x + 1); xx++) wide[yy * tw + xx] = 255;
    }
    this.tileTexWide.needsUpdate = true;
    // (a moving target is drawn whole unless its scene maps the mask, see mapTileMask)
    for (const [rt, m] of this.maskedRTs) this.drawMask(rt, m.margin, m.moving || this.displaced.has(rt) ? null : new THREE.Vector4(PW / rt.width, PH / rt.height, 0, 0));
    if (was) this.setMasking(true);
  }

  /** Write the tile mask into rt's depth buffer, through `map` (rt px -> output px); null: all of rt on. */
  private drawMask(rt: THREE.WebGLRenderTarget, margin: number, map: THREE.Vector4 | null) {
    const r = this.renderer, d = r.state.buffers.depth;
    r.setRenderTarget(rt);
    if (!map) { r.clear(false, true, false); return; }
    d.setClear(0);
    r.clear(false, true, false);
    d.setClear(1);
    this.maskPass.u.tiles!.value = margin ? this.tileTexWide : this.tileTex;
    (this.maskPass.u.map!.value as THREE.Vector4).copy(map);
    this.maskPass.render(r, rt);
  }

  private nearPass: FSPass;
  /** SceneCtx.maskDepth: clear rt's depth; in a masked sub-frame, converged tiles go to the near plane. */
  private maskDepth(rt: THREE.WebGLRenderTarget) {
    const r = this.renderer, d = r.state.buffers.depth;
    r.setRenderTarget(rt);
    d.setMask(true);
    r.clear(false, true, true);
    // (while a slide or zoom moves the scene targets, nothing is masked in place)
    if (!this.masking || this.displaced.size) return;
    (this.nearPass.u.map!.value as THREE.Vector4).set(PW / rt.width, PH / rt.height, 0, 0);
    this.nearPass.render(r, rt);
    r.setRenderTarget(rt);
  }

  /** SceneCtx.mapTileMask: `map` takes rt uv to screen uv. */
  private mapTileMask(rt: THREE.WebGLRenderTarget, map: THREE.Vector4 | null) {
    const m = this.maskedRTs.get(rt);
    if (!this.masking || !m?.moving) return;
    const r = this.renderer, prev = r.getRenderTarget(), x = new THREE.Vector4();
    if (map) x.set((map.x * PW) / rt.width, (map.y * PH) / rt.height, map.z * PW, map.w * PH);
    this.setMasking(false);
    this.drawMask(rt, m.margin, map ? x : null);
    this.setMasking(true);
    r.setRenderTarget(prev);
  }

  async init(only?: (e: TimelineEntry) => boolean) {
    const c = this.config;
    [this.audio, this.words] = await Promise.all([AudioData.load(c.audio), Words.load(c.words), loadFonts(), loadStrokeFonts()]) as [AudioData, Words, void, void];
    this.timeline = c.timeline({ words: this.words, audio: this.audio });
    this.configSounds = typeof c.sounds === 'function' ? c.sounds({ words: this.words, audio: this.audio }) : c.sounds ?? [];
    const ids = new Set<string>();
    for (const e of this.timeline) {
      if (ids.has(e.id)) throw new Error(`timeline: two clips are called '${e.id}'`);
      ids.add(e.id);
      if (!(e.end > e.start) || e.start < 0) throw new Error(`timeline: clip '${e.id}' runs ${e.start} to ${e.end}`);
      const ex = e.check?.exempt;
      if (ex !== undefined && ex !== true && !(Array.isArray(ex) && ex.every((r) => CHECK_RULES.includes(r))))
        throw new Error(`timeline: clip '${e.id}' check.exempt ${JSON.stringify(ex)}: expected true or a list of ${CHECK_RULES.join(', ')}`);
      transitionOf(e.transition, `timeline: clip '${e.id}'`);
    }
    this._duration = c.duration ?? (this.audio.duration > 0 ? this.audio.duration : Math.max(0, ...this.timeline.map((e) => e.end)));
    if (!(this._duration > 0)) throw new Error('the video has no length: give the config a duration, audio analysis or clips');
    // the theme's overlay: the HUD scene over the whole video, on a track above every clip
    let overlay: TimelineEntry | null = null;
    if (THEME.overlay) {
      if (ids.has(OVERLAY_ID)) throw new Error(`timeline: '${OVERLAY_ID}' is the theme overlay's clip; call yours something else`);
      overlay = { id: OVERLAY_ID, scene: () => import('../scenes/hud'), start: 0, end: this._duration, track: Math.max(0, ...this.timeline.map((e) => e.track ?? 0)) + 1, params: { ...THEME.overlay } };
      this.timeline.push(overlay);
    }
    const tracks = new Set(this.timeline.map((e) => e.track ?? 0)).size;
    for (let i = 0; i < Math.max(1, tracks); i++) {
      const t: TrackRTs = { rts: [makeRT(), makeRT(), makeRT()], mix: [makeRT(), makeRT()] };
      this.trackRTs.push(t);
      for (const rt of [...t.rts, ...t.mix]) this.maskedRTs.set(rt, { margin: 0 });
    }
    this.ctx = { renderer: this.renderer, audio: this.audio, words: this.words, comp: this.comp, W, H, id: '', params: {}, start: 0, end: 0, clip: (id) => {
      const e = this.timeline.find((x) => x.id === id);
      if (!e) throw new Error(`no clip '${id}' on the timeline (it has ${this.timeline.map((x) => x.id).join(', ')})`);
      return { id: e.id, start: e.start, end: e.end, track: e.track ?? 0 };
    }, mapTileMask: (rt, map) => this.mapTileMask(rt, map), maskDepth: (rt) => this.maskDepth(rt) };
    this.post = new Post();
    // (the overlay is part of the look: loaded with any --only)
    const entries = only ? this.timeline.filter((e) => e === overlay || only(e)) : this.timeline;
    // modules load in parallel; scenes are made and initialised one at a time, so the HTML layers a scene
    // makes know their clip
    const mods = await Promise.all(entries.map((e): Promise<Imported> => e.scene().then((m) => ({ m }), (err: unknown) => ({ err }))));
    for (const [i, e] of entries.entries()) await this.loadEntry(e, mods[i]!);
    for (const [id, msg] of await htmlLayers.settle()) this.fail(id, msg);
    await this.checkSounds();
  }

  /** Sounds on the timeline must name a file of the project or a bundled sound: one that is missing is a load error. */
  private async checkSounds() {
    for (const s of this.sounds()) {
      const bad = !(typeof s.file === 'string' && s.file) ? 'has no file' : !Number.isFinite(s.at) || s.at < 0 ? `starts at ${s.at}` : s.speed !== undefined && !(s.speed >= 0.1 && s.speed <= 10) ? `has speed ${s.speed} (0.1 to 10)` : '';
      if (bad) { this.loadErrors.push(`[sounds] the sound ${JSON.stringify(s.file)} ${bad}`); continue; }
      if (BUNDLED_SOUNDS.includes(s.file.replace(/\.wav$/, ''))) continue;
      const r = await fetch(s.file, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
      if (!r?.ok) this.loadErrors.push(`[sounds] the sound '${s.file}' at ${s.at} s is not in the project (a path from its folder, such as audio/door.wav, or a bundled sound: ${BUNDLED_SOUNDS.join(', ')})`);
    }
  }

  private fail(id: string, msg: string) {
    const rec = this.loaded.get(id);
    if (rec) { rec.error = msg; rec.scene = null; }
    this.loadErrors.push(`[${id}] ${msg}`);
    console.error(`scene ${id} failed`, msg);
  }

  private async loadEntry(e: TimelineEntry, mod?: Imported) {
    const rec: Loaded = { entry: e, scene: null, lastT: -1 };
    this.loaded.set(e.id, rec);
    htmlLayers.owner(e.id);
    LOADING.clip = { id: e.id, start: e.start, end: e.end };
    try {
      const m: Imported = mod ?? await e.scene().then((x) => ({ m: x }), (err: unknown) => ({ err }));
      if (!m.m) throw m.err;
      const s = new m.m.default({ ...this.ctx, id: e.id, params: e.params ?? {}, start: e.start, end: e.end });
      await s.init();
      rec.scene = s;
      for (const t of s.tileMasked) this.maskedRTs.set(t.rt, { margin: t.margin, moving: t.moving });
    } catch (err) {
      this.fail(e.id, String((err as Error)?.stack ?? err));
    } finally { htmlLayers.owner(''); LOADING.clip = null; }
  }

  /** Hot-swap a scene module (used by Vite HMR in preview). */
  async reload(id: string) {
    const e = this.timeline.find((x) => x.id === id);
    if (!e) return;
    const old = this.loaded.get(id)?.scene;
    for (const m of old?.tileMasked ?? []) this.maskedRTs.delete(m.rt);
    old?.dispose();
    htmlLayers.drop(id);
    await this.loadEntry(e);
    for (const [cid, msg] of await htmlLayers.settle()) this.fail(cid, msg);
    this.lastT = -1;
  }

  get duration() { return this._duration; }

  /**
   * Get ready to render the output frame at t: every clip on screen during the frame's shutter has its scene's
   * prepare(f) called and its HTML layers updated; layers that changed are painted and uploaded (one paint for
   * all). Asynchronous, once per output frame; render() then draws the frame's sub-frames synchronously.
   */
  async prepare(t: number, dt = 1 / FPS, samples: number | AdaptiveSampling = 1, shutter = 0.5) {
    const w = samples === 1 ? 0 : dt * shutter;
    this.exposure = w;
    const frames = new Map<string, Frame>();
    for (const e of this.timeline) {
      if (!(t + w / 2 >= e.start && t - w / 2 < e.end)) continue;
      const rec = this.loaded.get(e.id);
      if (!rec?.scene) continue;
      // (a clip that starts or ends within the shutter is prepared at its first or last moment)
      const f = this.frameFor(e, Math.min(Math.max(t, e.start), e.end - 1e-6), dt, false, false, null, 1, 0);
      try { await rec.scene.prepare(f); } catch (err) { this.renderFailed(rec, `[${e.id}] prepare at ${t.toFixed(3)} s: ${String((err as Error)?.stack ?? err)}`); }
      frames.set(e.id, f);
    }
    if (!htmlLayers.count()) return;
    for (const [id, msg] of await htmlLayers.prepare(this.renderer, frames)) {
      const rec = this.loaded.get(id);
      if (rec) this.renderFailed(rec, `[${id}] HTML layer at ${t.toFixed(3)} s: ${msg}`);
    }
  }

  private renderFailed(rec: Loaded, msg: string) {
    if (rec.renderError) return;
    rec.renderError = msg;
    this.renderErrors.push(msg);
    console.error(msg);
  }

  /** prepare() then render(): one output frame. */
  async renderFrame(t: number, dt = 1 / FPS, toScreen = true, samples: number | AdaptiveSampling = 1, shutter = 0.5): Promise<number> {
    await this.prepare(t, dt, samples, shutter);
    return this.render(t, dt, toScreen, samples, shutter);
  }

  private frameFor(e: TimelineEntry, t: number, dt: number, seeked: boolean, preroll: boolean, under: THREE.Texture | null, tin: number, tout: number): Frame {
    const beat = this.audio.beatAt(t), bar = this.audio.barAt(t);
    return {
      t, dt, lt: t - e.start, p: (t - e.start) / (e.end - e.start), start: e.start, end: e.end, exposure: this.exposure, seeked, preroll,
      beat, bar, beatPhase: beat - Math.floor(beat), barPhase: bar - Math.floor(bar),
      a: this.audio.sample(t), under, tin, tout,
    };
  }

  /**
   * Render time t. `dt` is the nominal frame step (1/fps). A non-sequential t counts as a
   * seek: stateful scenes are reset and fast-forwarded.
   *
   * Motion blur (offline export; the preview uses 1 sample): `samples` > 1 renders that many sub-frames
   * spread evenly over `shutter` x dt around t and averages them before post-processing, which gives real
   * motion blur plus temporal anti-aliasing. With an AdaptiveSampling the count is chosen per frame:
   * sub-frames are added in nested steps (4, 12, 36 … each set evenly spread over the shutter, see
   * ternaryOffsets) until the estimated remaining error is below `tol` levels. Stepped copies of a moving
   * edge shrink as 1/count, so when a step changes the frame by e, what is left is about e/2
   * (e·(1/3 + 1/9 + …)). A still frame stops at 3 x min; a whip pan goes on until its streaks are
   * continuous instead of stepped copies.
   * Returns the number of sub-frames used.
   */
  render(t: number, dt = 1 / FPS, toScreen = true, samples: number | AdaptiveSampling = 1, shutter = 0.5): number {
    const r = this.renderer;
    const seeked = this.lastT < 0 || t < this.lastT - 1e-6 || t - this.lastT > Math.max(0.25, dt * 4);
    this.lastT = t;
    this.exposure = samples === 1 ? 0 : dt * shutter;
    let outTex: THREE.Texture;
    let post: PostParams = { ...DEFAULT_POST };
    let n = 1;
    const collect = this.collectBoxes;
    let nearestBoxes = Infinity;
    if (collect) { this.lastBoxes = []; this.lastTextDraws = {}; }
    if (samples === 1) {
      SS_TAP.value = -1;
      SUB_FRAME.index = -1;
      if (collect) boxes.begin();
      ({ outTex, post } = this.composite(t, dt, seeked));
      if (collect) { this.lastBoxes = boxes.end(); this.lastTextDraws = boxes.textDraws(); }
    } else {
      const adaptive = typeof samples !== 'number';
      let maxAdaptive = adaptive ? samples.max : 0;
      if (adaptive) {
        // sub-frames are rendered out of time order: fine for pure functions of t, not for scenes that integrate state
        const w = dt * shutter;
        const on = this.timeline.filter((e) => t + w / 2 >= e.start && t - w / 2 < e.end);
        const st = on.find((e) => this.loaded.get(e.id)?.scene?.stateful);
        if (st) throw new Error(`adaptive sampling needs stateless scenes; '${st.id}' is stateful (use a fixed --samples)`);
        for (const e of on) if (e.maxSamples) maxAdaptive = Math.min(maxAdaptive, e.maxSamples);
      }
      // shaders that supersample share their 4 taps across the sub-frames when every set holds a multiple
      // of 4 (rotated by k/4 so a tap doesn't always land in the same part of the shutter)
      const cycle = adaptive || samples % 4 === 0;
      // post parameters (shake, flash, zoom, fades) are read at one point of the shutter,
      // 1/8 of it after t: where the video was tuned (4 sub-frames, the third) and a point every adaptive set
      // includes. (A flash that starts between t and there shows at its peak on this frame, not one frame on.)
      const POST_U = 0.125;
      let nearest = Infinity;
      // sub-frame k at shutter offset u (-0.5..0.5), summed into `into`; `step` = the sub-frame spacing
      const sub = (k: number, u: number, into: THREE.WebGLRenderTarget, step: number) => {
        SS_TAP.value = cycle ? (k + (k >> 2)) % 4 : -1;
        SUB_FRAME.index = k;
        // (clamped at 0: before the video no scene is active, and frame 0 would come out half black)
        const ts = Math.max(0, t + dt * shutter * u);
        let res: ReturnType<Engine['composite']>;
        if (collect) boxes.begin();
        if (!this.masking) res = this.composite(ts, step, seeked && k === 0);
        else {
          // a scene that depth-tests its own 3D can't draw over the mask: its sub-frames are drawn unmasked
          // (and the mask written again after, since it has cleared and drawn into the scene target's depth)
          const ids = this.timeline.filter((e) => ts >= e.start && ts < e.end).map((e) => e.id);
          let own = ids.some((id) => this.depthEntries.has(id));
          if (!own) {
            this.depthSeen = false;
            res = this.composite(ts, step, seeked && k === 0);
            if (this.depthSeen) { own = true; for (const id of ids) this.depthEntries.add(id); }
          }
          if (own) {
            this.setMasking(false);
            if (collect) boxes.begin();
            res = this.composite(ts, step, seeked && k === 0);
            this.writeTileMask();
            this.setMasking(true);
          }
        }
        if (collect) { const b = boxes.end(); if (Math.abs(u) < nearestBoxes) { nearestBoxes = Math.abs(u); this.lastBoxes = b; this.lastTextDraws = boxes.textDraws(); } }
        this.accum.u.src!.value = res!.outTex;
        this.accum.render(r, into);
        const d = Math.abs(u - POST_U);
        if (d < nearest - 1e-9 || (d < nearest + 1e-9 && u > POST_U)) { nearest = d; post = res!.post; }
      };
      clearRT(r, this.sumRT, [0, 0, 0], 0);
      let perTile = false;
      if (!adaptive) {
        n = samples;
        for (let k = 0; k < n; k++) sub(k, (k + 0.5) / n - 0.5, this.sumRT, dt / n);
      } else {
        const lg3 = (x: number) => Math.log(x / 4) / Math.log(3);
        const lo = Math.max(0, Math.round(lg3(samples.min))), hi = Math.max(lo, Math.floor(lg3(maxAdaptive) + 1e-9));
        const u = ternaryOffsets(hi);
        this.displacedAt(t, dt * shutter);
        n = 4 * 3 ** lo;
        this.lastErrors = [];
        this.lastShaded = 1;
        for (let k = 0; k < n; k++) sub(k, u[k]!, this.sumRT, dt / n);
        if ((samples.refine ?? 'tiles') === 'frame') {
          for (let l = lo; l < hi; l++) {
            clearRT(r, this.newRT, [0, 0, 0], 0);
            for (let k = n; k < 3 * n; k++) sub(k, u[k]!, this.newRT, dt / (3 * n));
            const err = this.sampleError(n) / 2;
            this.lastErrors.push(err);
            this.addSum();
            n *= 3;
            if (err < samples.tol) break;
          }
        } else {
          // Per-tile refinement: after each set, a tile goes on to the next only while it or one of its 8
          // neighbours is still at or over `tol`; a tile that stopped never restarts. Later sub-frames are
          // drawn with converged tiles masked out by the depth test (rejected before shading), only the tiles
          // still refining are added to the sums, and each tile is averaged over its own count. So every
          // tile is exactly the whole-frame sampler's frame had it stopped at that tile's count.
          const on = this.tileOn, tw = this.maxRT.width, th = this.maxRT.height, T = on.length;
          on.fill(255); // (an R8 texture: 255 reads as 1.0)
          const tileN = this.gainBuf; // count per tile, turned into the gain at the end
          tileN.fill(0);
          let live = T, shaded = 0, full = 0;
          for (let l = lo; l < hi && live > 0; l++) {
            const masked = live < T;
            clearRT(r, this.newRT, [0, 0, 0], 0);
            if (masked) { this.writeTileMask(); this.setMasking(true); }
            for (let k = n; k < 3 * n; k++) sub(k, u[k]!, this.newRT, dt / (3 * n));
            if (masked) this.setMasking(false);
            const err = this.sampleError(n, masked) / 2;
            this.lastErrors.push(err);
            if (masked) this.setMasking(true);
            this.addSum();
            if (masked) this.setMasking(false);
            shaded += 2 * n * live; full += 2 * n * T;
            n *= 3;
            // tiles whose neighbourhood is converged stop at this count
            const e = this.errBuf, next = new Uint8Array(T);
            for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
              const i = y * tw + x;
              if (!on[i]) continue;
              let m = 0;
              for (let yy = Math.max(0, y - 1); yy <= Math.min(th - 1, y + 1); yy++)
                for (let xx = Math.max(0, x - 1); xx <= Math.min(tw - 1, x + 1); xx++) m = Math.max(m, e[(yy * tw + xx) * 4]!);
              if (m / 2 >= samples.tol) next[i] = 255;
              else { tileN[i] = n; live--; }
            }
            on.set(next);
          }
          if (full > 0) {
            this.lastShaded = shaded / full;
            // tiles still refining when the sets ran out end at the last count, which is the frame's
            for (let i = 0; i < T; i++) if (on[i]) tileN[i] = n;
            perTile = tileN.some((c) => c !== n);
            if (perTile) { for (let i = 0; i < T; i++) tileN[i] = 1 / tileN[i]!; this.gainTex.needsUpdate = true; }
          }
        }
      }
      SS_TAP.value = -1;
      SUB_FRAME.index = -1;
      if (perTile) {
        this.gainPass.u.tex!.value = this.sumRT.texture;
        this.gainPass.render(r, this.avgRT);
      } else this.comp.draw(r, this.sumRT.texture, this.avgRT, { mode: 'replace', opacity: 1 / n, premult: false });
      outTex = this.avgRT.texture;
    }
    this.lastSamples = n;
    this.linearTex = outTex;
    this.post.render(r, outTex, this.finalRT, post, t);
    this.lastPost = post;
    if (toScreen) {
      this.blit.u.src!.value = this.finalRT.texture;
      this.blit.render(r, null);
    }
    return n;
  }

  /** Add a step's new sub-frames (newRT) into the frame's sum, colour and alpha. */
  private addSum() {
    this.accum.u.src!.value = this.newRT.texture;
    this.accum.render(this.renderer, this.sumRT);
  }

  /**
   * How far the displayed frame (8-bit levels, worst block) moves when the 2n sub-frames summed in newRT
   * are merged with the n summed in sumRT. Stepped copies of a fast edge differ between the two
   * interleaved sets; a converged streak does not.
   */
  private sampleError(n: number, tiles = false) {
    const r = this.renderer;
    // (with some tiles stopped, the error of those is forced to 0: their sums hold nothing new)
    const p = tiles ? this.errTilePass : this.errPass;
    p.u.a!.value = this.sumRT.texture;
    p.u.b!.value = this.newRT.texture;
    p.u.invA!.value = 1 / n;
    p.u.invB!.value = 1 / (2 * n);
    p.render(r, this.errRT);
    this.maxPass.u.e!.value = this.errRT.texture;
    this.maxPass.render(r, this.maxRT);
    r.readRenderTargetPixels(this.maxRT, 0, 0, this.maxRT.width, this.maxRT.height, this.errBuf);
    let m = 0;
    for (let i = 0; i < this.errBuf.length; i += 4) m = Math.max(m, this.errBuf[i]!);
    return m;
  }

  /**
   * Render and composite all clips active at t into an HDR texture (no post): each track's clips (with their
   * transition), then the tracks over one another, lowest first. `dt` is the step handed to scenes (the frame
   * step, or the sub-frame spacing); `seeked` says time jumped before this call.
   */
  private composite(t: number, dt: number, seeked: boolean): { outTex: THREE.Texture; post: PostParams } {
    const r = this.renderer;
    const active = this.timeline.filter((e) => t >= e.start && t < e.end);
    const tracks = [...new Set(active.map((e) => e.track ?? 0))].sort((a, b) => a - b);
    let post: PostParams = { ...DEFAULT_POST };
    let outTex: THREE.Texture | null = null;
    tracks.forEach((tn, ti) => {
      const clips = active.filter((e) => (e.track ?? 0) === tn).sort((a, b) => a.start - b.start);
      const res = this.compositeTrack(clips, t, dt, seeked, this.trackRTs[ti % this.trackRTs.length]!);
      post = { ...post, ...res.post };
      // the track's blend is its latest clip's; its opacity fades from clip to clip across a transition
      const top = clips[clips.length - 1]!, before = clips[clips.length - 2];
      const mode = top.blend ?? 'normal';
      let opacity = top.opacity ?? 1;
      if (before) opacity = (before.opacity ?? 1) + (opacity - (before.opacity ?? 1)) * Math.min(1, (t - top.start) / Math.max(1e-3, before.end - top.start));
      // (what each clip reported shows at its share of the transition and the track's opacity)
      clips.forEach((e, i) => boxes.fade(e.id, res.weights[i]! * opacity));
      // (the lowest track goes into the stack only when it is blended or something is drawn over it)
      if (ti === 0 && mode === 'normal' && opacity === 1) { outTex = res.outTex; return; }
      if (ti === 0) clearRT(r, this.stackRT, [0, 0, 0], ALPHA ? 0 : 1);
      else if (outTex !== this.stackRT.texture) this.comp.draw(r, outTex!, this.stackRT, { mode: 'replace', premult: false });
      this.comp.draw(r, res.outTex, this.stackRT, { mode, opacity, premult: false });
      outTex = this.stackRT.texture;
    });
    if (!outTex) { clearRT(r, this.stackRT, [0, 0, 0], ALPHA ? 0 : 1); outTex = this.stackRT.texture; }
    return { outTex, post };
  }

  /** One track at t: its active clips in start order, the later ones transitioning in over the earlier. */
  private compositeTrack(active: TimelineEntry[], t: number, dt: number, seeked: boolean, rt3: TrackRTs): { outTex: THREE.Texture; post: PostOverrides; weights: number[] } {
    const r = this.renderer;
    let post: PostOverrides = {};
    // each clip's share of the track's picture (1, unless crossfades mix it with the clips after it)
    const weights = active.map(() => 1);
    let under: THREE.Texture | null = null;
    let outTex: THREE.Texture = rt3.rts[0]!.texture;

    active.forEach((e, idx) => {
      const rec = this.loaded.get(e.id);
      const rt = rt3.rts[idx % rt3.rts.length]!;
      const prev = active[idx - 1], next = active[idx + 1];
      const tin = prev ? Math.min(1, (t - e.start) / Math.max(1e-3, prev.end - e.start)) : 1;
      const tout = next ? Math.max(0, (t - next.start) / Math.max(1e-3, e.end - next.start)) : 0;
      if (!rec?.scene) {
        // a clip that was not loaded (--only) shows nothing; one whose scene failed shows dark red
        clearRT(r, rt, rec?.error ? [0.25, 0.0, 0.0] : [0, 0, 0], rec?.error ? 1 : 0);
        under = rt.texture; outTex = rt.texture;
        return;
      }
      const s = rec.scene;
      // (sub-frames of one frame may step back within its shutter: not a seek)
      const sceneSeeked = seeked || rec.lastT < 0 || Math.abs(t - rec.lastT) > 0.25;
      boxes.clip(e.id, e.track ?? 0);
      if (s.stateful && sceneSeeked) {
        boxes.pause(true);
        s.reset();
        const from = Math.max(e.start, t - s.prerollMax);
        const step = 1 / FPS;
        let first = true;
        for (let pt = from; pt < t - step * 0.5; pt += step) {
          s.render(this.frameFor(e, pt, first ? 0 : step, first, true, null, 1, 0), rt);
          first = false;
        }
        boxes.pause(false);
      }
      let ov: PostOverrides | void = undefined;
      this.drawing = e.id;
      try {
        ov = s.render(this.frameFor(e, t, sceneSeeked ? 0 : dt, sceneSeeked && !s.stateful, false, idx > 0 ? under : null, tin, tout), rt);
      } catch (err) {
        this.renderFailed(rec, `[${e.id}] render at ${t.toFixed(3)} s: ${String((err as Error)?.stack ?? err)}`);
        clearRT(r, rt, [0.25, 0.0, 0.0]);
      }
      this.drawing = '';
      rec.lastT = t;
      post = { ...post, ...(e.post ?? {}), ...(ov ?? {}) };
      if (idx > 0 && !s.handlesTransition && under) {
        // the clip's transition from the previous clip over the overlap (a crossfade unless it says otherwise)
        const tr = transitionOf(e.transition, e.id);
        const mix = rt3.mix[under === rt3.mix[0]!.texture ? 1 : 0]!;
        // (in a transparent render the lowest track is like the others: a dip goes through transparent)
        this.transition.draw(r, tr, under, rt.texture, tin, mix, (e.track ?? 0) > 0 || ALPHA);
        outTex = mix.texture;
        const [wo, wi] = transitionWeights(tr, tin);
        for (let j = 0; j < idx; j++) weights[j]! *= wo;
        weights[idx] = wi;
      } else outTex = rt.texture;
      under = outTex;
    });
    return { outTex, post, weights };
  }

  /** RGBA8 pixels of the last rendered frame (bottom-up rows), PW x PH. */
  readPixels(buf?: Uint8Array) {
    const out = buf ?? new Uint8Array(PW * PH * 4);
    this.renderer.readRenderTargetPixels(this.finalRT, 0, 0, PW, PH, out);
    return out;
  }

  /**
   * Same pixels as readPixels(), read through a pixel-pack buffer and a fence instead of a blocking
   * readPixels: several times faster in Chrome (~15 ms instead of ~40 ms at 1920x1080, ~150 ms at 3840x2160).
   */
  async readPixelsAsync(buf?: Uint8Array) {
    const out = buf ?? new Uint8Array(PW * PH * 4);
    await this.renderer.readRenderTargetPixelsAsync(this.finalRT, 0, 0, PW, PH, out);
    return out;
  }

  private packs: ({ buf: WebGLBuffer; sync: WebGLSync; bytes: number } | undefined)[] = [];
  /**
   * Packing passes, one per readback: the frame's channels laid out as the bytes of the row stream ffmpeg reads
   * (little-endian), four bytes per texel of an RGBA8 target `PW * channels * bytes / 4` wide, copied exactly.
   * rgb8 is packed rgb24 (a quarter fewer bytes to read back and send than RGBA).
   */
  private packers = new Map<Pixels, { rt: THREE.WebGLRenderTarget; pass: FSPass }>();
  private packer(mode: Pixels) {
    let p = this.packers.get(mode);
    if (p) return p;
    if (mode === 'yuv420') return this.yuvPacker();
    const { channels: C, bytes: B } = PIXELS[mode], w = (PW * C * B) / 4;
    const max = (this.renderer.getContext() as WebGL2RenderingContext).getParameter(0x0d33) as number; // MAX_TEXTURE_SIZE
    if (w > max) throw new Error(`a ${mode} readback of a ${PW} px wide frame needs a ${w} px wide target; this GPU allows ${max}`);
    const byte = B === 1 ? 'p[ch]' : `float((${mode === 'linear' ? 'packHalf2x16(vec2(p[ch], 0.0))' : 'uint(clamp(p[ch], 0.0, 1.0) * 65535.0 + 0.5)'} >> (8u * uint(k))) & 255u) / 255.0`;
    const pass = new FSPass(/* glsl */ `
      uniform sampler2D src;
      void main() {
        ivec2 o = ivec2(gl_FragCoord.xy);
        vec4 v;
        for (int c = 0; c < 4; c++) {
          int b = o.x * 4 + c, i = b / ${C * B}, ch = (b - i * ${C * B}) / ${B}, k = b - i * ${C * B} - ch * ${B};
          vec4 p = texelFetch(src, ivec2(i, o.y), 0);
          v[c] = ${byte};
        }
        fragColor = v;
      }`, { src: { value: null } });
    p = { rt: new THREE.WebGLRenderTarget(w, PH, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }), pass };
    this.packers.set(mode, p);
    return p;
  }
  /**
   * The yuv420 packer: the Y plane in the first PH rows of a PW/4-wide RGBA8 target (four luma bytes a texel), then
   * U and V, two chroma rows to a target row, so the target's bytes are yuv420p's planes in order (bottom-up rows,
   * as ffmpeg's vflip expects). Limited-range BT.709 from the final frame's sRGB bytes, rounded to nearest; chroma
   * from the average of each 2x2 block.
   */
  private yuvPacker() {
    if (!yuvFits(PW, PH)) throw new Error(`a yuv420 readback needs a frame width that is a multiple of 8 and a height that is a multiple of 4 (${PW}x${PH})`);
    const cw = PW / 2;
    const pass = new FSPass(/* glsl */ `
      uniform sampler2D src;
      const vec3 K = vec3(0.2126, 0.7152, 0.0722);
      float luma(ivec2 p) { return dot(texelFetch(src, p, 0).rgb, K); }
      void main() {
        ivec2 o = ivec2(gl_FragCoord.xy);
        vec4 v;
        for (int c = 0; c < 4; c++) {
          int b = o.x * 4 + c;
          float x;
          if (o.y < ${PH}) x = 16.0 + 219.0 * luma(ivec2(b, o.y));
          else {
            int r = o.y - ${PH}, plane = r / ${PH / 4}, row = 2 * (r - plane * ${PH / 4}) + b / ${cw}, cx = b - (b / ${cw}) * ${cw};
            ivec2 q = ivec2(2 * cx, 2 * row);
            vec3 s = (texelFetch(src, q, 0).rgb + texelFetch(src, q + ivec2(1, 0), 0).rgb + texelFetch(src, q + ivec2(0, 1), 0).rgb + texelFetch(src, q + ivec2(1, 1), 0).rgb) * 0.25;
            float y = dot(s, K);
            x = 128.0 + 224.0 * (plane == 0 ? (s.b - y) / 1.8556 : (s.r - y) / 1.5748);
          }
          v[c] = floor(clamp(x, 0.0, 255.0) + 0.5) / 255.0;
        }
        fragColor = v;
      }`, { src: { value: null } });
    const p = { rt: new THREE.WebGLRenderTarget(PW / 4, (PH * 3) / 2, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }), pass };
    this.packers.set('yuv420', p);
    return p;
  }
  /** Bytes per frame of readStart/readFinish in `mode` (bottom-up rows). */
  static bytes(mode: Pixels = 'rgb8') { return PW * PH * PIXELS[mode].perPixel; }
  /** Bytes per frame of the rgb24 readback. */
  static readonly RGB_BYTES = PW * PH * 3;
  /**
   * Pipelined readback of the last rendered frame in `mode` (bottom-up rows; rgb8 is the bytes of readPixels()
   * without alpha): queue the copy into pixel-pack buffer `slot` (it runs on the GPU after the frame, so the next
   * frame can be rendered at once), then collect it with readFinish(slot). Two slots let frame n be collected while
   * n+1 renders. (A fresh buffer each time, as three's readback does: Chrome warns on every frame when a read-back
   * buffer is reused, though it reads no faster.)
   */
  readStart(slot: number, mode: Pixels = 'rgb8') {
    const r = this.renderer, gl = r.getContext() as WebGL2RenderingContext;
    const old = this.packs[slot];
    if (old) { gl.deleteSync(old.sync); gl.deleteBuffer(old.buf); } // (left by a stream that failed)
    if (mode === 'linear' && !this.linearTex) throw new Error('readStart: nothing rendered yet');
    if ((mode === 'rgb16' || mode === 'rgba16') && BITS === 8) throw new Error(`readStart: a ${mode} readback needs a page opened with ?bits= above 8`);
    const { rt, pass } = this.packer(mode), bytes = Engine.bytes(mode);
    const buf = gl.createBuffer()!;
    pass.u.src!.value = mode === 'linear' ? this.linearTex : this.finalRT.texture;
    pass.render(r, rt);
    r.setRenderTarget(rt);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
    gl.readPixels(0, 0, rt.width, rt.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.packs[slot] = { buf, sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!, bytes };
    gl.flush();
  }

  /** Resolve once the GPU has done everything queued so far (a fence, polled between tasks). For `reel perf`. */
  async gpuIdle() {
    const gl = this.renderer.getContext() as WebGL2RenderingContext, s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
    gl.flush();
    try {
      for (;;) {
        const st = gl.clientWaitSync(s, 0, 0);
        if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) return;
        if (st === gl.WAIT_FAILED) throw new Error('gpuIdle: fence wait failed');
        await yieldTask();
      }
    } finally { gl.deleteSync(s); }
  }

  /** Wait for readStart(slot)'s copy and copy it into `out` (Engine.bytes of its mode). */
  async readFinish(slot: number, out: Uint8Array) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext, p = this.packs[slot];
    if (!p) throw new Error(`readFinish: nothing queued in slot ${slot}`);
    // (a sync object's status only changes between tasks: yield to the event loop between polls)
    for (;;) {
      const s = gl.clientWaitSync(p.sync, 0, 0);
      if (s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED) break;
      if (s === gl.WAIT_FAILED) throw new Error('readFinish: fence wait failed');
      await yieldTask();
    }
    this.packs[slot] = undefined;
    gl.deleteSync(p.sync);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.buf);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out, 0, p.bytes);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.deleteBuffer(p.buf);
    return out;
  }
}
