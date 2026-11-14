// A title on an upper track: the target is cleared to transparent, so the track below shows through. The card
// is the kit's TitleCard, laid out from the frame, rising in as it fades.
import type * as THREE from 'three';
import { Scene, type Frame, TitleCard, clearRT } from 'reel';

export default class Title extends Scene {
  card = new TitleCard({
    title: String(this.ctx.params.text),
    kicker: this.ctx.params.kicker === undefined ? undefined : String(this.ctx.params.kicker),
    motion: { from: 'up', in: 0.9, out: 0.6, distance: 80 },
  });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, [0, 0, 0], 0);
    this.card.draw(this.ctx.renderer, out, f);
  }
}
