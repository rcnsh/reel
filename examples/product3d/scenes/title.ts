// The name, set in the left third over the 3D shot on the track below (cleared to transparent, so it shows through).
import type * as THREE from 'three';
import { Scene, type Frame, TitleCard, clearRT, W, H } from 'reel';

export default class Title extends Scene {
  card = new TitleCard({
    kicker: 'Eau de parfum',
    title: 'Nº 7',
    subtitle: 'Vetiver, fig leaf, cedar',
    align: 'left',
    box: { x: W * 0.07, y: H * 0.28, w: W * 0.34, h: H * 0.44 },
    motion: { from: 'up', in: 1.1, out: 0.7, distance: 60 },
  });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, [0, 0, 0], 0);
    this.card.draw(this.ctx.renderer, out, f);
  }
}
