// Text beside an image: a heading and a body fitted to their boxes, a photo with a slow push in, and a credit.
import type * as THREE from 'three';
import { Scene, type Frame, TextBlock, ImageBox, LowerThird, clearRT, LIN, W, H } from 'reel';
import { BOTTOM, TOP } from './_script';

const y = H * TOP, h = H * (BOTTOM - TOP), img = { x: W * 0.5, y, w: W * 0.42, h };

export default class Light extends Scene {
  heading = new TextBlock({ text: 'Linear light, any size', box: { x: W * 0.08, y, w: W * 0.38, h: h * 0.4 }, valign: 'bottom', size: 76, maxLines: 2 });
  body = new TextBlock({
    text: 'Colours mix in linear HDR and are encoded once, at the end. Layout is in logical pixels, so 1080p and 4K are the same picture at a different sharpness.',
    box: { x: W * 0.08, y: y + h * 0.46, w: W * 0.36, h: h * 0.54 }, valign: 'top', size: 34, minSize: 24, weight: 400, lineHeight: 1.4, color: 'muted',
    motion: { from: 'up', delay: 0.25 },
  });
  photo = new ImageBox({ src: 'assets/ridge.jpg', alt: 'ridge', box: img, radius: 18, kenBurns: { from: { zoom: 1 }, to: { zoom: 1.15, x: 0.4, y: 0.2 } } });
  credit = new LowerThird({ name: 'Ridge at dusk', role: 'Procedural, made for this example', box: { x: img.x + 24, y: img.y + img.h - 150, w: img.w - 48, h: 126 }, at: [1, 5] });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    clearRT(r, out, LIN.bg, 1);
    this.photo.draw(r, out, f);
    this.heading.draw(r, out, f);
    this.body.draw(r, out, f);
    this.credit.draw(r, out, f);
  }
}
