# The render server loads Vite lazily and keeps the page's console

`startServer` (`cli/server.ts`) imports `vite` inside the function, not at module top: a command that only talks to the warm renderer never loads Vite, which keeps its start fast.

`forwardConsole` is on only with `hmr` (the preview). A render server keeps the page's console to itself, because the CLI collects the page's console per request (`openPage`'s `log`, `PageHandle.logs`) and reports it with that request's result.
