# reel

A deterministic WebGL video engine. Every frame is a pure function of the time `t`, so the browser preview and the offline export (headless Chrome streaming frames over a WebSocket into ffmpeg) produce the same image, at 1080p or true 4K, with adaptive motion blur. A video is narration (or a song) plus one scene per plate. Stack: TypeScript, three.js, opentype.js, bun, Vite, playwright-core, ffmpeg; Python tools run through uv.

It is a personal tool, extracted from the singapore-dementia-2050 group video (whose repo keeps its own copy in `06_video/engine/`) and adapted from [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video). Build to that bar: working, tested, documented, no ceremony.

Where to read before acting:

- **Writing or changing a scene**: `docs/ENGINE.md` in full. It owns the Scene API, the determinism and sampling rules, the toolbox, typography, 4K and the spark.
- **Making a video, the layout, render commands**: `README.md`.
- **Render flags**: the comment block at the top of `scripts/render.ts`. **Analysis flags**: `uv run tools/analyze.py --help`. **Mix config**: the comment at the top of `tools/mix.ts`.

## How the pieces connect

```
narration.txt ──tools/narration.ts (say) or tools/align.ts (Whisper)──▶ audio/narration.mp3
                                                                         data/lyrics.json  (words + times)
song ──tools/analyze.py──▶ audio/<song>  +  data/audio.json  (beats, envelopes, onsets, sections, track)

data/*.json ─▶ Engine.init ─▶ src/timeline.ts: one entry per section that has src/scenes/<name>.ts
                            ─▶ each frame: scenes render HDR into targets ─▶ transitions ─▶ HUD ─▶ post
src/main.ts: preview player (default) or export API window.__reel (?export=1)
scripts/render.ts drives window.__reel: stills | sheet | plates | events | perf | video | gpu
render.ts events ─▶ data/cues.json ─▶ tools/mix.ts + mix.json ─▶ music and cue sounds under the video
```

- `data/audio.json` sections are the edit. The narration tools write one section per `# plate`; `analyze.py` writes them from a file, keeps them, or segments the song. The timeline maps each section to the scene module of the same name and skips sections without one, so a video is built one plate at a time.
- `data/audio.json` `track` names the sound the preview plays and the export muxes (default `audio/narration.mp3`). Without `--keep-sections`, `analyze.py` points it at the song.
- `audio/` and `data/` are served from the project root in dev; `vite build` copies them beside the bundle, minus dot-folders.
- Generated files are committed so the demo renders from a clone: `audio/narration.mp3`, `data/lyrics.json`, `data/audio.json`, `data/cues.json`. Regenerate them with their tool rather than editing them by hand.

## Rules

- **Deterministic.** A scene's output depends on `f.t` only. Randomness comes from `hash`/`mulberry32` with fixed seeds; per-frame jitter uses `frameIdx(t)`, which holds across a frame's shutter. `--samples auto` renders sub-frames out of order and in any number, so nothing may count `render()` calls. Simulation state means `stateful = true`, and the engine then refuses adaptive sampling (render such a video with a fixed `--samples N`).
- **Anchored to words.** Scenes find timing by text: `ctx.lyrics.get('some words')` (throws when the line is missing, so a script edit fails loudly) and its word times. Times typed as numbers break the moment the voice is re-timed.
- **Logical pixels.** Scenes lay out in 1920×1080 logical px at every output scale; `PW`/`PH`, `gl_FragCoord`, `fwidth` and canvas backing sizes are physical. GLSL uses `FRAG_PX`, `PX_SCALE` and `pxLine` (`docs/ENGINE.md`, "Output scale").
- **Linear colour.** Render targets are HalfFloat linear HDR. Colours come from `src/engine/palette.ts`: `LIN.<key>` for GL, `C_<KEY>` in GLSL, `rgba('<key>', a)` for Canvas2D.
- **Project-neutral engine.** `src/engine/` holds only what any video could use. A video's own colours, story helpers, data and motifs live in `src/scenes/` (shared helpers as `scenes/_<name>.ts`, which the timeline's glob skips because no section is named `_…`).
- **Sound by cue.** A scene that wants a sound calls `cue(kind, t)` in `init()`; `mix.json` maps kinds to files in `audio/`. Scenes never play audio.
- **Licences travel with the code.** `LICENSE` (upstream MIT, Giacomo Magnanini) covers the engine; `public/fonts/OFL-*.txt` and the stroke fonts' file headers cover the fonts. Keep them, and keep the upstream credit in `README.md` and `docs/ENGINE.md`.

## Tasks

**New scene for a plate.** Add the `# name` plate and its lines to `narration.txt`, re-time (`bun tools/narration.ts` for a scratch track), write `src/scenes/<name>.ts` default-exporting a `Scene` subclass (`src/scenes/hello.ts` is the minimal reference, `written.ts` shows stroke text, word timing and cues), then typecheck and look at stills across the plate's window, including its last frame.

