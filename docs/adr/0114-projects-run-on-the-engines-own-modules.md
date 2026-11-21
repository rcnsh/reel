# Projects run on the engine's own modules, with no install

A project outside this repo has no `node_modules` of its own. Two things in `cli/server.ts` make it work regardless:

- `loadConfig` compiles `reel.config.ts` with bun's transpiler and rewrites its `reel`, `reel/config` and `reel/scenes/<name>` imports to this engine's files, so a project need not have reel installed. The compiled module is written beside the config (`.reel.config.<hash>.mjs`) so its relative imports resolve, and removed once loaded. Only its top level is read; `timeline` is not called.
- The dev server dedupes `three`, so a project's scenes get the engine's three.js and never a second copy.
