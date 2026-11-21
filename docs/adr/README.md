# Architecture decision records

One decision per file: what was decided and why, where the code alone would not say. These replace the code comments that used to carry them (reel has no comments: see `.claude/skills/delete-comment`). A new decision gets the next number; a changed one is edited in place.

## Engine core: config, timeline, sampling, readback

- [0001](0001-adaptive-sampling-steps-by-thirds.md): Adaptive sampling steps the sub-frame count by thirds
- [0002](0002-audio-base64-decoded-with-atob.md): Audio analysis base64 is decoded with atob
- [0003](0003-capsamples-only-while-a-scene-is-made.md): ctx.capSamples counts only while the scene is made
- [0004](0004-clip-time-on-the-output-frame-grid.md): Clip time maps on the output frame grid
- [0005](0005-fetchjson-treats-html-as-missing.md): fetchJSON treats a non-JSON answer as a missing file
- [0006](0006-format-module-breaks-gl-import-cycle.md): The output format lives in its own module
- [0007](0007-gpu-fences-polled-between-tasks.md): GPU fences are polled between tasks on a MessageChannel
- [0008](0008-hairlines-keep-1x-ink-at-higher-scales.md): Hairlines keep their 1x ink at higher output scales
- [0009](0009-motion-blur-sum-is-float-and-finite.md): The motion-blur sum is Float32 and drops non-finite pixels
- [0010](0010-page-props-parsed-without-urlsearchparams.md): Page props in the URL are parsed without URLSearchParams
- [0011](0011-post-params-read-an-eighth-into-the-shutter.md): Post parameters are read 1/8 of the shutter after t
- [0012](0012-readback-through-fresh-pixel-pack-buffers.md): Readback goes through fresh pixel-pack buffers
- [0013](0013-render-props-are-frozen-copies.md): A render's props are a deep-frozen copy
- [0014](0014-restore-gl-state-after-tile-mask-passes.md): GL state is restored after every tile-mask pass
- [0015](0015-scene-reloads-are-serialised.md): Scene reloads run one at a time
- [0016](0016-sequence-times-rounded-to-microseconds.md): Sequence times are rounded to the microsecond
- [0017](0017-stateful-refusal-before-and-after-init.md): A stateful scene is refused before and after init
- [0018](0018-sub-frame-times-clamped-at-zero.md): Sub-frame times are clamped at 0
- [0019](0019-sub-frames-stepping-back-are-not-seeks.md): Stepping back within a shutter is not a seek
- [0020](0020-supersample-taps-rotate-across-sub-frames.md): Supersample taps cycle and rotate across sub-frames
- [0021](0021-videoconfig-assignable-with-typed-props.md): A config with typed props stays a VideoConfig

## Engine: HTML layers, lines, post, tracks, stroke fonts

- [0022](0022-check-overflow-vertical-slack.md): HTML overflow and clipping allow slack, more of it vertically
- [0023](0023-html-layer-dispose-keeps-texture.md): An HTML layer's dispose leaves its texture to the GL context
- [0024](0024-line-batch-hairline-floor.md): LineBatch widens each quad for anti-aliasing and fades hairlines instead of thinning them
- [0025](0025-pixels-module-has-no-imports.md): The readback modes module imports nothing
- [0026](0026-png16-colour-chunk-precedence.md): The 16-bit PNG decoder reads colour chunks in the PNG spec's order and leaves ICC to the browser
- [0027](0027-post-is-invariant-to-output-scale.md): Post-processing looks the same at every output scale
- [0028](0028-scene-props-typed-any.md): SceneCtx.props is typed with any, not unknown
- [0029](0029-stroke-fonts-optical-kerning.md): Stroke fonts are kerned optically and get built typographic glyphs
- [0030](0030-track-compositing-maths.md): Track grades and blends work on unpremultiplied colour by the W3C formula
- [0149](0149-bloom-gain-is-a-tuned-divisor.md): The bloom strength is divided by a tuned gain, not the pyramid's

## Transitions and the component kit

