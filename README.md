# reel

A deterministic WebGL video engine. Every frame is computed from the time `t` alone, by scenes written in TypeScript and three.js, so the same code drives a live preview in the browser and an offline 60 fps export (headless Chrome piped into ffmpeg) at 1080p or 4K, with adaptive motion blur. The edit follows a narration: a voice recording is word-timed with Whisper, and each narration plate gets its own scene.

## Licence

The engine is adapted from [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video), MIT licence, copyright 2026 Giacomo Magnanini: see `LICENSE`, which applies to the engine code and must stay with it.

Fonts in `public/fonts/`:

- Archivo, Cormorant Garamond and IBM Plex Mono are under the SIL Open Font License; the licence text for each is in `OFL-*.txt`.
- The single-stroke SVG fonts in `stroke/` (EMS under the OFL, plus the Hershey fonts) carry their own licence and attribution in each file's header.

## How a video is made

1. Write `narration.txt`: plates, each a `# name` header followed by its lines.
2. Time it. Either a scratch track from macOS `say` (`bun tools/narration.ts`), or a real recording aligned with Whisper (`bun tools/align.ts <recording>`). Both write `audio/narration.mp3`, `data/lyrics.json` (every word with its time) and `data/audio.json` (one section per plate).
3. Write a scene per plate, `src/scenes/<plate>.ts`. `src/timeline.ts` shows each plate with the scene of the same name and skips plates without one. Find words by their text (`ctx.lyrics.get('…')`), never by hard-coded times, so re-timing the voice moves everything with it.
4. Preview, check stills, render, mix.

The repo ships a two-plate demo (`hello`, `written`) built this way.

### Cutting to music

`uv run tools/analyze.py <song>` analyses a song into `data/audio.json`: a constant-tempo beat grid, downbeats, 100 fps loudness envelopes (mix bands plus harmonic/percussive proxies for drums, bass, other and vocal), kick, snare and hat onsets, and sections. That is what the engine's music helpers read (`f.beat`, `f.bar`, `f.a.kick`, `audio.env`, `audio.hit`, `audio.beatBefore`, `audio.nearestDownbeat`), so scenes can pulse on the kick and cuts can land on the beat. Sections come from `--sections sections.json` (`[{"name": "intro", "bar": 0}, …]`, named after your scenes), or structural segmentation (`part1`, `part2`, …). The song becomes the track the preview plays and the export muxes. For a narrated video with a music bed, `--keep-sections --offset <s>` keeps the narration's timing and adds the bed's beats from where it starts. Run `uv run tools/analyze.py --help` for the flags.

Lyrics for a sung track still go through `tools/align.ts` (Whisper word times), which suits clear vocals; it is not a forced aligner.

## Layout

- `src/engine/`: the engine: renderer, adaptive sampling and transitions (`engine.ts`), GL helpers (`gl.ts`), post-processing with `print` and `film` looks (`post.ts`), HUD, type and single-stroke fonts, GPU lines, the spark (`spark.ts`), palette, shared GLSL.
- `src/scenes/`: one scene per plate. `src/timeline.ts`: plates to scenes. `src/main.ts`: the preview player and the export API (`window.__reel`).
- `scripts/render.ts`: stills, contact sheets, plate thumbnails, sound cues, perf and the video.
- `tools/`: `narration.ts` (scratch track), `align.ts` + `whisper_words.py` (time a recording), `analyze.py` (time a song), `mix.ts` (music and cue sounds under a render, configured by `mix.json`), `make_fonts.py` (static font instances from the variable sources in `public/fonts/src/`).
- `audio/`, `data/`: the narration and its timing (written by the tools), music and sound files, `data/cues.json` (written by `render.ts events`).
- `docs/ENGINE.md`: the scene author's guide: the Scene API, rules for determinism and sampling, the toolbox, 4K.
- `out/`: renders (ignored by git).

## Running

You need [bun](https://bun.sh), ffmpeg and Chrome for headless rendering: `CHROME_PATH` names a Chromium build such as Playwright's Chrome for Testing, else the installed Google Chrome is used. The Python tools (`align.ts`'s Whisper step, `analyze.py`, `make_fonts.py`) need [uv](https://docs.astral.sh/uv/), which fetches their dependencies on first use.

```sh
bun install
export CHROME_PATH="<path to the Chrome for Testing binary>"   # optional

bun run dev                                    # preview at http://localhost:5173 (space plays, [ ] jump plates)
bun run typecheck

bun scripts/render.ts stills --t 2.5,6 --out out/stills
bun scripts/render.ts video --samples auto --shutter 0.2 --out out/raw.mp4
bun scripts/render.ts events                   # data/cues.json for the mix
bun tools/mix.ts out/raw.mp4 out/final.mp4
```

`--only a,b` loads only those plates, `--scale 2` renders 4K, `--from/--to` render part of the video. `scripts/render.ts` lists every mode and flag at the top.
