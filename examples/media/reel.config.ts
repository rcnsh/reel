import { defineVideo } from 'reel/config';

export default defineVideo({
  size: [1080, 1920],
  fps: 30,
  theme: 'neutral',
  timeline: () => [
    { id: 'shot', scene: () => import('./scenes/shot'), start: 0, end: 8 },
    { id: 'captions', scene: () => import('./scenes/captions'), start: 0, end: 8, track: 1 },
  ],
  sounds: [{ file: 'pop', at: 1.4, db: -4 }],
});
