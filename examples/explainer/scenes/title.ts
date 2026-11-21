import type * as THREE from 'three';
import { Scene, type Frame, TitleCard, clearRT, LIN, W, H } from 'reel';
import { BOTTOM, TOP } from './_script';

export default class Title extends Scene {
  card = new TitleCard({
    kicker: 'An explainer built from the kit',
    title: 'How a frame is made',
    subtitle: 'Time in, pixels out: the same picture in the preview and the export.',
    box: { x: W * 0.1, y: H * TOP, w: W * 0.8, h: H * (BOTTOM - TOP) },
    motion: { from: 'up', delay: 0.2, in: 0.8 },
  });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg, 1);
    this.card.draw(this.ctx.renderer, out, f);
  }
}
