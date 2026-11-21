import type * as THREE from 'three';
import { Scene, type Frame, CodeBlock, clearRT, LIN, W, H } from 'reel';
import { BOTTOM, TOP } from './_script';

const SOURCE = `import { Scene, type Frame, TitleCard, clearRT, LIN } from 'reel';

export default class Hello extends Scene {
  card = new TitleCard({ title: 'Hello' });   // laid out once

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg, 1);
    this.card.draw(this.ctx.renderer, out, f);  // f.t in, pixels out
  }
}`;

export default class Code extends Scene {
  code = new CodeBlock({
    code: SOURCE, lang: 'typescript', title: 'scenes/hello.ts', lineNumbers: true,
    box: { x: W * 0.12, y: H * TOP, w: W * 0.76, h: H * (BOTTOM - TOP) },
    reveal: (f) => (f.lt - 0.6) * 5,
    highlight: (f) => (f.lt > 3.6 ? [6, 7, 8, 9] : []),
  });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg, 1);
    this.code.draw(this.ctx.renderer, out, f);
  }
}
