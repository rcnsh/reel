# reel

A deterministic WebGL video engine. Every frame is computed from the time `t` alone, by scenes written in TypeScript and three.js, so the same code drives a live preview in the browser and an offline export (headless Chrome piped into ffmpeg) at any frame size and frame rate, up to 4K, with adaptive motion blur. A video can follow a narration (voiced by a local model or force-aligned to a recording, every word timed, each plate shown by its own scene), be cut to an analysed song, or be silent.

## Licence

The engine is adapted from [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video), MIT licence, copyright 2026 Giacomo Magnanini: see `LICENSE`, which applies to the engine code and must stay with it.

Fonts in `public/fonts/`:

- Archivo, Cormorant Garamond and IBM Plex Mono are under the SIL Open Font License; the licence text for each is in `OFL-*.txt`.
- The single-stroke SVG fonts in `stroke/` (EMS under the OFL, plus the Hershey fonts) carry their own licence and attribution in each file's header.

A project's own fonts live in its `fonts/` folder with their licences: `reel font add "<family>"` downloads a Google Fonts family from the google/fonts repository with its licence file (`OFL.txt`, `LICENSE.txt` or `UFL.txt`) beside the font files.

## How a video is made

A video is a project: a folder with a `reel.config.ts`, a `scenes/` folder and whatever audio and data it uses. The config sets the frame size, frame rate and theme and returns the timeline, a list of clips: each names a scene module, a time window and a track. Tracks stack, so a caption or a title can sit over whatever runs below; clips that overlap on one track make a transition (a crossfade, or the incoming clip's `transition`: `wipe`, `slide`, `zoom`, `dip`). Each track can have a grade of its own (exposure, saturation, contrast, tint, fade, flash, blur), be cut by the track above or below as a matte (alpha or luma), and blend over the tracks below (`add`, `screen`, `multiply`, `overlay`, `soft-light`, `hard-light`, `difference`, `color-dodge`).

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

On top of that sits a component kit, also imported from `reel`: `TextBlock` (wraps, aligns, shrinks to fit its box), `TitleCard`, `LowerThird`, `Captions` (pages of timed words, the word being said highlighted, inside the safe area), `ImageBox` (cover or contain, rounded corners, a Ken Burns move, drawn in GL; colour profiles converted, 16-bit PNGs kept at 16 bits, SVG rasterised at the output scale), `VideoClip` (an MP4 decoded frame by frame with WebCodecs, the same frame at a time however it is reached: trim, speed, loop, blended frames, stacked alpha, its sound in the mix), `LottieBox` (a Lottie animation drawn at every sub-frame's moment), `BarChart`, `LineChart` and `Counter` (driven by a progress value), `ProgressBar`, `Timer` and `CodeBlock` (syntax highlighted in the theme's colours, lines revealed and highlighted over time). Each takes a box, a window of its clip and an entrance and exit, lays itself out from the frame size, and reports to `reel check`. The `reel-authoring` skill's `reference/kit.md` has one example of each.

3D is three.js through a `Stage3D`: a scene and camera rendered into a clip in linear HDR, glTF/GLB models (Draco, meshopt, KTX2) and HDR environments loaded before the first frame, studio, overhead and outdoor lighting rigs, shadows on a shadow-catching ground, camera rigs that are functions of time (orbit, dolly, crane, a smooth path, keyframed shots), glTF animation sampled at a time, instancing, and HTML on planes in the set. The motion-blur sampler's sub-frames double as jitter: an export with `--samples` gets anti-aliasing, depth of field from the camera moving over its lens, soft shadows from lights moving over their area, and motion blur of the camera and every object, while per-tile adaptive sampling keeps skipping converged tiles. `reel check` reports labelled objects off the frame, behind the camera or too small, text on planes, and a stage that sees nothing. The `reel-3d` skill has the details.

The theme is the look, and the engine itself has none: `print` (ink on paper, faint grain), `film` (a dark grade with bloom, halation, heavy grain and crop marks) or `neutral` (clean greys and one accent, the default), or a theme of your own. It supplies the palette scenes colour with (`bg`, `fg`, `accent` and its own named colours), the default post-processing, and optionally an overlay drawn over every clip. The `reel-authoring` skill has the details.

`reel init <folder>` starts one: a config, one scene built from the kit (a title card, or for `--narrated` a text block typed as it is spoken), a `CLAUDE.md`, the reel skills in `.claude/skills`, a `.gitignore`, and a `tsconfig.json` and `package.json` that point at this checkout, so the project needs no install and renders at once (`reel init short --size 1080x1920 --fps 30 --theme film`; `--narrated` adds a script, times it with a scratch voice and lays out one clip per plate). The project's `tsconfig.json` extends this repo's `tsconfig.project.json` by absolute path, which maps `reel`, `reel/config`, `reel/scenes/*` and three.js's types here; its `package.json` scripts run this checkout's CLI (`bun run reel still --t 1`) and typechecker (`bun run typecheck`). A project moved to another machine changes those paths to that machine's checkout.

`examples/layers` is that kind of project: silent, vertical, two tracks with a wipe between clips, a title card, the film theme. `examples/explainer` is a silent 16:9 explainer made from the kit: a title card, text beside an image, charts, a code block, a different transition into each clip, and captions, a progress bar and a timer on a track above. `examples/product3d` is a 3D product shot: a glTF bottle made in code with an animated cap, studio light and an HDR environment of its own, an orbit with an 85 mm lens and shallow depth of field, a label on a plane in the set and a kit title over it. `examples/media` is a vertical short made of media: a video clip with its own sound, dimmed behind an SVG mark, a Lottie badge and the clip again at half speed in an inset, with captions and a sound on the timeline. `examples/music` is a square music video cut to a synthetic song: `reel analyze` found its beats, stems and drum hits, its sections name the scenes, and the scenes pulse on the kick, flash on the snare and meter the stems. `examples/demo` is a narrated one in the print theme that passes `reel check` at 16:9 and vertical, made like this:

1. Write `narration.txt`: plates, each a `# name` header followed by its lines.
2. Voice and time it with `reel narrate`: Kokoro, a local model, by default (`--voice kokoro:bm_george`), macOS `say` for an instant scratch track, or a hosted voice (`--voice elevenlabs:<voice-id>`, `fish:<voice-id>`) when its API key is in the environment. Each plate is voiced once and cached, so re-running after editing one line voices only that plate. It writes `audio/narration.flac` (lossless), `data/words.json` (every word with its time) and `data/audio.json` (one section per plate). A real recording replaces it later with `reel align <recording>`, which writes the same files.
3. Write a scene per plate, `scenes/<plate>.ts`. The config's `clipsFromSections` shows each plate with the scene of the same name and skips plates without one. Find words by their text (`ctx.words.get('…')`), never by hard-coded times, so re-timing the voice moves everything with it.
4. Preview, check stills, then `reel video --samples auto --mix` for the finished file.

### Sound and subtitles

The audio stays lossless until the last step: the narration is FLAC, `reel analyze` copies the song as it is, and `reel mix <render.mp4> <out.mp4>` reads the project's track from that file (not from the render's AAC), lays the music beds and cue sounds of `mix.json` under it (music ducked while the track sounds), brings the sum to a loudness target in two passes (EBU R128: measure, then a linear gain under a true-peak ceiling; -14 LUFS integrated and -1 dBTP unless `mix.json` says `"loudness": { … }` or `false`) and encodes AAC once, copying the picture. Cue sounds are the project's files in `audio/`, or six that ship with the engine in `sounds/` (`tick`, `click`, `pop`, `whoosh`, `swell`, `impact`, synthesised by `tools/make_sounds.ts`, so they carry no licence): `"file": "whoosh"` in `mix.json`, and a cue kind named after one needs no entry at all. Sounds that belong to the edit go in the config's `sounds` (`[{ file: 'audio/rain.flac', at: 2, duration: 8, loop: true, db: -12 }]`, or a function of the sources for times from words), or a scene's `sound()`, and the mix lays them as placed. It works on a silent render too, and the same project mixes to the same bytes every time (the filters run on one thread with fixed frame sizes). `reel video --mix` renders and mixes in one command; `reel mix` stays for re-mixing without re-rendering. `reel subtitles` writes SRT and VTT from the timed words, and `reel video --subtitles` adds them to the finished file as a soft track.

