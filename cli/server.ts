import type { ViteDevServer } from 'vite';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, createReadStream, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { formatOf, type VideoConfig } from '../src/config';
import { resolveTheme, type ResolvedTheme } from '../src/themes';
import { projectFonts } from './fonts';

export const ENGINE = path.resolve(import.meta.dir, '..');

const TYPES: Record<string, string> = {
  '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.hdr': 'application/octet-stream', '.exr': 'image/x-exr', '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2', '.m4v': 'video/mp4', '.aac': 'audio/aac', '.opus': 'audio/ogg', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.lottie': 'application/zip', '.csv': 'text/csv; charset=utf-8',
};
const MEDIA = new Set(Object.keys(TYPES).filter((x) => x !== '.json' && x !== '.txt'));

export function projectDir(dir: string) {
  const p = path.resolve(dir);
  if (!existsSync(path.join(p, 'reel.config.ts'))) throw new Error(`no reel.config.ts in ${p} (pass --project <folder>)`);
  return realpathSync(p);
}

export async function loadConfig(project: string): Promise<VideoConfig> {
  const src = await Bun.file(path.join(project, 'reel.config.ts')).text();
  let compiled: string;
  try { compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(src); } catch (e) {
    const p = (e as { position?: { line: number; column: number; lineText: string } }).position;
    throw new Error(`${path.join(project, 'reel.config.ts')}${p ? `:${p.line}:${p.column}` : ''}: ${(e as Error).message}${p ? `\n  ${p.lineText}` : ''}`);
  }
  const js = compiled
    .replace(/(from\s*|import\s*\(\s*)(["'])reel(\/config|\/scenes\/[\w-]+)?\2/g, (_, pre: string, q: string, sub?: string) => `${pre}${q}${path.join(ENGINE, sub === '/config' ? 'src/config.ts' : sub ? `src${sub}.ts` : 'src/index.ts')}${q}`);
  const file = path.join(project, `.reel.config.${Bun.hash(js).toString(36)}.mjs`);
  writeFileSync(file, js);
  let mod;
  try { mod = await import(file); } finally { rmSync(file, { force: true }); }
  if (!mod.default || typeof mod.default.timeline !== 'function') throw new Error(`${project}/reel.config.ts must default-export defineVideo({...})`);
  return mod.default as VideoConfig;
}

export function workspaceOf(project: string, search: (dir: string) => string): string[] {
  const root = search(project);
  if (root === project) return [];
  const has = (f: string) => existsSync(path.join(root, f));
  let workspaces = false;
  try { workspaces = !!JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).workspaces; } catch {}
  return has('pnpm-workspace.yaml') || has('lerna.json') || workspaces ? [root] : [];
}

export const PREBUNDLED = [
  'three', 'opentype.js', 'mp4box', 'lottie-web/build/player/esm/lottie_light_canvas.min.js',
  ...['GLTFLoader', 'DRACOLoader', 'KTX2Loader', 'HDRLoader', 'EXRLoader'].map((l) => `three/examples/jsm/loaders/${l}.js`),
  'three/examples/jsm/libs/meshopt_decoder.module.js', 'three/examples/jsm/environments/RoomEnvironment.js',
  'highlight.js/lib/core',
  ...['bash', 'cpp', 'css', 'diff', 'glsl', 'go', 'javascript', 'json', 'python', 'rust', 'sql', 'typescript', 'xml', 'yaml'].map((l) => `highlight.js/lib/languages/${l}`),
];

export const VITE_CACHE = path.join(ENGINE, 'node_modules/.vite/reel');

export function viteCacheDir(project: string, root = VITE_CACHE) {
  try {
    for (const d of readdirSync(root)) {
      let owner: string;
      try { owner = readFileSync(path.join(root, d, 'project'), 'utf8'); } catch { continue; }
      if (!existsSync(owner)) rmSync(path.join(root, d), { recursive: true, force: true });
    }
  } catch {}
  const dir = path.join(root, `${path.basename(project).replace(/[^\w.-]/g, '_')}-${Bun.hash(project).toString(36)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'project'), project);
  return dir;
}

export interface ModuleError { file: string; message: string }

export async function startServer(project: string, opts: { port?: number; strictPort?: boolean; hmr?: boolean; theme?: string; props?: string; onModuleError?: (e: ModuleError) => void } = {}): Promise<{ url: string; server: ViteDevServer; format: ReturnType<typeof formatOf>; theme: ResolvedTheme; stop: () => Promise<void> }> {
  const config = await loadConfig(project);
  const format = formatOf(config);
  const theme = resolveTheme(opts.theme ?? config.theme ?? 'neutral');
  const { createServer, createLogger, searchForWorkspaceRoot } = await import('vite');
  const logger = createLogger('error');
  let moduleFailed = false;
  const logError = logger.error.bind(logger);
  logger.error = (msg, o) => {
    const err = o?.error as { id?: string; message?: string } | null | undefined;
    if (err?.id) moduleFailed = true;
    if (opts.onModuleError && err?.id && err.message) {
      const file = err.id.split('?')[0]!;
      opts.onModuleError({ file, message: `${path.relative(project, file)}: ${stripVTControlCharacters(err.message).trim()}` });
    } else logError(msg, o);
  };
  const server = await createServer({
    configFile: false,
    root: ENGINE,
    cacheDir: viteCacheDir(project),
    publicDir: path.join(ENGINE, 'public'),
    customLogger: logger,
    clearScreen: false,
    define: { __REEL_FORMAT__: JSON.stringify(format), __REEL_THEME__: JSON.stringify(theme) },
    resolve: {
      alias: [
        { find: /^reel\/config$/, replacement: path.join(ENGINE, 'src/config.ts') },
        { find: /^reel\/scenes\/([\w-]+)$/, replacement: path.join(ENGINE, 'src/scenes/$1.ts') },
        { find: /^reel$/, replacement: path.join(ENGINE, 'src/index.ts') },
        { find: /^@project\//, replacement: project + '/' },
      ],
      dedupe: ['three'],
    },
    optimizeDeps: { include: PREBUNDLED },
    server: { port: opts.port || 0, strictPort: !!opts.port && opts.strictPort !== false, hmr: opts.hmr ?? false, forwardConsole: !!opts.hmr, fs: { allow: [ENGINE, project, ...workspaceOf(project, searchForWorkspaceRoot)] } },
    build: { target: 'esnext' },
    plugins: [{
      name: 'reel-props',
      transformIndexHtml: () => opts.props ? [{ tag: 'script', children: `window.__REEL_PROPS__ = ${JSON.stringify(opts.props).replace(/</g, '\\u003c')};`, injectTo: 'head-prepend' }] : [],
    }, {
      name: 'reel-project-files',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          const rel = decodeURIComponent((req.url ?? '/').split('?')[0]!);
          if (rel === '/@reel/fonts.json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            try { res.end(JSON.stringify({ fonts: projectFonts(project) })); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: (e as Error).message })); }
            return;
          }
          if (rel === '/' || rel.startsWith('/@') || rel.startsWith('/src/') || rel.startsWith('/node_modules/')) return next();
          const file = path.join(project, rel);
          if (!file.startsWith(project + path.sep) || /\.(ts|tsx|js|mjs)$/.test(file)) return next();
          if (!existsSync(file) || !statSync(file).isFile()) {
            if (!MEDIA.has(path.extname(file).toLowerCase()) || rel.startsWith('/public/')) return next();
            if (existsSync(path.join(ENGINE, 'public', rel))) return next();
            res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); res.end(`${rel.slice(1)} is not in the project`); return;
          }
          res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Accept-Ranges', 'bytes');
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
  if (opts.hmr) {
    server.watcher.add(project);
    server.watcher.on('add', (f) => {
      if (!moduleFailed || !f.startsWith(project + path.sep) || /(^|\/)(out|node_modules|\.git)\//.test(path.relative(project, f) + '/')) return;
      moduleFailed = false;
      void server.restart();
    });
  }
  const addr = server.httpServer!.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  return { url: `http://localhost:${port}`, server, format, theme, stop: () => server.close() };
}
