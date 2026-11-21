import type * as THREE from 'three';
import { W, H, Scene, type Frame, FSPass, HtmlLayer } from 'reel';

export default class Drop extends Scene {
  grid = new FSPass(/* glsl */ `
    uniform float beat, kick, snare;
    void main() {
      vec2 uv = FRAG_PX / vec2(${W}.0, ${H}.0);
      vec2 g = (uv - 0.14) / 0.72;
      vec3 col = C_BG;
      if (all(greaterThanEqual(g, vec2(0.0))) && all(lessThan(g, vec2(1.0)))) {
        vec2 c = floor(g * 4.0), f = fract(g * 4.0);
        float idx = c.x + (3.0 - c.y) * 4.0;
        float age = mod(beat - idx, 16.0);
        float lit = exp(-age * 1.4) * (0.6 + 0.4 * kick);
        float inside = step(0.06, f.x) * step(f.x, 0.94) * step(0.06, f.y) * step(f.y, 0.94);
        col = mix(C_BG, mix(C_ACCENT_LO, C_ACCENT_HI, lit), inside * (0.25 + 0.75 * lit));
      }
      col += C_FG * 0.03 * snare;
      fragColor = vec4(col, 1.0);
    }`, { beat: { value: 0 }, kick: { value: 0 }, snare: { value: 0 } });
  count = new HtmlLayer({
    html: `<p class="c"></p>`,
    css: `.c { position: absolute; bottom: 6.5%; width: 100%; text-align: center; font: 600 3.4vmin 'IBM Plex Mono'; color: var(--fg); }`,
    update: (f, l) => l.text('.c', `bar ${Math.floor(f.bar) + 1} · beat ${Math.floor(f.barPhase * 4) + 1}`),
  });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const u = this.grid.u;
    u.beat!.value = Math.floor(f.beat + 1e-3) - Math.round(this.ctx.audio.beatAt(f.start));
    u.kick!.value = f.a.kick;
    u.snare!.value = f.a.snare;
    this.grid.render(this.ctx.renderer, out);
    this.count.draw(this.ctx.renderer, out);
  }
}
