import type * as THREE from 'three';
import { W, H, Scene, type Frame, FSPass, TitleCard } from 'reel';

export default class Intro extends Scene {
  bg = new FSPass(/* glsl */ `
    uniform float glow, t;
    void main() {
      vec2 p = (FRAG_PX / vec2(${W}.0, ${H}.0) - 0.5);
      float r = length(p);
      vec3 col = mix(C_BG, C_ACCENT_LO, glow * smoothstep(0.7, 0.0, r + 0.015 * snoise(vec3(p * 2.0, t * 0.2))));
      fragColor = vec4(col, 1.0);
    }`, { glow: { value: 0 }, t: { value: 0 } });
  card = new TitleCard({ kicker: 'reel analyze', title: 'On the beat', subtitle: 'beats, stems and drums from the song', motion: { from: 'up', in: 0.8, out: 0.3 } });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.bg.u.glow!.value = 0.3 + 0.7 * f.a.other;
    this.bg.u.t!.value = f.t;
    this.bg.render(this.ctx.renderer, out);
    this.card.draw(this.ctx.renderer, out, f);
  }
}
