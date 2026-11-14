// A bar chart of samples per frame by how fast the picture moves, and a counter.
import type * as THREE from 'three';
import { Scene, type Frame, BarChart, Counter, clearRT, LIN, W, H } from 'reel';
import { BOTTOM, TOP } from './_script';

const y = H * TOP, h = H * (BOTTOM - TOP);

export default class Samples extends Scene {
  chart = new BarChart({
    title: 'Samples per frame',
    data: [{ label: 'Still', value: 1 }, { label: 'Drift', value: 4 }, { label: 'Pan', value: 9 }, { label: 'Whip', value: 24 }, { label: 'Cut', value: 2 }],
    highlight: 3,
    box: { x: W * 0.08, y, w: W * 0.5, h },
  });
  count = new Counter({ to: 7.8, digits: 1, suffix: '×', caption: 'faster than a fixed 24 samples', box: { x: W * 0.62, y, w: W * 0.3, h }, progress: (f) => Math.min(1, Math.max(0, (f.lt - 1) / 2.5)) });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    clearRT(r, out, LIN.bg, 1);
    this.chart.draw(r, out, f);
    this.count.draw(r, out, f);
  }
}
