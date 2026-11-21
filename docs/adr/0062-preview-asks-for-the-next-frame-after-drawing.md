# The preview asks for the next frame only once this one is drawn

The preview player's `tick` in `src/main.ts` awaits `engine.renderFrame` and calls `requestAnimationFrame(tick)` in its `finally`, rather than scheduling frames on a fixed loop. A frame's prepare may wait for a paint (HTML layers), so frames requested independently would overlap and render out of order.
