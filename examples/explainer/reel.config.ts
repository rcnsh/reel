// A silent 16:9 explainer built from the component kit: a title card, text beside an image, a bar chart and a
// counter, a line chart, a code block, each clip coming in with a different transition, and captions, a
// progress bar and a timer on a track above them all. No narration: the captions' times are in scenes/_script.ts.
import { defineVideo } from 'reel/config';

export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  theme: 'neutral',
  timeline: () => [
    { id: 'title', scene: () => import('./scenes/title'), start: 0, end: 4.4 },
    { id: 'light', scene: () => import('./scenes/light'), start: 4, end: 9, transition: 'slide' },
    { id: 'samples', scene: () => import('./scenes/samples'), start: 8.6, end: 14.8, transition: { kind: 'wipe', direction: 'right', softness: 0.15 } },
    { id: 'flat', scene: () => import('./scenes/flat'), start: 14.4, end: 20.2, transition: 'zoom' },
    { id: 'code', scene: () => import('./scenes/code'), start: 19.6, end: 26, transition: { kind: 'dip', color: 'surface' } },
    { id: 'chrome', scene: () => import('./scenes/chrome'), start: 0, end: 26, track: 1 },
  ],
});
