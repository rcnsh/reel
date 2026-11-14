// A title on an upper track: the target is cleared to transparent, so the track below shows through.
import type * as THREE from 'three';
import { Scene, type Frame, Layer2D, W, H, F, font, rgba, clearRT, ease, prog, window01 } from 'reel';

export default class Title extends Scene {
  layer = new Layer2D();

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp, params } = this.ctx;
    clearRT(renderer, out, [0, 0, 0], 0);
    const c = this.layer.ctx;
    this.layer.clear();
    const a = window01(f.t, f.start, f.end, 0.6, 0.6), rise = prog(f.lt, 0, 0.9, ease.outExpo);
    c.font = font(F.archivo(75, 900), W * 0.2);
    c.textAlign = 'center';
    c.fillStyle = rgba('signal', a);
    c.fillText(String(params.text), W / 2, H / 2 + (1 - rise) * 80);
    comp.draw(renderer, this.layer.upload(), out);
  }
}
