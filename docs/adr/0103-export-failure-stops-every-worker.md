# Any export failure stops every worker and leaves nothing running

In `exportVideo` (`cli/video.ts`) a failure on either side ends the whole render:

- `fail` closes every worker's WebSocket, which makes each page's `stream()` throw, and rejects `failed`. The main wait races the pages' rendering against `failed`, so a page error stops the render and a failure on this side stops waiting for the pages.
- A worker whose Chrome did not start is logged and skipped: the pages that came up render every chunk, so it costs speed, not the export.
- A page that comes up after the render stopped is closed by its own launcher, since `closePages` closes only the pages it finds; the `finally` block waits for every launch still in flight, so no Chrome outlives the export.
- On failure ffmpeg is killed with SIGKILL: it stops writing at once, and what it wrote is the partial, removed with the rest of the scratch.
