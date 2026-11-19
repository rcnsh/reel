/// <reference path="./lottie-module.d.ts" />
// A Lottie animation (After Effects through Bodymovin, or any tool that writes Lottie JSON) in a box, drawn by
// lottie-web's canvas renderer at the moment f.lt asks for, every sub-frame, so it is a pure function of time and
// blurs with the engine's motion blur. The light player has no expressions: an animation that relies on them plays
// without them.
import * as THREE from 'three';
import type { AnimationItem } from 'lottie-web';
import { SCALE } from '../engine/gl';
import { awaitBeforeFirstFrame } from '../engine/html';
import type { Frame } from '../engine/scene';
import { drawPicture } from './image';
import { safeBox, windowOf, type Box, type ComponentOptions } from './common';
import { sourceTime, type VideoTiming } from './video-time';

export interface LottieBoxOptions extends Omit<ComponentOptions, 'css'> {
  /** The animation's JSON, a path in the project. Images it names are looked up beside it. */
  src: string;
  /** The part of the animation played, in its own seconds [from, to] (default all of it). */
  trim?: [number, number];
  /** Animation seconds per second of the clip (default 1). */
  speed?: number;
  /** Play the trim again from its start when it ends (default false: hold its last frame). */
  loop?: boolean;
  /** 'contain' (default) shows all of it; 'cover' fills the box and crops. */
  fit?: 'cover' | 'contain';
  /** The animation's name in `reel check` findings. */
  alt?: string;
}

interface LottieJson { w: number; h: number; fr: number; ip: number; op: number }

/**
 * A Lottie animation fitted to a box, as a scene's field: `badge = new LottieBox({ src: 'assets/badge.json' })`,
 * then `badge.draw(renderer, out, f)` in render(). It loads before the first frame.
 */
export class LottieBox {
  readonly box: Box;
  /** `at` in clip seconds (undefined: the whole clip). */
  private at: [number, number] | undefined;
  private o: LottieBoxOptions;
  private anim: AnimationItem | null = null;
  private data!: LottieJson;
  private timing!: VideoTiming;
  private canvas = document.createElement('canvas');
  private tex = new THREE.CanvasTexture(this.canvas);
  private shown = NaN;

  constructor(o: LottieBoxOptions) {
    this.o = o;
    this.at = windowOf(o.at, o.label ?? o.alt ?? o.src);
    this.box = o.box ?? safeBox();
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.flipY = false;
    this.tex.generateMipmaps = false;
    this.tex.minFilter = THREE.LinearFilter;
    awaitBeforeFirstFrame(this.load());
  }

  private async load() {
    const o = this.o;
    const res = await fetch(o.src);
    if (!res.ok) throw new Error(`Lottie '${o.src}' did not load (a path in the project, served from its folder): ${res.status} ${res.statusText}`);
    let data: LottieJson;
    try { data = await res.json(); } catch { throw new Error(`Lottie '${o.src}' is not JSON`); }
    if (!(data.w > 0 && data.h > 0 && data.fr > 0 && data.op > data.ip)) throw new Error(`Lottie '${o.src}' has no size, frame rate or frames (w, h, fr, ip, op)`);
    this.data = data;
    const length = (data.op - data.ip) / data.fr;
    const trim: [number, number] = [Math.max(0, o.trim?.[0] ?? 0), Math.min(length, o.trim?.[1] ?? length)];
    if (!(trim[1] > trim[0])) throw new Error(`Lottie '${o.src}': the trim [${o.trim}] holds no frames (it is ${length.toFixed(2)} s)`);
    this.timing = { at: this.at ?? [0, Infinity], trim, speed: o.speed ?? 1, loop: !!o.loop };
    // the canvas: the animation's fitted size on screen, in physical px
    const b = this.box, s = (o.fit === 'cover' ? Math.max(b.w / data.w, b.h / data.h) : Math.min(b.w / data.w, b.h / data.h)) * SCALE;
    const k = Math.min(s, 8192 / Math.max(data.w, data.h));
    this.canvas.width = Math.max(1, Math.round(data.w * k)); this.canvas.height = Math.max(1, Math.round(data.h * k));
    const lottie = (await import('lottie-web/build/player/esm/lottie_light_canvas.min.js')).default;
    // (no container: given one, lottie-web draws into a canvas of its own inside it and ignores the context)
    const anim = lottie.loadAnimation({
      container: undefined as unknown as Element, renderer: 'canvas', loop: false, autoplay: false, animationData: data,
      assetsPath: o.src.replace(/[^/]*$/, ''),
      rendererSettings: { context: this.canvas.getContext('2d')!, clearCanvas: true, preserveAspectRatio: 'xMidYMid meet', dpr: 1 },
    });
    await new Promise<void>((res, rej) => {
      // (with its data inline and no images to fetch, it can be ready before loadAnimation returns)
      if (anim.isLoaded) { res(); return; }
      anim.addEventListener('DOMLoaded', () => res());
      anim.addEventListener('data_failed', () => rej(new Error(`Lottie '${o.src}' did not parse`)));
    });
    anim.setSubframe(true);
    this.anim = anim;
  }

  /** The animation's length in seconds, once loaded. */
  get duration() { return this.data ? (this.data.op - this.data.ip) / this.data.fr : 0; }

  /** The animation's frame (from its first) at clip time lt. */
  frameAt(lt: number) {
    const d = this.data, u = sourceTime(lt, this.timing);
    // (its last frame is the one before op: op itself is past every layer's end)
    return Math.min(u * d.fr, d.op - d.ip - 1e-3);
  }

  draw(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, f: Frame, o: { opacity?: number } = {}) {
    const anim = this.anim;
    if (!anim) return;
    const [w0, w1] = this.at ?? [0, f.end - f.start];
    if (f.lt < w0 || f.lt > w1) return;
    const fr = this.frameAt(f.lt);
    if (fr !== this.shown) {
      anim.goToAndStop(fr, true);
      this.tex.needsUpdate = true;
      this.shown = fr;
    }
    drawPicture(renderer, out, f, {
      tex: this.tex, size: [this.data.w, this.data.h], box: this.box, fit: this.o.fit ?? 'contain', framing: { zoom: 1, x: 0, y: 0 },
      label: this.o.label ?? this.o.alt ?? this.o.src,
    }, this.o.motion ?? false, w0, w1, o.opacity ?? 1);
  }

  dispose() { this.anim?.destroy(); this.tex.dispose(); }
}
