// The `reel` command end to end: flags and exit codes, stills that never overwrite, diff, check on the demo in
// two formats, init, and the warm renderer's status and stop. Renders work on scratch copies of the examples.
import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ENGINE, fixture, hasChrome, reel, scratchCopy } from './helpers';

const demo = scratchCopy('demo'), layers = scratchCopy('layers');
const fresh = realpathSync(mkdtempSync(path.join(tmpdir(), 'reel-test-init-')));
// a project inside a pnpm workspace whose scene lives outside the project folder, in the workspace's sources
const ws = fixture('workspace', {
  'pnpm-workspace.yaml': "packages: ['engine']\n",
  // (a package at the workspace's root with a stylesheet, as KaTeX's is)
  'node_modules/fake-style/package.json': '{ "name": "fake-style", "version": "1.0.0" }\n',
  'node_modules/fake-style/style.css': '.fake-style { color: red; }\n',
  'engine/src/card.ts': `import type * as THREE from 'three';
import { Scene, type Frame, Layer2D, W, H, clearRT, LIN } from 'reel';
export default class Card extends Scene {
  layer = new Layer2D();
  css = '';
  async init() { this.css = ((await import('fake-style/style.css?inline')) as { default: string }).default; }
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg);
    const c = this.layer.ctx;
    this.layer.clear();
    c.fillStyle = this.css.includes('fake-style') ? '#2050d0' : '#000000'; c.fillRect(W / 4, H / 4, W / 2, H / 2);
    c.font = '700 48px Archivo'; c.fillStyle = '#ffffff'; c.textAlign = 'center';
    c.fillText('drawn, never reported', W / 2, H / 2);
    this.ctx.comp.draw(this.ctx.renderer, this.layer.upload(), out);
  }
}
`,
  'engine/reel/card/reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({ size: [640, 360], fps: 30, theme: 'print', timeline: () => [{ id: 'card', scene: () => import('../../src/card'), start: 0, end: 1 }] });
`,
});
const wsProject = realpathSync(path.join(ws.dir, 'engine/reel/card'));
// two clips of a moving square, 4 s then 1 s: check --only probe must not judge intro, which it never loads (and so draws nothing)
const MOVING = `import type * as THREE from 'three';
import { Scene, type Frame, Layer2D, W, H, clearRT, LIN, rgba } from 'reel';
export default class Moving extends Scene {
  layer = new Layer2D();
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, LIN.bg);
    const c = this.layer.ctx;
    this.layer.clear();
    c.fillStyle = rgba('accent'); c.fillRect((f.t % 1) * (W - 100), H / 2 - 50, 100, 100);
    this.ctx.comp.draw(this.ctx.renderer, this.layer.upload(), out);
  }
}
`;
const two = fixture('only', {
  'reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({ size: [640, 360], fps: 30, timeline: () => [
  { id: 'intro', scene: () => import('./scenes/moving'), start: 0, end: 4 },
  { id: 'probe', scene: () => import('./scenes/moving'), start: 4, end: 5 },
] });
`,
  'scenes/moving.ts': MOVING,
});
afterAll(async () => {
  for (const p of [demo.dir, layers.dir, wsProject, two.dir]) await reel(['daemon', 'stop', '--project', p]);
  demo.cleanup(); layers.cleanup(); ws.cleanup(); two.cleanup(); rmSync(fresh, { recursive: true, force: true });
});

test('--help exits 0 and lists the commands; a bad command line exits 2', async () => {
  const help = await reel(['--help']);
  expect(help.code).toBe(0);
  for (const c of ['still', 'strip', 'check', 'diff', 'daemon status', 'mcp', 'golden update']) expect(help.out).toContain(c);
  const bad = await reel(['still', '--bogus', '--project', layers.dir]);
  expect(bad.code).toBe(2);
  expect(bad.err).toContain("Unknown option '--bogus'");
  expect((await reel(['still', '--t', '1', '--project', fresh])).code).toBe(2);
  expect((await reel(['nonsense'])).code).toBe(2);
});