### Outputs

`reel video` writes the format `--format` names, or the `--out` extension implies: `h264` (the default, `.mp4`, x264 at 4:2:0 8-bit, or `--chroma 444` and `--depth 10`), `hevc` (`.mp4`, x265 Main10), `prores` (`.mov`, ProRes 422 HQ, an editing master), `prores4444` (`.mov` with alpha), `webm` (VP9 with alpha), `gif` and `webp` (short loops: a palette made for the video, rate and size capped with `--max-fps` and `--max-size`), `png`, `png16` and `jpeg` sequences, and `exr` sequences of the linear HDR frame before tone mapping and post, for grading elsewhere. Every YUV stream is converted from full-range RGB to limited-range BT.709 explicitly and tagged so; 10-bit and 16-bit formats read the frame back at 16 bits per channel and dither at their own depth. Decoded back to RGB, colour bars and a grey ramp differ from the still by about half a level on average in 8-bit H.264 and a quarter of a level in 10-bit, without bias. 8-bit H.264 bands on dark gradients: x264 smooths away the frame's dither, leaving steps about 150 px wide on a slow ramp; `--depth 10` or `hevc` keep them at 25 to 35 px, often in a smaller file. Transparent formats (`prores4444`, `webm`, and `--alpha` for `webp`, `png`, `png16`, `exr`) leave the theme's background out and write straight alpha; `reel still --alpha` shows what they will. The mix and subtitles go into MP4 (AAC), MOV (24-bit PCM) and WebM (Opus, WebVTT). `reel video --help` lists each format's flags.

