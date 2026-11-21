# Readback goes through fresh pixel-pack buffers

`readPixelsAsync`, `readStart` and `readFinish` in `src/engine/engine.ts` read frames through a pixel-pack buffer and a fence instead of a blocking `readPixels`: several times faster in Chrome, about 15 ms instead of about 40 ms at 1920x1080 and about 150 ms at 3840x2160. The video path pipelines it over two slots, so frame n is collected while n+1 renders.

Each `readStart` creates a new buffer and `readFinish` deletes it, as three's own async readback does. Reusing one read-back buffer per slot reads no faster, and Chrome logs a performance warning on every frame when a read-back buffer is reused.
