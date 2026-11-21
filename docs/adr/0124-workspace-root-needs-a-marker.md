# The workspace root is served only when a marker says it is one

`workspaceOf` (`cli/server.ts`) adds Vite's `searchForWorkspaceRoot` result to the dev server's `fs.allow` only when that folder really is a workspace: it has a `pnpm-workspace.yaml`, a `lerna.json` or a `package.json` with `workspaces`. Without a marker Vite falls back to the nearest `package.json`, which may be a stray one in the home folder, and allowing that would open the whole home folder to the server.
