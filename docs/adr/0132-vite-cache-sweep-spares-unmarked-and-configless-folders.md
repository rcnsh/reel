# The Vite cache sweep spares folders it cannot judge yet

Each project's dev servers keep Vite's cache in `node_modules/.vite/reel/<project>-<hash>` with a `project` marker file naming the project (`viteCacheDir` in `cli/server.ts`), and folders of projects that are gone are swept. Two cases are left alone:

- a folder with no marker yet: another server is still creating it;
- a project folder that exists but has briefly no `reel.config.ts`: the sweep checks only that the marked project folder exists, not its config.

Only a folder whose marked project folder is gone is removed. `tests/server.test.ts` covers both cases.
