# reel

Deterministic WebGL video engine (TypeScript, three.js, bun, Vite; headless Chrome to ffmpeg), extracted from the singapore-dementia-2050 group video. `README.md` explains the pipeline and layout; `docs/ENGINE.md` is the scene author's guide: read it before writing or changing a scene.

## Rules

- Every frame is a pure function of `t`. No `Math.random()`, `Date.now()` or `performance.now()` in visuals; per-frame jitter uses `frameIdx(t)`. `--samples auto` renders sub-frames out of order.
- Scenes find words by text (`ctx.lyrics.get`), never by hard-coded times.
- The engine is project-neutral: nothing about a particular video goes in `src/engine/`. Project colours beyond the palette keys, story helpers and data live in the project's scenes.
- `LICENSE` (upstream MIT) and the fonts' `OFL-*.txt` must stay with the code.

## Checks

- `bun run typecheck` (both tsconfigs: `src/` for the browser, `scripts/` for bun).
- Render stills of what you changed and look at them: `bun scripts/render.ts stills --t <times> --only <plate>`. Needs `CHROME_PATH`; on the Mac: `$HOME/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.
- After touching the export path, render the demo end to end (`video`, `events`, `tools/mix.ts`).
