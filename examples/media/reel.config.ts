// A vertical short made of media: a video clip with its own sound (made by make_assets.ts) filling the frame, an
// SVG mark, a Lottie badge, the same clip again slowed to half speed and looped in an inset, captions on the track
// above, and a pop on the timeline when the badge lands. Silent apart from the clip and the pop; 8 s.
import { defineVideo } from 'reel/config';

export default defineVideo({
  size: [1080, 1920],
  fps: 30,
  theme: 'neutral',
  timeline: () => [
    { id: 'shot', scene: () => import('./scenes/shot'), start: 0, end: 8 },
    { id: 'captions', scene: () => import('./scenes/captions'), start: 0, end: 8, track: 1 },
  ],
  // the badge's disc lands 0.4 s into its window, which opens 1 s into the shot
  sounds: [{ file: 'pop', at: 1.4, db: -4 }],
});
