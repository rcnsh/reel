// Demo plate: a single-stroke font written by a moving pen in step with the narration's word timings,
// with a sound cue at the start of every word for the mix.
import type * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { strokeText, drawStrokeText, writtenLength, type StrokeText } from '../engine/stroke';
import { cue } from '../engine/util';

export default class Written extends Scene {
  layer = new Layer2D();
  st!: StrokeText;
  charTimes: [number, number][] = [];

  override init() {
    const line = this.ctx.lyrics.get('pen writes');
    this.st = strokeText(line.text, 'script', 88);
    // each character is written during its word; spaces take no time
    for (const w of line.words) {
      cue('tick', w.start);
      const n = Array.from(w.w).length;
      for (let i = 0; i < n; i++) this.charTimes.push([w.start + ((w.end - w.start) * i) / n, w.start + ((w.end - w.start) * (i + 1)) / n]);
      this.charTimes.push([w.end, w.end]);
    }
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp } = this.ctx;
    clearRT(renderer, out, LIN.paper);
    const c = this.layer.ctx;
    this.layer.clear();
    c.save();
    c.translate((W - this.st.width) / 2, H / 2 + this.st.capHeight / 2);
    c.strokeStyle = rgba('ink');
    c.lineWidth = 3;
    c.lineCap = c.lineJoin = 'round';
    const head = drawStrokeText(c, this.st, writtenLength(this.st, this.charTimes, f.t));
    if (head) {
      c.fillStyle = rgba('signal');
      c.beginPath();
      c.arc(head.x, head.y, 6, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    comp.draw(renderer, this.layer.upload(), out);
  }
}
