import { defineConfig, type Plugin } from 'vite';
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';

// The project's narration and timing data live in audio/ and data/ beside src/ (the tools write there).
// The dev server serves them from the root; builds copy them next to the bundle.
const assetDirs = ['audio', 'data'];
function projectAssets(): Plugin {
  return {
    name: 'project-assets',
    writeBundle(options) {
      if (!options.dir) return;
      for (const dir of assetDirs) {
        const src = path.resolve(import.meta.dirname, dir);
        if (existsSync(src)) cpSync(src, path.join(options.dir, dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [projectAssets()],
  // REEL_NO_HMR=1: no live reload (export renders must not reload mid-run when a file changes)
  server: { port: 5173, strictPort: false, hmr: process.env.REEL_NO_HMR ? false : undefined },
  build: { target: 'esnext', assetsInlineLimit: 0 },
});
