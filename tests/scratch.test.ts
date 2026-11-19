// An export's scratch: partials named after their process, the sweep that removes only dead processes' scratch, and
// end to end, an export stopped or killed mid-way leaving the file at --out as it was.
import { afterAll, expect, test } from 'bun:test';
import { chmodSync, existsSync, lstatSync, statSync, mkdirSync, readdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { commit, commitFrames, destOf, ownerGone, ownerOf, partialOf, processName, sweep } from '../cli/scratch';
import { fixture, hasChrome, REEL, removeTempDirs, scratchCopy, tempDir } from './helpers';

const layers = scratchCopy('layers');
// (a scene that throws in render(): its export exits 1)
const broken = fixture('broken', {
  'reel.config.ts': `import { defineVideo } from 'reel/config';
export default defineVideo({ size: [320, 180], fps: 10, theme: 'print', timeline: () => [{ id: 'oops', scene: () => import('./scenes/oops'), start: 0, end: 0.5 }] });
`,
  'scenes/oops.ts': `import { Scene } from 'reel';
export default class Oops extends Scene { render() { throw new Error('this scene is broken'); } }
`,
});
afterAll(() => { layers.cleanup(); broken.cleanup(); removeTempDirs(); });

test('a partial keeps the extension and names its process', () => {
  const a = partialOf('/x/out/video.mp4'), b = partialOf('/x/out/video.mp4');
  expect(a).toMatch(new RegExp(`^/x/out/video\\.partial-${process.pid}-\\d{13}\\.mp4$`));
  expect(a).not.toBe(b);
  expect(ownerOf(path.basename(a))).toEqual({ pid: process.pid });
  expect(ownerOf(`reel-spool-123-${Date.now()}`)?.pid).toBe(123);
  expect(ownerOf(`reel-webp-45-${Date.now()}`)?.pid).toBe(45);
  expect(ownerOf(`frames.partial-7-${Date.now()}`)?.pid).toBe(7);
  for (const n of ['video.mp4', 'reel-exports', 'my.partial-plan.txt', 'reel-spool-1-2', `x.partial-1-${Date.now()}.part.zip`, `notes.partial-1-${Date.now()}-draft.txt`]) expect(ownerOf(n)).toBeNull();
});

test('an owner is gone when dead, or when its pid now runs another program', () => {
  const dead = Bun.spawnSync(['true']).pid;
  expect(ownerGone({ pid: dead })).toBe(true);
  expect(processName(process.pid)).toMatch(/^bun/);
  expect(ownerGone({ pid: process.pid })).toBe(false);
  // (a reused pid: alive, but no longer bun; a name that cannot be read keeps the scratch)
  expect(ownerGone({ pid: process.pid }, () => 'zsh')).toBe(true);
  expect(ownerGone({ pid: process.pid }, () => null)).toBe(false);
});

test('an output that is a symlink is written through to its target', () => {
  const d = tempDir('reel-test-link-'), target = path.join(d, 'real.mp4'), link = path.join(d, 'video.mp4');
  writeFileSync(target, 'old'); symlinkSync(target, link);
  const dest = destOf(link), p = partialOf(dest);
  writeFileSync(p, 'new');
  commit(p, dest);
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(readFileSync(link, 'utf8')).toBe('new');
  expect(destOf(target)).toBe(target);
  expect(destOf(path.join(d, 'missing.mp4'))).toBe(path.join(d, 'missing.mp4'));
  // (a dangling link is still followed; the old file's permissions carry over)
  const dangling = path.join(d, 'dangling.mp4');
  symlinkSync(path.join(d, 'gone/real.mp4'), dangling);
  expect(destOf(dangling)).toBe(path.join(d, 'gone/real.mp4'));
  chmodSync(target, 0o640);
  const q = partialOf(target);
  writeFileSync(q, 'newer');
  commit(q, target);
  expect(statSync(target).mode & 0o777).toBe(0o640);
});

test('sweep removes dead processes\' scratch and keeps live ones\', and only stale Vite temp folders', () => {
  const d = tempDir('reel-test-sweep-'), vite = path.join(d, '.vite');
  const dead = Bun.spawnSync(['true']).pid, ms = Date.now();
  const deadPartial = path.join(d, `video.partial-${dead}-${ms}.mp4`), livePartial = partialOf(path.join(d, 'video.mp4'));
  const deadSpool = path.join(d, `reel-spool-${dead}-${ms}`), mine = path.join(d, 'video.mp4');
  for (const f of [deadPartial, livePartial, mine]) writeFileSync(f, 'x');
  mkdirSync(deadSpool); writeFileSync(path.join(deadSpool, '1.rgb'), 'x');
  for (const n of ['deps', 'deps_temp_old', 'deps_temp_new']) mkdirSync(path.join(vite, n), { recursive: true });
  const old = new Date(Date.now() - 2 * 3600_000);
  utimesSync(path.join(vite, 'deps_temp_old'), old, old);
  utimesSync(path.join(vite, 'deps'), old, old);
  const removed = sweep([d], vite);
  expect(removed.sort()).toEqual([deadPartial, deadSpool, path.join(vite, 'deps_temp_old')].sort());
  expect(readdirSync(d).sort()).toEqual(['.vite', path.basename(livePartial), 'video.mp4'].sort());
  expect(readdirSync(vite).sort()).toEqual(['deps', 'deps_temp_new']);
});

test('commitFrames moves a folder of frames over the old ones', () => {
  const d = tempDir('reel-test-frames-'), part = path.join(d, 'frames.partial-1-1');
  mkdirSync(part);
  writeFileSync(path.join(d, 'frame_000001.png'), 'old'); writeFileSync(path.join(d, 'keep.txt'), 'k');
  writeFileSync(path.join(part, 'frame_000001.png'), 'new'); writeFileSync(path.join(part, 'frame_000002.png'), 'new');
  commitFrames(part, d);
  expect(readdirSync(d).sort()).toEqual(['frame_000001.png', 'frame_000002.png', 'keep.txt']);
  expect(readFileSync(path.join(d, 'frame_000001.png'), 'utf8')).toBe('new');
});

/** Start an export to `out`, and once it has written frames, send it `signal`; resolves when it has exited. */
async function stopMidway(out: string, signal: 'SIGTERM' | 'SIGKILL', env: Record<string, string>) {
  const p = Bun.spawn(['bun', REEL, 'video', '--project', layers.dir, '--samples', '1', '--preset', 'ultrafast', '--size', '360x640', '--out', out, '--force', '--progress'], { stdout: 'ignore', stderr: 'pipe', env: { ...process.env, ...env } });
  const dec = new TextDecoder();
  let seen = '';
  for await (const chunk of p.stderr) {
    seen += dec.decode(chunk);
    if (/"frames":\s*[1-9]/.test(seen)) break;
  }
  p.kill(signal);
  return p.exited;
}

test.skipIf(!hasChrome)('an export stopped or killed mid-way leaves the previous file; the next export sweeps its partial', async () => {
  const d = tempDir('reel-test-atomic-'), out = path.join(d, 'video.mp4');
  const env = { REEL_EXPORTS_DIR: tempDir('reel-test-atomic-exports-') };
  writeFileSync(out, 'the previous render');
  // SIGTERM (what the MCP's video_cancel sends): the export removes its partial itself
  expect(await stopMidway(out, 'SIGTERM', env)).toBe(143);
  expect(readFileSync(out, 'utf8')).toBe('the previous render');
  expect(readdirSync(d)).toEqual(['video.mp4']);
  // SIGKILL: ffmpeg sees its input end and finishes the partial, never the file at --out
  // (ffmpeg made the partial before the first frame was counted)
  await stopMidway(out, 'SIGKILL', env);
  expect(readFileSync(out, 'utf8')).toBe('the previous render');
  expect(readdirSync(d).some((n) => /\.partial-\d+-\d+\.mp4$/.test(n))).toBe(true);
  // a finished export replaces the file and sweeps the dead export's partial
  const p = Bun.spawnSync(['bun', REEL, 'video', '--project', layers.dir, '--samples', '1', '--preset', 'ultrafast', '--size', '360x640', '--to', '0.3', '--out', out, '--force'], { env: { ...process.env, ...env } });
  expect(p.exitCode).toBe(0);
  expect(readdirSync(d)).toEqual(['video.mp4']);
  expect(readFileSync(out).subarray(4, 8).toString()).toBe('ftyp');
  expect(existsSync(out)).toBe(true);
}, 180_000);

test.skipIf(!hasChrome)('a render with scene errors exits 1 and keeps the previous file', async () => {
  const d = tempDir('reel-test-errors-'), out = path.join(d, 'video.mp4');
  writeFileSync(out, 'the previous render');
  const p = Bun.spawnSync(['bun', REEL, 'video', '--project', broken.dir, '--out', out, '--force', '--json'], { env: { ...process.env, REEL_EXPORTS_DIR: tempDir('reel-test-errors-exports-') } });
  expect(p.exitCode).toBe(1);
  const r = JSON.parse(p.stdout.toString());
  expect(r.errors.join('\n')).toContain('this scene is broken');
  expect(r.file).toBeUndefined();
  expect(readFileSync(out, 'utf8')).toBe('the previous render');
  expect(readdirSync(d)).toEqual(['video.mp4']);
}, 120_000);
