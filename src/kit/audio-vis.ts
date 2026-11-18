// Pictures of the analysed song: a waveform (bars or a line, mirrored or from a baseline, a static window with a
// playhead or a scrolling one) and a spectrum (bars or radial). Drawn in GL by one shader from levels computed per
// sub-frame at f.t, so they move smoothly and blur under motion blur, sharp at every output scale.
import * as THREE from 'three';
import type { AudioData } from '../engine/audio';
import { FSPass, H, W } from '../engine/gl';
import { linearColor } from '../engine/palette';
import { report, reporting } from '../engine/report';
import type { Frame } from '../engine/scene';
import { clamp } from '../engine/util';
import { motionAt, safeBox, UNIT, type Box, type ComponentOptions } from './common';

/** The most levels one draw takes (bars, line points or radial bars). */
const MAX_N = 2048;

let pass: FSPass | null = null;

function visPass() {
  if (pass) return pass;
  pass = new FSPass(/* glsl */ `
    uniform sampler2D levels; uniform int n, mode, reach;
    uniform vec4 box;          // the box after motion, logical px, origin top left
    uniform float scale, frameH, opacity, x0, dx, halfW, minLen, lineW, fillA, splitX, restA, r0, rLen, edge, mirror, rounded;
    uniform vec3 colA, colB;
    float lv(int k) { return k < 0 || k >= n ? 0.0 : texelFetch(levels, ivec2(k, 0), 0).r; }
    float sdBox(vec2 p, vec2 c, vec2 h, float r) { vec2 d = abs(p - c) - (h - r); return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
    float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h); }
    // a level's height as a y in the box: from the middle both ways (mirror, sign s), else up from the bottom
    float yOf(float v, float s, float h) { return mirror > 0.5 ? h * 0.5 - s * v * h * 0.5 : h - v * h; }
    void main() {
      // the fragment in the box's own logical px (motion's scale undone about the box's centre)
      vec2 P = vec2(FRAG_PX.x, frameH - FRAG_PX.y);
      vec2 sz = box.zw / scale, p = (P - box.xy - box.zw * 0.5) / scale + sz * 0.5;
      float aa = 1.0 / (PX_SCALE * scale);
      float a = 0.0;
      if (mode == 0) {            // bars
        int k = int(floor((p.x - x0) / dx + 0.5));
        if (k >= 0 && k < n) {
          float cx = x0 + float(k) * dx, len = max(lv(k) * sz.y, minLen);
          vec2 hext = vec2(halfW, len * 0.5), c = vec2(cx, mirror > 0.5 ? sz.y * 0.5 : sz.y - len * 0.5);
          float d = sdBox(p, c, hext, rounded > 0.5 ? min(halfW, hext.y) : 0.0);
          a = clamp(0.5 - d / aa, 0.0, 1.0);
        }
      } else if (mode == 1) {     // a line through the levels, and a fill under it (or between, mirrored)
        int k0 = int(floor((p.x - x0) / dx));
        float d = 1e9;
        // (the segments that can come within half the line's width of the fragment)
        for (int j = -reach; j <= reach; j++) {
          int k = k0 + j;
          if (k < 0 || k + 1 >= n) continue;
          vec2 a0 = vec2(x0 + float(k) * dx, 0.0), b0 = vec2(a0.x + dx, 0.0);
          d = min(d, sdSeg(p, vec2(a0.x, yOf(lv(k), 1.0, sz.y)), vec2(b0.x, yOf(lv(k + 1), 1.0, sz.y))));
          if (mirror > 0.5) d = min(d, sdSeg(p, vec2(a0.x, yOf(lv(k), -1.0, sz.y)), vec2(b0.x, yOf(lv(k + 1), -1.0, sz.y))));
        }
        float stroke = clamp(0.5 - (d - lineW * 0.5) / aa, 0.0, 1.0);
        float fill = 0.0;
        if (k0 >= 0 && k0 + 1 < n) {
          float u = (p.x - x0) / dx - float(k0), v = mix(lv(k0), lv(k0 + 1), u);
          float inside = mirror > 0.5 ? v * sz.y * 0.5 - abs(p.y - sz.y * 0.5) : p.y - yOf(v, 1.0, sz.y);
          fill = clamp(0.5 + inside / aa, 0.0, 1.0) * fillA;
        }
        a = stroke + (1.0 - stroke) * fill;
      } else {                    // radial bars around the box's centre, the first at the top, clockwise
        vec2 q = p - sz * 0.5;
        float st = 6.283185307 / float(n), th = atan(q.x, -q.y);
        if (th < 0.0) th += 6.283185307;
        int k = int(floor(th / st + 0.5)) % n;
        float an = float(k) * st;
        vec2 dir = vec2(sin(an), -cos(an)), tang = vec2(cos(an), sin(an));
        vec2 l = vec2(dot(q, tang), dot(q, dir));
        float len = max(lv(k) * rLen, minLen);
        float d = sdBox(l, vec2(0.0, r0 + len * 0.5), vec2(halfW, len * 0.5), rounded > 0.5 ? min(halfW, len * 0.5) : 0.0);
        a = clamp(0.5 - d / aa, 0.0, 1.0);
      }
      // a scrolling window fades in and out at its ends
      if (edge > 0.0) a *= smoothstep(0.0, edge, p.x) * smoothstep(0.0, edge, sz.x - p.x);
      a *= step(0.0, p.x) * step(p.x, sz.x) * step(0.0, p.y) * step(p.y, sz.y);
      if (a <= 0.0) discard;
      // played (before splitX) in colA, the rest in colB at restA
      float played = clamp((splitX - p.x) / aa + 0.5, 0.0, 1.0);
      vec3 col = mix(colB, colA, played);
      a *= mix(restA, 1.0, played) * opacity;
      fragColor = vec4(col * a, a);
    }`, {
    levels: { value: null }, n: { value: 0 }, mode: { value: 0 }, reach: { value: 3 }, box: { value: new THREE.Vector4() }, scale: { value: 1 }, frameH: { value: H },
    opacity: { value: 1 }, x0: { value: 0 }, dx: { value: 1 }, halfW: { value: 1 }, minLen: { value: 0 }, lineW: { value: 2 }, fillA: { value: 0 },
    splitX: { value: 1e9 }, restA: { value: 1 }, r0: { value: 0 }, rLen: { value: 0 }, edge: { value: 0 }, mirror: { value: 0 }, rounded: { value: 1 },
    colA: { value: new THREE.Vector3() }, colB: { value: new THREE.Vector3() },
  }, { blending: THREE.CustomBlending, transparent: true });
  const m = pass.mat;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return pass;
}

