import { afterAll, expect, test } from 'bun:test';
import { readPng } from '../cli/png';
import { fixture, hasChrome, reel } from './helpers';

const project = fixture('lines', {
  'reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({
  size: [320, 180], fps: 30, theme: 'neutral',
  timeline: () => [
    { id: 'across', scene: () => import('./scenes/floor'), start: 0, end: 1, params: { behind: false } },
    { id: 'behind', scene: () => import('./scenes/floor'), start: 1, end: 2, params: { behind: true } },
  ],
});
`,
  'scenes/floor.ts': `import * as THREE from 'three';
import { Scene, type Frame, LineBatch, clearRT, W, H } from 'reel';
export default class Floor extends Scene {
  lines = new LineBatch(4, { screen2D: false });
  cam = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, [0, 0, 0], 1);
    this.cam.position.set(0, 0.4, 0);
    this.cam.lookAt(0, 0.1, -5);
    this.cam.updateMatrixWorld();
    this.lines.clear();
    if (this.ctx.params.behind) this.lines.seg(0, 0, 3, 0, 0, 20, 2, 1, 0, 0);
    else this.lines.seg(0, 0, 10, 0, 0, -40, 2, 1, 0, 0);
    this.lines.render(this.ctx.renderer, out, this.cam);
  }
}
`,
});
afterAll(async () => { await reel(['daemon', 'stop', '--project', project.dir]); project.cleanup(); });

const red = (file: string, rows: [number, number]) => {
  const img = readPng(file);
  let max = 0;
  for (let y = rows[0]; y < rows[1]; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4;
    max = Math.max(max, img.data[i]! - img.data[i + 1]!);
  }
  return max;
};

test.skipIf(!hasChrome)('a 3D line crossing the near plane runs to the frame edge, and one behind it draws nothing', async () => {
  const across = (await reel(['still', '--t', '0.5', '--json', '--project', project.dir])).json().files[0] as string;
  const behind = (await reel(['still', '--t', '1.5', '--json', '--project', project.dir])).json().files[0] as string;
  expect(red(across, [176, 180])).toBeGreaterThan(150);
  expect(red(behind, [0, 180])).toBeLessThan(5);
}, 120_000);
