// A slow vertical wash between two palette colours (the clip's `from` and `to` params).
import type * as THREE from 'three';
import { Scene, type Frame, FSPass, LIN, type PaletteKey } from 'reel';

export default class Wash extends Scene {
  bg = new FSPass(/* glsl */ `
    uniform vec3 a, b; uniform float t;
    void main() {
      float k = vUv.y + 0.08 * snoise(vec3(vUv * 3.0, t * 0.15));
      fragColor = vec4(mix(a, b, smoothstep(0.1, 0.9, k)), 1.0);
    }`, { a: { value: [0, 0, 0] }, b: { value: [0, 0, 0] }, t: { value: 0 } });

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const p = this.ctx.params as { from: PaletteKey; to: PaletteKey };
    this.bg.u.a!.value = LIN[p.from];
    this.bg.u.b!.value = LIN[p.to];
    this.bg.u.t!.value = f.t;
    this.bg.render(this.ctx.renderer, out);
  }
}