/** A silent bar's length: a dot (round ends) or 2 px, never more than 1.2% of the short side or the room it has. */
const stub = (halfW: number, round: boolean, room: number) => Math.min(round ? 2 * halfW : 2, UNIT * 0.012, room);

/** One draw of the shader: the levels (0..1) and how to lay them out in the box, in its own logical px. */
interface VisDraw {
  mode: 0 | 1 | 2;
  values: ArrayLike<number>;
  x0?: number; dx?: number; halfW: number; minLen: number;
  lineW?: number; fill?: number; mirror?: boolean; rounded?: boolean;
  r0?: number; rLen?: number; edge?: number;
  splitX?: number; color: string; restColor?: string; restOpacity?: number;
}

/** What the two components share: the box, the window, the motion, the draw and the report. */
abstract class AudioVis {
  readonly box: Box;
  protected o: ComponentOptions & { audio: AudioData };
  /** The levels as a texture of the component's own, uploaded only when they change. */
  private levels = new Float32Array(0);
  private tex: THREE.DataTexture | null = null;
  constructor(o: ComponentOptions & { audio: AudioData; color?: string; restColor?: string }, box: Box, what: 'waveform' | 'spectrum') {
    if (!o.audio) throw new Error(`a ${what} needs the song's analysis: { audio: this.ctx.audio }`);
    if (!(what === 'waveform' ? o.audio.hasWave : o.audio.hasSpectrum)) {
      throw new Error(`data/audio.json has no ${what}: run \`reel analyze <song>\` (again: analyses made before reel stored one have none, and so does narration timing)`);
    }
    // (a colour that is no palette key fails here, not on every frame)
    for (const c of [o.color, o.restColor]) if (c !== undefined) linearColor(c);
    this.o = o;
    this.box = o.box ?? box;
  }

