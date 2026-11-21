# Rendering Chrome runs without a frame-rate limit

`CHROME_ARGS` in `cli/renderer.ts` includes `--disable-frame-rate-limit`. Without it a page paints on a 60 Hz clock, so an HTML layer that changes waits for the next vsync: up to 17 ms per frame. With it the page paints as soon as it is asked to, and a changed HTML layer costs a fraction of a millisecond per frame.
