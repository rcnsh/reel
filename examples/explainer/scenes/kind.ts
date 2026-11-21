import type * as THREE from 'three';
import { Scene, type Frame, TitleCard, Layer2D, clearRT, LIN, rgba, W, H } from 'reel';
import { BOTTOM, TOP } from './_script';

export default class Kind extends Scene {
  panel = new Layer2D();
  card!: TitleCard;

  override init() {
    const p = this.ctx.params as { title: string; code: string; side: 'left' | 'right' };
    const left = p.side === 'left', pw = W * 0.38;
    this.card = new TitleCard({
      kicker: 'Transition', title: p.title, subtitle: p.code, align: 'left',
      box: { x: left ? pw + W * 0.06 : W * 0.08, y: H * TOP, w: W - pw - W * 0.14, h: H * (BOTTOM - TOP) },
      motion: { from: 'up', delay: 0.1, in: 0.6 },
    });
    const c = this.panel.ctx;
    this.panel.clear();
    c.fillStyle = rgba('accent');
    c.fillRect(left ? 0 : W - pw, 0, pw, H);
    this.panel.upload();
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    clearRT(r, out, LIN.bg, 1);
    this.ctx.comp.draw(r, this.panel.texture, out);
    this.card.draw(r, out, f);
  }
}
