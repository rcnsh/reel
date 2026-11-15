// The `reel` command end to end: flags and exit codes, stills that never overwrite, diff, check on the demo in
// two formats, init, and the warm renderer's status and stop. Renders work on scratch copies of the examples.
import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ENGINE, hasChrome, reel, scratchCopy } from './helpers';

const demo = scratchCopy('demo'), layers = scratchCopy('layers');
const fresh = realpathSync(mkdtempSync(path.join(tmpdir(), 'reel-test-init-')));
afterAll(async () => {
  for (const p of [demo.dir, layers.dir]) await reel(['daemon', 'stop', '--project', p]);
  demo.cleanup(); layers.cleanup(); rmSync(fresh, { recursive: true, force: true });
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