- [0031](0031-arrow-geometry-bow-tuck-and-heads.md): Arrow geometry: the bow's control point, the tucked line and growing heads
- [0032](0032-codeblock-fits-by-plex-mono-advance.md): CodeBlock fits its font by IBM Plex Mono's fixed advance
- [0033](0033-cormorant-lining-figures-via-fontface-features.md): Cormorant is loaded with lining figures, set on the FontFace
- [0034](0034-cubic-bezier-extrapolates-like-chromium.md): cubicBezier extrapolates along its end tangents, as Chromium does
- [0035](0035-custom-transition-uniforms-as-plain-arrays.md): Custom transition uniforms are uploaded as plain arrays
- [0036](0036-donut-chart-tags-gaps-and-centre-size.md): DonutChart: no tag for an empty slice, a fixed-width gap, a centre sized by its final text
- [0037](0037-glyph-positions-from-inclusive-prefix.md): Glyph positions come from the inclusive prefix, minus the glyph's advance
- [0038](0038-idle-transitions-mirror-composite-order.md): idleTransitions judges overlaps in the compositor's order, by whole frames
- [0039](0039-keys-checked-during-the-walk.md): keys() checks key order as it walks, not up front
- [0040](0040-kit-colours-fail-loudly.md): Kit colours fail loudly, and when the component is made
- [0041](0041-kit-numbers-format-en-us.md): Kit numbers are formatted in en-US on every machine
- [0042](0042-kit-windows-may-end-at-infinity.md): A kit window may end at Infinity
- [0043](0043-linechart-head-label-slides-in-the-box.md): LineChart's value label slides from left- to right-aligned
- [0044](0044-project-fonts-optional-without-dev-server.md): The page loads without project fonts when nothing lists them
- [0045](0045-spring-maths-numerics.md): Spring maths: continuous heavy damping, a stable overdamped root and a bracketed settle time
- [0046](0046-stagger-random-order-cached.md): stagger's random order is shuffled once per item count and seed
- [0047](0047-svgdraw-css-scoped-to-its-root.md): SvgDraw scopes its CSS to its own root
- [0048](0048-svgdraw-draws-on-with-pathlength-dashes.md): SvgDraw draws on with pathLength dashes, and avoids non-scaling strokes
- [0049](0049-text-outlines-glyph-by-glyph.md): Text outlines are built glyph by glyph at Canvas2D positions
- [0050](0050-transition-weights-follow-uncovered-area.md): Transition weights for reel check follow the uncovered area
- [0051](0051-transitions-clamp-eased-progress-only-for-fades.md): Transitions clamp the eased progress only for fades
- [0052](0052-waveform-static-levels-cached-by-window.md): A static Waveform caches its levels by window alone

## Kit media, preview, HUD and 3D

- [0053](0053-animation-resets-actions-before-set-time.md): Animation resets every action before setting the time
- [0054](0054-downscaled-pngs-reduce-in-halvings.md): Downscaled PNGs reduce in halvings
- [0055](0055-frame-sender-pools-two-transferred-buffers.md): The frame sender transfers two pooled buffers to a worker
- [0056](0056-hud-caption-sits-in-the-margin.md): The HUD caption sits in the margin, with a halo only on dark pictures
- [0057](0057-hud-redraws-its-layer-from-quantised-state.md): The HUD redraws its layer only when its quantised state changes
- [0058](0058-image-decode-paths-keep-colour-and-depth.md): ImageBox decodes each format by the path that keeps its colours and depth
- [0059](0059-instances-skip-frustum-culling.md): Instances are never frustum culled
- [0060](0060-kinetic-function-entrance-writes-whole-style.md): KineticText writes a function entrance's style whole every frame
- [0061](0061-lottie-box-drives-lottie-web-into-its-own-canvas.md): LottieBox drives lottie-web into its own canvas, frame by frame
- [0062](0062-preview-asks-for-the-next-frame-after-drawing.md): The preview asks for the next frame only once this one is drawn
- [0063](0063-projected-boxes-stay-finite.md): Projected boxes are clamped to one frame beyond each edge
- [0064](0064-screen-point-mirrors-three-lookat.md): projectPoint builds the camera's axes as three.js's lookAt does
- [0065](0065-smooth-path-arc-length-table.md): smoothPath mirrors phantom end points and walks an arc-length table
- [0066](0066-theme-lookups-use-own-keys-only.md): Theme and palette lookups use own keys only
- [0067](0067-video-clip-decodes-whole-groups-with-a-fresh-decoder.md): VideoClip decodes whole groups of pictures, each with a fresh decoder
- [0068](0068-video-frame-lookup-tolerates-float-error.md): Video frame lookup allows a hair of float error
- [0069](0069-video-frames-upload-through-three-state-cache.md): VideoClip uploads frames through three.js's state cache

## CLI: processes, exports, formats, jobs, MCP

