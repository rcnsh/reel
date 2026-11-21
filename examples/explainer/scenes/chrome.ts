import type * as THREE from 'three';
import { Scene, type Frame, Captions, ProgressBar, Timer, clearRT, W, H } from 'reel';
import { SCRIPT } from './_script';

export default class Chrome extends Scene {
  captions = new Captions({ words: SCRIPT, size: 44 });
  bar = new ProgressBar({ box: { x: W * 0.08, y: H * 0.06, w: W * 0.7, h: 40 } });
  timer = new Timer({ box: { x: W * 0.8, y: H * 0.06 - 8, w: W * 0.12, h: 56 }, size: 40, color: 'muted' });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    clearRT(r, out, [0, 0, 0], 0);
    this.bar.draw(r, out, f);
    this.timer.draw(r, out, f);
    this.captions.draw(r, out, f);
  }
}
