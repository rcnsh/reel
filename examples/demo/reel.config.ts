// The demo: two narrated plates, each shown by the scene of the same name, in the print theme (ink on paper).
import { clipsFromSections, defineVideo } from 'reel/config';

export default defineVideo({
  size: [1920, 1080],
  fps: 60,
  theme: 'print',
  timeline: (src) => clipsFromSections(src, import.meta.glob('./scenes/*.ts')),
});
