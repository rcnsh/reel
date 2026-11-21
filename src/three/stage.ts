import * as THREE from 'three';
import { ALPHA, isBg, makeRT, SUB_FRAME, W, H } from '../engine/gl';
import { LIN } from '../engine/palette';
import { report, reporting } from '../engine/report';
import type { SceneCtx } from '../engine/scene';
import { apertureOf, type CameraPose, type Vec3 } from './camera';
import { lensSample, lightSample, subPixel } from './jitter';
import { corners, projectBox, projectPoint, type ScreenPoint } from './project';
import { environment } from './load';

export interface StageOptions {
  background?: string | null;
  /** Blur of an environment background, 0 to 1 (default 0.3). */
  backgroundBlur?: number;
  /** Vertical field of view in degrees (default 35), near and far planes (default 0.05 and 200). */
  fov?: number;
  near?: number;
  far?: number;
  antialias?: 'auto' | 'jitter' | 'none';
  shadows?: boolean | { mapSize?: number };
  unitsPerMetre?: number;
  /** A name for findings (default 'stage'). */
  label?: string;
}

export interface SoftLight { light: THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight; softness: number }

export const STAGE_MAX_SAMPLES = 108;
const SUB_FRAME_SHADOW_RADIUS = 1;

const colour = (c: string) => {
  if (Object.prototype.hasOwnProperty.call(LIN, c)) { const [r, g, b] = LIN[c]!; return new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace); }
  return new THREE.Color(c);
};

export class Stage3D {
  readonly scene = new THREE.Scene();
  readonly cam: THREE.PerspectiveCamera;
  readonly label: string;
  private renderer: THREE.WebGLRenderer;
  private o: StageOptions;
  private rt: THREE.WebGLRenderTarget;
  private msaa: THREE.WebGLRenderTarget | null = null;
  private pose: CameraPose = { position: [0, 1, 5], target: [0, 0, 0] };
  private softs: SoftLight[] = [];
  private envs: { dispose(): void }[] = [];
  private bg: THREE.Color | null;
  private bgEnv = false;
  private vp = new THREE.Matrix4();

