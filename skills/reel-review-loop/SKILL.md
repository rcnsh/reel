---
name: reel-review-loop
description: The render-look-fix loop for reel videos - render stills, motion strips and contact sheets, run reel check, read the images, fix and re-render until the video is right; then export. Use after writing or changing a reel scene or config, when asked to review, verify or polish a reel video, to work through the notes a person left with reel review, or before reporting reel work as done.
---

# Reviewing a reel video

A reel video is code, so the only proof a change worked is a rendered frame you have looked at. Typechecking proves nothing about layout, timing or colour. The loop is: render a little, look, fix, repeat; widen to the whole video; export last.

Commands are `reel <command>` (in a project made by `reel init`: `bun run reel <command>`; elsewhere `bun <engine>/cli/reel.ts`). Each has `--project <folder>` and `--json`, and exits 1 on a scene error. The same tools exist over MCP (`render_still`, `motion_strip`, `contact_sheet`, `check_video`, `diff_images`, `video_start`, `review_notes`, `resolve_note`) and return the images inline.

## The loop

1. **Know the timeline.** `reel info`: size, fps, duration, every clip's id, start, end and track. Times for everything below come from here.
2. **Typecheck** (`bun run typecheck`). A type error found by a render costs more.
3. **Stills of the clip you touched**: its first frame, its middle, its last frame, and the moments its animation changes (`reel still --t 4.20,6,9.98 --only title`). `--only` loads just that clip: faster, and errors elsewhere cannot hide yours. Then read every PNG with your image-reading tool. A still you have not looked at has not been checked.
4. **Motion**: `reel strip --from 4.2 --to 5.2 --n 8 --only title` lays eight frames side by side; `--frames 6` gives consecutive frames. Read it for the motion's direction, spacing (is the easing what you meant: fast in, slow out?), overshoot, and whether anything pops, jumps or flickers between neighbours.
5. **`reel check`**: sweeps the whole video (denser at clip starts and ends) and prints findings, each with a crop image in `out/check/`. Read the crops of the errors and warnings, fix, run it again. It exits 1 while any finding is an error.
6. **Other formats**: `reel check --size 1080x1920` (and `1080x1080`) when the video may be cut vertical or square; text laid out for 16:9 runs off a vertical frame.
7. **Cuts and the whole**: `reel sheet --cuts` (four frames around every cut) for transitions; `reel sheet --n 24` for an overview of pacing and consistency.
8. **Export** (below) once stills, strips and check are clean.

