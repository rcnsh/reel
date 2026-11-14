// A 3D product shot: a perfume bottle (a glTF model with an animation, made by make_assets.ts) under studio light,
// the camera orbiting it with a shallow depth of field, a size label in the scene on a plane, and a kit title over
// it on an upper track. Silent; the length is the end of the last clip.
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
