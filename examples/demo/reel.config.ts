import { clipsFromSections, defineVideo } from 'reel/config';

export default defineVideo({
  size: [1920, 1080],
  fps: 60,
  theme: 'print',
  narration: { voice: 'kokoro:af_heart' },
  timeline: (src) => clipsFromSections(src, import.meta.glob('./scenes/*.ts')),
});
