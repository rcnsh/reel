// The verse: a ring leaves the centre on every beat, swelling with the kick; the snare flashes the field and the
// hats sparkle at its edge. Everything is read from f (the analysis at this time), so any frame renders alone.
import type * as THREE from 'three';
import { W, H, Scene, type Frame, FSPass } from 'reel';

export default class Verse extends Scene {
  bg = new FSPass(/* glsl */ `
    uniform float phase, kick, snare, hat, bass;
    void main() {
      vec2 p = (FRAG_PX - 0.5 * vec2(${W}.0, ${H}.0)) / ${Math.min(W, H)}.0;
      float r = length(p);
      // rings: one per beat, radius growing with the beat's phase (and the ones before it, further out)
      float ring = 0.0;
      for (int k = 0; k < 4; k++) {
        float rad = (phase + float(k)) * 0.16;
        ring += smoothstep(0.012, 0.0, abs(r - rad)) * (1.0 - float(k) * 0.24);
      }
      float core = smoothstep(0.06 + 0.06 * kick, 0.0, r);
      float spark = hat * step(0.997, fract(sin(dot(floor(FRAG_PX / (4.0 * PX_SCALE)), vec2(12.9898, 78.233))) * 43758.5453)) * smoothstep(0.25, 0.5, r);
      vec3 col = C_BG + C_ACCENT_LO * (0.25 * snare + 0.2 * bass);
      col = mix(col, C_ACCENT, clamp(ring * (0.5 + 0.5 * kick), 0.0, 1.0));
      col = mix(col, C_FG, core + spark);
      fragColor = vec4(col, 1.0);
    }`, { phase: { value: 0 }, kick: { value: 0 }, snare: { value: 0 }, hat: { value: 0 }, bass: { value: 0 } });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const u = this.bg.u;
    u.phase!.value = f.beatPhase;
    u.kick!.value = f.a.kick;
    u.snare!.value = f.a.snare;
    u.hat!.value = f.a.hat;
    u.bass!.value = f.a.bass;
    this.bg.render(this.ctx.renderer, out);
  }
}
