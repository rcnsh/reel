// Demo plate: a single-stroke font written by a spark in step with the narration's word timings, with a
// sound cue at the start of every word for the mix.
import type * as THREE from 'three';
import { Scene, type Frame, Layer2D, W, H, clearRT, LIN, rgba, strokeText, drawStrokeText, writtenLength, type StrokeText, sparkHead2D, cue, report, reporting } from 'reel';

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
    const ox = (W - this.st.width) / 2, oy = H / 2 + this.st.capHeight / 2, len = writtenLength(this.st, this.charTimes, f.t);
    c.save();
    c.translate(ox, oy);
    c.strokeStyle = rgba('fg');
    c.lineWidth = 3;
    c.lineCap = c.lineJoin = 'round';
    const head = drawStrokeText(c, this.st, len);
    if (head) sparkHead2D(c, head.x, head.y, f.t, 0.5);
    c.restore();
    if (reporting()) this.reportWritten(ox, oy, len);
    comp.draw(renderer, this.layer.upload(), out);
  }

  /** For `reel check`: the box around the strokes written so far (stroke text is paths, not fillText). */
  private reportWritten(ox: number, oy: number, len: number) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    this.st.strokes.forEach((pts, i) => pts.forEach((p, j) => {
      if (this.st.startLen[i]! + this.st.lens[i]![j]! > len) return;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }));
    if (x1 < x0) return;
    report({ kind: 'text', label: 'line', text: this.ctx.words.get('pen writes').text, size: this.st.size, color: 'fg', x: ox + x0 - 1.5, y: oy + y0 - 1.5, w: x1 - x0 + 3, h: y1 - y0 + 3 });
  }
}
