/// <reference path="./lottie-module.d.ts" />
import * as THREE from 'three';
import type { AnimationItem } from 'lottie-web';
import { SCALE, context2D } from '../engine/gl';
import { awaitBeforeFirstFrame, notLate } from '../engine/html';
import type { Frame } from '../engine/scene';
import { drawPicture } from './image';
import { safeBox, windowOf, type Box, type ComponentOptions } from './common';
import { sourceTime, type VideoTiming } from './video-time';

export interface LottieBoxOptions extends Omit<ComponentOptions, 'css'> {
  src: string;
  trim?: [number, number];
  speed?: number;
  loop?: boolean;
  fit?: 'cover' | 'contain';
  alt?: string;
}

interface LottieJson { w: number; h: number; fr: number; ip: number; op: number }

export class LottieBox {
  readonly box: Box;
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
    notLate(o.label ?? o.src);
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
    const b = this.box, s = (o.fit === 'cover' ? Math.max(b.w / data.w, b.h / data.h) : Math.min(b.w / data.w, b.h / data.h)) * SCALE;
    const k = Math.min(s, 8192 / Math.max(data.w, data.h));
    this.canvas.width = Math.max(1, Math.round(data.w * k)); this.canvas.height = Math.max(1, Math.round(data.h * k));
    const lottie = (await import('lottie-web/build/player/esm/lottie_light_canvas.min.js')).default;
    const anim = lottie.loadAnimation({
      container: undefined as unknown as Element, renderer: 'canvas', loop: false, autoplay: false, animationData: data,
      assetsPath: o.src.replace(/[^/]*$/, ''),
      rendererSettings: { context: context2D(this.canvas), clearCanvas: true, preserveAspectRatio: 'xMidYMid meet', dpr: 1 },
    });
    await new Promise<void>((res, rej) => {
      if (anim.isLoaded) { res(); return; }
      anim.addEventListener('DOMLoaded', () => res());
      anim.addEventListener('data_failed', () => rej(new Error(`Lottie '${o.src}' did not parse`)));
    });
    anim.setSubframe(true);
    this.anim = anim;
  }

  get duration() { return this.data ? (this.data.op - this.data.ip) / this.data.fr : 0; }

  /** The animation's frame (from its first) at clip time lt. */
  frameAt(lt: number) {
    const d = this.data, u = sourceTime(lt, this.timing);
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
