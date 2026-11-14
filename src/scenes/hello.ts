// Demo plate: a shader background (paper with engraved hatching) and the line set in type as it is spoken.
import type * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { Lyrics } from '../engine/lyrics';
import { ease, prog } from '../engine/util';

export default class Hello extends Scene {
  bg = new FSPass(/* glsl */ `
    uniform float t;
    void main() {
      vec2 p = FRAG_PX / 1080.0;
      float shade = 0.18 + 0.12 * snoise(vec3(p * 2.0, t * 0.1));
      vec3 col = mix(C_PAPER, C_INK, hatch(p.x * 90.0 + p.y * 40.0, shade) * 0.35);
      fragColor = vec4(col, 1.0);
    }`, { t: { value: 0 } });
  text = new Layer2D();

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp, lyrics } = this.ctx;
    this.bg.u.t!.value = f.t;
    this.bg.render(renderer, out);

    const c = this.text.ctx;
    this.text.clear();
    const line = lyrics.get('function of time');
    const shown = line.text.slice(0, Math.ceil(Lyrics.lineCharProgress(line, f.t)));
    const rise = prog(f.lt, 0, 0.8, ease.outExpo);
    c.font = font(F.archivo(87.5, 900), 96);
    c.textAlign = 'center';
    c.fillStyle = rgba('ink', rise);
    c.fillText(shown, W / 2, H / 2 + (1 - rise) * 40);
    comp.draw(renderer, this.text.upload(), out);
  }
}