**New video.** Replace `narration.txt`, the demo scenes and `mix.json`, then time the voice: `bun tools/align.ts <recording>` (one take, or a folder of per-plate files named after the plates). `align.ts` takes `LEAD`, `HOLD` and `TAIL` from the environment (silence before the first word, after each plate, after the last word). Change palette values in `palette.ts` (keep the keys: the engine and GLSL use them).

**Music video.** `uv run tools/analyze.py <song> --sections sections.json` with sections named after the scenes (`[{"name": "intro", "bar": 0}, …]`). Scenes react with `f.a` (envelopes and decaying kick/snare/hat/vocal pulses), `f.beat`, `f.bar`, `audio.hit`, `audio.env`. For cuts on the beat, edit `src/timeline.ts` to snap entry starts with `au.beatBefore(t)` or `au.nearestDownbeat(t)`. Sung lyrics still come from `align.ts`, which is Whisper word times, not forced alignment.

**Narrated video with a music bed.** Time the narration first, then `uv run tools/analyze.py <bed> --keep-sections --offset <s>` to add the bed's beats from where it enters, and list the bed under `music` in `mix.json` with the same start.

**Engine change.** Change `src/engine/` only for something any video could use; update `docs/ENGINE.md` in the same change (it is what scene authors read). After touching `engine.ts`, `gl.ts`, `post.ts` or `main.ts`, render a short `--samples auto` video as well as stills: the sampler, tile masking and readback paths only run on export.

**Fonts.** `uv run tools/make_fonts.py` cuts the static instances from `public/fonts/src/`. Its instance lists and `src/engine/type.ts` (`ARCHIVO_WIDTHS`, `ARCHIVO_WEIGHTS`, `DEFS`) must match. Regenerated files differ from the committed ones only in the `head` table, so an unchanged rebuild needs no commit.

## Checks

Run all that apply before reporting work done:

1. `bun run typecheck`: three tsconfigs, `src/` for the browser, `scripts/` and `tools/` for bun.
2. Stills of every plate you touched, looked at with the Read tool: `bun scripts/render.ts stills --t <times> --only <plate> --out out/stills`. `sheet --cuts` checks every boundary at once.
3. Export path changes: the demo end to end, `video --preset veryfast --out out/demo_raw.mp4`, then `events`, then `bun tools/mix.ts out/demo_raw.mp4 out/demo.mp4`.
4. Python tool changes: run the tool on real input. For `analyze.py`, a synthetic track with a known tempo and first downbeat shows whether the grid and bar phase are right; a lead-in, a break and a non-integer tempo are the cases that have broken it before.

No test suite exists; these renders are the tests.

## Environment and gotchas

- **Chrome.** `render.ts` uses `CHROME_PATH`, else the installed Google Chrome (`channel: 'chrome'`). This Mac has no Google Chrome, so set `export CHROME_PATH="$HOME/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"`. Rendering uses Metal through ANGLE (`--use-angle=metal`).
- **Dev server.** `render.ts` reuses `http://localhost:5173` if something answers there, else starts a private Vite on a random 5300–5799 port with `REEL_NO_HMR=1`. A live-reloading server reloads the page mid-render when a file is saved, so for renders during edits run `REEL_NO_HMR=1 bunx vite --port 5190` and pass `--url http://localhost:5190`. A stale server on 5173 from another checkout serves the wrong project: stop it or pass `--url`.
- **Preview.** `bun run dev`, then `http://localhost:5173/?t=<seconds>`. Space plays, arrow keys seek, `,`/`.` step a frame, `[`/`]` jump plates, `l` loops the plate, `h` hides the UI. A missing track still plays silently: the clock runs on `performance.now()`.
- **`--only a,b`** loads only those timeline entries: faster, and isolates you from another scene's errors. Outside a loaded entry's window the frame is black.
- **Scene errors** do not stop a render: they print as `SCENE ERRORS` and `BROWSER LOG` lines. Read them.
- **Partial renders and the mix.** `tools/mix.ts --from <s>` must match the render's `--from`, or cues and music land in the wrong place.
- **analyze.py** copies the song into `audio/` under a URL-safe name (the preview fetches it by URL). Its drum and vocal measurements come from a harmonic/percussive split and band filters of the mix, not separated stems: kick, snare and hat are reliable on produced music, `bass`, `vocal` and vocal onsets are rough. `--onset-delta` tunes the peak-picking per drum band.
- **Disk.** `out/` fills fast (a 4K render is gigabytes), and the video mode spools up to `--spool-gb` (default 20) of frames to the system temp folder while x264 catches up.
- Bun 1.4, TypeScript 7 (`tsc` comes from the `typescript` peer dependency), three.js 0.186. Python tools pin their dependencies inline (PEP 723); `uv run` fetches them on first use.

## Git

Local repo on `main`, no remote. Conventional Commits (`feat(analyze): …`, `fix(mix): …`, `docs: …`). Small changes go straight to `main`; a change large enough to want review gets a fresh-context review of the diff before it is committed. Keep `README.md`, `docs/ENGINE.md` and this file current in the same commit as the behaviour they describe.
