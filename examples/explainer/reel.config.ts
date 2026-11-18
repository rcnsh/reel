// A silent 16:9 explainer built from the component kit: a title card, text beside an image, a bar chart and a
// counter, a line chart, a code block, each clip coming in with a different transition, and captions, a
// progress bar and a timer on a track above them all. No narration: the captions' times are in scenes/_script.ts.
import { defineVideo, sequence } from 'reel/config';

export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  theme: 'neutral',
  timeline: () => {
    // each clip after the first comes in over the last 0.4 s of the one before (the dip into the code over 0.6 s)
    const story = sequence([
      { id: 'title', scene: () => import('./scenes/title'), dur: 4.4 },
      { id: 'light', scene: () => import('./scenes/light'), dur: 5, transition: 'slide' },
      { id: 'samples', scene: () => import('./scenes/samples'), dur: 6.2, transition: { kind: 'wipe', direction: 'right', softness: 0.15 } },
      { id: 'flat', scene: () => import('./scenes/flat'), dur: 5.8, transition: 'zoom' },
      { id: 'code', scene: () => import('./scenes/code'), dur: 6.4, transition: { kind: 'dip', color: 'surface' }, overlap: 0.6 },
    ], { overlap: 0.4 });
    return [...story, { id: 'chrome', scene: () => import('./scenes/chrome'), start: 0, end: story.at(-1)!.end, track: 1 }];
  },
});
