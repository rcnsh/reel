// Text and UI in a 3D scene: an HTML layer (or a kit component's layer) as the texture of a plane. The layer is
// rasterised at the output scale like any other, so give it as many layer px as the plane covers on screen
// (`pxPerUnit`) and it stays sharp at --scale 2.
import * as THREE from 'three';
import { H, W } from '../engine/gl';
import { HtmlLayer, type HtmlLayerOptions } from '../engine/html';

export interface HtmlPlaneOptions extends HtmlLayerOptions {
  /** The plane's size in world units, [width, height]. */
  size: [number, number];
  /** Layer px per world unit (default 400): the layer is size x pxPerUnit px unless `width`/`height` say otherwise. */
  pxPerUnit?: number;
  /** An existing layer to show instead of making one (a kit component's `layer`). */
  layer?: HtmlLayer;
  /** Seen from behind too (default false). */
  doubleSided?: boolean;
}

/**
 * A plane in a Stage3D showing an HTML layer: `new HtmlPlane({ html, css, size: [2, 0.5] })` made as a field of a
 * scene (or in init()) so the layer belongs to its clip, then placed like any mesh. Unlit: the layer's colours as
 * they are, like a screen. Its text is reported to `reel check` where it lands on screen. It draws nothing until
 * the layer's first upload.
 */
export class HtmlPlane extends THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  readonly layer: HtmlLayer;
  readonly size: [number, number];

  constructor(o: HtmlPlaneOptions) {
    const ppu = o.pxPerUnit ?? 400;
    const layer = o.layer ?? new HtmlLayer({ ...o, width: o.width ?? Math.round(o.size[0] * ppu), height: o.height ?? Math.round(o.size[1] * ppu) });
    // premultiplied sRGB texels, row 0 at the top -> linear premultiplied
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: layer.texture } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; varying vec2 vUv;
        vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
        void main() {
          vec4 c = texture2D(map, vec2(vUv.x, 1.0 - vUv.y));
          vec3 s = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
          gl_FragColor = vec4(lin(s) * c.a, c.a);
        }`,
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      depthWrite: false,
      side: o.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    super(new THREE.PlaneGeometry(o.size[0], o.size[1]), mat);
    this.layer = layer;
    this.size = o.size;
    this.userData.htmlPlane = true;
  }

  /** The stage's, before each render: draw only once the layer has a picture. */
  sync() { this.material.visible = this.layer.ready; }

  /** The stage's: report the layer's text where it lands on screen, through view-projection `vp` (column-major). */
  reportThrough(vp: ArrayLike<number>, opacity: number, eye: THREE.Vector3) {
    // (a one-sided plane seen from behind shows nothing)
    if (this.material.side === THREE.FrontSide) {
      const n = new THREE.Vector3(0, 0, 1).transformDirection(this.matrixWorld), p = new THREE.Vector3().setFromMatrixPosition(this.matrixWorld);
      if (n.dot(eye.clone().sub(p)) <= 0) return;
    }
    const lw = this.layer.width, lh = this.layer.height, [sw, sh] = this.size, m = this.matrixWorld.elements;
    this.layer.reportThrough((x, y) => {
      // layer px -> the plane's own coordinates -> world -> clip -> frame px
      const px = (x / lw - 0.5) * sw, py = (0.5 - y / lh) * sh;
      const wx = m[0]! * px + m[4]! * py + m[12]!, wy = m[1]! * px + m[5]! * py + m[13]!, wz = m[2]! * px + m[6]! * py + m[14]!;
      const cx = vp[0]! * wx + vp[4]! * wy + vp[8]! * wz + vp[12]!, cy = vp[1]! * wx + vp[5]! * wy + vp[9]! * wz + vp[13]!, cw = vp[3]! * wx + vp[7]! * wy + vp[11]! * wz + vp[15]!;
      if (cw <= 1e-5) return null;
      return [((cx / cw + 1) / 2) * W, ((1 - cy / cw) / 2) * H];
    }, opacity);
  }
}
