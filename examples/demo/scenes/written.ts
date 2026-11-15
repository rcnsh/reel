// Demo plate: a single-stroke font written by a spark in step with the narration's word timings, with a
// sound cue at the start of every word for the mix. The line breaks to fit the frame's width, so it holds in
// 16:9 and vertical alike.
import type * as THREE from 'three';
import { Scene, type Frame, Layer2D, W, H, clearRT, LIN, rgba, strokeText, drawStrokeText, writtenLength, type StrokeText, sparkHead2D, cue, reportStrokeText } from 'reel';

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
      reportStrokeText(c, r.st, len, this.ctx.words.get('pen writes').text, { label: 'line' });
      c.restore();
      if (head) spark = { x: r.x + head.x, y: r.y + head.y };
    }
    if (spark) sparkHead2D(c, spark.x, spark.y, f.t, 0.5);
    comp.draw(renderer, this.layer.upload(), out);
  }
}
