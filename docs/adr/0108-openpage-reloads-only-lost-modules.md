# openPage reloads only for modules that never arrived

A render dev server has no live reload, so when a module never arrives `openPage` (`cli/renderer.ts`) reloads the page itself, as Vite's live reload would (the cases and the five-reload limit are in `docs/ENGINE.md`). Two cases must not count as lost:

- A request that failed with `ERR_ABORTED` is one the page itself gave up, as a reload does to the old document's requests; counting it would trigger reloads from reloads.
- Chrome also reports a script it refused to run (a 404 among them) as a failed request. `openPage` records every response of 400 or more in `refusedReq` and ignores those in `requestfailed`, so only a request with no answer or whose body was cut short is lost; a 404 or 500 stays the project's error and is reported.
