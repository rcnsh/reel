# fetchJSON treats a non-JSON answer as a missing file

`fetchJSON` in `src/engine/audio.ts` (used for `data/audio.json`, `data/words.json` and `assets.json`) returns null unless the response is ok and its content type is JSON. The Vite dev server answers a request for a file that does not exist with the page itself (200, `text/html`), so `r.ok` alone would hand the HTML to `JSON.parse` instead of reporting the file as absent.
