# The warm renderer's engine version covers protocol, patches and GL backend

A client replaces a warm renderer whose engine version differs from its own (`engineVersion` in `cli/daemon.ts`). That version hashes these inputs, and each one is there for a reason:

- `PROTOCOL`. It must be bumped whenever the request or state format changes. A daemon started by an older client otherwise keeps answering requests it no longer understands.
- `patches/`, the patched dependencies. bun.lock does not record edits to a patch, so a change there would otherwise go unseen.
- The GL backend. `--gl` travels by environment (`REEL_GL`, set in `cli/reel.ts`) to the warm renderer and to the video export's browsers. Because the backend is part of the engine version, switching it replaces the daemon instead of reusing a Chrome launched for another backend.