  /** The texture holding `values` (clamped to 0..1), re-uploaded only when they differ from the last ones. */
  private texture(values: ArrayLike<number>) {
    const n = values.length;
    if (!this.tex || this.levels.length !== n) {
      this.tex?.dispose();
      this.levels = new Float32Array(n);
      this.tex = new THREE.DataTexture(this.levels, Math.max(1, n), 1, THREE.RedFormat, THREE.FloatType);
      this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
      this.tex.needsUpdate = true;
    }
    let changed = false;
    for (let i = 0; i < n; i++) {
      const v = clamp(values[i]!);
      if (v !== this.levels[i]) { this.levels[i] = v; changed = true; }
    }
    if (changed) this.tex.needsUpdate = true;
    return this.tex;
  }

  /** The levels and layout at f (f.t: every sub-frame, so they blur). */
  protected abstract layout(f: Frame): VisDraw;
  protected abstract readonly kind: string;

  /** Draw it over `out` (call in render(); outside its window it draws nothing). */
  draw(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, f: Frame, o: { opacity?: number } = {}) {
    const [w0, w1] = this.o.at ?? [0, f.end - f.start];
    const m = motionAt(this.o.motion ?? { from: 'fade' }, f.lt, w0, w1);
    if (!m) return;
    const v = this.layout(f), b = this.box, p = visPass();
    const n = Math.min(v.values.length, MAX_N);
    const u = p.u, bx = b.x + m.dx + (b.w * (1 - m.scale)) / 2, by = b.y + m.dy + (b.h * (1 - m.scale)) / 2;
    u.levels!.value = this.texture(v.values); u.n!.value = n; u.mode!.value = v.mode;
    u.reach!.value = Math.min(64, Math.ceil(((v.lineW ?? 0) / 2 + 2) / Math.max(v.dx ?? 1, 1e-3)) + 1);
    (u.box!.value as THREE.Vector4).set(bx, by, b.w * m.scale, b.h * m.scale);
    u.scale!.value = m.scale; u.opacity!.value = m.opacity * (o.opacity ?? 1);
    u.x0!.value = v.x0 ?? 0; u.dx!.value = v.dx ?? 1; u.halfW!.value = v.halfW; u.minLen!.value = v.minLen;
    u.lineW!.value = v.lineW ?? 0; u.fillA!.value = v.fill ?? 0; u.mirror!.value = v.mirror ? 1 : 0; u.rounded!.value = v.rounded === false ? 0 : 1;
    u.r0!.value = v.r0 ?? 0; u.rLen!.value = v.rLen ?? 0; u.edge!.value = v.edge ?? 0;
    u.splitX!.value = v.splitX ?? 1e9; u.restA!.value = v.restOpacity ?? 1;
    (u.colA!.value as THREE.Vector3).set(...linearColor(v.color));
    (u.colB!.value as THREE.Vector3).set(...linearColor(v.restColor ?? v.color));
    p.render(renderer, out);
    if (reporting()) report({ kind: 'shape', x: bx, y: by, w: b.w * m.scale, h: b.h * m.scale, alpha: m.opacity * (o.opacity ?? 1), color: v.color, label: this.o.label ?? this.kind });
  }

  dispose() { this.tex?.dispose(); this.tex = null; }
}

export interface WaveformOptions extends Omit<ComponentOptions, 'css'> {
  /** The song's analysis: `this.ctx.audio` (`reel analyze` stores the waveform). */
  audio: AudioData;
  /**
   * The audio shown across the box: 'clip' (the default: the clip's own span of video time, static, with the
   * playhead moving across), [from, to] (video seconds, static), or a number of seconds that scrolls past the
   * playhead.
   */
  window?: 'clip' | [number, number] | number;
  /** Where now sits across a scrolling window, 0 (left) to 1 (right) (default 0.5). */
  playhead?: number;
  /** 'bars' (default) or 'line' (a line through the levels, with a fill under it). */
  style?: 'bars' | 'line';
  /** Symmetric about the box's middle (default true), else up from its bottom. */
  mirror?: boolean;
  /** Bars (or line points) across the box (default one per 1.4% of the short side). */
  count?: number;
  /** 'peak' (default) or 'rms'. */
  measure?: 'peak' | 'rms';
  /** Level multiplier (default 1; levels stop at the box's edge). */
  gain?: number;
  /** The share of each bar's slot left empty (default 0.4), and whether bars have round ends (default true). */
  gap?: number;
  round?: boolean;
  /** What has played, in this colour (palette key or '#rrggbb'; default accent); the rest in `restColor` (fg) at `restOpacity` (0.35). */
  color?: string;
  restColor?: string;
  restOpacity?: number;
  /** The line's width in logical px (default 0.4% of the short side) and its fill's opacity (default 0.2). */
  lineWidth?: number;
  fill?: number;
}