test('a --scale that does not fit the frame exits 2 before a browser starts', async () => {
  // (no Chrome to be had: a refusal after launch would be exit 1)
  const env = { CHROME_PATH: '/nonexistent/chrome' };
  for (const args of [['still', '--t', '1'], ['video', '--out', path.join(fresh, 'x.mp4')]]) {
    const r = await reel([...args, '--scale', '0.5', '--size', '1080x1350', '--project', layers.dir], ENGINE, env);
    expect(r.code).toBe(2);
    expect(r.err).toContain('1080x1348 (--size 1080x1348) renders at --scale 0.5');
  }
});

test.skipIf(!hasChrome)('stills are named after clip and time and never overwrite each other', async () => {
  const a = await reel(['still', '--t', '1', '--json', '--project', layers.dir]);
  expect(a.code).toBe(0);
  const b = await reel(['still', '--t', '1', '--json', '--project', layers.dir]);
  const [fa] = a.json().files, [fb] = b.json().files;
  expect(path.basename(fa)).toBe('dawn+title_1.000s.png');
  expect(path.basename(fb)).toBe('dawn+title_1.000s-2.png');
  expect(existsSync(fa) && existsSync(fb)).toBe(true);
}, 120_000);

test.skipIf(!hasChrome)('diff: identical renders exit 0, a different frame exits 1 with the changed box', async () => {
  const saved = (await reel(['still', '--t', '2', '--json', '--project', layers.dir])).json().files[0];
  const same = await reel(['diff', '--t', '2', saved, '--json', '--project', layers.dir]);
  expect(same.code).toBe(0);
  expect(same.json().changed).toBe(0);
  const other = await reel(['diff', '--t', '3.25', saved, '--json', '--project', layers.dir]);
  expect(other.code).toBe(1);
  expect(other.json().changed).toBeGreaterThan(0);
  expect(other.json().box).not.toBeNull();
  expect(existsSync(other.json().file)).toBe(true);
}, 120_000);

test.skipIf(!hasChrome)('check passes the demo at 16:9 and vertical (its text wraps to the frame)', async () => {
  for (const size of ['1920x1080', '1080x1920']) {
    const r = await reel(['check', '--size', size, '--json', '--project', demo.dir]);
    expect(r.code).toBe(0);
    expect(r.json().findings.filter((f: { severity: string }) => f.severity !== 'info')).toEqual([]);
  }
}, 180_000);

test.skipIf(!hasChrome)('check --only looks at the loaded clips alone: no blank or frozen frames where the others would be', async () => {
  const r = await reel(['check', '--only', 'probe', '--json', '--project', two.dir]);
  expect(r.code).toBe(0);
  expect(r.json().findings).toEqual([]);
  expect(r.json().frames).toBeGreaterThan(0);
  const bad = await reel(['check', '--only', 'probe', '--to', '3', '--json', '--project', two.dir]);
  expect(bad.code).toBe(2);
  expect(bad.out + bad.err).toContain('in --only probe');
}, 120_000);

test.skipIf(!hasChrome)('a syntax error in a scene is reported with its line through the warm renderer, and its fix is picked up', async () => {
  const file = path.join(layers.dir, 'scenes/title.ts'), good = readFileSync(file, 'utf8');
  writeFileSync(file, good.replace('clearRT(this.ctx.renderer, out, [0, 0, 0], 0);', 'clearRT(this.ctx.renderer, out, [0, 0, 0], 0'));
  try {
    const bad = await reel(['still', '--t', '1', '--json', '--project', layers.dir]);
    expect(bad.code).toBe(1);
    expect(bad.json().errors.join('\n')).toMatch(/\[title\] could not load scenes\/title\.ts: [^]*`,` or `\)` expected/);
  } finally { writeFileSync(file, good); }
  const fixed = await reel(['still', '--t', '1', '--json', '--project', layers.dir]);
  expect(fixed.json().errors).toEqual([]);
}, 120_000);

