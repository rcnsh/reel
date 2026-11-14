// Demo plate: a single-stroke font written by a spark in step with the narration's word timings, with a
// sound cue at the start of every word for the mix.
import type * as THREE from 'three';
import { Scene, type Frame, Layer2D, W, H, clearRT, LIN, rgba, strokeText, drawStrokeText, writtenLength, type StrokeText, sparkHead2D, cue } from 'reel';

export default class Written extends Scene {
  layer = new Layer2D();
  st!: StrokeText;
  charTimes: [number, number][] = [];

  override init() {
    const line = this.ctx.words.get('pen writes');
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
    clearRT(renderer, out, LIN.bg);
    const c = this.layer.ctx;
    this.layer.clear();
    c.save();
    c.translate((W - this.st.width) / 2, H / 2 + this.st.capHeight / 2);
    c.strokeStyle = rgba('fg');
    c.lineWidth = 3;
    c.lineCap = c.lineJoin = 'round';
    const head = drawStrokeText(c, this.st, writtenLength(this.st, this.charTimes, f.t));
    if (head) sparkHead2D(c, head.x, head.y, f.t, 0.5);
    c.restore();
    comp.draw(renderer, this.layer.upload(), out);
  }
}
