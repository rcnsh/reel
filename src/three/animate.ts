import * as THREE from 'three';

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

  get duration() { return Math.max(0, ...this.actions.map((a) => a.getClip().duration)); }

  at(t: number, speed = 1) {
    for (const a of this.actions) a.reset();
    this.mixer.setTime(Math.max(0, t * speed));
    return this;
  }
}

export interface Placement { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3; color?: THREE.Color }

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
    this.frustumCulled = false;
  }

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
