// The demo: two narrated plates, each shown by the scene of the same name.
import { clipsFromSections, defineVideo } from 'reel/config';

export default defineVideo({
  size: [1920, 1080],
  fps: 60,
  timeline: (src) => clipsFromSections(src, import.meta.glob('./scenes/*.ts')),
});
