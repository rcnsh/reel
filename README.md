# reel

A deterministic WebGL video engine. Every frame is computed from the time `t` alone, by scenes written in TypeScript and three.js, so the same code drives a live preview in the browser and an offline export (headless Chrome piped into ffmpeg) at any frame size and frame rate, up to 4K, with adaptive motion blur. The edit follows a narration: a voice recording is word-timed with Whisper, and each narration plate gets its own scene.

## Licence

The engine is adapted from [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video), MIT licence, copyright 2026 Giacomo Magnanini: see `LICENSE`, which applies to the engine code and must stay with it.

Fonts in `public/fonts/`:

- Archivo, Cormorant Garamond and IBM Plex Mono are under the SIL Open Font License; the licence text for each is in `OFL-*.txt`.
- The single-stroke SVG fonts in `stroke/` (EMS under the OFL, plus the Hershey fonts) carry their own licence and attribution in each file's header.

A project's own fonts live in its `fonts/` folder with their licences: `reel font add "<family>"` downloads a Google Fonts family from the google/fonts repository with its licence file (`OFL.txt`, `LICENSE.txt` or `UFL.txt`) beside the font files.

## How a video is made

A video is a project: a folder with a `reel.config.ts`, a `scenes/` folder and whatever audio and data it uses. The config sets the frame size, frame rate and theme and returns the timeline, a list of clips: each names a scene module, a time window and a track. Tracks stack, so a caption or a title can sit over whatever runs below; clips that overlap on one track make a transition (a crossfade, or the incoming clip's `transition`: `wipe`, `slide`, `zoom`, `dip`).

```ts
import { defineVideo } from 'reel/config';

export default defineVideo({
  size: [1080, 1920],
  fps: 30,
  theme: 'film',
  timeline: () => [
    { id: 'wash', scene: () => import('./scenes/wash'), start: 0, end: 6 },
    { id: 'title', scene: () => import('./scenes/title'), start: 0.5, end: 5.5, track: 1 },
  ],
});
```

Scenes put text and layout on screen with HTML and CSS: an `HtmlLayer` renders markup into a texture at the output resolution (through Chrome's HTML-in-Canvas), with the theme's colours as CSS variables, the engine's and the project's fonts by family name (any font file in a project's `fonts/` folder; `reel font add "Space Grotesk"` fetches a Google Fonts family there), CSS animations played on the clip's clock, and every text element reported to `reel check`. Its content changes once per output frame; where it is drawn is evaluated per motion-blur sub-frame, so it moves with motion blur. Shaders, three.js and Canvas2D do the rest.

On top of that sits a component kit, also imported from `reel`: `TextBlock` (wraps, aligns, shrinks to fit its box), `TitleCard`, `LowerThird`, `Captions` (pages of timed words, the word being said highlighted, inside the safe area), `ImageBox` (cover or contain, rounded corners, a Ken Burns move, drawn in GL), `BarChart`, `LineChart` and `Counter` (driven by a progress value), `ProgressBar`, `Timer` and `CodeBlock` (syntax highlighted in the theme's colours, lines revealed and highlighted over time). Each takes a box, a window of its clip and an entrance and exit, lays itself out from the frame size, and reports to `reel check`. The `reel-authoring` skill's `reference/kit.md` has one example of each.

The theme is the look, and the engine itself has none: `print` (ink on paper, faint grain), `film` (a dark grade with bloom, halation, heavy grain and crop marks) or `neutral` (clean greys and one accent, the default), or a theme of your own. It supplies the palette scenes colour with (`bg`, `fg`, `accent` and its own named colours), the default post-processing, and optionally an overlay drawn over every clip. The `reel-authoring` skill has the details.

`reel init <folder>` starts one: a config, one scene built from the kit (a title card, or for `--narrated` a text block typed as it is spoken), a `CLAUDE.md`, the reel skills in `.claude/skills`, a `.gitignore`, and a `tsconfig.json` and `package.json` that point at this checkout, so the project needs no install and renders at once (`reel init short --size 1080x1920 --fps 30 --theme film`; `--narrated` adds a script, times it with a scratch voice and lays out one clip per plate). The project's `tsconfig.json` extends this repo's `tsconfig.project.json` by absolute path, which maps `reel`, `reel/config`, `reel/scenes/*` and three.js's types here; its `package.json` scripts run this checkout's CLI (`bun run reel still --t 1`) and typechecker (`bun run typecheck`). A project moved to another machine changes those paths to that machine's checkout.

`examples/layers` is that kind of project: silent, vertical, two tracks with a wipe between clips, a title card, the film theme. `examples/explainer` is a silent 16:9 explainer made from the kit: a title card, text beside an image, charts, a code block, a different transition into each clip, and captions, a progress bar and a timer on a track above. `examples/demo` is a narrated one in the print theme that passes `reel check` at 16:9 and vertical, made like this:

1. Write `narration.txt`: plates, each a `# name` header followed by its lines.
2. Voice and time it with `reel narrate`: Kokoro, a local model, by default (`--voice kokoro:bm_george`), macOS `say` for an instant scratch track, or a hosted voice (`--voice elevenlabs:<voice-id>`, `fish:<voice-id>`) when its API key is in the environment. Each plate is voiced once and cached, so re-running after editing one line voices only that plate. It writes `audio/narration.flac` (lossless), `data/words.json` (every word with its time) and `data/audio.json` (one section per plate). A real recording replaces it later with `reel align <recording>`, which writes the same files.
3. Write a scene per plate, `scenes/<plate>.ts`. The config's `clipsFromSections` shows each plate with the scene of the same name and skips plates without one. Find words by their text (`ctx.words.get('…')`), never by hard-coded times, so re-timing the voice moves everything with it.
4. Preview, check stills, render, mix.

### Cutting to music

`reel analyze <song>` analyses a song into `data/audio.json`: beats and downbeats from Beat This! (a constant-tempo grid fitted through them where the song keeps one tempo, the tracked beats where it does not), 100 fps loudness envelopes of the mix's bands and of drums, bass, other and vocal stems separated by Demucs (through demucs-mlx on Apple Silicon), kick, snare and hat onsets from the drum stem, vocal onsets from the vocal stem, and sections. The models (about 250 MB) are fetched on its first run; `--fast` skips them for a draft (librosa beats, harmonic/percussive proxies for the stems). That is what the engine's music helpers read (`f.beat`, `f.bar`, `f.a.kick`, `audio.env`, `audio.hit`, `audio.beatBefore`, `audio.nearestDownbeat`), so scenes can pulse on the kick and cuts can land on the beat. Sections come from `--sections sections.json` (`[{"name": "intro", "bar": 0}, …]`, named after your scenes), or structural segmentation (`part1`, `part2`, …). The song becomes the track the preview plays and the export muxes. For a narrated video with a music bed, `--keep-sections --offset <s>` keeps the narration's timing and adds the bed's beats from where it starts. Run `reel analyze --help` for the flags.

Words for a sung track come from `reel align <vocal> --method whisper` (Whisper's word times matched to the lyrics), which suits clear vocals; the default forced aligner is made for speech.

## For agents: the MCP server

`reel mcp` is a local stdio MCP server over the same warm renderer, for rendering and inspection (an agent authors a video by editing its files): `project_info`, `render_still`, `contact_sheet`, `motion_strip`, `check_video`, `diff_images`, `video_start` / `video_status` / `video_cancel`, and the project tools `narrate`, `align_recording`, `analyze_song` and `mix_audio`. Every tool takes the `project` folder. Image tools return MCP image blocks, at most 1280 px on the long side unless `full_size` is set and a few per call, plus the paths of the full-size files on disk.

Register it with Claude Code (after `reel chrome install`; pass `CHROME_PATH` only to render with another Chrome 157+):

```sh
claude mcp add reel -- bun <path to reel>/cli/reel.ts mcp
```

or, for a client configured with JSON:

```json
{
  "mcpServers": {
    "reel": {
      "command": "bun",
      "args": ["<path to reel>/cli/reel.ts", "mcp"]
    }
  }
}
```

`tests/mcp.test.ts` drives it with the official MCP client over stdio.

## Layout

- `src/engine/`: the engine: renderer, adaptive sampling, tracks and transitions (`engine.ts`), GL helpers (`gl.ts`), post-processing (`post.ts`), type and single-stroke fonts, GPU lines, the spark (`spark.ts`), the palette from the theme (`palette.ts`), shared GLSL. `src/index.ts` is what scenes import as `reel`; `src/config.ts` is `reel/config`.
- `src/engine/html.ts`: HTML layers (the per-frame prepare, upload, draw and what they report). `src/kit/`: the component kit (`common.ts` has the box, window and motion every component shares). `src/check.ts`: what `reel check` samples, measures and finds (pure functions, shared by the page and the CLI); `src/engine/report.ts`: the boxes scenes report.
- `src/themes.ts`: the themes (`print`, `film`, `neutral`), `extendTheme` and the checks a theme goes through. `src/scenes/`: scenes any project can place, imported as `reel/scenes/<name>`: `hud` (crop marks and captions).
- `src/main.ts`, `index.html`: the page a project runs in: the preview player and the export API (`window.__reel`).
- `cli/reel.ts`: the `reel` command; `cli/args.ts` its flags and help. `cli/renderer.ts`: a project's dev server, Chrome and pages; `cli/chrome.ts`: which Chrome renders (the pinned build, `reel chrome install`); `cli/daemon.ts`: the warm renderer that keeps one per project; `cli/ops.ts`: what a command asks a page to do; `cli/video.ts`: the video export; `cli/diff.ts` and `cli/png.ts`: image comparison; `cli/mcp.ts`: the MCP server. `cli/server.ts`: the dev server that maps a project into the page. `cli/init.ts`: `reel init`. `tsconfig.project.json` and `project.d.ts`: what a project's `tsconfig.json` extends.
- `tools/`: `narrate.ts` (script to voice and word times; `voices/` holds one file per voice source: `say`, `kokoro` + `kokoro.py`, `elevenlabs`, `fish`; `settings.ts` the narration settings and cache keys), `align.ts` (time a recording), shared by both: `script.ts` (the plate parser and timing data), `narration-files.ts` (the track and data files), `aligner.ts` + `forced_align.py` (Qwen3-ForcedAligner on MLX), `align-words.ts` (matching timed tokens to the script, snapping edges to pauses), `audio-io.ts` and `loudness.ts`; `whisper_words.py` (`align --method whisper`), `analyze.py` (time a song), `mix.ts` + `mix-graph.ts` (music and cue sounds under a render, configured by the project's `mix.json`), `make_fonts.py` (static font instances from the variable sources in `public/fonts/src/`).
- `examples/`: projects. Each has `reel.config.ts` and `scenes/`; a narrated one also `narration.txt`, `mix.json`, `audio/` and `data/` (written by the tools). Renders go to its `out/` (ignored by git).
- `skills/`: agent skills (Agent Skills format) that `reel init` copies into a project's `.claude/skills` and `reel skills update` refreshes: `reel-authoring` (the config, the Scene API, determinism and sampling rules, themes, the toolbox, timing; reference files beside it) and `reel-review-loop` (render, look, check, fix; when to export).
- `tests/`: `bun test`: unit tests of the pure modules, and tests that render through Chrome: golden frames of the examples (`tests/golden/`, rewritten by `reel golden update`) the CLI end to end, and the MCP client.
- `docs/ENGINE.md`: the engine's internals, for changing it: the page, a frame's pipeline, adaptive sampling, readback and export, reporting.

## Running

You need [bun](https://bun.sh), ffmpeg and Chrome 157 or later for headless rendering (HTML layers need its HTML-in-Canvas). `reel chrome install` downloads the Chrome for Testing build reel is pinned to into a cache folder of its own (`~/Library/Caches/reel-chrome` on macOS, `~/.cache/reel-chrome` elsewhere, or `REEL_CHROME_CACHE`), and renders use it whenever `CHROME_PATH` is unset; `CHROME_PATH` names another binary. The installed Google Chrome is never used by default: it updates itself, and a render should not change with it. A Chrome that is missing or too old is an error that says what to run. The Python tools (Kokoro, the forced aligner, `analyze`, `make_fonts.py`) need [uv](https://docs.astral.sh/uv/), which fetches their dependencies on first use; Kokoro and the aligner run through MLX on Apple Silicon and fetch their models (about 350 MB and 1.2 GB) into the Hugging Face cache the first time.

```sh
bun install
alias reel="bun $PWD/cli/reel.ts"
reel chrome install                            # the pinned Chrome for Testing, once
reel init ~/videos/first                       # a new project, ready to render
cd examples/demo                               # or pass --project <folder> to any command

reel dev                                       # preview at the URL it prints (space plays, [ ] jump clips)
reel info                                      # format, duration, clips
reel still --t 2.5,6                           # out/stills/hello_2.500s.png …, never overwritten
reel strip --from 1 --to 2 --n 8                # frames side by side: motion and easing in one image
reel diff --t 2.5 out/stills/hello_2.500s.png   # changed pixels, the box around them, a diff image
reel check                                     # findings with crops; exits 1 on an error
reel video --samples auto --shutter 0.2 --out out/raw.mp4
reel events                                    # data/cues.json for the mix
reel mix out/raw.mp4 out/final.mp4
```

`reel check` sweeps the video in one browser session (every half second, denser around each clip's start and end, always its first and last frame) and prints findings, each with a kind, a severity, the time span, the clip, a rectangle, a message that says how to fix it and a cropped image in `out/check/`: blank and frozen frames, scene and shader errors, and from the boxes scenes report drawing (`reportText(ctx2d, text, x, y)` after a `fillText`, `report({ kind, x, y, w, h, … })` for anything else) text that runs off the frame, sits in the safe margin, overlaps other text, is too small, has too little contrast with the pixels actually behind it, or (in an HTML layer, which reports its text by itself) overflows its box or is cut off by `overflow: hidden`. It exits 1 when a finding is an error, so `reel check --size 1080x1920` tells you whether a layout survives a vertical frame. A box or a clip that breaks a rule on purpose says so (`exempt: ['offFrame']` on the box, `check: { exempt: ['blank'] }` on the clip).

Commands that look at a project (`info`, `still`, `sheet`, `strip`, `check`, `diff --t`, `events`, `perf`, `gpu`) go through a warm renderer: the first one starts a background process for the project that keeps its dev server, a headless Chrome and its pages open, so the next still takes about 0.15 s instead of a second or more. It reloads its pages when the project's files change, restarts its dev server when the config's size, frame rate or theme change, is replaced when the engine's code changes, replaces a page or a browser that crashed, and stops after 15 idle minutes (`REEL_DAEMON_IDLE` seconds). `reel daemon status` lists them, `reel daemon stop [--all]` stops them, and `--no-daemon` (or `REEL_NO_DAEMON=1`) renders in a browser of the command's own. `reel video` always runs its own browsers.

`--only a,b` loads only those clips, `--theme film` tries another built-in theme, `--scale 2` renders 4K, `--from/--to` render part of the video, `--max-size 800` writes smaller images to look at, `--json` prints one JSON object. Unknown flags are errors, and a command exits 1 if any scene threw. `reel --help` lists every command and flag; `bun run typecheck` checks the engine, the CLI, the examples and the tests; `bun test` runs the tests (the rendering ones need Chrome and skip without it).
