import type * as THREE from 'three';
import { Scene, type Frame, Captions, Words, clearRT } from 'reel';

const LINES = Words.timed([
  { text: 'A clip decoded frame by frame', start: 0.3, end: 2.5 },
  { text: 'an SVG, sharp at any scale', start: 2.7, end: 5 },
  { text: 'and a Lottie drawn at every moment', start: 5.2, end: 7.6 },
]);

export default class Caps extends Scene {
  captions = new Captions({ words: LINES, size: 52, panel: true });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, [0, 0, 0], 0);
    this.captions.draw(this.ctx.renderer, out, f);
  }
}
