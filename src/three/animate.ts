// Animation in a 3D stage as functions of time: glTF animation clips (skeletons, morph targets, transforms) sampled at
// a time rather than advanced by frame deltas, and instanced meshes whose every instance is placed by a function
// of time. Both are evaluated per motion-blur sub-frame, in any order.
import * as THREE from 'three';

/**
 * A model's animation clips, sampled at any time: `anim.at(t)` poses the model as it is `t` seconds into its
 * clips. Built on three's AnimationMixer, but never advanced by a frame's delta: every call sets the time from
 * scratch (AnimationMixer.setTime), so the pose depends on t alone.
 */
export class Animation {
  readonly mixer: THREE.AnimationMixer;
  readonly clips: THREE.AnimationClip[];
  private actions: THREE.AnimationAction[] = [];

  /**
   * `root`: the model (a glTF's `.scene`); `clips`: its animations (`.animations`); `play`: the names (or indices) of
   * the clips that play together (default all); `loop` (default true) repeats them, else each holds its last pose.
   */
  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[], o: { play?: (string | number)[]; loop?: boolean } = {}) {
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = clips;
    const chosen = o.play ? o.play.map((p) => {
      const c = typeof p === 'number' ? clips[p] : clips.find((x) => x.name === p);
      if (!c) throw new Error(`animation '${p}' is not in the model (it has ${clips.map((x, i) => x.name || `#${i}`).join(', ') || 'none'})`);
      return c;
    }) : clips;
    for (const c of chosen) {
      const a = this.mixer.clipAction(c);
      if (o.loop === false) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.play();
      this.actions.push(a);
    }
  }

  /** The longest playing clip's length in seconds. */
  get duration() { return Math.max(0, ...this.actions.map((a) => a.getClip().duration)); }

  /** Pose the model `t` seconds into its clips (times `speed`, default 1). */
  at(t: number, speed = 1) {
    this.mixer.setTime(Math.max(0, t * speed));
    return this;
  }
}

/** Where one instance is: what place() fills in. */
export interface Placement { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3; color?: THREE.Color }

/**
 * Many copies of one mesh, each placed by `place(i, t, p)` (set p.position, p.rotation, p.scale and optionally
 * p.color, from i and t only), in one draw call. Call `update(t)` in render().
 */
export class Instances extends THREE.InstancedMesh {
  private place: (i: number, t: number, p: Placement) => void;
  private p: Placement = { position: new THREE.Vector3(), rotation: new THREE.Euler(), scale: new THREE.Vector3(1, 1, 1) };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, count: number, place: (i: number, t: number, p: Placement) => void) {
    super(geometry, material, count);
    this.place = place;
    this.castShadow = true;
    this.receiveShadow = true;
    // (instances move every sub-frame: culling against stale bounds would drop them)
    this.frustumCulled = false;
  }

  /** Place every instance at time t. */
  update(t: number) {
    const p = this.p;
    let coloured = false;
    for (let i = 0; i < this.count; i++) {
      p.position.set(0, 0, 0); p.rotation.set(0, 0, 0); p.scale.set(1, 1, 1); p.color = undefined;
      this.place(i, t, p);
      this.setMatrixAt(i, this.m.compose(p.position, this.q.setFromEuler(p.rotation), p.scale));
      if (p.color) { this.setColorAt(i, p.color); coloured = true; }
    }
    this.instanceMatrix.needsUpdate = true;
    if (coloured && this.instanceColor) this.instanceColor.needsUpdate = true;
    return this;
  }
}