One export runs at a time on a machine: an export holds several Chromes, their GPU processes and the encoder, and a few 4K exports at once have frozen a 24 GB Mac. Each running export leaves a claim in the temp folder (`reel-exports/`) with its pid and that process's start time, and another `reel video` refuses while one is live unless given `--wait`, which queues it (a ticket in `reel-exports/queue/`; the oldest live ticket takes the slot when it frees, so exports run in the order they asked), or `--force`, which runs it beside; a claim whose process is gone, or whose pid now belongs to a process started at another time, is cleared.

`reel video --draft` is for looking, not delivering: half the size with the same layout (full size for a frame whose half would not pack into the readback: a width that is not a multiple of 8 or a height not of 4, as 1080x1350), one sample, and H.264 encoded inside the browser with WebCodecs (hardware where there is one), so only the encoded stream leaves the page; it writes `<name>.draft.mp4` with a comment tag saying it is a draft. On an M-series Mac a draft of the examples renders at 230 to 290 frames a second; at half size the raw pipe into x264 `ultrafast` or VideoToolbox (`REEL_DRAFT_ENCODER`) is as fast, since frames leave the page as 4:2:0, but WebCodecs keeps the raw frames off the WebSocket altogether.

### Cutting to music

`reel analyze <song>` analyses a song into `data/audio.json`: beats and downbeats from Beat This! (a constant-tempo grid fitted through them where the song keeps one tempo, the tracked beats where it does not), 100 fps loudness envelopes of the mix's bands and of drums, bass, other and vocal stems separated by Demucs (through demucs-mlx on Apple Silicon, PyTorch elsewhere), kick, snare and hat onsets from the drum stem, vocal onsets from the vocal stem, and sections. The models (about 250 MB) are fetched on its first run; `--fast` skips them for a draft (librosa beats, harmonic/percussive proxies for the stems). That is what the engine's music helpers read (`f.beat`, `f.bar`, `f.a.kick`, `audio.env`, `audio.hit`, `audio.beatBefore`, `audio.nearestDownbeat`), so scenes can pulse on the kick and cuts can land on the beat. Sections come from `--sections sections.json` (`[{"name": "intro", "bar": 0}, …]`, named after your scenes), or structural segmentation (`part1`, `part2`, …). The song becomes the track the preview plays and the export muxes. For a narrated video with a music bed, `--keep-sections --offset <s>` keeps the narration's timing and adds the bed's beats from where it starts. Run `reel analyze --help` for the flags.

Words for a sung track come from `reel align <vocal> --method whisper` (Whisper's word times matched to the lyrics), which suits clear vocals; the default forced aligner is made for speech.

### Generated assets

A project lists the pictures and sounds it needs made in `assets.json`: `{ "assets": [{ "id": "ridge", "kind": "image", "prompt": "…", "size": [1600, 900], "out": "assets/ridge.png" }, { "id": "riser", "kind": "sfx" | "music", "prompt": "…", "duration": 2, "out": "audio/riser.mp3" }] }`. `reel assets` generates the missing ones when the provider's key is set (images with OpenAI's image API, `OPENAI_API_KEY`; sound effects and music with ElevenLabs, `ELEVENLABS_API_KEY`; only the prompt and size or duration are sent), fits each to its size and format, and records what it made in `data/generated-assets.json` so an unchanged prompt is not generated again and a changed one is. Without a key it prints each missing asset's prompt, path and size, so a person can make the file elsewhere and drop it in, and exits 1 (`--json` gives the same list). A file it did not make is never replaced. Until an image exists, an `ImageBox` showing it draws a labelled placeholder of the declared size, and `reel check` reports every missing asset.

