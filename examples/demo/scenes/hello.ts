import type * as THREE from 'three';
import { Scene, type Frame, FSPass, TextBlock, Words, esc, safeBox } from 'reel';

export default class Hello extends Scene {
  bg = new FSPass(/* glsl */ `
    uniform float t;
    void main() {
      vec2 p = FRAG_PX / 1080.0;
      float shade = 0.18 + 0.12 * snoise(vec3(p * 2.0, t * 0.1));
      vec3 col = mix(C_BG, C_FG, hatch(p.x * 90.0 + p.y * 40.0, shade) * 0.35);
      fragColor = vec4(col, 1.0);
    }`, { t: { value: 0 } });

  line = this.ctx.words.get('function of time');
  text = new TextBlock({
    html: (f) => {
      const n = Math.ceil(Words.lineCharProgress(this.line, f.t));
      return `${esc(this.line.text.slice(0, n))}<span style="visibility: hidden">${esc(this.line.text.slice(n))}</span>`;
    },
    box: safeBox(0.1), align: 'center', size: 96, weight: 900, maxLines: 3, label: 'line',
    motion: { from: 'up', in: 0.8, distance: 40 },
  });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.bg.u.t!.value = f.t;
    this.bg.render(this.ctx.renderer, out);
    this.text.draw(this.ctx.renderer, out, f);
  }
}