/**
 * The song's waveform in a box: a static window with what has played in the accent, or a window scrolling past a
 * playhead. Make it in a scene's field: `wave = new Waveform({ audio: this.ctx.audio })`, then
 * `this.wave.draw(renderer, out, f)` in render().
 */
export class Waveform extends AudioVis {
  protected readonly kind = 'waveform';
  private w: WaveformOptions;
  private cache: { key: string; values: Float32Array } | null = null;
  private buf = new Float32Array(0);
  constructor(o: WaveformOptions) {
    const s = safeBox();
    super(o, { x: s.x, y: H * 0.5 - UNIT * 0.12, w: s.w, h: UNIT * 0.24 }, 'waveform');
    this.w = o;
  }

  /** The level of the bar for [t - span/2, t + span/2]. */
  private level(t: number, span: number) {
    const v = this.w.audio.wave(t, span);
    return (this.w.measure === 'rms' ? v.rms : v.peak) * (this.w.gain ?? 1);
  }

  protected layout(f: Frame): VisDraw {
    const o = this.w, b = this.box, count = Math.max(2, Math.round(o.count ?? b.w / (UNIT * 0.014)));
    if (count > MAX_N - 2) throw new Error(`Waveform: count ${count} is more than ${MAX_N - 2}`);
    const dx = b.w / count, line = o.style === 'line', gap = clamp(o.gap ?? 0.4, 0, 0.95);
    const halfW = (dx * (1 - gap)) / 2, round = o.round !== false;
    const common = {
      mode: (line ? 1 : 0) as 0 | 1, dx, halfW, minLen: line ? 0 : stub(halfW, round, b.h), mirror: o.mirror !== false, rounded: round,
      lineW: o.lineWidth ?? UNIT * 0.004, fill: o.fill ?? 0.2,
      color: o.color ?? 'accent', restColor: o.restColor ?? 'fg', restOpacity: o.restOpacity ?? 0.35,
    };
    const win = o.window ?? 'clip';
    if (typeof win === 'number') {
      if (!(win > 0)) throw new Error(`Waveform: a scrolling window is a number of seconds above 0, not ${win}`);
      // scrolling: bars fixed in song time (bar k is [k dt, (k+1) dt)), sliding across, so they never shimmer
      const ph = clamp(o.playhead ?? 0.5), dt = win / count, tl = f.t - ph * win, k0 = Math.floor(tl / dt);
      if (this.buf.length !== count + 2) this.buf = new Float32Array(count + 2);
      const values = this.buf;
      for (let j = 0; j < values.length; j++) values[j] = this.level((k0 + j + 0.5) * dt, dt);
      // (a line's points sit at the bars' middles, as bars do)
      return { ...common, values, x0: (((k0 + 0.5) * dt - tl) / win) * b.w, splitX: ph * b.w, edge: b.w * 0.06 };
    }
    const [t0, t1] = win === 'clip' ? [f.start, f.end] : win;
    if (!(t1 > t0)) throw new Error(`Waveform: window [${t0}, ${t1}] is empty`);
    // static: bars in the middles of `count` equal slots; a line's points from edge to edge, each the level of the
    // span around it
    const key = `${t0},${t1}`;   // (the rest is fixed for the component)
    const ldx = line ? b.w / (count - 1) : dx, dt = ((t1 - t0) * ldx) / b.w;
    if (this.cache?.key !== key) {
      const values = new Float32Array(count);
      for (let k = 0; k < count; k++) values[k] = this.level(t0 + (line ? k : k + 0.5) * dt, dt);
      this.cache = { key, values };
    }
    return { ...common, dx: ldx, values: this.cache.values, x0: line ? 0 : dx / 2, splitX: ((f.t - t0) / (t1 - t0)) * b.w };
  }
}

