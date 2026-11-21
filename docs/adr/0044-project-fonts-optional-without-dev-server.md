# The page loads without project fonts when nothing lists them

`loadFonts` in `src/engine/type.ts` asks the dev server for the project's fonts at `/@reel/fonts.json` (served by `cli/server.ts`). A page served some other way has no such endpoint, so a failed fetch or a response that is not JSON means "no project fonts", not an error, and the engine's own fonts still load. Only an `error` the endpoint itself reports (a bad font file in the project's `fonts/`) fails the load.
