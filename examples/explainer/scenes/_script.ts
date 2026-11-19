// The captions: what the video says and when (video seconds), timed per word by Words.timed.
import { Words } from 'reel';

export const SCRIPT = Words.timed([
  { text: 'Every frame is a pure function of time.', start: 0.6, end: 3.8 },
  { text: 'Scenes draw in linear light, sharp at any output size.', start: 4.4, end: 8.6 },
  { text: 'Adaptive sampling spends its samples where things move.', start: 9.2, end: 14.2 },
  { text: 'So render time grows with motion, not with length.', start: 14.8, end: 19.6 },
  { text: 'And a scene is one small TypeScript class.', start: 20.2, end: 25.4 },
  { text: 'Clips come in by iris, clock, whip, flash, or a shader of your own.', start: 26.0, end: 36.4 },
]);

/** The content area: below the progress bar and timer, above the captions. */
export const TOP = 0.15, BOTTOM = 0.74;
