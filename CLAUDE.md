# reel

A deterministic WebGL video engine for agents. Every frame is a pure function of the time `t`, so the browser preview and the offline export (headless Chrome streaming frames over a WebSocket into ffmpeg) produce the same image, at any frame size and frame rate (16:9, vertical, square; `--scale 2` for true 4K), with adaptive motion blur. Stack: TypeScript, three.js, opentype.js, bun, Vite, playwright-core, ffmpeg; Python tools run through uv.

This repo is the engine and its `reel` CLI. A video is a **project**: a folder with a `reel.config.ts`, `scenes/` and its own audio and data, in this repo's `examples/` or anywhere else. It is a personal tool, adapted from [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video). Build to that bar: working, tested, documented, no ceremony.

Where to read before acting:

- **Writing or changing a scene or a config**: `skills/reel-authoring/SKILL.md` and the reference files beside it (the Scene API, determinism and sampling rules, themes, the toolbox, timing). **Checking it**: `skills/reel-review-loop/SKILL.md`.
- **Changing the engine**: `docs/ENGINE.md` (the page, a frame's pipeline, adaptive sampling, readback, reporting).
- **Making a video, the layout, render commands**: `README.md`, and `bun cli/reel.ts --help` for every command and flag.
- **A project's config**: the types in `src/config.ts` (`VideoConfig`, `Clip`). **Analysis flags**: `reel analyze --help`. **Mix config**: the comment at the top of `tools/mix.ts`.

## Words

- **Scene**: a class that draws (`scenes/<name>.ts` in a project). **Clip**: a scene placed on the timeline, with an id and a window. **Track**: a layer of clips; tracks stack in number order. **Project**: the folder holding a video's config, scenes and data.
- A narrated project's script is split into **plates** (`# name` headers in `narration.txt`); each becomes a section in `data/audio.json` and, through `clipsFromSections`, a clip shown by the scene of the same name.

## How the pieces connect

```
<project>/narration.txt ──reel narrate (say) or reel align (Whisper)──▶ audio/narration.mp3, data/words.json (words + times)
song ──reel analyze──▶ audio/<song>  +  data/audio.json  (beats, envelopes, onsets, sections, track)

<project>/reel.config.ts ─▶ format (size, fps) + timeline(): clips on tracks, each naming a scene module
cli/server.ts: Vite serving index.html + src/main.ts, with the project mapped in (@project, its files at the site root)
Engine.init ─▶ load the clips' scenes (+ the theme's overlay clip) ─▶ each frame: scenes render HDR into targets
            ─▶ transitions per track ─▶ tracks stacked ─▶ post (defaults from the theme)
src/main.ts: preview player (reel dev) or export API window.__reel (?export=1)
cli/reel.ts (flags: cli/args.ts) drives window.__reel through cli/renderer.ts + cli/ops.ts: info | still | sheet | strip | check | events | perf | gpu;
            cli/video.ts: the video export
reel events ─▶ data/cues.json ─▶ reel mix + mix.json ─▶ music and cue sounds under the video
```

- The config is the edit. `size`, `fps` and `theme` are read by the CLI outside the browser (so a config's top level is plain data: scenes are lazy imports, engine calls live inside `timeline()`), and reach the page as the compile-time constants `__REEL_FORMAT__` and `__REEL_THEME__` (the theme resolved by `src/themes.ts`). Being constants, they are in place before any module runs, which is what lets `glsl/common.ts` bake the palette into shader strings at import time.
- The engine has no look of its own. The theme (`print`, `film`, `neutral` (the default) or an object) gives the palette, the post defaults and an optional overlay, which the engine places as a clip called `overlay` on a track above every other. The HUD (crop marks, captions) is an ordinary scene, `src/scenes/hud.ts` (`reel/scenes/hud`).
- Audio and words are optional. Without `data/audio.json` and `data/words.json` a project is silent, its sources are empty and its length is `duration` or the end of its last clip.
- `data/audio.json` `track` names the sound the preview plays and the export muxes (default `audio/narration.mp3`). Without `--keep-sections`, `reel analyze` points it at the song.
- Scenes import the engine as `reel` (`src/index.ts`), configs import `reel/config` (`src/config.ts`), and both can name the engine's scenes as `reel/scenes/<name>` (`src/scenes/`): aliases in the dev server and `tsconfig.json`.
- An example's generated files are committed so it renders from a clone: `audio/narration.mp3`, `data/words.json`, `data/audio.json`, `data/cues.json`. Regenerate them with their tool rather than editing them by hand.

## Rules

- **Deterministic.** A scene's output depends on `f.t` only. Randomness comes from `hash`/`mulberry32` with fixed seeds; per-frame jitter uses `frameIdx(t)`, which holds across a frame's shutter, and a frame step is `1 / FPS`, never `1 / 60`. `--samples auto` renders sub-frames out of order and in any number, so nothing may count `render()` calls. Simulation state means `stateful = true`, and the engine then refuses adaptive sampling (render such a video with a fixed `--samples N`).
- **Anchored to words.** Scenes find timing by text: `ctx.words.get('some words')` (throws when the line is missing, so a script edit fails loudly) and its word times. Times typed as numbers break the moment the voice is re-timed.
- **Logical pixels.** Scenes lay out in logical px, `W`×`H` (the `--size`, default 1920×1080), at every output scale; `PW`/`PH`, `gl_FragCoord`, `fwidth` and canvas backing sizes are physical. GLSL uses `FRAG_PX`, `PX_SCALE` and `pxLine` (`skills/reel-authoring/reference/sampling.md`, "Output scale").
- **Linear colour, from the theme.** Render targets are HalfFloat linear HDR. Colours come from the theme's palette (`src/engine/palette.ts`): `LIN.<key>` for GL, `C_<KEY>` in GLSL, `rgba('<key>', a)` for Canvas2D. Scenes meant to follow any theme use the keys every palette has: `bg`, `fg`, `accent`, `accentHi`, `accentLo`. The engine's own colours (flash, invert, heat ramp, spark, HUD) come from those keys too, never from a theme's extra keys.
- **Project-neutral engine.** `src/engine/` holds only what any video could use, and no look: colours and grades belong to themes (`src/themes.ts`). A video's own colours, story helpers, data and motifs live in its project (shared helpers as `scenes/_<name>.ts`, which `clipsFromSections` skips because no section is named `_…`).
- **Scenes report their text.** Text drawn with `fillText` is followed by `reportText(c, text, x, y)`, other drawn text (stroke fonts, glyphs, textures) by `report({ kind: 'text', … })`, so `reel check` can see it. Both are free outside a check; anything they need that costs work goes behind `if (reporting())`.
- **Upper tracks are transparent.** A scene on track 0 fully overwrites its target; a scene on a higher track clears it to transparent (`clearRT(renderer, out, [0, 0, 0], 0)`) and draws premultiplied over that, so the tracks below show through.
- **Sound by cue.** A scene that wants a sound calls `cue(kind, t)` in `init()`; `mix.json` maps kinds to files in `audio/`. Scenes never play audio.
- **Licences travel with the code.** `LICENSE` (upstream MIT, Giacomo Magnanini) covers the engine; `public/fonts/OFL-*.txt` and the stroke fonts' file headers cover the fonts. Keep them, and keep the upstream credit in `README.md` and `docs/ENGINE.md`.

## Tasks

`reel` below is `bun cli/reel.ts`; every command takes `--project <folder>`.

**New scene for a narrated plate.** Add the `# name` plate and its lines to the project's `narration.txt`, re-time (`reel narrate` for a scratch track), write `scenes/<name>.ts` default-exporting a `Scene` subclass (`examples/demo/scenes/hello.ts` is the minimal reference, `written.ts` shows stroke text, word timing and cues), then typecheck and look at stills across the clip's window, including its last frame.

**New project.** `reel init <folder> [--size WxH] [--fps N] [--theme print|film|neutral] [--narrated]` writes one that renders straight away (it refuses a folder holding anything but `.git` or `.DS_Store`). Its `tsconfig.json` extends `tsconfig.project.json` here by absolute path (paths for `reel`, `reel/config`, `reel/scenes/*`, `three`; `project.d.ts` brings Vite's `import.meta.glob` types), so it typechecks without an install; its `package.json` scripts run this checkout's CLI and `tsc`. Change `tsconfig.project.json` with care: every project outside this repo extends it. `examples/layers` is a silent two-track project, `examples/demo` a narrated one. For a real voice in a narrated project, time it: `reel align <recording>` (one take, or a folder of per-plate files named after the plates). `align` takes `LEAD`, `HOLD` and `TAIL` from the environment (silence before the first word, after each plate, after the last word).

**Music video.** `reel analyze <song> --sections sections.json` with sections named after the scenes (`[{"name": "intro", "bar": 0}, …]`). Scenes react with `f.a` (envelopes and decaying kick/snare/hat/vocal pulses), `f.beat`, `f.bar`, `audio.hit`, `audio.env`. For cuts on the beat, snap clip starts in the config's `timeline()` with `src.audio.beatBefore(t)` or `src.audio.nearestDownbeat(t)`. Sung lyrics still come from `reel align`, which is Whisper word times, not forced alignment.

**Narrated video with a music bed.** Time the narration first, then `reel analyze <bed> --keep-sections --offset <s>` to add the bed's beats from where it enters, and list the bed under `music` in `mix.json` with the same start.

**Engine change.** Change `src/engine/` only for something any video could use. In the same change, update the `reel-authoring` skill for anything a scene author sees and `docs/ENGINE.md` for how it works inside; a fact lives in one of them, not both. After touching `engine.ts`, `gl.ts`, `post.ts` or `main.ts`, render a short `--samples auto` video as well as stills: the sampler, tile masking and readback paths only run on export.

**Skills.** `skills/<name>/SKILL.md` (YAML `name` and `description`) plus files beside it, each under about 300 lines; long reference goes in the files. They are written for a capable agent that has never seen reel and carry knowledge, not process. Projects hold copies (`reel init`, `reel skills update`), so a skill must make sense without this repo.

**Fonts.** `uv run tools/make_fonts.py` cuts the static instances from `public/fonts/src/`. Its instance lists and `src/engine/type.ts` (`ARCHIVO_WIDTHS`, `ARCHIVO_WEIGHTS`, `DEFS`) must match. Regenerated files differ from the committed ones only in the `head` table, so an unchanged rebuild needs no commit.

## Checks

Run all that apply before reporting work done:

1. `bun run typecheck`: one tsconfig over `src/`, `cli/`, `tools/` and `examples/`.
2. Stills of every clip you touched, looked at with the Read tool: `reel still --project <p> --t <times> --only <clip>`. `reel sheet --cuts` checks every cut at once.
3. Theme or post changes: the print theme must still render the demo byte for byte as before. Stills before and after (`reel still --project examples/demo --t 0.4,2.5,5,7.3`) compared with a pixel diff.
4. Export path changes: both examples end to end. `reel video --project examples/demo --samples auto --preset veryfast --out <raw.mp4>`, then `reel events`, then `reel mix <raw.mp4> <out.mp4>`; and `reel video --project examples/layers --samples auto --preset veryfast` (tracks, a crossfade, the film theme's overlay, no audio, vertical, 30 fps).
5. `reel init`, `tsconfig.project.json` or `project.d.ts` changes: `reel init` a silent and a `--narrated` project under `/tmp`, then in each `bun run typecheck`, `bun run reel still --t 1` and `bun run reel video --samples auto --preset veryfast`.
6. Python tool changes: run the tool on real input. For `analyze.py`, a synthetic track with a known tempo and first downbeat shows whether the grid and bar phase are right; a lead-in, a break and a non-integer tempo are the cases that have broken it before.

No test suite exists yet; these renders are the tests.

## Environment and gotchas

- **Chrome.** The CLI uses `CHROME_PATH`, else the installed Google Chrome (`channel: 'chrome'`). This Mac has no Google Chrome, so set `export CHROME_PATH="$HOME/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"` (Chrome 156). Chrome for Testing 157, which has HTML-in-Canvas, is at `~/Library/Caches/reel-chrome/chrome/mac_arm-157.0.8103.78/…` (`bunx @puppeteer/browsers install chrome@157.0.8103.78 --path ~/Library/Caches/reel-chrome`). Rendering uses Metal through ANGLE (`--use-angle=metal`).
- **Dev server.** Every rendering command (or its warm renderer) uses a Vite of its own on a free port, without live reload, so a render never talks to another project's server and a file saved mid-render does not reload the page. `reel dev` is the one with live reload.
- **Warm renderer.** `info`, `still`, `sheet`, `strip`, `check`, `diff --t`, `events`, `perf` and `gpu` run in a background process per project (`cli/daemon.ts`) that keeps Vite, Chrome and pages open: a warm still takes about 0.15 s. Before every request it stats the project's files (not a file watcher, which can deliver an edit after the request that follows it) and reloads its pages, and Vite's modules for the changed files, when any changed. Its state, token and log are in `$TMPDIR/reel-daemons/` (`reel daemon status` prints the log path). A request is plain data with absolute paths (`cli/ops.ts`), so ops work the same in it and with `--no-daemon`. It is replaced when the engine's code (`src/`, `cli/`, `index.html`, `package.json`) or `CHROME_PATH` changes, so after editing the engine the next command pays a cold start. Debug the page path with `--no-daemon`; stop stragglers with `reel daemon stop --all`.
- **MCP.** `reel mcp` (`cli/mcp.ts`) maps tools onto the same requests as the CLI (`reqOf` checks arguments with the CLI's flag rules) and sends them to the warm renderer; video jobs run `reel video --json --progress` as child processes. Nothing may write to stdout in that process except the MCP transport.
- **Stills** are named after the clips on screen and the time (`out/stills/hello_2.500s.png`), and a name that is taken gets `-2`, `-3`: stills never overwrite each other. `--out <file.png>` writes exactly that file.
- **Exit codes.** 0: done and no scene reported an error. 1: something failed (a scene's `init()` or `render()` threw, a shader did not compile, ffmpeg, the page). 2: bad command line or no project. `--json` puts the same in `{ ok, errors, logs }`. A scene that throws in `render()` shows as a dark red frame.
- **Flags are strict.** An unknown flag is an error; `reel --help` is the list.
- **Preview.** `reel dev --project <p>`, then the URL it prints (5173 when free, else the next free port), with `?t=<seconds>`. Space plays, arrow keys seek, `,`/`.` step a frame, `[`/`]` jump clips, `l` loops the clip, `h` hides the UI. A missing track still plays silently: the clock runs on `performance.now()`.
- **`--only a,b`** loads only those clips: faster, and isolates you from another scene's errors. Clips that are not loaded draw nothing.
- **Stateful scenes** (`stateful = true`) are exported by one worker in order, whatever `--workers` says, and refuse `--samples auto`.
- **Partial renders and the mix.** `reel mix --from <s>` must match the render's `--from`, or cues and music land in the wrong place.
- **analyze.py** copies the song into the project's `audio/` under a URL-safe name (the preview fetches it by URL). Its drum and vocal measurements come from a harmonic/percussive split and band filters of the mix, not separated stems: kick, snare and hat are reliable on produced music, `bass`, `vocal` and vocal onsets are rough. `--onset-delta` tunes the peak-picking per drum band.
- **Frame size.** `size` wants a width that is a multiple of 4 and an even height (the packed readback and yuv420). A scene written for one aspect does not reflow by itself: lay out from `W` and `H`, not from 1920 and 1080.
- **Disk.** A project's `out/` fills fast (a 4K render is gigabytes), and the video command spools up to `--spool-gb` (default 20) of frames to the system temp folder while x264 catches up.
- Bun 1.4, TypeScript 7 (`tsc` comes from the `typescript` peer dependency), three.js 0.186, Vite 8 (started from the CLI through its API; there is no `vite.config.ts`). Python tools pin their dependencies inline (PEP 723); `uv run` fetches them on first use.

## Git

Every change is committed straight to `main`, one logical change per commit: no branches, no PRs. Conventional Commits (`feat(analyze): …`, `fix(mix): …`, `docs: …`), title only: no body and no trailers. A change large enough to want review gets a fresh-context review of the diff before it is committed. Keep `README.md`, `docs/ENGINE.md`, the skills, `reel --help` (`cli/args.ts`) and this file current in the same commit as the behaviour they describe.

If a gitignored `plan.md` exists in the root, read it before starting work: it holds the agreed direction and what is in progress. Nothing committed refers to it.
