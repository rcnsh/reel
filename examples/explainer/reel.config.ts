// A silent 16:9 explainer built from the component kit: a title card, text beside an image, a bar chart and a
// counter, a line chart, a code block, then a card per transition, each clip coming in with a different
// transition (every kind, an eased one and a custom GLSL one), and captions, a progress bar and a timer on a
// track above them all. No narration: the captions' times are in scenes/_script.ts.
import { defineVideo } from 'reel/config';

const kind = () => import('./scenes/kind');
// a custom transition: diagonal bands that each wipe across in turn
const BANDS = `float x = fract((uv.x * ratio + uv.y) * bands / (ratio + 1.0));
float m = smoothstep(x - 0.04, x, p * 1.04);
return mix(getFromColor(uv), getToColor(uv), m);`;

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
    { id: 'iris', scene: kind, start: 25.4, end: 28, params: { title: 'Iris', code: "{ kind: 'iris', center: [0.7, 0.5] }", side: 'left' }, transition: { kind: 'iris', center: [0.7, 0.5] } },
    { id: 'clock', scene: kind, start: 27.4, end: 30, params: { title: 'Clock', code: "{ kind: 'clock', ease: 'inOutQuart' }", side: 'right' }, transition: { kind: 'clock', ease: 'inOutQuart' } },
    { id: 'whip', scene: kind, start: 29.7, end: 32.3, params: { title: 'Whip', code: "{ kind: 'whip' }", side: 'left' }, transition: 'whip' },
    { id: 'flash', scene: kind, start: 31.9, end: 34.5, params: { title: 'Flash', code: "{ kind: 'flash' }", side: 'right' }, transition: 'flash' },
    { id: 'shader', scene: kind, start: 33.9, end: 37, params: { title: 'Your own', code: '{ glsl, uniforms: { bands: 6 } }', side: 'left' }, transition: { glsl: BANDS, uniforms: { bands: 6 } } },
    { id: 'chrome', scene: () => import('./scenes/chrome'), start: 0, end: 37, track: 1 },
  ],
});