### Reviewing a render

Agents make the video; a person reviews it near the end. `reel review` starts a small local server (127.0.0.1 only, no browser of reel's own) and prints a URL. The page plays the project's newest render under `out/` (or the file named: `reel review out/cut.mp4`) with the browser's controls, frame stepping (`,` and `.`), and a timeline of the project's clips with a marker for every note. Pausing and pressing `n` starts a note at that frame: text, optionally an area dragged on the frame, and open or done; Enter saves it. Notes are listed beside the video, where a click seeks to one and they can be edited, resolved and deleted. A draft render carries a banner saying so. `--port` picks the port; Ctrl-C stops it.

Notes are saved at once to `review/notes.json` in the project, meant to be committed. Each has an id, the time and frame, the clips on screen, the text, the area in logical px, its status, the render it was made on (path and modification time) and when it was created and last changed. Every writer (the page, `reel notes`, the MCP tools) re-reads the file and changes only the notes it means to, by id, then replaces the file atomically, so an agent editing it at the same moment loses nothing; a file that is not valid notes is reported and left alone. The timeline comes from `out/review-timeline.json`, refreshed through the warm renderer when the config or its data changed.

The agent's side: `reel notes` lists them (`--open`, `--json`), each open one with its clips and the `reel still --t <time>` command that shows its moment; `reel notes done <id>` resolves one (`reopen` opens it again) and `reel notes add --t <s> "<text>"` adds one. Over MCP, `review_notes` and `resolve_note`.

## For agents: the MCP server

`reel mcp` is a local stdio MCP server over the same warm renderer, for rendering and inspection (an agent authors a video by editing its files): `project_info`, `render_still`, `contact_sheet`, `motion_strip`, `check_video`, `diff_images`, `video_start` / `video_status` / `video_cancel`, `review_notes` / `resolve_note`, and the project tools `narrate`, `align_recording`, `analyze_song`, `mix_audio`, `subtitles` and `assets` (`video_start` takes `mix` and `subtitles` for the finished file, and `wait` to queue for the machine's export slot instead of failing). Every tool takes the `project` folder. Image tools return MCP image blocks, at most 1280 px on the long side (`max_size` for smaller, `full_size` for none) and a few per call, plus the paths of the full-size files on disk.

Register it with Claude Code (after `reel chrome install`; pass `CHROME_PATH` only to render with another Chrome 157+):

```sh
claude mcp add --scope user reel -- bun <path to reel>/cli/reel.ts mcp
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

The tools take strict arguments (one a tool does not have is an error), and the server exits when its client goes away. [PLAYBOOK.md](PLAYBOOK.md) says how to brief an agent that makes a video with them: what a prompt must give (the video, the look, the ingredients, the deliverables, the limits, what done means), a template, and the kinds of job.

## Layout

- `src/engine/`: the engine: renderer, adaptive sampling, tracks and transitions (`engine.ts`), track grades, mattes and blend modes (`tracks.ts`), GL helpers (`gl.ts`), post-processing (`post.ts`), type and single-stroke fonts, GPU lines, the spark (`spark.ts`), the palette from the theme (`palette.ts`), shared GLSL. `src/index.ts` is what scenes import as `reel`; `src/config.ts` is `reel/config`.
- `src/engine/html.ts`: HTML layers (the per-frame prepare, upload, draw and what they report). `src/kit/`: the component kit (`common.ts` has the box, window and motion every component shares; `image.ts` the picture drawing that images, video and Lottie share, `video.ts` + `video-time.ts` the video clip, `lottie.ts` the Lottie box). `src/engine/png16.ts`: the 16-bit PNG decoder. `src/check.ts`: what `reel check` samples, measures and finds (pure functions, shared by the page and the CLI); `src/engine/report.ts`: the boxes scenes report.
- `src/three/`: the 3D kit (`stage.ts` the stage and its jitter, lighting rigs and check reports; `camera.ts` rigs; `load.ts` models, textures and environments; `animate.ts` glTF animation and instancing; `plane.ts` HTML on planes; `project.ts` and `jitter.ts` pure maths).
- `src/themes.ts`: the themes (`print`, `film`, `neutral`), `extendTheme` and the checks a theme goes through. `src/scenes/`: scenes any project can place, imported as `reel/scenes/<name>`: `hud` (crop marks and captions).
- `src/main.ts`, `index.html`: the page a project runs in: the preview player and the export API (`window.__reel`).
- `cli/reel.ts`: the `reel` command; `cli/args.ts` its flags and help. `cli/renderer.ts`: a project's dev server, Chrome and pages; `cli/chrome.ts`: which Chrome renders (the pinned build, `reel chrome install`); `cli/daemon.ts`: the warm renderer that keeps one per project; `cli/ops.ts`: what a command asks a page to do; `cli/video.ts`: the video export; `cli/formats.ts`: the output formats and their ffmpeg commands; `cli/diff.ts` and `cli/png.ts`: image comparison; `cli/mcp.ts`: the MCP server. `cli/review.ts` + `cli/review.html`: `reel review`, the server and its page; `cli/notes.ts`: the review notes in `review/notes.json`. `cli/server.ts`: the dev server that maps a project into the page. `cli/init.ts`: `reel init`. `tsconfig.project.json` and `project.d.ts`: what a project's `tsconfig.json` extends.
- `tools/`: `narrate.ts` (script to voice and word times; `voices/` holds one file per voice source: `say`, `kokoro` + `kokoro_tts.py` (named apart from the `kokoro` package it imports), `elevenlabs`, `fish`; `settings.ts` the narration settings and cache keys), `align.ts` (time a recording), shared by both: `script.ts` (the plate parser and timing data), `narration-files.ts` (the track and data files), `aligner.ts` + `forced_align.py` (Qwen3-ForcedAligner, MLX on Apple Silicon, PyTorch elsewhere), `align-words.ts` (matching timed tokens to the script, snapping edges to pauses), `audio-io.ts` and `loudness.ts`; `whisper_words.py` (`align --method whisper`), `analyze.py` (time a song), `mix.ts` + `mix-graph.ts` (the finished sound under a render, configured by the project's `mix.json`), `subtitles.ts` (SRT and VTT), `assets.ts` + `asset-manifest.ts` + `providers/` (generated assets: one file per provider), `make_sounds.ts` (the bundled cue sounds in `sounds/`), `synth_song.py` (songs with known beats), `make_fonts.py` (static font instances from the variable sources in `public/fonts/src/`).
- `examples/`: projects. Each has `reel.config.ts` and `scenes/`; a narrated one also `narration.txt`, `mix.json`, `audio/` and `data/` (written by the tools). Renders go to its `out/` (ignored by git).
- `skills/`: agent skills (Agent Skills format) that `reel init` copies into a project's `.claude/skills` and `reel skills update` refreshes: `reel-authoring` (the config, the Scene API, determinism and sampling rules, themes, the toolbox, timing; reference files beside it), `reel-review-loop` (render, look, check, fix; when to export) and `reel-audio` (narration, alignment, music analysis, the mix, subtitles, generated assets) and `reel-3d` (stages, models, light, cameras, depth of field, animation).
- `tests/`: `bun test`: unit tests of the pure modules, and tests that render through Chrome: golden frames of the examples (`tests/golden/<platform>/`, a set for macOS and one for Linux, rewritten by `reel golden update` on that system), the CLI end to end, and the MCP client.
- `docs/ENGINE.md`: the engine's internals, for changing it: the page, a frame's pipeline, adaptive sampling, readback and export, reporting.

## Running

You need [bun](https://bun.sh), ffmpeg and Chrome 157 or later for headless rendering (HTML layers need its HTML-in-Canvas). `reel chrome install` downloads the Chrome for Testing build reel is pinned to into a cache folder of its own (`~/Library/Caches/reel-chrome` on macOS, `~/.cache/reel-chrome` elsewhere, or `REEL_CHROME_CACHE`), and renders use it whenever `CHROME_PATH` is unset; `CHROME_PATH` names another binary. The installed Google Chrome is never used by default: it updates itself, and a render should not change with it. A Chrome that is missing or too old is an error that says what to run, and so is one that cannot start on Linux for want of system libraries (it names them and the Debian packages that hold them). The Python tools (Kokoro, the forced aligner, `analyze`, `make_fonts.py`) need [uv](https://docs.astral.sh/uv/), which fetches their dependencies on first use; Kokoro, the aligner and Demucs run through MLX on Apple Silicon and through PyTorch elsewhere (CPU wheels on Linux), and fetch their models (about 350 MB, 1.2 GB and 80 MB) the first time.

On Linux reel renders headless with no display and no GPU. WebGL goes through SwiftShader, Chrome's software renderer, unless a GPU render node (`/dev/dri/renderD*`) is there, when it uses EGL; `--gl` (or `REEL_GL`) picks one, and `reel gpu` and every `--json` result say which. Software rendering is slow but complete, and it slows further on a shared host. On a four-core x86-64 VM whose hypervisor was taking back 70% of the CPU, a 1080p frame took 1.6 s for the explainer and 2.4 s for the 3D product shot (`reel perf`; about a third of that with the cores to itself), a `reel check` of an example half a minute to two and a half minutes, a `--draft` 1.3 frames a second, and a `--samples auto` export 4 s a frame where little moves, 15 to 30 s where motion blur needs 36 to 108 sub-frames, and 200 s for the 3D shot's 324. Keep work there to stills, checks and short drafts (`--draft`, `--from/--to`), and render finals where there is a GPU. Text never depends on the system: the engine's fonts and a project's `fonts/` are served with the page, and renders on a machine with no system fonts at all match those with them. Chrome needs the usual shared libraries (`reel chrome install` and a failed launch name any that are missing). Frames match the Mac's in layout, type and colour; text edges and decoded video clips differ (in the golden frames, under a level on average, up to about 45 levels at text edges, and more than 3 levels in up to a quarter of a video clip's pixels), more than the golden frames' tolerance, which is why they have a set per system. The `say` voice is macOS only: Kokoro is the default everywhere.

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
reel review                                    # a page to watch the newest render and leave notes
reel notes --open                              # the notes left there, each with its reel still command
reel video --samples auto --mix --out out/final.mp4   # render, then the mix at -14 LUFS
reel events                                    # data/cues.json, for re-mixing a render:
reel mix out/raw.mp4 out/final.mp4
```

`reel check` sweeps the video in one browser session (every half second, denser around each clip's start and end, always its first and last frame) and prints findings, each with a kind, a severity, the time span, the clip, a rectangle, a message that says how to fix it and a cropped image in `out/check/`: blank and frozen frames, scene and shader errors, and from the boxes scenes report drawing (`reportText(ctx2d, text, x, y)` after a `fillText`, `report({ kind, x, y, w, h, … })` for anything else) text that runs off the frame, sits in the safe margin, overlaps other text, is too small, has too little contrast with the pixels actually behind it, or (in an HTML layer, which reports its text by itself) overflows its box or is cut off by `overflow: hidden`. It exits 1 when a finding is an error, so `reel check --size 1080x1920` tells you whether a layout survives a vertical frame. A clip that draws text with `fillText` or `strokeText` but reports none is a warning (`unreported`), since everything above is blind to that text. A box or a clip that breaks a rule on purpose says so (`exempt: ['offFrame']` on the box, `check: { exempt: ['blank'] }` on the clip).

Commands that look at a project (`info`, `still`, `sheet`, `strip`, `check`, `diff --t`, `events`, `perf`, `gpu`) go through a warm renderer: the first one starts a background process for the project that keeps its dev server, a headless Chrome and its pages open, so the next still takes about 0.15 s instead of a second or more. It reloads its pages when the project's files change, or a module its scenes import from outside the project (a monorepo's sources; Vite's module graph names them), restarts its dev server when the config's size, frame rate or theme change, is replaced when the engine's code changes, replaces a page or a browser that crashed, and stops after 15 idle minutes (`REEL_DAEMON_IDLE` seconds). `reel daemon status` lists them, `reel daemon stop [--all]` stops them, and `--no-daemon` (or `REEL_NO_DAEMON=1`) renders in a browser of the command's own. `reel video` always runs its own browsers.

`--only a,b` loads only those clips, `--theme film` tries another built-in theme, `--scale 2` renders 4K, `--from/--to` render part of the video, `--max-size 800` writes smaller images to look at, `--json` prints one JSON object. Unknown flags are errors, and a command exits 1 if any scene threw. `reel --help` lists every command and flag; `bun run typecheck` checks the engine, the CLI, the examples and the tests; `bun test` runs the tests (the rendering ones need Chrome and skip without it).
