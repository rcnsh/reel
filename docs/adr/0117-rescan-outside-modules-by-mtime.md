# Modules from outside the project count as changed by mtime on first sight

`Renderer.rescan` (`cli/renderer.ts`) also stats the modules the pages loaded from outside the project (a monorepo's sources), which Vite's module graph names. A file seen there for the first time has no earlier stat to compare with, yet the page may have loaded it before an edit: it counts as changed when its mtime is later than the previous scan. The engine's own files are skipped (they replace the warm renderer instead), as are packages under `node_modules`, which change only with an install.
