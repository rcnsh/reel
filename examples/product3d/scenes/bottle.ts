import * as THREE from 'three';
import { Scene, type Frame, Stage3D, HtmlPlane, Animation, loadGLTF, orbit, fovOf } from 'reel';

export default class Bottle extends Scene {
  stage = new Stage3D(this.ctx, { fov: fovOf(85), label: 'set' });
  label = new HtmlPlane({
    size: [0.13, 0.03],
    pxPerUnit: 5000,
    html: '<p><b>50 ml · 1.7 fl oz</b></p>',
    css: `p { margin: 0; height: 100%; display: flex; align-items: center; justify-content: center; border-top: 7px solid var(--accent); }
          b { font: 600 52px/1 'IBM Plex Mono'; letter-spacing: .05em; white-space: nowrap; color: var(--fg); }`,
    label: 'size label',
  });
  anim!: Animation;
  rig = orbit({ target: [-0.07, 0.1, 0], radius: [1.3, 1.15], height: [0.14, 0.2], from: -38, to: 30, at: [0, 6], ease: 'inOutQuad', fstop: 2.8 });

  override async init() {
    const g = await loadGLTF(this.ctx.renderer, 'assets/bottle.glb');
    this.stage.scene.add(this.stage.labelled(g.scene, 'bottle'));
    this.anim = new Animation(g.scene, g.animations, { loop: false });
    await this.stage.studio({ target: [0, 0.07, 0], radius: 0.12, softness: 0.6 });
    await this.stage.environment('assets/studio.hdr', 0.9);
    this.stage.ground({ opacity: 0.4 });
    this.label.position.set(0.125, 0.015, 0.0);
    this.label.rotation.y = -0.15;
    this.stage.scene.add(this.label);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const pose = this.rig(f.lt);
    this.stage.camera({ ...pose, focus: Math.hypot(pose.position[0], pose.position[1] - 0.06, pose.position[2]) - 0.05 });
    this.anim.at(f.lt - 3.4);
    this.stage.render(out);
  }

  override dispose() { this.stage.dispose(); }
}
