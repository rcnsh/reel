import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { apertureOf, crane, dolly, focalOf, fovOf, lookAt, orbit, path, progress, shots, smoothPath, type CameraPose, type Vec3 } from '../src/three/camera';
import { halton, lensSample, lightSample, subPixel } from '../src/three/jitter';
import { corners, projectBox, projectPoint } from '../src/three/project';
import { Animation } from '../src/three/animate';
import { findingsOf, type CheckOpts, type Sample } from '../src/check';
import type { ReportedBox } from '../src/engine/report';

const near = (a: number[], b: number[], eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]!) < eps);
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('camera rigs', () => {
  test('progress clamps and eases over its window', () => {
    expect(progress(-1, [0, 2])).toBe(0);
    expect(progress(3, [0, 2])).toBe(1);
    expect(progress(1, [0, 2], 'linear')).toBe(0.5);
    expect(progress(1, [0, 2], (x) => x * x)).toBe(0.25);
  });
  test('orbit circles the target at its radius and height, from one angle to another', () => {
    const rig = orbit({ target: [1, 0, 0], radius: 2, height: 0.5, from: 0, to: 90, at: [0, 1], ease: 'linear' });
    expect(near(rig(0).position, [1, 0.5, 2])).toBe(true);
    expect(near(rig(1).position, [3, 0.5, 0])).toBe(true);
    expect(rig(0.5).target).toEqual([1, 0, 0]);
    for (const t of [0, 0.3, 0.7, 1]) expect(Math.hypot(rig(t).position[0] - 1, rig(t).position[2])).toBeCloseTo(2, 9);
    expect(rig(0.37)).toEqual(orbit({ target: [1, 0, 0], radius: 2, height: 0.5, from: 0, to: 90, at: [0, 1], ease: 'linear' })(0.37));
  });
  test('dolly, crane and lookAt', () => {
    const d = dolly({ from: [0, 1, 5], to: [0, 1, 2], target: [0, 0, 0], at: [0, 2], ease: 'linear' });
    expect(d(1).position).toEqual([0, 1, 3.5]);
    const c = crane({ base: [0, 0, 4], rise: 2, target: [0, 0, 0], targetRise: 1, at: [0, 1], ease: 'linear' });
    expect(c(1).position).toEqual([0, 2, 4]);
    expect(c(1).target).toEqual([0, 1, 0]);
    const l = lookAt(d, [[0, [0, 0, 0]], [1, [2, 0, 0]]], 'linear');
    expect(l(0.5).target).toEqual([1, 0, 0]);
    expect(l(5).target).toEqual([2, 0, 0]);
    expect(l(1).position).toEqual(d(1).position);
  });
  test('a smooth path passes through its points and is travelled at an even speed', () => {
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [3, 0, 1]];
    const c = smoothPath(pts);
    expect(near(c.at(0), pts[0]!)).toBe(true);
    expect(near(c.at(1), pts[3]!, 1e-9)).toBe(true);
    for (const p of pts) expect(Math.min(...Array.from({ length: 2001 }, (_, i) => dist(c.at(i / 2000), p)))).toBeLessThan(0.01);
    const steps = Array.from({ length: 20 }, (_, i) => dist(c.at(i / 20), c.at((i + 1) / 20)));
    expect(Math.max(...steps) / Math.min(...steps)).toBeLessThan(1.05);
    const r = path({ points: pts, at: [0, 1], ease: 'linear' });
    expect(r(0.5).position).toEqual(c.at(0.5));
    expect(dist(r(0.5).target, c.at(0.55))).toBeLessThan(1e-9);
  });
  test('shots hold before and after their keys and pass through each', () => {
    const s = shots([{ t: 0, position: [0, 0, 5], target: [0, 0, 0], fov: 40 }, { t: 2, position: [5, 0, 0], target: [1, 0, 0], fov: 20 }, { t: 3, position: [0, 0, -5], target: [0, 0, 0] }], 'linear');
    expect(s(-1).position).toEqual([0, 0, 5]);
    expect(near(s(2).position, [5, 0, 0])).toBe(true);
    expect(s(1).fov).toBeCloseTo(30, 9);
    expect(s(9).position).toEqual([0, 0, -5]);
  });
  test('lens helpers', () => {
    expect(fovOf(focalOf(35))).toBeCloseTo(35, 9);
    expect(focalOf(fovOf(50))).toBeCloseTo(50, 9);
    expect(apertureOf(50, 2)).toBeCloseTo(0.0125, 12);
  });
});

