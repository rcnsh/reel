// Demo plate: a single-stroke font written by a spark in step with the narration's word timings, with a
// sound cue at the start of every word for the mix. The line breaks to fit the frame's width, so it holds in
// 16:9 and vertical alike.
import type * as THREE from 'three';
import { Scene, type Frame, Layer2D, W, H, clearRT, LIN, rgba, strokeText, drawStrokeText, writtenLength, type StrokeText, sparkHead2D, cue, report, reporting } from 'reel';

const SIZE = 88, LEADING = 1.4;

interface Row { st: StrokeText; charTimes: [number, number][]; x: number; y: number }

export default class Written extends Scene {
  layer = new Layer2D();
  rows: Row[] = [];

  override init() {
    const line = this.ctx.words.get('pen writes');
    // words onto rows no wider than the frame less its margins
    const groups: (typeof line.words)[] = [[]];
    for (const w of line.words) {
      const cur = groups.at(-1)!, next = [...cur, w].map((x) => x.w).join(' ');
      if (cur.length && strokeText(next, 'script', SIZE).width > W * 0.84) groups.push([w]);
      else cur.push(w);
    }
    const top = H / 2 - ((groups.length - 1) * SIZE * LEADING) / 2;
    this.rows = groups.map((ws, r) => {
      const st = strokeText(ws.map((w) => w.w).join(' '), 'script', SIZE), charTimes: [number, number][] = [];
      // each character is written during its word; spaces take no time
      for (const w of ws) {
        cue('tick', w.start);
        const n = Array.from(w.w).length;
        for (let i = 0; i < n; i++) charTimes.push([w.start + ((w.end - w.start) * i) / n, w.start + ((w.end - w.start) * (i + 1)) / n]);
        charTimes.push([w.end, w.end]);
      }
      return { st, charTimes, x: (W - st.width) / 2, y: top + r * SIZE * LEADING + st.capHeight / 2 };
    });
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp } = this.ctx;
    clearRT(renderer, out, LIN.bg);
    const c = this.layer.ctx;
    this.layer.clear();
    c.strokeStyle = rgba('fg');
    c.lineWidth = 3;
    c.lineCap = c.lineJoin = 'round';
    let spark: { x: number; y: number } | null = null;
    for (const r of this.rows) {
      const len = writtenLength(r.st, r.charTimes, f.t);
      if (len <= 0) break;
      c.save();
      c.translate(r.x, r.y);
      const head = drawStrokeText(c, r.st, len);
      c.restore();
      if (head) spark = { x: r.x + head.x, y: r.y + head.y };
      if (reporting()) this.reportWritten(r, len);
    }
    if (spark) sparkHead2D(c, spark.x, spark.y, f.t, 0.5);
    comp.draw(renderer, this.layer.upload(), out);
  }

  /** For `reel check`: the box around the strokes written so far on a row (stroke text is paths, not fillText). */
  private reportWritten(r: Row, len: number) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    r.st.strokes.forEach((pts, i) => pts.forEach((p, j) => {
      if (r.st.startLen[i]! + r.st.lens[i]![j]! > len) return;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }));
    if (x1 < x0) return;
    report({ kind: 'text', label: 'line', text: this.ctx.words.get('pen writes').text, size: r.st.size, color: 'fg', x: r.x + x0 - 1.5, y: r.y + y0 - 1.5, w: x1 - x0 + 3, h: y1 - y0 + 3 });
  }
}
