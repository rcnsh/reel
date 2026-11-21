import { afterAll, expect, test } from 'bun:test';
import path from 'node:path';
import { ENGINE, REEL, removeTempDirs, tempDir } from './helpers';

afterAll(removeTempDirs);

const pids = (s: string) => Bun.spawnSync(['pgrep', '-f', s]).stdout.toString().split('\n').filter(Boolean).map(Number);
async function until(ok: () => boolean, ms: number) {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (ok()) return true;
  return ok();
}

function parent(cmd: string[]) {
  const code = `const { spawnChild } = await import(${JSON.stringify(path.join(ENGINE, 'cli/children.ts'))}); console.log(spawnChild(${JSON.stringify(cmd)}).pid); setInterval(() => {}, 1000);`;
  const p = Bun.spawn(['bun', '-e', code], { stdout: 'pipe', stderr: 'inherit' });
  const pid = (async () => { for await (const c of p.stdout) return Number(new TextDecoder().decode(c).trim()); return 0; })();
  return { p, pid };
}

const tree = (p: number): number[] => [p, ...Bun.spawnSync(['pgrep', '-P', String(p)]).stdout.toString().split('\n').filter(Boolean).flatMap((c) => tree(Number(c)))];
const alive = (ps: number[]) => ps.filter((p) => { try { process.kill(p, 0); return true; } catch { return false; } });

test('a child and everything under it go when the parent is killed outright, by SIGKILL after a grace if they ignore SIGTERM', async () => {
  const { p, pid } = parent(['sh', '-c', "trap '' TERM; sleep 60 & sleep 60; wait"]);
  try {
    const c = await pid;
    expect(await until(() => tree(c).length === 3, 3000)).toBe(true);
    const all = tree(c);
    p.kill('SIGKILL');
    await p.exited;
    const t0 = Date.now();
    expect(await until(() => alive(all).length === 0, 5000)).toBe(true);
    expect(Date.now() - t0).toBeGreaterThan(1000);
  } finally { p.kill('SIGKILL'); }
});

test('the same for a parent ended by a signal it does not handle (SIGALRM, as a perl alarm time limit sends)', async () => {
  const { p, pid } = parent(['sh', '-c', 'sleep 60']);
  try {
    const all = tree(await pid);
    p.kill('SIGALRM');
    expect(await p.exited).toBe(142);
    expect(await until(() => alive(all).length === 0, 3000)).toBe(true);
  } finally { p.kill('SIGKILL'); }
});

test('a parent whose children are done exits by itself (the watchdog keeps nothing alive)', async () => {
  const code = `const { run } = await import(${JSON.stringify(path.join(ENGINE, 'cli/children.ts'))}); console.log((await run(['echo', 'hi'])).text().trim());`;
  const p = Bun.spawn(['bun', '-e', code], { stdout: 'pipe' });
  const timer = setTimeout(() => p.kill('SIGKILL'), 5000);
  expect(await new Response(p.stdout).text()).toBe('hi\n');
  expect(await p.exited).toBe(0);
  clearTimeout(timer);
});

test.skipIf(!Bun.which('ffmpeg'))('reel mix killed with SIGKILL mid-mix leaves no ffmpeg behind', async () => {
  const dir = tempDir('reel-mix-kill-');
  const long = path.join(dir, 'long.mp4'), out = path.join(dir, 'out.mp4');
  expect(Bun.spawnSync(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=black:s=16x16:r=1', '-t', '7200', '-c:v', 'libx264', '-preset', 'ultrafast', long]).exitCode).toBe(0);
  const p = Bun.spawn(['bun', REEL, 'mix', '--project', path.join(ENGINE, 'examples/demo'), long, out], { stdout: 'ignore', stderr: 'ignore' });
  const ffmpeg = () => pids(dir).filter((q) => Bun.spawnSync(['ps', '-o', 'comm=', '-p', String(q)]).stdout.toString().includes('ffmpeg'));
  try {
    expect(await until(() => ffmpeg().length > 0, 10000)).toBe(true);
    p.kill('SIGKILL');
    await p.exited;
    expect(await until(() => pids(dir).length === 0, 5000)).toBe(true);
  } finally { p.kill('SIGKILL'); for (const q of pids(dir)) process.kill(q, 'SIGKILL'); }
}, 20000);