describe('jitter', () => {
  test('halton and the sequences stay in range and spread their prefixes', () => {
    expect([1, 2, 3, 4].map((i) => halton(i, 2))).toEqual([0.5, 0.25, 0.75, 0.125]);
    for (let k = 0; k < 400; k++) {
      const [x, y] = subPixel(k);
      expect(x >= -0.5 && x < 0.5 && y >= -0.5 && y < 0.5).toBe(true);
      for (const [u, v] of [lensSample(k), lightSample(k)]) expect(u * u + v * v).toBeLessThanOrEqual(1 + 1e-12);
    }
    for (const n of [4, 12, 36]) {
      const m = Array.from({ length: n }, (_, k) => subPixel(k)).reduce((a, b) => [a[0] + b[0] / n, a[1] + b[1] / n], [0, 0]);
      expect(Math.hypot(m[0], m[1])).toBeLessThan(0.6 / Math.sqrt(n));
    }
  });
});

describe('projectBox', () => {
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  cam.position.set(0, 0, 5); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
  test('a box at the centre lands around the frame centre, symmetric', () => {
    const p = projectBox(corners([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]), vp, 1920, 1080);
    expect(p.behind).toBe(false);
    expect(p.x + p.w / 2).toBeCloseTo(960, 6);
    expect(p.y + p.h / 2).toBeCloseTo(540, 6);
    const q = new THREE.Vector3(0.5, 0.5, 0.5).project(cam);
    expect(p.x + p.w).toBeCloseTo(((q.x + 1) / 2) * 1920, 6);
  });
  test('behind the camera, and partly behind it', () => {
    expect(projectBox(corners([-1, -1, 6], [1, 1, 8]), vp, 1920, 1080).behind).toBe(true);
    const p = projectBox(corners([-1, -1, 0], [1, 1, 8]), vp, 1920, 1080);
    expect(p.behind).toBe(false);
    expect(p.partial).toBe(true);
    expect(Number.isFinite(p.w) && p.w > 0).toBe(true);
  });
});

test('glTF animation is sampled at a time: the same pose in any order, after any other', async () => {
  (globalThis as { FileReader?: unknown }).FileReader ??= class { result: unknown; onloadend?: () => void; readAsArrayBuffer(b: Blob) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); }); } };
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.morphAttributes.position = [new THREE.Float32BufferAttribute(Array.from(geo.attributes.position!.array, (v) => v * 2), 3)];
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
  mesh.name = 'box';
  mesh.morphTargetInfluences = [0];
  const scene = new THREE.Scene().add(mesh);
  const clip = new THREE.AnimationClip('move', 2, [
    new THREE.VectorKeyframeTrack('box.position', [0, 1, 2], [0, 0, 0, 1, 2, 0, 0, 0, 0]),
    new THREE.NumberKeyframeTrack('box.morphTargetInfluences', [0, 2], [0, 1]),
  ]);
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations: [clip] }) as ArrayBuffer;
  const g = await new GLTFLoader().parseAsync(glb, '');
  const model = g.scene.getObjectByName('box') as THREE.Mesh;
  const anim = new Animation(g.scene, g.animations);
  const at = (t: number) => { anim.at(t); return [...model.position.toArray(), model.morphTargetInfluences![0]!]; };
  const order = [0.5, 1.7, 0.25, 3.1, 0.5, 1.7, 0.25];
  const first = new Map<number, number[]>();
  for (const t of order) { const v = at(t); if (first.has(t)) expect(v).toEqual(first.get(t)!); else first.set(t, v); }
  expect(at(0.5)).toEqual([0.5, 1, 0, 0.25]);
  expect(at(3.1)).toEqual(at(1.1));
  expect(() => new Animation(g.scene, g.animations, { play: ['nope'] })).toThrow("animation 'nope' is not in the model");
  const once = new Animation(g.scene, g.animations, { loop: false });
  const y = (t: number) => { once.at(t); return model.position.y; };
  expect([y(0.5), y(5), y(0.5), y(1), y(9), y(0)]).toEqual([1, 0, 1, 2, 0, 0]);
});

describe('check of 3D boxes', () => {
  const opts: CheckOpts = { W: 1000, H: 500, safe: 0.05, minText: 24, frozen: 3, clips: [{ id: 'a', start: 0, end: 10, track: 0 }], palette: { bg: '#FFFFFF', fg: '#111111', accent: '#FF0000' } };
  const sample = (boxes: Partial<ReportedBox>[]): Sample => ({ t: 1, clips: ['a'], boxes: boxes.map((b, index) => ({ kind: 'object', x: 0, y: 0, w: 0, h: 0, clip: 'a', index, ...b }) as ReportedBox), stats: { sig: [0, 50], cols: 2, rows: 1, spread: 50 }, errors: [] });
  test('an empty stage, an object behind the camera, a tiny one, one off the frame', () => {
    const f = findingsOf([sample([
      { kind: 'stage', label: 'stage', w: 1000, h: 500, visible: 0 },
      { label: 'lamp', behind: true },
      { label: 'bolt', x: 400, y: 200, w: 4, h: 6 },
      { label: 'bottle', x: 900, y: 100, w: 200, h: 200 },
    ])], opts);
    expect(f.map((x) => `${x.severity} ${x.kind} ${x.text ?? ''}`).sort()).toEqual(['info offFrame bottle', 'info offFrame lamp', 'info tiny bolt', 'warning empty '].sort());
    expect(f.find((x) => x.kind === 'offFrame' && x.text === 'lamp')!.message).toContain('behind the camera');
    expect(findingsOf([sample([{ kind: 'stage', w: 1000, h: 500, visible: 3 }])], opts)).toHaveLength(0);
  });
});