Repeat 3 to 5 after every edit. The warm renderer reloads changed files by itself (the project's, and any module its scenes import from outside it), so a still takes a fraction of a second; there is no server to restart.

## What to look for in a frame

- **Layout**: text inside the frame and its safe margin, nothing clipped, nothing colliding, alignment consistent between clips, a clear hierarchy (one thing to read first). Layout derived from `W` and `H`, not from 1920 by 1080.
- **Type**: sizes readable on a phone (24 px at 1080 is the floor), kerning even, typographic quotes and dashes, no widows of one short word, line breaks where a reader pauses.
- **Colour and contrast**: text clearly separated from what is behind it, in the theme's palette. Faint text in a held frame is a bug, not a style, unless it is fading.
- **The first and last frame of each clip**: elements fully in (or deliberately out), nothing half-drawn at a cut, no one-frame flash of a default state. Fade-ins that start late leave a blank first frame.
- **Timing against words** (narrated videos): the line or object appears as the word is said. `reel still` at the word's time from `data/words.json` and a few frames either side.
- **Rendering faults**: black or dark-red frames (a scene threw: the command lists the error), banding in gradients, aliased hairlines, flicker between consecutive frames (state, or `Math.floor(t * FPS)` instead of `frameIdx`), moiré in fine patterns.
- **4K** (if delivering it): `reel still --scale 2` of the finest details: hairlines must keep their weight and text its sharpness.

## Reading `reel check`

Each finding has a `kind`, a `severity`, the time span it was seen (`t` to `until`, over `frames` sampled frames), the `clip`, a `rect` in logical px, a `message` that says how to fix it, and an `image` (a crop of the worst frame, the box outlined in magenta).

- `sceneError` (error): a scene threw or a shader failed to compile; the message names the clip and the source line. Fix first: everything else in that clip is suspect.
- `offFrame` (error for text partly outside; info for things wholly outside or for images and shapes): size text from `W` with `fitSize`, or break it into lines.
- `contrast` (error under 3:1, warning under 4.5:1 for body text): measured on the rendered pixels behind the text, after post. The message suggests a palette colour that reads; or change what is behind the text.
- `safeArea`, `overlap`, `minSize` (warnings): fix unless the design means it.
- `overflow` (error) and `clipped` (warning; a note when it is an ellipsis or line clamp): text in an HTML layer that runs out of its box, or is cut off by `overflow: hidden` or the edge of its layer (a component's box). Let it wrap, make it smaller (a `TextBlock` fits text to its box), or give it room.
- `blank` (a flat frame) and `frozen` (nothing moved for seconds) (warnings): a scene drawing nothing, a fade held too long, a still held without intent.
- `nondeterministic` (error): a time rendered a second time, out of order, came out different: `Math.random()`, `Date.now()` or `performance.now()` in drawing (the message names any the clip called), or state that changes from one `render()` call to the next. Preview, stills and export will disagree; fix it before anything else.
- `timeline` (warning): a clip's `transition` overlaps no clip before it on its track, so it cuts; start it before the previous clip ends, by the transition's length (or drop the `transition`).
- 3D (the `reel-3d` skill): `empty` (warning: a stage whose camera sees none of its objects), `tiny` (a note: a labelled object too small to make out), and `offFrame` notes for labelled objects off the frame or behind the camera.
- Check sees text in HTML layers by itself, and text scenes draw themselves only when they report it: after every `fillText`, `reportText(c, text, x, y)`; after `drawStrokeText`, `reportStrokeText(c, st, len, text)`; for other drawn text, `report({ … })`. Report the box of what is drawn at that moment: a `contrast` error saying text "cannot be seen" while it plainly can means the reported box is far larger than the ink (a whole line's box while it is half written). A scene that draws text with `fillText` or `strokeText` and reports none gets an `unreported` warning; text drawn as paths or glyph textures it cannot see at all. If check is silent about text you can see, add the reports.
- When a rule is broken on purpose, mark it in the scene (`exempt: ['offFrame']` on the box, `data-exempt="offFrame"` on an HTML element) or on the clip (`check: { exempt: ['blank'] }`) rather than ignoring the finding, so the next check is clean.

`--step 0.25` samples more densely; `--from/--to` checks a range; `--only title` checks just that clip's frames (the clips not loaded draw nothing, so they are not judged); `--safe`, `--min-text`, `--frozen` change the thresholds.

## Comparing

`reel diff --t 6 out/stills/title_6.000s.png` renders t now and compares it with an earlier still: changed pixels, max and mean difference, the box around the change, and a diff image. Use it to confirm a refactor changed nothing (expect `identical`) or that a fix touched only what it should. Grain changes from frame to frame, so compare the same time; `--tol 8` ignores grain-level noise. `reel diff a.png b.png` compares any two images.

## When to render video

Stills and strips settle layout and most motion. Render video when you need to judge rhythm and timing against the audio, motion blur, or the final pass:

- **Draft** (`reel video --draft`, add `--from 20 --to 26` for a stretch): half size with the same layout (full size when the frame's width is not a multiple of 8 or its height not of 4), one sample (no motion blur), H.264 encoded inside the browser, so a minute of video takes seconds. Use it to judge pacing, rhythm against the sound, cuts and motion while iterating, and to show the person you work with a rough cut. It is written as `out/video.draft.mp4` and tagged a draft: never hand one over as the result, and never judge sharpness, banding, motion blur or fine type from it.
- **Final** (`--samples auto`, at full size; `--scale 2` for 4K): once stills, strips and check are clean and a draft has settled the timing. Adaptive motion blur, the full encoder; slower. Stateful scenes need a fixed `--samples 8`.
- **Format**: `--format` or the `--out` extension: `h264` for most delivery, `hevc` or `--depth 10` where a dark gradient or a slow fade bands (8-bit H.264 smooths away the frame's dither, so steps show in dark areas; 10-bit files hold them and are often smaller), `prores` for an editor, `prores4444` or `webm` for an overlay with transparency (check it with `reel still --alpha`), `gif`/`webp` for a short loop, `png`/`exr` frames for grading or compositing elsewhere. `reel video --help` lists them. Film grain (the `film` theme, or `grain` in a theme's post) is noise the encoder must keep: an H.264 file at the default quality grows many times over (a 70 s 4K master near 1 GB where HEVC 10-bit makes 40 MB), so deliver grainy 4K as `hevc`, or raise `--crf`. Formats that carry sound get the project's track: add `--noaudio` for an overlay asset such as a `prores4444` title card. A project that always exports one way says so in its config, `export: { crf: 22, noaudio: true }` (also `preset`, `samples`), and every `reel video` and `video_start` uses that unless a flag says otherwise (`--audio`, or `noaudio: false`, keeps the sound). One export runs at a time on a machine; with several agents exporting, pass `--wait` (`wait: true` on `video_start`) to queue for the slot instead of failing.
- Narrated or scored: `reel video --samples auto --mix` lays the track, music and cue sounds at the loudness target (it prints LUFS and true peak); `reel events` then `reel mix out/raw.mp4 out/final.mp4` re-mixes a render (a partial one with the same `--from`).

You cannot watch a video file; judge its frames with `reel strip` at the same times, and use the video for the person you are working with.

One export runs at a time on a machine: a second `reel video` (or `video_start`) fails while one is running, naming it. Wait for it rather than forcing a second beside it. On a Linux machine without a GPU everything renders in software (SwiftShader): stills, `check` and drafts work but take half a second to a few seconds a frame (more on a busy host), and a final `--samples auto` export takes from seconds to minutes a frame, so keep exports there short (`--from/--to`) and render finals where there is a GPU.

## Notes from the person reviewing

The person you work with watches renders with `reel review` (a page that plays the newest render under `out/` and pins notes to frames) and leaves notes in the project's `review/notes.json`. Each note has an `id`, a time `t` and `frame`, the `clips` on screen, the `text`, sometimes a `rect` (the area meant, in logical px, the same coordinates as `W` x `H`), a `status` (open or done) and the `render` it was made on (a draft says so). Pick them up like this:

1. `reel notes --open` (or `--json`; MCP: `review_notes` with `open_only`). Each open note names its clips and gives the command that renders its moment.
2. For each: run that `reel still --t <t>` and read the image, looking inside the `rect` when there is one. A note made on a draft is about timing or layout, not sharpness. If the note is not clear from the frame, ask rather than guess.
3. Fix it in the scene or config, and check it the usual way (stills, a strip, `reel check`).
4. Re-render what the person will look at (`reel video --draft`, or the final), since the page plays the newest file.
5. `reel notes done <id>` (MCP: `resolve_note`) for each note fixed. Never delete a person's note, and leave open what you did not fix; say why in your report.

`reel notes add --t <s> "<text>"` leaves a note of your own for the person (a question about a moment, or a choice you made); `reel notes move <id> --t <s>` pins a note to another moment. While `reel review` runs, its page's API does the same over HTTP on the URL it prints: `GET /api/state` (the render, the timeline and the notes), `POST /api/notes` with `{ t, text, rect?: { x, y, w, h }, status? }`, `PATCH /api/notes/<id>` with any of `{ t, text, rect, status }`, `DELETE /api/notes/<id>`. Edit `review/notes.json` by hand only if you must; the tools merge by id, so a page open at the same time loses nothing.

## Cheap looking

- `--max-size 800` writes smaller images (cheaper to read) for stills, sheets and strips; MCP image tools return at most 1280 px unless asked for full size.
- `--only` a clip; a short `--from/--to` range.
- Stills are never overwritten (`hello_2.500s.png`, then `-2`, `-3`): compare before and after by name. The name lists the clips on screen at that time by the timeline, with `--only` too (the clips not loaded are in the name but not in the image). Clean `out/` now and then; it is not committed.
- `reel daemon status` shows the warm renderer; `--no-daemon` renders in a fresh browser (when you suspect the warm one, which is rare).

## Before you report work done

Every touched clip: stills at its first, middle and last frame and a strip of its main motion, read. `reel check` clean of errors (and of warnings you did not choose), at every delivery format. Typecheck clean. Say which times you looked at and what check reported, and name anything you could not verify.
