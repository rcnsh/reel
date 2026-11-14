// Shared by the tests: whether a Chrome is there to render with, and scratch copies of the examples.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

/** Run the CLI; returns its exit code, stdout and stderr. */
export async function reel(args: string[], cwd = ENGINE) {
  const p = Bun.spawn(['bun', REEL, ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: process.env });
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
