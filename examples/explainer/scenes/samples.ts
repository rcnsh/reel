import type * as THREE from 'three';
import { Scene, type Frame, BarChart, Counter, clearRT, LIN, W, H, split } from 'reel';
import { BOTTOM, TOP } from './_script';

const [chartBox, countBox] = split({ x: W * 0.08, y: H * TOP, w: W * 0.84, h: H * (BOTTOM - TOP) }, 'h', [0.5, 0.3], W * 0.04);

export default class Samples extends Scene {
  chart = new BarChart({
    title: 'Samples per frame',
    data: [{ label: 'Still', value: 1 }, { label: 'Drift', value: 4 }, { label: 'Pan', value: 9 }, { label: 'Whip', value: 24 }, { label: 'Cut', value: 2 }],
    highlight: 3,
    box: chartBox,
  });
  count = new Counter({ to: 7.8, digits: 1, suffix: '×', caption: 'faster than a fixed 24 samples', box: countBox, progress: (f) => Math.min(1, Math.max(0, (f.lt - 1) / 2.5)) });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    clearRT(r, out, LIN.bg, 1);
    this.chart.draw(r, out, f);
    this.count.draw(r, out, f);
  }
}