- [0070](0070-animated-webp-default-quality-88.md): Animated WebP defaults to quality 88
- [0071](0071-cancel-a-video-job-through-its-reel-video-process.md): Cancelling a job signals reel video, not the encoder
- [0072](0072-child-watchdog-over-a-pipe.md): Child processes are killed by a watchdog reading a pipe
- [0073](0073-export-defaults-apply-only-where-they-mean-the-same.md): A config's export defaults apply only where they mean the same
- [0074](0074-export-slot-claims-survive-races-and-pid-reuse.md): Export-slot claims survive races and pid reuse
- [0075](0075-exr-alpha-mode-needs-ffmpeg-8.md): EXR alpha is marked premultiplied where ffmpeg can say so
- [0076](0076-ffmpeg-deep-gain-is-measured-per-process.md): ffmpeg's 16-bit gain is measured, not assumed
- [0077](0077-font-add-takes-the-variable-fonts.md): reel font add takes the variable fonts, not static/
- [0078](0078-golden-sets-per-operating-system.md): Golden frames are kept per operating system, not per GL backend
- [0079](0079-img2webp-frame-durations-follow-the-frame-clock.md): img2webp frame durations follow the frame clock
- [0080](0080-job-queue-state-is-read-from-the-stderr-tail.md): A job's queue state is read from the tail of its stderr
- [0081](0081-mcp-server-exits-when-its-input-ends.md): The MCP server exits when its input ends, after answering pending calls
- [0082](0082-move-files-across-filesystems.md): Moving renders handles EXDEV
- [0083](0083-note-frames-tolerate-decimal-times.md): A note's frame tolerates times typed as decimals
- [0084](0084-one-warm-renderer-per-project-by-lock-file.md): One warm renderer per project, decided by a lock file
- [0085](0085-props-travel-as-checked-json-text.md): Props travel as checked JSON text
- [0086](0086-review-notes-change-under-a-lock.md): Review notes change by re-reading the file under a lock
- [0087](0087-swiftshader-webgl-needs-the-unsafe-flag.md): SwiftShader renders launch Chrome with --enable-unsafe-swiftshader
- [0088](0088-transparent-video-formats-carry-straight-alpha.md): Transparent video formats carry straight alpha
- [0089](0089-video-job-processes-are-checked-by-start-time-and-group.md): Video jobs recognise their processes by start time and process group
- [0090](0090-video-status-waits-at-most-50-s.md): video_status waits at most 50 s
- [0091](0091-video-writes-subtitles-before-rendering.md): reel video --subtitles writes the subtitles before rendering
- [0092](0092-warm-renderer-engine-version.md): The warm renderer's engine version covers protocol, patches and GL backend
- [0093](0093-warm-renderer-http-has-no-timeouts.md): Warm renderer HTTP has no timeouts

## CLI: renderer, servers, review, examples

- [0094](0094-atomic-commit-follows-symlinks-and-renames.md): Outputs are committed by one rename onto the real file
- [0095](0095-bun-filereader-shim-for-gltfexporter.md): A FileReader shim lets GLTFExporter run under bun
- [0096](0096-check-contrast-measured-on-rendered-pixels.md): Check measures text contrast on the rendered pixels
- [0097](0097-check-frozen-runs-compare-cells-and-stop-at-gaps.md): Frozen runs compare cell brightness and stop at unsampled gaps
- [0098](0098-check-samples-bunch-at-clip-edges.md): Check bunches its samples at clip edges
- [0099](0099-chrome-disable-frame-rate-limit.md): Rendering Chrome runs without a frame-rate limit
- [0100](0100-demo-hatching-in-fixed-logical-units.md): The demo's hatching is sized in a fixed logical unit
- [0101](0101-draft-stream-retagged-bt709.md): The draft's WebCodecs stream is retagged BT.709
- [0102](0102-explainer-content-area-between-chrome.md): The explainer's content area sits between its chrome
- [0103](0103-export-failure-stops-every-worker.md): Any export failure stops every worker and leaves nothing running
- [0104](0104-export-workers-reorder-buffer-and-spool.md): Exports render in parallel workers through a bounded reorder buffer and a disk spool
- [0105](0105-media-assets-made-in-code.md): The media example's assets are generated with seeking and fonts in mind
- [0106](0106-media-clip-dimmed-over-black.md): The media example dims its clip over black for white type
- [0107](0107-module-load-failures-reported-with-vite-reason.md): Module load failures are reported with Vite's reason
- [0108](0108-openpage-reloads-only-lost-modules.md): openPage reloads only for modules that never arrived
- [0109](0109-preview-props-script-escapes-lt.md): The preview's props script escapes `<`
- [0110](0110-product3d-cap-pivots-at-collar-top.md): The bottle's cap is modelled about its own origin
- [0111](0111-product3d-framing-keeps-bottle-clear-of-title.md): The product shot frames the bottle clear of the title
- [0112](0112-project-dir-resolves-symlinks.md): The project folder is resolved through symlinks
- [0113](0113-project-files-served-by-own-middleware.md): Project files are served by reel's own middleware
- [0114](0114-projects-run-on-the-engines-own-modules.md): Projects run on the engine's own modules, with no install
- [0115](0115-render-server-loads-vite-lazily-and-keeps-console.md): The render server loads Vite lazily and keeps the page's console
- [0116](0116-renderer-page-leasing-order.md): The renderer leases pages one at a time and orders its bookkeeping around awaits
- [0117](0117-rescan-outside-modules-by-mtime.md): Modules from outside the project count as changed by mtime on first sight
- [0118](0118-review-page-playback-choices.md): The review page seeks mid-frame and owns its keys
- [0119](0119-review-server-checks-host-header.md): The review server accepts only local Host headers
- [0120](0120-review-skips-scratch-and-legacy-picture-files.md): The review page skips scratch and old --mix pictures
- [0121](0121-scratch-names-carry-pid-not-clock.md): Scratch names identify their owner by pid and program, never by clock
- [0122](0122-stroke-text-spaces-take-no-time.md): Written stroke text gives each space a zero-length time
- [0123](0123-sweep-stale-vite-optimizer-temp-folders.md): The sweep removes Vite optimizer temp folders older than an hour
- [0124](0124-workspace-root-needs-a-marker.md): The workspace root is served only when a marker says it is one

