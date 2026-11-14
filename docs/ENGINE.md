# Engine internals

How `src/engine/` and the page (`src/main.ts`) work, for changing them. Writing scenes and configs is in the `reel-authoring` skill (`skills/reel-authoring/`); the render-and-check loop in `reel-review-loop`. The engine is adapted from the upstream engine of [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video) (MIT, Giacomo Magnanini; see `LICENSE`).

## The page

`cli/server.ts` serves `index.html` and `src/main.ts` with Vite, the project mapped in as `@project/` (its config) and its files served from the site root. Two things are compile-time constants (Vite `define`), so they are in place before any module runs: `__REEL_FORMAT__` (size, fps) and `__REEL_THEME__` (the theme the CLI resolved from the config with `src/themes.ts`). The page URL overrides the size and rate (`?w=&h=&fps=`), sets the output scale (`?scale=`) and can name a built-in theme (`?theme=`, what `--theme` sends); `format.ts` and `palette.ts` read them at import. Because the palette is fixed at import, `glsl/common.ts` bakes every key into `GLSL_COMMON` as `C_<KEY>` and `post.ts` its defaults; a change to the config's format or theme needs a new dev server, which the warm renderer handles by restarting Vite.

`main.ts` boots the `Engine` and then either the preview player or, with `?export=1`, the export API `window.__reel`: `still`, `png` (the readback as PNG, optionally cropped, downscaled and with rectangles marked), `grid` (sheets and strips), `inspect` (`reel check`), `stream` (video frames), `clipsAt`, `timeline`, `cues`, `errors`, `beginRequest`, `contextLost`. The CLI's ops (`cli/ops.ts`) are thin drivers of that API.

## Engine.init

Loads the words, the audio analysis, the fonts and the stroke fonts in parallel, calls the config's `timeline()`, checks the clips (unique ids, windows, `check.exempt` rules), sets the duration (config, else audio, else the last clip's end), appends the theme's overlay as the clip `overlay` on a track above every other, allocates per track three scene targets and two transition mixes, and loads each clip's scene (module import, constructor, `init()`). A clip whose scene fails to load is recorded in `loadErrors` and drawn dark red. `--only` loads the selected clips plus the overlay.

## A frame

`render(t, dt, toScreen, samples, shutter)`:

1. `composite(t)`: the clips active at t, grouped by track in number order. Per track, `compositeTrack` renders each clip into a scene target (stateful scenes are reset and pre-rolled at the frame step after a seek), crossfades overlapping clips with `xfade` unless the incoming scene `handlesTransition`, and merges post overrides (clip `post`, then the scene's return). The lowest track is used as is when it is opaque, unblended and alone; otherwise tracks stack into `stackRT` with their blend and opacity (an opacity fades from clip to clip across a transition).
2. Motion blur (`samples` > 1): sub-frames summed into `sumRT`, averaged into `avgRT`. Post parameters come from the sub-frame nearest 1/8 of the shutter after t.
3. `post.render` (bloom pyramid, halation, CA, shoulder, invert, flash, vignette, grain, dither, sRGB) into `finalRT`, then blitted to the canvas.

A scene that throws in `render()` is recorded once per clip in `renderErrors` (cleared by `clearRenderErrors`, which the warm renderer calls per request through `beginRequest`) and drawn dark red. A shader that fails to compile surfaces through three's `debug.onShaderError`, recorded in `loadErrors` (three compiles a program once) with the drawing clip's id and the source line each error points at.

## Adaptive sampling

`--samples auto` (`AdaptiveSampling`) steps the sub-frame count through 4, 12, 36, 108, 324. `ternaryOffsets` orders the shutter offsets so that each step adds a sub-frame either side of every existing one: every prefix of 4·3^l is evenly spread and centred on t, and so is each step's new set, so comparing the new set's average with the old one's measures sampling error rather than a shift in time. After each step, `sampleError` renders the displayed difference (through the tone shoulder and sRGB, worst channel, 2x2-logical-px blocks, `errRT`) and reduces it to a max per 32x32-logical-px tile (`maxRT`, read back). Stepped copies of a moving edge shrink as 1/count, so the error left is about half the last step's change.

Per tile (`refine: 'tiles'`, the default): a tile goes on while it or one of its 8 neighbours is at or over `tol`; a tile that stops is final, the average of its first n sub-frames. Later sub-frames skip stopped tiles: `writeTileMask` writes the live tiles into the depth buffer of every masked target (the engine's, plus scenes' `tileMasked` targets, `moving` ones through `mapTileMask`), and while `masking` is on, `hookDepthState` forces every draw into a masked target to depth-test LEQUAL against it without writing depth, whatever its material says, so the GPU rejects stopped tiles before shading (early-Z; a stencil test does not reject early on Apple GPUs). A draw whose material wants its own depth test sets `depthSeen`; that clip's sub-frames are then drawn unmasked from then on (`depthEntries`). The final average weights each tile by its own count (`gainPass`). `refine: 'frame'` decides for the whole frame at once.

In practice a still frame stops at 12, ordinary camera motion at 36, whips and fast zooms at 108 or 324; at 1:1 in 4K, 108 cannot be told from 324.

## Readback and export

`readPixelsAsync` reads `finalRT` through a pixel-pack buffer and a fence (several times faster than a blocking `readPixels` in Chrome). The video path packs RGB into a `(PW*3/4) x PH` RGBA8 target (`rgbPass`, exact bytes), queues the copy with `readStart(slot)` and collects it with `readFinish(slot)` while the next frame renders. `stream()` sends frames over a WebSocket written from a worker thread, with at most `inflight` unacknowledged frames: the encoder's backpressure. `cli/video.ts` runs several pages (each its own Chrome and GPU process) on chunks of frames, puts the frames back in order, spools to disk when x264 falls behind, and pipes them into one ffmpeg (BT.709, tagged).

## Reporting and check

`report.ts` holds a module-level sink. `Engine.render` with `collectBoxes` opens it around the composite (around the sub-frame nearest t when there are several; paused during a stateful scene's pre-roll) and names each box with the drawing clip; outside that, `report()` and `reportText()` return on their first line. `__reel.inspect(t)` renders with collection, reads the pixels back and measures them with the pure functions of `src/check.ts` (a brightness grid per frame, each text box's text and background luminance); the CLI turns the samples into findings with `findingsOf` from the same module.

## Warm pages

The warm renderer (`cli/daemon.ts`, `cli/renderer.ts`) keeps pages open across requests. What that asks of the page: render errors are per request (`beginRequest`), a lost WebGL context is reported (`contextLost`) so the page is replaced, and nothing in the engine may depend on how many frames were rendered before (the same rule motion blur imposes on scenes).
