// The `reel` command end to end: flags and exit codes, stills that never overwrite, diff, check on the demo in
// two formats, init, and the warm renderer's status and stop. Renders work on scratch copies of the examples.
import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ENGINE, fixture, hasChrome, hasUv, middleColor, PROPS, reel, REEL, scratchCopy } from './helpers';

const demo = scratchCopy('demo'), layers = scratchCopy('layers'), props = fixture('props', PROPS);
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
// a scene black in one step of adaptive sampling's sub-frames (4, 12, 36 …) and grey in the next, so it never
// converges, that asks for a cap
const capped = fixture('capped', {
  'reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({ size: [320, 180], fps: 30, theme: 'print', timeline: () => [
  { id: 'asks', scene: () => import('./scenes/noise'), start: 0, end: 1 },
  { id: 'own', scene: () => import('./scenes/noise'), start: 1, end: 2, maxSamples: 108 },
] });
`,
  'scenes/noise.ts': `import type * as THREE from 'three';
import { Scene, type Frame, clearRT, SUB_FRAME } from 'reel';
export default class Noise extends Scene {
  async init() { this.ctx.capSamples(36); this.ctx.capSamples(12); }
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.ctx.capSamples(4); // (too late: ignored)
    const k = Math.max(0, SUB_FRAME.index), v = [4, 12, 36, 108].filter((n) => k >= n).length % 2 ? 0.8 : 0;
    clearRT(this.ctx.renderer, out, [v, v, v]);
  }
}
`,
});
// a stage with a transparent background on track 0, nothing drawn under it: a box that moves across the frame
const glass = fixture('glass', {
  'reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({ size: [320, 180], fps: 30, theme: 'print', timeline: () => [{ id: 'glass', scene: () => import('./scenes/glass'), start: 0, end: 1 }] });
`,
  'scenes/glass.ts': `import * as THREE from 'three';
import { Scene, type Frame, Stage3D } from 'reel';
export default class Glass extends Scene {
  stage = new Stage3D(this.ctx, { background: null, shadows: false });
  box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: 0xff8020 }));
  async init() { this.stage.scene.add(this.box); }
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.stage.camera({ position: [0, 0, 4], target: [0, 0, 0] });
    this.box.position.x = -1.6 + 3.2 * f.lt;
    this.box.rotation.y = 4 * f.lt;
    this.stage.render(out);
  }
  dispose() { this.stage.dispose(); }
}
`,
});
afterAll(async () => {
  for (const p of [demo.dir, layers.dir, wsProject, two.dir, capped.dir, props.dir, glass.dir]) await reel(['daemon', 'stop', '--project', p]);
  demo.cleanup(); layers.cleanup(); ws.cleanup(); two.cleanup(); capped.cleanup(); props.cleanup(); glass.cleanup(); rmSync(fresh, { recursive: true, force: true });
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

test.skipIf(!hasChrome)('--props reaches timeline() and scenes through the warm renderer, inline or from a file, over the defaults', async () => {
  const still = async (...extra: string[]) => {
    const r = await reel(['still', '--t', '0.5', '--json', '--project', props.dir, ...extra]);
    expect(r.code).toBe(0);
    return middleColor(r.json().files[0]);
  };
  const [r, g, b] = await still();
  expect(r).toBeGreaterThan(200); expect(g).toBeLessThan(40); expect(b).toBeLessThan(40);
  // (the same warm renderer, one request after another: each set of props gets its own page, never a stale one)
  const blue = await still('--props', '{"color":"#0000ff"}');
  expect(blue[2]).toBeGreaterThan(200); expect(blue[0]).toBeLessThan(40);
  writeFileSync(path.join(props.dir, 'green.json'), '{ "color": "#00ff00" }');
  const green = await still('--props', path.join(props.dir, 'green.json'));
  expect(green[1]).toBeGreaterThan(200); expect(green[0]).toBeLessThan(40);
  expect((await still())[0]).toBeGreaterThan(200);
  // (props larger than a URL can hold: they do not travel in the page's URL)
  const big = await still('--props', JSON.stringify({ color: '#00ff00', note: 'x'.repeat(40000) }));
  expect(big[1]).toBeGreaterThan(200);
  // timeline() reads them: the clip's length, and info reports the props it rendered with
  const info = (await reel(['info', '--json', '--project', props.dir, '--props', '{"seconds":2.5}'])).json();
  expect(info.duration).toBe(2.5);
  expect(info.props).toEqual({ color: '#ff0000', seconds: 2.5, note: '' });
  // a key the config's defaults lack, or a value of another kind, fails in the page (exit 1) naming the defaults
  const typo = await reel(['still', '--t', '0.5', '--json', '--project', props.dir, '--props', '{"colour":"#000000"}']);
  expect(typo.code).toBe(1);
  expect(typo.json().errors.join('\n')).toContain("'colour' is not one of the config's props (color, seconds, note)");
  const kind = await reel(['info', '--json', '--project', props.dir, '--props', '{"seconds":"2"}']);
  expect(kind.code).toBe(1);
  expect(kind.json().errors.join('\n')).toContain("'seconds' expected a number, as in the config's props, got a string");
}, 120_000);

test('--props that is not a JSON object, or a file that is not there, exits 2 before a browser starts', async () => {
  const env = { CHROME_PATH: '/nonexistent/chrome' };
  for (const [arg, msg] of [['{"a":', 'not JSON'], ['[1]', 'neither a JSON object nor a file'], [path.join(fresh, 'none.json'), 'neither a JSON object nor a file']]) {
    const r = await reel(['still', '--t', '1', '--project', layers.dir, '--props', arg!], ENGINE, env);
    expect(r.code).toBe(2);
    expect(r.err).toContain(msg!);
  }
  writeFileSync(path.join(fresh, 'list.json'), '[1, 2]');
  const list = await reel(['still', '--t', '1', '--project', layers.dir, '--props', path.join(fresh, 'list.json')], ENGINE, env);
  expect(list.code).toBe(2);
  expect(list.err).toContain('expected a JSON object, got an array');
});

test('reel dev --props puts them in the page, escaped; bad props exit 2 before a server starts', async () => {
  const bad = await reel(['dev', '--project', props.dir, '--props', '[1]']);
  expect(bad.code).toBe(2);
  expect(bad.err).toContain('neither a JSON object nor a file');
  const p = Bun.spawn(['bun', REEL, 'dev', '--project', props.dir, '--port', '0', '--props', '{"note":"</script>+"}'], { stdout: 'pipe', stderr: 'ignore' });
  try {
    const reader = p.stdout.getReader();
    let out = '';
    while (!/http:\/\/\S+/.test(out)) { const r = await reader.read(); if (r.done) break; out += new TextDecoder().decode(r.value); }
    const html = await (await fetch(/http:\/\/\S+/.exec(out)![0])).text();
    expect(html).toContain('window.__REEL_PROPS__ = "{\\"note\\":\\"\\u003c/script>+\\"}"');
  } finally { p.kill(); await p.exited; }
}, 30_000);

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

test.skipIf(!hasChrome)('adaptive sampling gives the same frame masking stopped tiles out of every sub-frame or only the merge', async () => {
  // (at 5 s some of the layers' tiles stop at 12 sub-frames and others go on: the next step is masked)
  const sub = await reel(['still', '--t', '5', '--samples', 'auto', '--json', '--project', layers.dir], ENGINE, { REEL_TILE_MASK: 'subs' });
  expect(sub.json().frames[0].subFrames).toBeGreaterThan(12);
  const merge = await reel(['diff', '--t', '5', sub.json().files[0], '--samples', 'auto', '--json', '--project', layers.dir], ENGINE, { REEL_TILE_MASK: 'merge' });
  expect(merge.json().changed).toBe(0);
  const bad = await reel(['still', '--t', '5', '--samples', 'auto', '--project', layers.dir], ENGINE, { REEL_TILE_MASK: 'some' });
  expect(bad.code).toBe(2);
}, 120_000);

test.skipIf(!hasChrome)("adaptive sampling stops at the lowest cap a clip's scene asks for while it is made, unless the clip sets its own", async () => {
  const sub = async (t: number) => {
    const r = await reel(['still', '--t', String(t), '--samples', 'auto', '--json', '--project', capped.dir]);
    expect(r.code).toBe(0);
    return r.json().frames[0].subFrames;
  };
  expect(await sub(0.5)).toBe(12);
  expect(await sub(1.5)).toBe(108);
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

test.skipIf(!hasChrome)('a custom transition whose GLSL does not compile fails the load, named after its clip, at any time', async () => {
  const file = path.join(layers.dir, 'reel.config.ts'), good = readFileSync(file, 'utf8');
  const dusk = "transition: { kind: 'wipe', direction: 'up', softness: 0.3 }";
  expect(good).toContain(dusk);
  writeFileSync(file, good.replace(dusk, "transition: { glsl: 'mix(getFromColor(uv), getToColor(uv), p * nope)' }"));
  try {
    // (t 0.2 is before the transition: the shader is compiled when the video loads)
    const bad = await reel(['still', '--t', '0.2', '--json', '--project', layers.dir]);
    expect(bad.code).toBe(1);
    expect(bad.json().errors.join('\n')).toMatch(/\[dusk: its transition's glsl\] shader failed to compile: [^]*'nope' : undeclared identifier[^]*in: return \(mix\(getFromColor\(uv\), getToColor\(uv\), p \* nope\)\);/);
    // (a pasted gl-transitions shader: its own PI, int and vec2 uniforms)
    const pasted = '#define PI 3.141592653589\\nuniform int steps;\\nuniform ivec2 grid;\\nuniform vec2 dir;\\nvec4 transition(vec2 uv) { float s = float(steps + grid.x) * PI; return mix(getFromColor(uv), getToColor(uv), step(fract(uv.x * s + dir.x), progress)); }';
    writeFileSync(file, good.replace(dusk, `transition: { glsl: '${pasted}', uniforms: { steps: 3, grid: [2, 2], dir: [0.5, 0] } }`));
    const ok = await reel(['still', '--t', '3.25', '--json', '--project', layers.dir]);
    expect(ok.json().errors).toEqual([]);
  } finally { writeFileSync(file, good); }
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

test.skipIf(!hasChrome)('a scene that leaves its target undrawn renders the same whatever the page drew before', async () => {
  // (a transparent stage composites over its target: what an earlier frame left there must not show through)
  for (const samples of ['1', 'auto']) {
    const first = await reel(['still', '--t', '0.2', '--samples', samples, '--json', '--project', glass.dir]);
    expect(first.json().errors).toEqual([]);
    await reel(['still', '--t', '0.8', '--samples', samples, '--json', '--project', glass.dir]);
    const again = await reel(['diff', '--t', '0.2', '--samples', samples, first.json().files[0], '--json', '--project', glass.dir]);
    expect(again.json().changed).toBe(0);
  }
}, 120_000);

test.skipIf(!hasChrome)('the warm renderer shows in daemon status and stops', async () => {
  await reel(['info', '--project', layers.dir]);
  const projects = () => reel(['daemon', 'status', '--json']).then((r) => r.json().daemons.map((d: { project: string }) => d.project));
  expect(await projects()).toContain(realpathSync(layers.dir));
  const stop = await reel(['daemon', 'stop', '--json', '--project', layers.dir]);
  expect(stop.json().stopped).toEqual([realpathSync(layers.dir)]);
  expect(await projects()).not.toContain(realpathSync(layers.dir));
}, 120_000);

async function initTypechecks(name: string, flags: string[], files: string[]) {
  const dir = path.join(fresh, name);
  const init = await reel(['init', dir, ...flags]);
  expect(init.code, init.err).toBe(0);
  for (const f of ['reel.config.ts', 'CLAUDE.md', '.claude/skills/reel-authoring/SKILL.md', '.claude/skills/reel-review-loop/SKILL.md', '.claude/skills/reel-audio/SKILL.md', ...files]) expect(existsSync(path.join(dir, f))).toBe(true);
  const tc = Bun.spawn(['bun', 'run', 'typecheck'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(tc.stdout).text();
  expect(await tc.exited, out).toBe(0);
  const again = await reel(['init', dir]);
  expect(again.code).toBe(2);
  expect(again.err).toContain('not empty');
}

test('init writes a silent project that typechecks without an install', () => initTypechecks('silent', [], ['scenes/intro.ts']), 240_000);

// (a narrated project is voiced with Kokoro, a Python tool run by uv)
test.skipIf(!hasUv)('init writes a narrated project that typechecks without an install', () => initTypechecks('narrated', ['--narrated'], ['narration.txt']), 240_000);
