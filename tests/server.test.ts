import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { PREBUNDLED, viteCacheDir } from '../cli/server';
import { launchChrome, openPage } from '../cli/renderer';
import { ENGINE, hasChrome, removeTempDirs, tempDir } from './helpers';

afterAll(removeTempDirs);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    return e.isDirectory() ? sources(f) : f.endsWith('.ts') && !f.endsWith('.d.ts') ? [f] : [];
  });
}

test('every package the engine imports at run time is pre-bundled', () => {
  const missing = new Set<string>();
  for (const f of sources(path.join(ENGINE, 'src'))) {
    const text = readFileSync(f, 'utf8');
    const specs = [
      ...text.matchAll(/^(?:import|export)\s+(?!type\s)[^'"`;]*?from\s+['"]([^'"]+)['"]/gm),
      ...text.matchAll(/^import\s+['"]([^'"]+)['"]/gm),
      ...text.matchAll(/import\(\s*['"`]([^'"`]+)['"`]\s*\)/g),
    ].map((m) => m[1]!);
    for (const s of specs) if (!/^(\.|reel(\/|$)|@project\/)/.test(s) && !PREBUNDLED.includes(s)) missing.add(s);
  }
  expect([...missing]).toEqual([]);
});

test('viteCacheDir: a folder per project, and those of projects that are gone are removed', () => {
  const root = tempDir('reel-vite-cache-');
  const a = tempDir('reel-proj-a-'), b = tempDir('reel-proj-b-');
  for (const p of [a, b]) writeFileSync(path.join(p, 'reel.config.ts'), '');
  const da = viteCacheDir(a, root), db = viteCacheDir(b, root);
  expect(da).not.toBe(db);
  expect(viteCacheDir(a, root)).toBe(da);
  expect(readFileSync(path.join(da, 'project'), 'utf8')).toBe(a);
  mkdirSync(path.join(root, 'starting'));
  rmSync(path.join(a, 'reel.config.ts'));
  rmSync(b, { recursive: true });
  viteCacheDir(tempDir('reel-proj-c-'), root);
  expect(existsSync(db)).toBe(false);
  expect(existsSync(da)).toBe(true);
  expect(existsSync(path.join(root, 'starting'))).toBe(true);
});

type Answer = 'ok' | 504 | 404 | 'drop' | 'cut';

async function server(answer: (n: number) => Answer, src = '/m.js') {
  let n = 0;
  const html = `<!doctype html><script type="module" src="${src}" onerror="window.__reel = { error: 'a module of the page did not load' }"></script>`;
  const js = `window.__reel = { ready: true, width: 64, height: 64, timeline: [] };`;
  const s = createServer((req, res) => {
    if (req.url !== src) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    const a = answer(++n);
    if (a === 'drop') { req.socket.destroy(); return; }
    if (a === 'cut') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Content-Length': 1000 }); res.write('window.x = 1;', () => res.socket?.destroy()); return; }
    res.writeHead(a === 'ok' ? 200 : a, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    res.end(a === 'ok' ? js : '');
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/`, requests: () => n, stop: () => { s.closeAllConnections(); s.close(); } };
}

test.skipIf(!hasChrome)('openPage loads a page again after a 504 or a module request that failed, and gives up on one that keeps failing', async () => {
  const browser = await launchChrome();
  const fmt = { w: 64, h: 64, fps: 30, scale: 1 };
  try {
    for (const fail of [504, 'drop', 'cut'] as const) {
      const s = await server((n) => (n <= 2 ? fail : 'ok'));
      try {
        const page = await openPage(browser, s.url, fmt, {}, () => {});
        expect(s.requests()).toBeGreaterThanOrEqual(3);
        await page.close();
      } finally { s.stop(); }
    }
    const gone = await server((n) => (n <= 2 ? 404 : 'ok'), '/node_modules/.vite/reel/p/deps/m.js');
    try {
      await (await openPage(browser, gone.url, fmt, {}, () => {})).close();
      expect(gone.requests()).toBe(3);
    } finally { gone.stop(); }
    const s = await server(() => 504);
    try {
      expect(String(await openPage(browser, s.url, fmt, {}, () => {}).catch((e) => e))).toContain('did not arrive after 5 reloads');
    } finally { s.stop(); }
    const s404 = await server(() => 404);
    try {
      expect(String(await openPage(browser, s404.url, fmt, {}, () => {}).catch((e) => e))).toContain('module did not load');
      expect(s404.requests()).toBe(1);
    } finally { s404.stop(); }
  } finally { await browser.close(); }
}, 30000);
