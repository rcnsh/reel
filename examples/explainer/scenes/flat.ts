// A line chart: the render minutes one minute of video takes, by how much of the frame moves.
import type * as THREE from 'three';
import { Scene, type Frame, LineChart, TextBlock, clearRT, LIN, W, H, ease, prog } from 'reel';
import { BOTTOM, TOP } from './_script';

const y = H * TOP, h = H * (BOTTOM - TOP);

export default class Flat extends Scene {
  chart = new LineChart({
    title: 'Minutes to render one minute',
    series: [1, 1.2, 1.6, 2.4, 3.6, 5.2, 7.4, 10],
    labels: ['Nothing moves', 'Everything moves'],
    format: (v) => `${v.toFixed(1)} min`,
    box: { x: W * 0.08, y, w: W * 0.56, h },
    progress: (f) => prog(f.lt, 0.4, 3.6, ease.inOutCubic),
  });
  note = new TextBlock({
    html: 'A still shot needs <span style="color: var(--accent)">one sample</span> a frame; a whip pan needs dozens.',
    box: { x: W * 0.68, y, w: W * 0.26, h }, size: 40, weight: 500, lineHeight: 1.5, motion: { from: 'left', delay: 1 },
  });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    clearRT(r, out, LIN.bg, 1);
    this.chart.draw(r, out, f);
    this.note.draw(r, out, f);
  }
}
