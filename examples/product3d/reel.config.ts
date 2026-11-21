import { defineVideo } from 'reel/config';

export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  theme: 'neutral',
  timeline: () => [
    { id: 'bottle', scene: () => import('./scenes/bottle'), start: 0, end: 6 },
    { id: 'title', scene: () => import('./scenes/title'), start: 0.6, end: 5.6, track: 1 },
  ],
});
