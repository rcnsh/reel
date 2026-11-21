# Project files are served by reel's own middleware

`startServer` (`cli/server.ts`) serves a project's files from the site root through the `reel-project-files` middleware rather than Vite's static serving:

- Only files inside the project, and never its config or sources (`.ts`, `.tsx`, `.js`, `.mjs`), which go through Vite's transform.
- A missing media file (any type in `MEDIA`) is a 404 naming the file, not the HTML page a dev server would send for an unknown path, which a scene would then fail to decode with a confusing error. A path the engine's `public/` serves (its fonts) falls through to Vite.
- Byte ranges are honoured (206, 416), because the preview's `<audio>` and `<video>` cannot seek without them.
