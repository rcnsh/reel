// The dev server a project is rendered through: Vite serving the engine's page (index.html, src/main.ts) with the
// project folder mapped in. The project's config is `@project/reel.config`, its scenes import the engine as
// `reel` (and its scenes as `reel/scenes/<name>`), and its files (audio/, data/, assets/ ...) are served from the
// site root. The config's format and theme reach the page as compile-time constants (__REEL_FORMAT__, __REEL_THEME__).
import { createServer, type ViteDevServer } from 'vite';
import { existsSync, statSync, createReadStream, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatOf, type VideoConfig } from '../src/config';
import { resolveTheme, type ResolvedTheme } from '../src/themes';

export const ENGINE = path.resolve(import.meta.dir, '..');

const TYPES: Record<string, string> = {
  '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.hdr': 'application/octet-stream', '.bin': 'application/octet-stream',
};

/** The folder of the project to work on: `dir`, which must hold a reel.config.ts. */
export function projectDir(dir: string) {
  const p = path.resolve(dir);
  if (!existsSync(path.join(p, 'reel.config.ts'))) throw new Error(`no reel.config.ts in ${p} (pass --project <folder>)`);
  return p;
}

/**
 * The project's config, read outside the browser: its top level is plain data and `timeline` is not called. The
 * file is compiled with its `reel` imports pointed at this engine, so a project need not have it installed.
 */
export async function loadConfig(project: string): Promise<VideoConfig> {
  const src = await Bun.file(path.join(project, 'reel.config.ts')).text();
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(src)
    .replace(/(from\s*|import\s*\(\s*)(["'])reel(\/config|\/scenes\/[\w-]+)?\2/g, (_, pre: string, q: string, sub?: string) => `${pre}${q}${path.join(ENGINE, sub === '/config' ? 'src/config.ts' : sub ? `src${sub}.ts` : 'src/index.ts')}${q}`);
  // (beside the config, so its relative imports resolve; removed once loaded)
  const file = path.join(project, `.reel.config.${Bun.hash(js).toString(36)}.mjs`);
  writeFileSync(file, js);
  let mod;
  try { mod = await import(file); } finally { rmSync(file, { force: true }); }
  if (!mod.default || typeof mod.default.timeline !== 'function') throw new Error(`${project}/reel.config.ts must default-export defineVideo({...})`);
  return mod.default as VideoConfig;
}

/**
 * Start the server for `project`. `hmr: false` for renders: a file saved mid-render must not reload the page.
 * `port: 0` picks a free port. `theme` names a built-in theme to use instead of the config's.
 */
export async function startServer(project: string, opts: { port?: number; hmr?: boolean; theme?: string } = {}): Promise<{ url: string; server: ViteDevServer; format: ReturnType<typeof formatOf>; theme: ResolvedTheme; stop: () => Promise<void> }> {
  const config = await loadConfig(project);
  const format = formatOf(config);
  const theme = resolveTheme(opts.theme ?? config.theme ?? 'neutral');
  const server = await createServer({
    configFile: false,
    root: ENGINE,
    publicDir: path.join(ENGINE, 'public'),
    logLevel: 'error',
    clearScreen: false,
    define: { __REEL_FORMAT__: JSON.stringify(format), __REEL_THEME__: JSON.stringify(theme) },
    resolve: {
      alias: [
        { find: /^reel\/config$/, replacement: path.join(ENGINE, 'src/config.ts') },
        { find: /^reel\/scenes\/([\w-]+)$/, replacement: path.join(ENGINE, 'src/scenes/$1.ts') },
        { find: /^reel$/, replacement: path.join(ENGINE, 'src/index.ts') },
        { find: /^@project\//, replacement: project + '/' },
      ],
      // (a project outside this repo has no node_modules of its own: its scenes get the engine's three.js)
      dedupe: ['three'],
    },
    optimizeDeps: { include: ['three', 'opentype.js'] },
    server: { port: opts.port || 0, strictPort: !!opts.port, hmr: opts.hmr ?? false, fs: { allow: [ENGINE, project] } },
    build: { target: 'esnext' },
    plugins: [{
      name: 'reel-project-files',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          const rel = decodeURIComponent((req.url ?? '/').split('?')[0]!);
          if (rel === '/' || rel.startsWith('/@') || rel.startsWith('/src/') || rel.startsWith('/node_modules/')) return next();
          const file = path.join(project, rel);
          // (inside the project only, never its config or sources: those go through Vite's transform)
          if (!file.startsWith(project + path.sep) || /\.(ts|tsx|js|mjs)$/.test(file) || !existsSync(file) || !statSync(file).isFile()) return next();
          res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Accept-Ranges', 'bytes');
          // (byte ranges: the preview's <audio> and <video> cannot seek without them)
          const size = statSync(file).size, m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
          if (!m || (!m[1] && !m[2])) { res.setHeader('Content-Length', size); createReadStream(file).pipe(res); return; }
          const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])), end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
          if (start > end || start >= size) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${size}`); res.end(); return; }
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
          res.setHeader('Content-Length', end - start + 1);
          createReadStream(file, { start, end }).pipe(res);
        });
      },
    }],
  });
  await server.listen();
  const addr = server.httpServer!.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  return { url: `http://localhost:${port}`, server, format, theme, stop: () => server.close() };
}
