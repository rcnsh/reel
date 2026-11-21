# The review page seeks mid-frame and owns its keys

`cli/review.html`:

- `seekFrame` seeks to half a frame in (`(f + 0.5) / fps`), so the decoder lands on the frame asked for and not the one before it, as a seek to the frame's exact start can.
- The browser's video controls cover the bottom of the frame, so `setControls` hides them while a note is being written (and `h` toggles them).
- The `keydown` handler is registered in the capture phase and stops propagation, so the page's keys run ahead of the video element's own.
- The notes are fetched again every two seconds, because an agent may change them (through `reel notes` or the MCP tools) while the page is open.
