// Shared by the tests: whether a Chrome is there to render with, and scratch copies of the examples.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hasChrome as findChrome } from '../cli/chrome';

export const ENGINE = path.resolve(import.meta.dir, '..');
export const REEL = path.join(ENGINE, 'cli/reel.ts');

/** A Chrome the renders can use: $CHROME_PATH, else the pinned build (`reel chrome install`). Tests that render skip without one. */
export const hasChrome = findChrome();

/** A copy of an example in a fresh temp folder (its renders and warm renderer stay out of the repo). */
export function scratchCopy(example: string) {
  const dir = mkdtempSync(path.join(tmpdir(), `reel-test-${example}-`));
  cpSync(path.join(ENGINE, 'examples', example), dir, { recursive: true, filter: (f) => !f.includes(`${path.sep}out`) });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const scratch: string[] = [];
/** A fresh temp folder; a test file that makes them calls `afterAll(removeTempDirs)`. */
export function tempDir(prefix: string) {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  scratch.push(d);
  return d;
}
export function removeTempDirs() { for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true }); }

/** Run the CLI; returns its exit code, stdout and stderr. */
export async function reel(args: string[], cwd = ENGINE, env: Record<string, string> = {}) {
  const p = Bun.spawn(['bun', REEL, ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err, json: () => JSON.parse(out) };
}

/** A project written from `files` (path → contents) into a fresh temp folder. */
export function fixture(name: string, files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), `reel-test-${name}-`));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), text);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A one-clip project whose Canvas2D line runs off both sides of the frame (check's offFrame error). */
export const OFF_FRAME = {
  'reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({ size: [1280, 720], fps: 30, theme: 'print', timeline: () => [{ id: 'wide', scene: () => import('./scenes/wide'), start: 0, end: 1 }] });
`,
  'scenes/wide.ts': `import type * as THREE from 'three';
import { Scene, type Frame, Layer2D, W, H, clearRT, LIN, rgba, reportText } from 'reel';
export default class Wide extends Scene {
  layer = new Layer2D();
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg);
    const c = this.layer.ctx, text = 'A line far too long for the frame it is set in';
    this.layer.clear();
    c.font = '900 120px Archivo'; c.textAlign = 'center'; c.fillStyle = rgba('fg');
    c.fillText(text, W / 2, H / 2);
    reportText(c, text, W / 2, H / 2, { label: 'line' });
    this.ctx.comp.draw(this.ctx.renderer, this.layer.upload(), out);
  }
}
`,
};

/**
 * A one-clip project driven by props: the clip runs `seconds` long and fills the frame with `color`, both defaults
 * of the config's `props` that `--props` replaces (`note` is read by nothing: room for large props).
 */
export const PROPS = {
  'reel.config.ts': `import { defineVideo } from 'reel/config';
export interface Props { color: string; seconds: number; note: string }
export default defineVideo({
  size: [320, 180], fps: 30, theme: 'neutral',
  props: { color: '#ff0000', seconds: 1, note: '' } as Props,
  timeline: (src) => [{ id: 'swatch', scene: () => import('./scenes/swatch'), start: 0, end: src.props.seconds }],
});
`,
  'scenes/swatch.ts': `import type * as THREE from 'three';
import { Scene, type Frame, clearRT, hexToLinear } from 'reel';
import type { Props } from '../reel.config';
export default class Swatch extends Scene {
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, hexToLinear((this.ctx.props as Props).color));
  }
}
`,
};

/** The mean colour of a PNG's middle quarter, 0-255 per channel. */
export function middleColor(file: string): [number, number, number] {
  const png = PNG.sync.read(readFileSync(file));
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = png.height >> 2; y < (png.height * 3) >> 2; y++) for (let x = png.width >> 2; x < (png.width * 3) >> 2; x++) {
    const i = (y * png.width + x) * 4;
    for (let c = 0; c < 3; c++) sum[c]! += png.data[i + c]!;
    n++;
  }
  return sum.map((s) => Math.round(s / n)) as [number, number, number];
}