## Tests

- [0125](0125-analyze-fast-misses-kicks-under-a-bass-on-every-beat.md): `reel analyze --fast` misses kicks under a bass note on every beat
- [0126](0126-analyze-model-tests-run-one-song-at-a-time.md): The analyze model tests run one song at a time
- [0127](0127-jobs-test-follows-from-another-process-asynchronously.md): The jobs test follows a job from another process asynchronously
- [0128](0128-mix-sum-is-bounded-by-silence-of-the-video-length.md): The mix's sum ends with silence of the video's length
- [0129](0129-page-load-test-allows-for-chromes-own-retry.md): The page-load test allows for Chrome's own retry
- [0130](0130-stage-pose-without-fov-uses-the-stage-fov.md): A camera pose without a field of view uses the stage's own
- [0131](0131-tests-size-slow-work-for-swiftshader.md): Tests size slow work for SwiftShader
- [0132](0132-vite-cache-sweep-spares-unmarked-and-configless-folders.md): The Vite cache sweep spares folders it cannot judge yet

## Tools: narration, alignment, analysis, mix

- [0133](0133-analyze-beat-heuristics-thresholds.md): Where reel analyze's beat thresholds come from
- [0134](0134-cue-tracks-written-a-block-at-a-time.md): Each cue kind is one summed track, written a block at a time
- [0135](0135-forced-alignment-in-60-s-windows.md): Long takes are force-aligned in overlapping 60 s windows
- [0136](0136-hosted-requests-retry-only-before-an-answer.md): Hosted requests retry only what a later attempt can fix, and never resend a success
- [0137](0137-loudness-two-pass-linear-gain-first.md): Loudness: a linear gain where it fits, else loudnorm, measured on the finished file
- [0138](0138-match-timed-tokens-to-script-by-edit-distance.md): Timed tokens are matched to the script by edit distance
- [0139](0139-mix-graph-ffmpeg-guards.md): The mix graph guards against ffmpeg's fade and end-of-stream behaviour
- [0140](0140-music-models-cache-check-and-decoding.md): music_models.py's cache check and decoding
- [0141](0141-narration-plates-cached-as-each-arrives.md): Narration plates are cached as each one arrives
- [0142](0142-one-model-process-per-batch.md): Each local model runs in one process for all its passages
- [0143](0143-snap-word-edges-to-pauses.md): Word edges snap to the pauses in the audio
- [0144](0144-spectrum-top-at-least-loudest-less-30-db.md): The spectrum's top level is at least the loudest moment less 30 dB
- [0145](0145-subtitle-lines-never-empty.md): Subtitle line breaks never leave an empty line
- [0146](0146-test-reference-values-from-chrome-and-easings-net.md): Easing tests check against outside reference values
- [0147](0147-video-format-tests-allow-for-ffmpeg-and-the-export-queue.md): Video format tests allow for ffmpeg versions and the export queue
- [0148](0148-whisper-transcribes-independent-chunks-with-script-vocabulary.md): Whisper transcribes independent chunks, primed with the script's vocabulary
