// The `reel` command end to end: flags and exit codes, stills that never overwrite, diff, check on the demo in
// two formats, init, and the warm renderer's status and stop. Renders work on scratch copies of the examples.
import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hasChrome, reel, scratchCopy } from './helpers';

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

test.skipIf(!hasChrome)('check passes the demo at 16:9 and fails it vertical, naming the text that runs off', async () => {
  const wide = await reel(['check', '--json', '--project', demo.dir]);
  expect(wide.code).toBe(0);
  expect(wide.json().findings.filter((f: { severity: string }) => f.severity === 'error')).toEqual([]);
  const tall = await reel(['check', '--size', '1080x1920', '--json', '--project', demo.dir]);
  expect(tall.code).toBe(1);
  const errors = tall.json().findings.filter((f: { severity: string }) => f.severity === 'error');
  expect(errors.map((f: { kind: string; clip: string }) => `${f.kind} ${f.clip}`).sort()).toEqual(['offFrame hello', 'offFrame written']);
  for (const f of errors) expect(existsSync(f.image)).toBe(true);
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
  for (const f of ['reel.config.ts', 'narration.txt', 'CLAUDE.md', '.claude/skills/reel-authoring/SKILL.md', '.claude/skills/reel-review-loop/SKILL.md']) expect(existsSync(path.join(dir, f))).toBe(true);
  const tc = Bun.spawn(['bun', 'run', 'typecheck'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(tc.stdout).text();
  expect(await tc.exited, out).toBe(0);
  const again = await reel(['init', dir]);
  expect(again.code).toBe(2);
  expect(again.err).toContain('not empty');
}, 60_000);
