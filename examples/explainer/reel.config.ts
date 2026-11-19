// A silent 16:9 explainer built from the component kit: a title card, text beside an image, a bar chart and a
// counter, a line chart, a code block, then a card per transition, each clip coming in with a different
// transition (every kind, an eased one and a custom GLSL one), and captions, a progress bar and a timer on a
// track above them all. No narration: the captions' times are in scenes/_script.ts.
import { defineVideo, sequence } from 'reel/config';

const kind = () => import('./scenes/kind');
// a custom transition: diagonal bands that each wipe across in turn
const BANDS = `float x = fract((uv.x * ratio + uv.y) * bands / (ratio + 1.0));
float m = smoothstep(x - 0.04, x, p * 1.04);
return mix(getFromColor(uv), getToColor(uv), m);`;

export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  theme: 'neutral',
  timeline: () => {
    // each clip after the first comes in over the last 0.4 s of the one before (the dip into the code, and the
    // iris, clock and custom transitions over 0.6 s, the whip over 0.3 s)
    const story = sequence([
      { id: 'title', scene: () => import('./scenes/title'), dur: 4.4 },
      { id: 'light', scene: () => import('./scenes/light'), dur: 5, transition: 'slide' },
      { id: 'samples', scene: () => import('./scenes/samples'), dur: 6.2, transition: { kind: 'wipe', direction: 'right', softness: 0.15 } },
      { id: 'flat', scene: () => import('./scenes/flat'), dur: 5.8, transition: 'zoom' },
      { id: 'code', scene: () => import('./scenes/code'), dur: 6.4, transition: { kind: 'dip', color: 'surface' }, overlap: 0.6 },
      { id: 'iris', scene: kind, dur: 2.6, overlap: 0.6, params: { title: 'Iris', code: "{ kind: 'iris', center: [0.7, 0.5] }", side: 'left' }, transition: { kind: 'iris', center: [0.7, 0.5] } },
      { id: 'clock', scene: kind, dur: 2.6, overlap: 0.6, params: { title: 'Clock', code: "{ kind: 'clock', ease: 'inOutQuart' }", side: 'right' }, transition: { kind: 'clock', ease: 'inOutQuart' } },
      { id: 'whip', scene: kind, dur: 2.6, overlap: 0.3, params: { title: 'Whip', code: "{ kind: 'whip' }", side: 'left' }, transition: 'whip' },
      { id: 'flash', scene: kind, dur: 2.6, params: { title: 'Flash', code: "{ kind: 'flash' }", side: 'right' }, transition: 'flash' },
      { id: 'shader', scene: kind, dur: 3.1, overlap: 0.6, params: { title: 'Your own', code: '{ glsl, uniforms: { bands: 6 } }', side: 'left' }, transition: { glsl: BANDS, uniforms: { bands: 6 } } },
    ], { overlap: 0.4 });
    return [...story, { id: 'chrome', scene: () => import('./scenes/chrome'), start: 0, end: story.at(-1)!.end, track: 1 }];
  },
});