test.skipIf(!hasChrome)('a config naming a scene file that is not there fails at once with the import, and the new file is picked up', async () => {
  const file = path.join(layers.dir, 'reel.config.ts'), good = readFileSync(file, 'utf8'), scene = path.join(layers.dir, 'scenes/later.ts');
  writeFileSync(file, good.replace("import('./scenes/title')", "import('./scenes/later')"));
  try {
    const t0 = Date.now();
    const bad = await reel(['still', '--t', '1', '--json', '--project', layers.dir]);
    expect(bad.code).toBe(1);
    expect(bad.json().errors.join('\n')).toMatch(/could not load reel\.config\.ts: Failed to resolve import "\.\/scenes\/later"/);
    expect(Date.now() - t0).toBeLessThan(30_000);
    writeFileSync(scene, readFileSync(path.join(layers.dir, 'scenes/title.ts')));
    const made = await reel(['still', '--t', '1', '--json', '--project', layers.dir]);
    expect(made.json().errors).toEqual([]);
  } finally { writeFileSync(file, good); rmSync(scene, { force: true }); }
  const fixed = await reel(['still', '--t', '1', '--json', '--project', layers.dir]);
  expect(fixed.json().errors).toEqual([]);
}, 120_000);

test.skipIf(!hasChrome)('a project inside a workspace loads a scene from outside its folder, and the warm renderer sees edits to it', async () => {
  const first = await reel(['still', '--t', '0.5', '--json', '--project', wsProject]);
  expect(first.json().errors).toEqual([]);
  expect(first.code).toBe(0);
  const saved = first.json().files[0];
  // the next request is warm: an edit to the scene, outside the project, must show without touching the project
  await reel(['still', '--t', '0.5', '--json', '--project', wsProject]);
  const scene = path.join(ws.dir, 'engine/src/card.ts');
  writeFileSync(scene, readFileSync(scene, 'utf8').replace("'#2050d0'", "'#d05020'"));
  const after = await reel(['diff', '--t', '0.5', saved, '--json', '--project', wsProject]);
  expect(after.code).toBe(1);
  expect(after.json().changed).toBeGreaterThan(1000);
  // its text is drawn with fillText and never reported: check says it cannot see it
  const check = await reel(['check', '--json', '--project', wsProject]);
  expect(check.json().findings.filter((f: { kind: string }) => f.kind === 'unreported').map((f: { clip: string }) => f.clip)).toEqual(['card']);
}, 180_000);

test.skipIf(!hasChrome)('the warm renderer shows in daemon status and stops', async () => {
  await reel(['info', '--project', layers.dir]);
  const projects = () => reel(['daemon', 'status', '--json']).then((r) => r.json().daemons.map((d: { project: string }) => d.project));
  expect(await projects()).toContain(realpathSync(layers.dir));
  const stop = await reel(['daemon', 'stop', '--json', '--project', layers.dir]);
  expect(stop.json().stopped).toEqual([realpathSync(layers.dir)]);
  expect(await projects()).not.toContain(realpathSync(layers.dir));
}, 120_000);

test('init writes a project that typechecks without an install', async () => {
  const dir = path.join(fresh, 'first');
  const init = await reel(['init', dir, '--narrated']);
  expect(init.code).toBe(0);
  for (const f of ['reel.config.ts', 'narration.txt', 'CLAUDE.md', '.claude/skills/reel-authoring/SKILL.md', '.claude/skills/reel-review-loop/SKILL.md', '.claude/skills/reel-audio/SKILL.md']) expect(existsSync(path.join(dir, f))).toBe(true);
  const tc = Bun.spawn(['bun', 'run', 'typecheck'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(tc.stdout).text();
  expect(await tc.exited, out).toBe(0);
  const again = await reel(['init', dir]);
  expect(again.code).toBe(2);
  expect(again.err).toContain('not empty');
}, 240_000);
