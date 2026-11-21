# The project folder is resolved through symlinks

`projectDir` (`cli/server.ts`) returns `realpathSync` of the project folder. One project reached by two paths (on macOS `/tmp` and `/private/tmp`) then has one identity, so it shares one warm renderer and one Vite cache instead of starting a second.
