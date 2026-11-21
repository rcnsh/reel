import * as THREE from 'three';
import { AudioData } from './audio';
import { Words } from './words';
import { Compositor, compositorFrag, FSPass, W, H, PW, PH, SCALE, FPS, SS_TAP, SUB_FRAME, makeRT, clearRT, setCpuCanvases } from './gl';
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
import { idleTransitions, TransitionPass, transitionDisplaces, transitionOf, transitionWeights, type Transition } from './transitions';
import { maskSubFrames, softwareGL } from './tilemask';
import { clipTime, sceneRate, sceneTime, statefulBlocker, type ClipTime } from './cliptime';
import { BUNDLED_SOUNDS, parseProps, resolveProps, type Clip, type Props, type SoundClip, type VideoConfig } from '../config';
import { BlendPass, TrackFx, blendOf, gradeOf, isIdentityGrade, isShaderBlend, lerpGrade, matteOf, matteSource, opacityOf, resolveGrade, trackSettingsOf, type Grade, type GradeValues, type MatteMode, type TrackBlend, type TrackSettings } from './tracks';

function pageProps(): Props | null {
  const m = typeof location === 'undefined' ? null : /[?&]props=([^&]*)/.exec(location.search);
  if (m) {
    let text: string;
    try { text = decodeURIComponent(m[1]!); } catch { throw new Error(`?props=: not URL-encoded (a % in the JSON is written %25)`); }
    return parseProps(text, '?props=');
  }
  const injected = (globalThis as { __REEL_PROPS__?: string }).__REEL_PROPS__;
  return injected === undefined ? null : parseProps(injected, 'props');
}

function frozenCopy<T>(v: T): T {
  let c: T;
  try { c = structuredClone(v); } catch (e) { throw new Error(`props: expected plain data (${(e as Error).message})`); }
  const freeze = (x: unknown) => {
    if (!x || typeof x !== 'object' || ArrayBuffer.isView(x)) return;
    Object.freeze(x);
    for (const y of Object.values(x)) freeze(y);
  };
  freeze(c);
  return c;
}

export type TimelineEntry = Clip;

export const OVERLAY_ID = 'overlay';

interface TrackRTs { rts: THREE.WebGLRenderTarget[]; mix: THREE.WebGLRenderTarget[] }

type Imported = { m?: { default: SceneClass }; err?: unknown };

interface Loaded { entry: TimelineEntry; scene: Scene | null; error?: string; renderError?: string; lastT: number; cap?: number }

export interface AdaptiveSampling { min: number; max: number; tol: number; refine?: 'tiles' | 'frame'; mask?: 'subs' | 'merge' }


function ternaryOffsets(steps: number) {
  const u = [0, 1, 2, 3].map((i) => (i + 0.5) / 4 - 0.5);
  for (let l = 0, n = 4; l < steps; l++, n *= 3)
    for (let m = 0; m < n; m++) u.push((3 * m + 0.5) / (3 * n) - 0.5, (3 * m + 2.5) / (3 * n) - 0.5);
  return u;
}

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