export interface SpectrumOptions extends Omit<ComponentOptions, 'css'> {
  /** The song's analysis: `this.ctx.audio` (`reel analyze` stores the spectrum). */
  audio: AudioData;
  /** 'bars' (default: low to high across the box) or 'radial' (around a circle). */
  style?: 'bars' | 'radial';
  /**
   * Bars (default the analysis' bands, 24; fewer take the loudest band each covers, more interpolate). Radial and
   * `symmetric`: bars on each side.
   */
  count?: number;
  /** Bars grow from the box's middle both ways (default false: up from the bottom). */
  mirror?: boolean;
  /** Radial: lows at the top, mirrored down both sides (default true), else once round clockwise. */
  symmetric?: boolean;
  /** Radial: the inner circle's radius as a share of the box's half short side (default 0.45). */
  inner?: number;
  gain?: number;
  /** The share of each bar's slot left empty (default 0.3), round ends (default true). */
  gap?: number;
  round?: boolean;
  /** Palette key or '#rrggbb' (default accent). */
  color?: string;
}

/**
 * The song's spectrum: bars from low to high frequencies, or radial bars around a circle, levels interpolated at
 * every sub-frame. `spec = new Spectrum({ audio: this.ctx.audio, style: 'radial' })`.
 */
export class Spectrum extends AudioVis {
  protected readonly kind = 'spectrum';
  private s: SpectrumOptions;
  private lv = new Float32Array(0);
  private ring = new Float32Array(0);
  constructor(o: SpectrumOptions) {
    const s = safeBox(), radial = o.style === 'radial', side = UNIT * 0.6;
    super(o, radial ? { x: W / 2 - side / 2, y: H / 2 - side / 2, w: side, h: side } : { x: s.x, y: H * 0.5, w: s.w, h: UNIT * 0.3 }, 'spectrum');
    this.s = o;
  }

  protected layout(f: Frame): VisDraw {
    const o = this.s, b = this.box, a = o.audio, gain = o.gain ?? 1, gap = clamp(o.gap ?? 0.3, 0, 0.95), round = o.round !== false;
    const color = o.color ?? 'accent';
    const sym = o.style === 'radial' && o.symmetric !== false;
    const count = Math.max(1, Math.round(o.count ?? (a.bandFreqs.length || 24)));
    if (count > (sym ? MAX_N / 2 : MAX_N)) throw new Error(`Spectrum: count ${count} is more than ${sym ? MAX_N / 2 : MAX_N}`);
    if (this.lv.length !== count) this.lv = new Float32Array(count);
    const lv = a.bands(f.t, count, this.lv);
    for (let i = 0; i < lv.length; i++) lv[i]! *= gain;
    if (o.style === 'radial') {
      const n = sym ? count * 2 : count;
      if (sym && this.ring.length !== n) this.ring = new Float32Array(n);
      const values = sym ? this.ring : lv;
      // symmetric: band k at angles +k and -k from the top
      if (sym) {
        for (let k = 0; k < count; k++) { values[k] = lv[k]!; values[(n - k) % n] = lv[k]!; }
        values[count] = lv[count - 1]!;   // (the bottom: the highest band, between its two neighbours)
      }
      const half = Math.min(b.w, b.h) / 2, r0 = half * clamp(o.inner ?? 0.45, 0.05, 0.95);
      const halfW = ((Math.PI * 2 * r0) / n) * (1 - gap) / 2;
      return { mode: 2, values, halfW, minLen: stub(halfW, round, half - r0), rounded: round, r0, rLen: half - r0, color };
    }
    const dx = b.w / count, halfW = (dx * (1 - gap)) / 2;
    return { mode: 0, values: lv, x0: dx / 2, dx, halfW, minLen: stub(halfW, round, b.h), mirror: !!o.mirror, rounded: round, color };
  }
}