describe('projectPoint', () => {
  test("matches three's camera for a pose: position, target, roll and field of view", () => {
    const poses: CameraPose[] = [
      { position: [3, 2, 5], target: [0, 0.5, 0] }, { position: [-2, 4, 1], target: [1, 0, -3], roll: 17, fov: 60 },
      { position: [0, 6, 0.001], target: [0, 0, 0] }, { position: [0, 0, 5], target: [0, 0, 0], roll: -40 },
    ];
    const pts: Vec3[] = [[0.4, 0.2, -0.3], [-1, 1.5, 0.7], [2, 0, 2]];
    for (const pose of poses) for (const pt of pts) {
      const cam = new THREE.PerspectiveCamera(pose.fov ?? 35, 1920 / 1080, 0.05, 200);
      cam.position.set(...pose.position); cam.up.set(0, 1, 0); cam.lookAt(...pose.target);
      if (pose.roll) cam.rotateZ((pose.roll * Math.PI) / 180);
      cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      const q = new THREE.Vector3(...pt).project(cam);
      const p = projectPoint(pose, pt, 35, 1920, 1080);
      expect(p.x).toBeCloseTo(((q.x + 1) / 2) * 1920, 1);
      expect(p.y).toBeCloseTo(((1 - q.y) / 2) * 1080, 1);
      expect(p.behind).toBe(false);
    }
  });
  test('a point behind the camera says so', () => {
    expect(projectPoint({ position: [0, 0, 5], target: [0, 0, 0] }, [0, 0, 9], 35, 1920, 1080).behind).toBe(true);
  });
});

describe('Stage3D', () => {
  const fakeStage = async () => {
    const { Stage3D } = await import('../src/three/stage');
    const drawn: { radius: number; position: THREE.Vector3 }[] = [];
    let light: THREE.DirectionalLight | null = null;
    const renderer = {
      shadowMap: { enabled: false, type: 0 },
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(1920, 1080),
      setRenderTarget() {}, clear() {}, setClearColor() {}, getClearAlpha: () => 0,
      getClearColor: (c: THREE.Color) => c,
      fail: false,
      render() { if (renderer.fail) throw new Error('lost context'); drawn.push({ radius: light!.shadow.radius, position: light!.position.clone() }); },
    };
    const caps: number[] = [];
    const ctx = { renderer, comp: { draw() {} }, maskDepth() {}, capSamples: (n: number) => caps.push(n) };
    const stage = new Stage3D(ctx as never, { antialias: 'none' });
    light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(-1, 3, 2);
    light.castShadow = true;
    light.shadow.radius = 9;
    stage.scene.add(light, light.target);
    stage.soft(light, 0.5);
    stage.camera({ position: [0, 1, 4], target: [0, 0, 0] });
    return { stage, light, drawn, caps, renderer };
  };

  test('asks its clip for at most 108 adaptive sub-frames', async () => {
    const { caps } = await fakeStage();
    expect(caps).toEqual([108]);
  });

  test("a soft light's shadow-map blur drops to a texel in sub-frames, where the moving light makes the penumbra", async () => {
    const { SUB_FRAME } = await import('../src/engine/gl');
    const { stage, light, drawn } = await fakeStage();
    const out = new THREE.WebGLRenderTarget(4, 4);
    try {
      SUB_FRAME.index = -1;
      stage.render(out);
      for (let k = 0; k < 4; k++) { SUB_FRAME.index = k; stage.render(out); }
    } finally { SUB_FRAME.index = -1; }
    expect(drawn[0]!.radius).toBe(9);
    expect(drawn[0]!.position.toArray()).toEqual([-1, 3, 2]);
    for (const d of drawn.slice(1)) expect(d.radius).toBe(1);
    expect(new Set(drawn.slice(1).map((d) => d.position.toArray().join())).size).toBe(4);
    expect(light.shadow.radius).toBe(9);
    expect(light.position.toArray()).toEqual([-1, 3, 2]);
  });

  test('the light is put back when a sub-frame throws', async () => {
    const { SUB_FRAME } = await import('../src/engine/gl');
    const { stage, light, renderer } = await fakeStage();
    renderer.fail = true;
    try {
      SUB_FRAME.index = 3;
      expect(() => stage.render(new THREE.WebGLRenderTarget(4, 4))).toThrow('lost context');
    } finally { SUB_FRAME.index = -1; }
    expect(light.shadow.radius).toBe(9);
    expect(light.position.toArray()).toEqual([-1, 3, 2]);
  });
});
