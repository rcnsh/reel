# The review page skips scratch and old --mix pictures

`latestRender` (`cli/review.ts`) picks the newest video under `out/` but skips scratch files: a partial (`ownerOf` from `cli/scratch.ts`) and any `*.picture.<ext>` file. The latter is the picture-only intermediate that `--mix` wrote under that name before exports wrote through partials; such files can still sit in a project's `out/`, and they have no sound, so they must never be offered for review.
