import { clipsFromSections, defineVideo } from 'reel/config';

export default defineVideo({
  size: [1080, 1080],
  fps: 30,
  theme: 'film',
  timeline: (src) => clipsFromSections(src, import.meta.glob('./scenes/*.ts')),
});
