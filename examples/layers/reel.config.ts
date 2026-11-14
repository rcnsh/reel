// A silent vertical video on two tracks: a background that crossfades between two colours, and a title drawn
// over it for part of the time, in the film theme (its crop marks are the theme's overlay, a third track).
// No narration or audio data: the length is the end of the last clip.
import { defineVideo } from 'reel/config';

export default defineVideo({
  size: [1080, 1920],
  fps: 30,
  theme: 'film',
  timeline: () => [
    { id: 'dawn', scene: () => import('./scenes/wash'), start: 0, end: 3.5, params: { from: 'ink', to: 'graphite' } },
    // (overlaps dawn by half a second: a crossfade)
    { id: 'dusk', scene: () => import('./scenes/wash'), start: 3, end: 6, params: { from: 'ink2', to: 'blood' } },
    { id: 'title', scene: () => import('./scenes/title'), start: 0.5, end: 5.5, track: 1, params: { text: 'Layers' } },
  ],
});