async function waitFence(gl: WebGL2RenderingContext, sync: WebGLSync, label: string) {
  for (;;) {
    const s = gl.clientWaitSync(sync, 0, 0);
    if (s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED) return;
    if (s === gl.WAIT_FAILED) throw new Error(`${label}: fence wait failed`);
    await yieldTask();
  }
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  ctx!: Omit<SceneCtx, 'capSamples'>;
  audio!: AudioData;
  words!: Words;
  props: Props = {};
  post!: Post;
  comp = new Compositor();
  loaded = new Map<string, Loaded>();
  private trackRTs: TrackRTs[] = [];
  private stackRT = makeRT();
  private _duration = 0;
  private sumRT = makeRT(W, H, { type: THREE.FloatType });
  private newRT = makeRT(W, H, { type: THREE.FloatType });
  private avgRT = makeRT(W, H, { depthBuffer: false });
  private errRT: THREE.WebGLRenderTarget;
  private maxRT: THREE.WebGLRenderTarget;
  private errPass: FSPass;
  private maxPass: FSPass;
  private errBuf: Float32Array;
  private tileOn: Uint8Array;
  private tileTex: THREE.DataTexture;
  private gainBuf: Float32Array;
  private gainTex: THREE.DataTexture;
  private maskPass: FSPass;
  private errTilePass: FSPass;
  private gainPass: FSPass;
  private maskedRTs = new Map<THREE.WebGLRenderTarget, { margin: number; moving?: boolean }>();
  private tileOnWide: Uint8Array;
  private tileTexWide: THREE.DataTexture;
  private masking = false;
  private depthSeen = false;
  private depthEntries = new Set<string>();
  lastSamples = 1;
  lastErrors: number[] = [];
  lastShaded = 1;
  private maskSubsDefault: boolean;
  private finalRT = new THREE.WebGLRenderTarget(PW, PH, { type: BITS > 8 ? THREE.FloatType : THREE.UnsignedByteType, depthBuffer: false });
  private linearTex: THREE.Texture | null = null;
  private blit: FSPass;
  private transition = new TransitionPass();
  private trackSettings = new Map<number, TrackSettings>();
  private clipMattes = new Map<string, { mode: MatteMode; src: number }>();
  private trackMattes = new Map<number, { mode: MatteMode; src: number }>();
  private staticMattes = new Set<number>();
  private trackFx = new TrackFx();
  private fxRTs = new Map<number, THREE.WebGLRenderTarget>();
  private blendPass = new BlendPass();
  private stackRT2: THREE.WebGLRenderTarget | null = null;
  private emptyMatte = (() => { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.needsUpdate = true; return t; })();
  private transitions = new WeakMap<TimelineEntry, Transition>();
  private transitionAt(e: TimelineEntry) {
    let t = this.transitions.get(e);
    if (!t) this.transitions.set(e, (t = transitionOf(e.transition, e.id)));
    return t;
  }
  private accum: FSPass;
  private lastT = -1;
  lastPost: PostParams = { ...DEFAULT_POST };
  loadErrors: string[] = [];
  renderErrors: string[] = [];
  get errors() { return [...this.loadErrors, ...this.renderErrors]; }
  warnings: { clip: string; message: string }[] = [];
  clearRenderErrors() {
    this.renderErrors = [];
    for (const rec of this.loaded.values()) rec.renderError = undefined;
  }

  timeline: TimelineEntry[] = [];
  private times = new Map<string, ClipTime>();
  private configSounds: SoundClip[] = [];
  private exposure = 0;
  sounds(): SoundClip[] {
    return [...this.configSounds, ...((globalThis as { __reelSounds?: SoundClip[] }).__reelSounds ?? [])].sort((a, b) => a.at - b.at);
  }
  collectBoxes = false;
  lastBoxes: ReportedBox[] = [];
  lastTextDraws: Record<string, number> = {};
  lastClocks: Record<string, Record<string, number>> = {};
  lastStepped = new Set<string>();
  private drawing = '';

  constructor(public canvas: HTMLCanvasElement, private config: VideoConfig) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(PW, PH, false);
    this.renderer.autoClear = false;
    htmlLayers.attach(canvas);
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
    this.accum = new FSPass(`uniform sampler2D src;
      void main() {
        vec4 c = texture(src, vUv);
        bool ok = abs(c.r) <= 6e4 && abs(c.g) <= 6e4 && abs(c.b) <= 6e4 && abs(c.a) <= 6e4;
        fragColor = ok ? c : vec4(0.0);
      }`, { src: { value: null } }, { blending: THREE.CustomBlending, transparent: true });
    const am = this.accum.mat;
    am.blendEquation = THREE.AddEquation;
    am.blendSrc = THREE.OneFactor; am.blendDst = THREE.OneFactor;
    am.blendSrcAlpha = THREE.OneFactor; am.blendDstAlpha = THREE.OneFactor;
    const B = 2 * SCALE, ew = Math.ceil(PW / B), eh = Math.ceil(PH / B), R = 16;
    const small = { depthBuffer: false, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, pxScale: 1 } as const;
    this.errRT = makeRT(ew, eh, small);
    this.maxRT = makeRT(Math.ceil(ew / R), Math.ceil(eh / R), small);
    this.errBuf = new Float32Array(this.maxRT.width * this.maxRT.height * 4);
    const errFrag = (tiles: boolean) => /* glsl */ `
      uniform sampler2D a; uniform sampler2D b; uniform float invA, invB;${tiles ? ' uniform sampler2D tiles;' : ''}
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
        fragColor = vec4(170.0 * max(e.r, max(e.g, e.b))${tiles ? ` * texelFetch(tiles, ivec2(gl_FragCoord.xy) / ${R}, 0).r` : ''}, 0.0, 0.0, 1.0);
      }`;
    this.errPass = new FSPass(errFrag(false), { a: { value: null }, b: { value: null }, invA: { value: 1 }, invB: { value: 1 } });
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

    const tw = this.maxRT.width, th = this.maxRT.height, TP = B * R;
    this.tileOn = new Uint8Array(tw * th);
    this.tileTex = new THREE.DataTexture(this.tileOn, tw, th, THREE.RedFormat, THREE.UnsignedByteType);
    this.tileOnWide = new Uint8Array(tw * th);
    this.tileTexWide = new THREE.DataTexture(this.tileOnWide, tw, th, THREE.RedFormat, THREE.UnsignedByteType);
    this.gainBuf = new Float32Array(tw * th);
    this.gainTex = new THREE.DataTexture(this.gainBuf, tw, th, THREE.RedFormat, THREE.FloatType);
    for (const t of [this.tileTex, this.tileTexWide, this.gainTex]) { t.unpackAlignment = 1; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; }
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
    {
      const gl = this.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      this.maskSubsDefault = maskSubFrames(name);
      setCpuCanvases(softwareGL(name));
    }
    this.errTilePass = new FSPass(errFrag(true), { a: { value: null }, b: { value: null }, invA: { value: 1 }, invB: { value: 1 }, tiles: { value: this.tileTex } });
    this.gainPass = new FSPass(
      compositorFrag({ uniform: 'uniform sampler2D gain;', expr: `texelFetch(gain, ivec2(gl_FragCoord.xy) / ${TP}, 0).r` }),
      { tex: { value: null }, tint: { value: new THREE.Vector3(1, 1, 1) }, uvXform: { value: new THREE.Vector4(1, 1, 0, 0) }, premult: { value: false }, gain: { value: this.gainTex } },
    );
  }

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

  private displaced = new Set<THREE.WebGLRenderTarget>();
  private displacedAt(t: number, w: number) {
    this.displaced.clear();
    const moving = this.timeline.some((e) => {
      if (!transitionDisplaces(this.transitionAt(e))) return false;
      return this.timeline.some((o) => o !== e && (o.track ?? 0) === (e.track ?? 0) && o.start < e.start && o.end > e.start && o.end > t - w / 2 && e.start < t + w / 2);
    });
    if (moving) for (const tr of this.trackRTs) for (const rt of [...tr.rts, ...tr.mix]) this.displaced.add(rt);
  }

  private writeTileMask() {
    const r = this.renderer, was = this.masking;
    if (was) this.setMasking(false);
    this.tileTex.needsUpdate = true;
    const on = this.tileOn, wide = this.tileOnWide, tw = this.maxRT.width, th = this.maxRT.height;
    wide.fill(0);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      if (!on[y * tw + x]) continue;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(th - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(tw - 1, x + 1); xx++) wide[yy * tw + xx] = 255;
    }
    this.tileTexWide.needsUpdate = true;
    for (const [rt, m] of this.maskedRTs) this.drawMask(rt, m.margin, m.moving || this.displaced.has(rt) ? null : new THREE.Vector4(PW / rt.width, PH / rt.height, 0, 0));
    if (was) this.setMasking(true);
  }

  private writeSumMask() {
    this.tileTex.needsUpdate = true;
    this.drawMask(this.sumRT, 0, new THREE.Vector4(PW / this.sumRT.width, PH / this.sumRT.height, 0, 0));
  }

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
    r.state.buffers.color.setMask(true);
  }

  private nearPass: FSPass;
  private maskDepth(rt: THREE.WebGLRenderTarget) {
    const r = this.renderer, d = r.state.buffers.depth;
    r.setRenderTarget(rt);
    d.setMask(true);
    r.clear(false, true, true);
    if (!this.masking || this.displaced.size) return;
    (this.nearPass.u.map!.value as THREE.Vector4).set(PW / rt.width, PH / rt.height, 0, 0);
    this.nearPass.render(r, rt);
    r.state.buffers.color.setMask(true);
    r.setRenderTarget(rt);
  }

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
    this.props = frozenCopy(resolveProps(c.props, pageProps()));
    const src = { words: this.words, audio: this.audio, props: this.props };
    this.timeline = c.timeline(src);
    this.configSounds = typeof c.sounds === 'function' ? c.sounds(src) : c.sounds ?? [];
    const ids = new Set<string>();
    for (const e of this.timeline) {
      if (ids.has(e.id)) throw new Error(`timeline: two clips are called '${e.id}'`);
      ids.add(e.id);
      if (!(e.end > e.start) || e.start < 0) throw new Error(`timeline: clip '${e.id}' runs ${e.start} to ${e.end}`);
      const ex = e.check?.exempt;
      if (ex !== undefined && ex !== true && !(Array.isArray(ex) && ex.every((r) => CHECK_RULES.includes(r))))
        throw new Error(`timeline: clip '${e.id}' check.exempt ${JSON.stringify(ex)}: expected true or a list of ${CHECK_RULES.join(', ')}`);
      const where = `timeline: clip '${e.id}'`;
      this.transitions.set(e, transitionOf(e.transition, where));
      if (e.blend !== undefined) blendOf(e.blend, where);
      if (e.opacity !== undefined) opacityOf(e.opacity, where);
      if (e.grade !== undefined && typeof e.grade !== 'function') gradeOf(e.grade, where);
      this.times.set(e.id, clipTime(e, FPS));
    }
    this.checkTracks();
    this.warnings = idleTransitions(this.timeline, 1 / FPS);
    for (const w of this.warnings) console.warn(`timeline: ${w.message}`);
    this._duration = c.duration ?? (this.audio.duration > 0 ? this.audio.duration : Math.max(0, ...this.timeline.map((e) => e.end)));
    if (!(this._duration > 0)) throw new Error('the video has no length: give the config a duration, audio analysis or clips');
    let overlay: TimelineEntry | null = null;
    if (THEME.overlay) {
      if (ids.has(OVERLAY_ID)) throw new Error(`timeline: '${OVERLAY_ID}' is the theme overlay's clip; call yours something else`);
      overlay = { id: OVERLAY_ID, scene: () => import('../scenes/hud'), start: 0, end: this._duration, track: Math.max(0, ...this.timeline.map((e) => e.track ?? 0)) + 1, params: { ...THEME.overlay } };
      this.timeline.push(overlay);
      this.times.set(OVERLAY_ID, clipTime(overlay, FPS));
    }
    const tracks = new Set(this.timeline.map((e) => e.track ?? 0)).size;
    for (let i = 0; i < Math.max(1, tracks); i++) {
      const t: TrackRTs = { rts: [makeRT(), makeRT(), makeRT()], mix: [makeRT(), makeRT()] };
      this.trackRTs.push(t);
      for (const rt of [...t.rts, ...t.mix]) this.maskedRTs.set(rt, { margin: 0 });
    }
    this.ctx = { renderer: this.renderer, audio: this.audio, words: this.words, props: this.props, comp: this.comp, W, H, id: '', params: {}, start: 0, end: 0, clip: (id) => {
      const e = this.timeline.find((x) => x.id === id);
      if (!e) throw new Error(`no clip '${id}' on the timeline (it has ${this.timeline.map((x) => x.id).join(', ')})`);
      return { id: e.id, start: e.start, end: e.end, track: e.track ?? 0 };
    }, mapTileMask: (rt, map) => this.mapTileMask(rt, map), maskDepth: (rt) => this.maskDepth(rt) };
    this.post = new Post();
    const entries = only ? this.timeline.filter((e) => e === overlay || only(e)) : this.timeline;
    const mods = await Promise.all(entries.map((e): Promise<Imported> => e.scene().then((m) => ({ m }), (err: unknown) => ({ err }))));
    for (const [i, e] of entries.entries()) await this.loadEntry(e, mods[i]!);
    for (const e of entries) {
      this.drawing = `${e.id}: its transition's glsl`;
      try { this.transition.compile(this.renderer, this.transitionAt(e)); }
      catch (err) { this.loadErrors.push(`[${e.id}] its transition: ${String((err as Error)?.message ?? err)}`); }
      finally { this.drawing = ''; }
    }
    for (const [id, msg] of await htmlLayers.settle()) this.fail(id, msg);
    htmlLayers.loading(false);
    await this.checkSounds();
  }

  private checkTracks() {
    this.trackSettings = trackSettingsOf(this.config.tracks);
    const nums = [...new Set(this.timeline.map((e) => e.track ?? 0))];
    const resolve = (tn: number, m: unknown, where: string) => { const r = matteOf(m, where); return { mode: r.mode, src: matteSource(tn, r, nums, where) }; };
    for (const e of this.timeline) if (e.matte !== undefined) this.clipMattes.set(e.id, resolve(e.track ?? 0, e.matte, `timeline: clip '${e.id}'`));
    for (const [tn, ts] of this.trackSettings) {
      if (!nums.includes(tn)) throw new Error(`tracks[${tn}]: no clip is on track ${tn} (clips are on ${[...nums].sort((a, b) => a - b).join(', ')})`);
      if (ts.matte !== undefined) this.trackMattes.set(tn, resolve(tn, ts.matte, `tracks[${tn}]`));
    }
    for (const tn of this.trackMattes.keys()) {
      const seen = [tn];
      for (let x = this.trackMattes.get(tn); x; x = this.trackMattes.get(x.src)) {
        const again = seen.includes(x.src);
        seen.push(x.src);
        if (again) throw new Error(`tracks: the mattes go round in a circle (track ${seen.join(' is matted by track ')})`);
      }
    }
    this.staticMattes = new Set([...this.trackMattes.values()].map((m) => m.src));
  }

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

  private async loadEntry(e: TimelineEntry, mod: Imported) {
    const rec: Loaded = { entry: e, scene: null, lastT: -1 };
    this.loaded.set(e.id, rec);
    htmlLayers.owner(e.id);
    const time = this.times.get(e.id)!, end = time.identity ? e.end : e.start + time.length;
    LOADING.clip = { id: e.id, start: e.start, end, time };
    try {
      const m = mod;
      if (!m.m) throw m.err;
      let made = false;
      const capSamples = (n: number) => {
        if (!(n >= 1)) throw new Error(`ctx.capSamples: expected a count of at least 1, got ${n}`);
        if (!made) rec.cap = Math.min(rec.cap ?? Infinity, n);
      };
      const s = new m.m.default({ ...this.ctx, id: e.id, params: e.params ?? {}, start: e.start, end, capSamples });
      const refuse = () => {
        const no = s.stateful && statefulBlocker(time);
        if (no) throw new Error(`the scene is stateful (it simulates forward from its start), so its clip cannot ${no}; speed works`);
      };
      refuse();
      await s.init();
      refuse();
      made = true;
      rec.scene = s;
      for (const t of s.tileMasked) this.maskedRTs.set(t.rt, { margin: t.margin, moving: t.moving });
    } catch (err) {
      this.fail(e.id, String((err as Error)?.stack ?? err));
    } finally { htmlLayers.owner(''); LOADING.clip = null; }
  }

  reload(id: string): Promise<void> {
    const next = this.reloads.then(() => this.reloadOne(id));
    this.reloads = next.catch(() => {});
    return next;
  }
  private reloads: Promise<void> = Promise.resolve();
  private async reloadOne(id: string) {
    const e = this.timeline.find((x) => x.id === id);
    if (!e) return;
    const old = this.loaded.get(id)?.scene;
    for (const m of old?.tileMasked ?? []) this.maskedRTs.delete(m.rt);
    old?.dispose();
    const rec = this.loaded.get(id);
    if (rec) rec.scene = null;
    htmlLayers.drop(id);
    htmlLayers.loading(true);
    try {
      await this.loadEntry(e, await e.scene().then((m): Imported => ({ m }), (err: unknown) => ({ err })));
      for (const [cid, msg] of await htmlLayers.settle()) this.fail(cid, msg);
    } finally { htmlLayers.loading(false); }
    this.lastT = -1;
  }

  forgetTime() {
    this.lastT = -1;
    for (const rec of this.loaded.values()) rec.lastT = -1;
  }

  get duration() { return this._duration; }

  async prepare(t: number, dt = 1 / FPS, samples: number | AdaptiveSampling = 1, shutter = 0.5) {
    const w = samples === 1 ? 0 : dt * shutter;
    this.exposure = w;
    const frames = new Map<string, Frame>();
    for (const e of this.timeline) {
      if (!(t + w / 2 >= e.start && t - w / 2 < e.end)) continue;
      const rec = this.loaded.get(e.id);
      if (!rec?.scene) continue;
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

  failures = 0;
  private renderFailed(rec: Loaded, msg: string) {
    this.failures++;
    if (rec.renderError) return;
    rec.renderError = msg;
    this.renderErrors.push(msg);
    console.error(msg);
  }

  async renderFrame(t: number, dt = 1 / FPS, toScreen = true, samples: number | AdaptiveSampling = 1, shutter = 0.5): Promise<number> {
    await this.prepare(t, dt, samples, shutter);
    return this.render(t, dt, toScreen, samples, shutter);
  }

  private frameFor(e: TimelineEntry, t: number, dt: number, seeked: boolean, preroll: boolean, under: THREE.Texture | null, tin: number, tout: number): Frame {
    const beat = this.audio.beatAt(t), bar = this.audio.barAt(t), beatPhase = beat - Math.floor(beat), barPhase = bar - Math.floor(bar), a = this.audio.sample(t);
    const m = this.times.get(e.id);
    if (!m || m.identity) return { t, vt: t, dt, lt: t - e.start, p: (t - e.start) / (e.end - e.start), start: e.start, end: e.end, exposure: this.exposure, seeked, preroll, beat, bar, beatPhase, barPhase, a, under, tin, tout };
    const lt = sceneTime(m, t);
    return {
      t: e.start + lt, vt: t, dt: dt * Math.abs(sceneRate(m, t)), lt, p: lt / m.length, start: e.start, end: e.start + m.length, exposure: this.exposure * m.speed,
      seeked, preroll, beat, bar, beatPhase, barPhase, a, under, tin, tout,
    };
  }

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
    if (collect) { this.lastBoxes = []; this.lastTextDraws = {}; this.lastClocks = {}; this.lastStepped.clear(); }
    if (samples === 1) {
      SS_TAP.value = -1;
      SUB_FRAME.index = -1;
      if (collect) boxes.begin();
      ({ outTex, post } = this.composite(t, dt, seeked));
      if (collect) { this.lastBoxes = boxes.end(); this.lastTextDraws = boxes.textDraws(); this.lastClocks = boxes.clocks(); }
    } else {
      const adaptive = typeof samples !== 'number';
      let maxAdaptive = adaptive ? samples.max : 0;
      if (adaptive) {
        const w = dt * shutter;
        const on = this.timeline.filter((e) => t + w / 2 >= e.start && t - w / 2 < e.end);
        const st = on.find((e) => this.loaded.get(e.id)?.scene?.stateful);
        if (st) throw new Error(`adaptive sampling needs stateless scenes; '${st.id}' is stateful (use a fixed --samples)`);
        for (const e of on) { const cap = e.maxSamples || this.loaded.get(e.id)?.cap; if (cap) maxAdaptive = Math.min(maxAdaptive, cap); }
      }
      const cycle = adaptive || samples % 4 === 0;
      const POST_U = 0.125;
      let nearest = Infinity;
      const sub = (k: number, u: number, into: THREE.WebGLRenderTarget, step: number) => {
        SS_TAP.value = cycle ? (k + (k >> 2)) % 4 : -1;
        SUB_FRAME.index = k;
        const ts = Math.max(0, t + dt * shutter * u);
        let res: ReturnType<Engine['composite']>;
        if (collect) boxes.begin();
        if (!this.masking) res = this.composite(ts, step, seeked && k === 0);
        else {
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
        if (collect) { const b = boxes.end(); if (Math.abs(u) < nearestBoxes) { nearestBoxes = Math.abs(u); this.lastBoxes = b; this.lastTextDraws = boxes.textDraws(); this.lastClocks = boxes.clocks(); } }
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
          const on = this.tileOn, tw = this.maxRT.width, th = this.maxRT.height, T = on.length;
          on.fill(255);
          const tileN = this.gainBuf;
          tileN.fill(0);
          let live = T, shaded = 0, full = 0;
          const maskSubs = samples.mask ? samples.mask === 'subs' : this.maskSubsDefault;
          for (let l = lo; l < hi && live > 0; l++) {
            const masked = live < T;
            clearRT(r, this.newRT, [0, 0, 0], 0);
            if (masked) { if (maskSubs) { this.writeTileMask(); this.setMasking(true); } else this.writeSumMask(); }
            for (let k = n; k < 3 * n; k++) sub(k, u[k]!, this.newRT, dt / (3 * n));
            if (masked && maskSubs) this.setMasking(false);
            const err = this.sampleError(n, masked) / 2;
            this.lastErrors.push(err);
            if (masked) this.setMasking(true);
            this.addSum();
            if (masked) this.setMasking(false);
            shaded += 2 * n * (maskSubs ? live : T); full += 2 * n * T;
            n *= 3;
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

  private addSum() {
    this.accum.u.src!.value = this.newRT.texture;
    this.accum.render(this.renderer, this.sumRT);
  }

  private sampleError(n: number, tiles = false) {
    const r = this.renderer;
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

  private composite(t: number, dt: number, seeked: boolean): { outTex: THREE.Texture; post: PostParams } {
    const r = this.renderer;
    const active = this.timeline.filter((e) => t >= e.start && t < e.end);
    const tracks = [...new Set(active.map((e) => e.track ?? 0))].sort((a, b) => a - b);
    const clipsOf = new Map(tracks.map((tn) => [tn, active.filter((e) => (e.track ?? 0) === tn).sort((a, b) => a.start - b.start)]));
    const matteOfTrack = (tn: number) => { const c = clipsOf.get(tn)!; return this.clipMattes.get(c[c.length - 1]!.id) ?? this.trackMattes.get(tn); };
    const mattes = new Set(this.staticMattes);
    for (const tn of tracks) { const m = matteOfTrack(tn); if (m) mattes.add(m.src); }
    type Drawn = { tex: THREE.Texture; mode: TrackBlend; opacity: number; matted: boolean; post: PostOverrides };
    const drawn = new Map<number, Drawn>();
    const drawing = new Set<number>();
    const draw = (tn: number): Drawn => {
      const had = drawn.get(tn);
      if (had) return had;
      drawing.add(tn);
      const ti = tracks.indexOf(tn);
      const clips = clipsOf.get(tn)!;
      const res = this.compositeTrack(clips, t, dt, seeked, this.trackRTs[ti % this.trackRTs.length]!);
      const ts = this.trackSettings.get(tn) ?? {};
      const top = clips[clips.length - 1]!, before = clips[clips.length - 2];
      const mode = top.blend ?? ts.blend ?? 'normal';
      const k = before ? Math.min(1, (t - top.start) / Math.max(1e-3, before.end - top.start)) : 1;
      let opacity = top.opacity ?? ts.opacity ?? 1;
      if (before) { const o0 = before.opacity ?? ts.opacity ?? 1; opacity = o0 + (opacity - o0) * k; }
      let g = this.clipGrade(top, t, ts.grade, res.grades[clips.length - 1]);
      if (before) g = lerpGrade(this.clipGrade(before, t, ts.grade, res.grades[clips.length - 2]), g, k);
      const graded = !isIdentityGrade(g);
      const ms = matteOfTrack(tn);
      let matte: { tex: THREE.Texture; mode: MatteMode } | null = null;
      if (ms) {
        let tex: THREE.Texture = this.emptyMatte;
        if (drawing.has(ms.src)) {
          const rec = this.loaded.get(top.id);
          if (rec) this.renderFailed(rec, `[${top.id}] at ${t.toFixed(3)} s: the mattes of tracks ${[...drawing].join(', ')} go round in a circle`);
        } else if (tracks.includes(ms.src)) tex = draw(ms.src).tex;
        matte = { mode: ms.mode, tex };
      }
      let tex = res.outTex;
      if (graded || matte) {
        if (graded && g.blur > 0 && this.masking) this.depthSeen = true;
        let rt = this.fxRTs.get(tn);
        if (!rt) { rt = makeRT(W, H, { depthBuffer: false }); this.fxRTs.set(tn, rt); }
        this.trackFx.draw(r, tex, rt, graded ? g : null, matte, tn > 0 || ALPHA);
        tex = rt.texture;
      }
      clips.forEach((e, i) => boxes.fade(e.id, mattes.has(tn) ? 0 : res.weights[i]! * opacity * (1 - g.fade)));
      const d: Drawn = { tex, mode, opacity, matted: !!matte, post: res.post };
      drawn.set(tn, d);
      drawing.delete(tn);
      return d;
    };
    let outTex: THREE.Texture | null = null;
    let first = true;
    for (const tn of tracks) {
      if (mattes.has(tn)) { draw(tn); continue; }
      const d = draw(tn);
      if (first && d.mode === 'normal' && d.opacity === 1 && !d.matted) { outTex = d.tex; first = false; continue; }
      let into = this.stackRT;
      if (first) clearRT(r, into, [0, 0, 0], ALPHA ? 0 : 1);
      else if (outTex === this.stackRT2?.texture) into = this.stackRT2;
      else if (outTex !== this.stackRT.texture) this.comp.draw(r, outTex!, into, { mode: 'replace', premult: false });
      first = false;
      if (isShaderBlend(d.mode)) {
        const dst = into === this.stackRT ? (this.stackRT2 ??= makeRT(W, H, { depthBuffer: false })) : this.stackRT;
        this.blendPass.draw(r, into.texture, d.tex, dst, d.mode, d.opacity);
        into = dst;
      } else this.comp.draw(r, d.tex, into, { mode: d.mode, opacity: d.opacity, premult: false });
      outTex = into.texture;
    }
    if (!outTex) { clearRT(r, this.stackRT, [0, 0, 0], ALPHA ? 0 : 1); outTex = this.stackRT.texture; }
    let post: PostParams = { ...DEFAULT_POST };
    for (const tn of tracks) { const d = drawn.get(tn); if (d && !mattes.has(tn)) post = { ...post, ...d.post }; }
    return { outTex, post };
  }

  private blankPrev = new THREE.Color();
  private blank(rt: THREE.WebGLRenderTarget) {
    const r = this.renderer, prevC = r.getClearColor(this.blankPrev), prevA = r.getClearAlpha();
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.setClearColor(prevC, prevA);
  }

  private compositeTrack(active: TimelineEntry[], t: number, dt: number, seeked: boolean, rt3: TrackRTs): { outTex: THREE.Texture; post: PostOverrides; weights: number[]; grades: (Grade | undefined)[] } {
    const r = this.renderer;
    let post: PostOverrides = {};
    const grades: (Grade | undefined)[] = active.map(() => undefined);
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
        clearRT(r, rt, rec?.error ? [0.25, 0.0, 0.0] : [0, 0, 0], rec?.error ? 1 : 0);
        under = rt.texture; outTex = rt.texture;
        return;
      }
      const s = rec.scene;
      const sceneSeeked = seeked || rec.lastT < 0 || Math.abs(t - rec.lastT) > 0.25;
      if (this.collectBoxes && s.stateful && !sceneSeeked && SUB_FRAME.index <= 0) this.lastStepped.add(e.id);
      boxes.clip(e.id, e.track ?? 0);
      if (s.stateful && sceneSeeked) {
        boxes.pause(true);
        s.reset();
        const from = Math.max(e.start, t - s.prerollMax / (this.times.get(e.id)?.speed ?? 1));
        const step = 1 / FPS;
        let first = true;
        for (let pt = from; pt < t - step * 0.5; pt += step) {
          this.blank(rt);
          s.render(this.frameFor(e, pt, first ? 0 : step, first, true, null, 1, 0), rt);
          first = false;
        }
        boxes.pause(false);
      }
      let ov: PostOverrides | void = undefined;
      this.drawing = e.id;
      try {
        this.blank(rt);
        ov = s.render(this.frameFor(e, t, sceneSeeked ? 0 : dt, sceneSeeked && !s.stateful, false, idx > 0 ? under : null, tin, tout), rt);
      } catch (err) {
        this.renderFailed(rec, `[${e.id}] render at ${t.toFixed(3)} s: ${String((err as Error)?.stack ?? err)}`);
        clearRT(r, rt, [0.25, 0.0, 0.0]);
      }
      this.drawing = '';
      rec.lastT = t;
      const { grade: sg, ...po } = ov ?? {};
      if (sg !== undefined) {
        try { grades[idx] = gradeOf(sg, `[${e.id}] render() returned a`); } catch (err) { this.renderFailed(rec, String((err as Error).message)); }
      }
      post = { ...post, ...(e.post ?? {}), ...po };
      if (idx > 0 && !s.handlesTransition && under) {
        const tr = this.transitionAt(e);
        const mix = rt3.mix[under === rt3.mix[0]!.texture ? 1 : 0]!;
        this.drawing = e.id;
        try { this.transition.draw(r, tr, under, rt.texture, tin, mix, (e.track ?? 0) > 0 || ALPHA); }
        finally { this.drawing = ''; }
        outTex = mix.texture;
        const [wo, wi] = transitionWeights(tr, tin);
        for (let j = 0; j < idx; j++) weights[j]! *= wo;
        weights[idx] = wi;
      } else outTex = rt.texture;
      under = outTex;
    });
    return { outTex, post, weights, grades };
  }

  private clipGrade(e: TimelineEntry, t: number, track: Grade | undefined, scene: Grade | undefined): GradeValues {
    let g = e.grade;
    if (typeof g === 'function') {
      try { g = gradeOf(g({ t, lt: t - e.start, p: (t - e.start) / (e.end - e.start) }), `clip '${e.id}' at ${t.toFixed(3)} s: its grade function returned a`); } catch (err) {
        const rec = this.loaded.get(e.id);
        if (rec) this.renderFailed(rec, `[${e.id}] ${String((err as Error).message)}`);
        g = undefined;
      }
    }
    return resolveGrade(track, g, scene);
  }

  readPixels(buf?: Uint8Array) {
    const out = buf ?? new Uint8Array(PW * PH * 4);
    this.renderer.readRenderTargetPixels(this.finalRT, 0, 0, PW, PH, out);
    return out;
  }

  async readPixelsAsync(buf?: Uint8Array) {
    const out = buf ?? new Uint8Array(PW * PH * 4);
    await this.renderer.readRenderTargetPixelsAsync(this.finalRT, 0, 0, PW, PH, out);
    return out;
  }

  private packs: ({ buf: WebGLBuffer; sync: WebGLSync; bytes: number } | undefined)[] = [];
  private packers = new Map<Pixels, { rt: THREE.WebGLRenderTarget; pass: FSPass }>();
  private packer(mode: Pixels) {
    let p = this.packers.get(mode);
    if (p) return p;
    if (mode === 'yuv420') return this.yuvPacker();
    const { channels: C, bytes: B } = PIXELS[mode], w = (PW * C * B) / 4;
    const max = this.renderer.capabilities.maxTextureSize;
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
  static bytes(mode: Pixels = 'rgb8') { return PW * PH * PIXELS[mode].perPixel; }
  static readonly RGB_BYTES = PW * PH * 3;
  readStart(slot: number, mode: Pixels = 'rgb8') {
    const r = this.renderer, gl = r.getContext() as WebGL2RenderingContext;
    const old = this.packs[slot];
    if (old) { gl.deleteSync(old.sync); gl.deleteBuffer(old.buf); }
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

  async gpuIdle() {
    const gl = this.renderer.getContext() as WebGL2RenderingContext, s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!s) throw new Error('gpuIdle: no fence (the WebGL context was lost)');
    gl.flush();
    try { await waitFence(gl, s, 'gpuIdle'); } finally { gl.deleteSync(s); }
  }

  async readFinish(slot: number, out: Uint8Array) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext, p = this.packs[slot];
    if (!p) throw new Error(`readFinish: nothing queued in slot ${slot}`);
    await waitFence(gl, p.sync, 'readFinish');
    this.packs[slot] = undefined;
    gl.deleteSync(p.sync);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.buf);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out, 0, p.bytes);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.deleteBuffer(p.buf);
    return out;
  }
}