  constructor(private ctx: SceneCtx, o: StageOptions = {}) {
    this.o = o;
    ctx.capSamples(STAGE_MAX_SAMPLES);
    this.renderer = ctx.renderer;
    this.label = o.label ?? 'stage';
    this.cam = new THREE.PerspectiveCamera(o.fov ?? 35, W / H, o.near ?? 0.05, o.far ?? 200);
    this.rt = makeRT(W, H);
    const bg = o.background === undefined ? 'bg' : o.background;
    this.bgEnv = bg === 'environment';
    this.bg = bg === null || this.bgEnv ? null : colour(bg);
    if (ALPHA && this.bg && isBg([this.bg.r, this.bg.g, this.bg.b])) this.bg = null;
    if (o.shadows !== false) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
    }
  }

  async environment(src: 'studio' | string, intensity = 1) {
    const e = await environment(this.renderer, src);
    this.envs.push(e);
    this.scene.environment = e.env;
    this.scene.environmentIntensity = intensity;
    if (this.bgEnv) {
      this.scene.background = e.equirect ?? e.env;
      this.scene.backgroundBlurriness = this.o.backgroundBlur ?? 0.3;
      this.scene.backgroundIntensity = intensity;
    }
  }

  soft(light: THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight, softness: number) {
    this.softs = this.softs.filter((s) => s.light !== light);
    this.softs.push({ light, softness });
    return light;
  }

  private sun(color: THREE.ColorRepresentation, intensity: number, position: Vec3, target: Vec3, radius: number, softness: number, shadows: boolean) {
    const l = new THREE.DirectionalLight(color, intensity);
    l.position.set(...position);
    l.target.position.set(...target);
    this.scene.add(l, l.target);
    if (shadows && this.o.shadows !== false) {
      l.castShadow = true;
      const size = typeof this.o.shadows === 'object' ? this.o.shadows.mapSize ?? 2048 : 2048;
      l.shadow.mapSize.set(size, size);
      const c = l.shadow.camera, d = new THREE.Vector3(...position).distanceTo(new THREE.Vector3(...target));
      c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius; c.near = Math.max(0.01, d - radius * 3); c.far = d + radius * 3;
      l.shadow.bias = -0.0004;
      l.shadow.normalBias = 0.02;
      l.shadow.radius = 3 + softness * 12;
      this.soft(l, softness);
    }
    return l;
  }

  /**
   * Studio three-point lighting around a subject at `target` about `radius` across: a key light high front left
   * (casting soft shadows), a fill from the right, a rim behind tinted with the theme's accent, and the studio
   * environment for reflections. `intensity` scales it all (default 1), `softness` the key's shadow (default 0.5).
   */
  async studio(o: { target?: Vec3; radius?: number; intensity?: number; softness?: number; rim?: string } = {}) {
    const t = o.target ?? [0, 0, 0], r = o.radius ?? 1, k = o.intensity ?? 1;
    const rim = new THREE.Color(1, 1, 1).lerp(colour(o.rim ?? 'accent'), 0.35);
    const key = this.sun(0xfff4e8, 2.4 * k, [t[0] - r * 3, t[1] + r * 4, t[2] + r * 3], t, r * 1.6, (o.softness ?? 0.5) * r, true);
    const fill = this.sun(0xe8f0ff, 0.6 * k, [t[0] + r * 4, t[1] + r * 1.5, t[2] + r * 2], t, r, 0, false);
    const back = this.sun(rim, 1.6 * k, [t[0] + r, t[1] + r * 3, t[2] - r * 4], t, r, 0, false);
    await this.environment('studio', 0.5 * k);
    return { key, fill, rim: back };
  }

  async overhead(o: { target?: Vec3; radius?: number; intensity?: number; softness?: number } = {}) {
    const t = o.target ?? [0, 0, 0], r = o.radius ?? 1, k = o.intensity ?? 1;
    const top = this.sun(0xffffff, 2.2 * k, [t[0] + r * 0.3, t[1] + r * 5, t[2] + r * 0.2], t, r * 1.6, (o.softness ?? 1.2) * r, true);
    const hemi = new THREE.HemisphereLight(0xffffff, colour('bg'), 0.5 * k);
    this.scene.add(hemi);
    await this.environment('studio', 0.35 * k);
    return { top, hemi };
  }

  /**
   * Outdoor light: a warm sun at `elevation` and `azimuth` degrees (default 40 and 30) with sharp-edged soft
   * shadows, and a sky: a hemisphere light from a sky colour (default a clear blue) over the ground (the theme's
   * background), which also lights reflections.
   */
  async outdoor(o: { target?: Vec3; radius?: number; intensity?: number; elevation?: number; azimuth?: number; sky?: string; softness?: number } = {}) {
    const t = o.target ?? [0, 0, 0], r = o.radius ?? 1, k = o.intensity ?? 1;
    const el = ((o.elevation ?? 40) * Math.PI) / 180, az = ((o.azimuth ?? 30) * Math.PI) / 180, d = r * 6;
    const sunPos: Vec3 = [t[0] + d * Math.cos(el) * Math.sin(az), t[1] + d * Math.sin(el), t[2] + d * Math.cos(el) * Math.cos(az)];
    const sun = this.sun(0xfff1dc, 3 * k, sunPos, t, r * 1.6, (o.softness ?? 0.08) * r, true);
    const sky = colour(o.sky ?? '#8fb8e8'), ground = colour('bg');
    const hemi = new THREE.HemisphereLight(sky, ground, 0.9 * k);
    this.scene.add(hemi);
    const pmrem = new THREE.PMREMGenerator(this.renderer), dome = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 32, 16), cols: number[] = [];
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 10, c = y > 0 ? new THREE.Color().copy(ground).lerp(sky, Math.min(1, 0.4 + y)) : ground.clone().multiplyScalar(0.6); cols.push(c.r, c.g, c.b); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    dome.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const env = pmrem.fromScene(dome, 0.02);
    pmrem.dispose(); geo.dispose();
    this.envs.push(env);
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = 0.6 * k;
    return { sun, hemi };
  }

  /**
   * A ground at height `y` that shows only the shadows cast on it (default) over whatever is behind, so a subject
   * sits on the background colour without a visible horizon; or, with `color`, a matte floor of that colour.
   * `opacity` is the shadows' strength (default 0.35). It is not counted as an object by `reel check`.
   */
  ground(o: { y?: number; size?: number; opacity?: number; color?: string } = {}) {
    const size = o.size ?? 40;
    const mat = o.color ? new THREE.MeshStandardMaterial({ color: colour(o.color), roughness: 0.95, metalness: 0 }) : new THREE.ShadowMaterial({ opacity: o.opacity ?? 0.35 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = o.y ?? 0;
    m.receiveShadow = true;
    m.userData.reelGround = true;
    this.scene.add(m);
    return m;
  }

  labelled<T extends THREE.Object3D>(obj: T, name: string): T {
    obj.userData.label = name;
    return obj;
  }

  camera(pose: CameraPose) {
    this.pose = pose;
    const c = this.cam;
    c.position.set(...pose.position);
    c.up.set(0, 1, 0);
    c.lookAt(...pose.target);
    if (pose.roll) c.rotateZ((pose.roll * Math.PI) / 180);
    c.fov = pose.fov ?? this.o.fov ?? 35;
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    return this;
  }

  /** The distance in focus and the lens radius (world units) of the current pose; radius 0: no depth of field. */
  lens() {
    const p = this.pose, focus = p.focus ?? new THREE.Vector3(...p.position).distanceTo(new THREE.Vector3(...p.target));
    const radius = p.aperture ?? (p.fstop ? apertureOf(this.cam.getFocalLength(), p.fstop, this.o.unitsPerMetre ?? 1) : 0);
    return { focus, radius };
  }

  private target() {
    if (SUB_FRAME.index < 0 && (this.o.antialias ?? 'auto') === 'auto') return (this.msaa ??= makeRT(W, H, { samples: 4 }));
    return this.rt;
  }

  render(out: THREE.WebGLRenderTarget, o: { opacity?: number } = {}) {
    const r = this.renderer, c = this.cam, k = SUB_FRAME.index, tgt = this.target();
    if (reporting()) this.report(o.opacity ?? 1);
    const pos = c.position.clone(), quat = c.quaternion.clone(), pm = c.projectionMatrix.clone();
    const lights = this.softs.map((s) => ({ s, p: s.light.position.clone(), radius: s.light.shadow.radius }));
    const prevC = r.getClearColor(new THREE.Color()), prevA = r.getClearAlpha();
    try {
      if (k >= 0) {
        const e = c.projectionMatrix.elements;
        const { focus, radius } = this.lens();
        if (radius > 0) {
          const [lx, ly] = lensSample(k).map((v) => v * radius) as [number, number];
          c.translateX(lx); c.translateY(ly); c.updateMatrixWorld();
          e[8]! -= (e[0]! * lx) / focus; e[9]! -= (e[5]! * ly) / focus;
        }
        if ((this.o.antialias ?? 'auto') !== 'none') {
          const [jx, jy] = subPixel(k), size = new THREE.Vector2();
          r.getDrawingBufferSize(size);
          e[8]! -= (2 * jx) / size.x; e[9]! -= (2 * jy) / size.y;
        }
        c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
        for (const { s, p } of lights) {
          if (!s.softness) continue;
          const [u, v] = lightSample(k), aim = new THREE.Vector3();
          const tp = (s.light as THREE.DirectionalLight).target?.getWorldPosition(aim) ?? aim.set(0, 0, 0);
          const dir = tp.sub(p).normalize(), a = new THREE.Vector3(0, 1, 0).cross(dir);
          if (a.lengthSq() < 1e-6) a.set(1, 0, 0);
          a.normalize();
          const b = new THREE.Vector3().crossVectors(dir, a);
          s.light.position.copy(p).addScaledVector(a, (u * s.softness) / 2).addScaledVector(b, (v * s.softness) / 2);
          s.light.shadow.radius = Math.min(s.light.shadow.radius, SUB_FRAME_SHADOW_RADIUS);
        }
      }
      this.scene.traverse((ob) => { if (ob.userData.htmlPlane) (ob as unknown as { sync(): void }).sync(); });
      this.ctx.maskDepth(tgt);
      r.setRenderTarget(tgt);
      if (this.bg) r.setClearColor(this.bg, 1); else r.setClearColor(0x000000, 0);
      r.clear(true, false, false);
      r.render(this.scene, c);
    } finally {
      r.setClearColor(prevC, prevA);
      c.position.copy(pos); c.quaternion.copy(quat); c.updateMatrixWorld();
      c.projectionMatrix.copy(pm); c.projectionMatrixInverse.copy(pm).invert();
      for (const { s, p, radius } of lights) { s.light.position.copy(p); s.light.shadow.radius = radius; }
    }
    const opaque = !!this.bg && (o.opacity ?? 1) >= 1;
    this.ctx.comp.draw(r, tgt.texture, out, { mode: opaque ? 'replace' : 'normal', opacity: o.opacity ?? 1, premult: false });
  }

  project(point: Vec3 | THREE.Object3D): ScreenPoint {
    const v = Array.isArray(point) ? new THREE.Vector3(...point) : point.getWorldPosition(new THREE.Vector3());
    const depth = -v.clone().applyMatrix4(this.cam.matrixWorldInverse).z;
    v.project(this.cam);
    return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H, depth, behind: depth <= 1e-9 };
  }

  viewProjection() {
    return this.vp.multiplyMatrices(this.cam.projectionMatrix, this.cam.matrixWorldInverse);
  }

  private report(opacity: number) {
    const vp = this.viewProjection().elements, frustum = new THREE.Frustum().setFromProjectionMatrix(this.vp);
    let visible = 0;
    const box = new THREE.Box3();
    this.scene.updateMatrixWorld();
    this.scene.traverseVisible((obj) => {
      const mesh = obj as THREE.Mesh;
      if ((mesh.isMesh || (obj as THREE.Points).isPoints || (obj as THREE.Line).isLine) && !obj.userData.reelGround && !obj.userData.htmlPlane) {
        if (!mesh.geometry?.boundingSphere) mesh.geometry?.computeBoundingSphere();
        if ((mesh as THREE.InstancedMesh).isInstancedMesh || frustum.intersectsObject(obj)) visible++;
      }
      if (obj.userData.htmlPlane) (obj as unknown as { reportThrough(vp: ArrayLike<number>, o: number, eye: THREE.Vector3): void }).reportThrough(vp, opacity, this.cam.position);
      const label = obj.userData.label as string | undefined;
      if (!label) return;
      box.setFromObject(obj);
      if (box.isEmpty()) return;
      const p = projectBox(corners(box.min.toArray() as Vec3, box.max.toArray() as Vec3), vp, W, H);
      report({ kind: 'object', label, x: p.x, y: p.y, w: p.w, h: p.h, behind: p.behind, alpha: opacity });
    });
    report({ kind: 'stage', label: this.label, x: 0, y: 0, w: W, h: H, visible, alpha: opacity });
  }

  dispose() {
    this.rt.dispose();
    this.msaa?.dispose();
    for (const e of this.envs) e.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
        for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) (v as THREE.Texture).dispose();
        mat.dispose();
      }
    });
  }
}

/** The theme's colour for a palette key or a CSS colour, as a three.js colour in linear sRGB. */
export const themeColor = colour;

export const screenPoint = (pose: CameraPose, point: Vec3, o: { fov?: number } = {}): ScreenPoint => projectPoint(pose, point, o.fov ?? 35, W, H);
