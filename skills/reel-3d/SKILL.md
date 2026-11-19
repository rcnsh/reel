---
name: reel-3d
description: 3D in reel videos with three.js - a Stage3D that renders into a scene, glTF/GLB models and HDR environments, lighting rigs, shadows, camera rigs as functions of time, depth of field, glTF animation, instancing, HTML text on planes, and what reel check reports about 3D. Use when a reel scene shows a 3D model, a product shot, a camera move through a 3D set, or anything rendered with three.js meshes and lights.
---

# 3D in reel

A 3D scene is an ordinary reel `Scene` that owns a `Stage3D`: a three.js scene and camera rendered into the clip's target in linear HDR. The engine's motion-blur sampler then gives it, for nothing beyond more sub-frames: anti-aliasing (the projection moves by a sub-pixel per sub-frame), depth of field (the camera moves over its lens aperture), soft shadows (each soft light moves over its area) and motion blur of the camera and of every object. Renders of one sample (previews, stills, `reel check`) use 4x MSAA and blurred shadow maps instead, with everything in focus. Tone mapping, bloom and grain stay the theme's post. Real-time rendering, no path tracing.

Everything is a function of time, as in any reel scene: pose the camera and the objects from `f.lt` in `render()`, which runs once per sub-frame in any order. Never `THREE.Clock`, never `mixer.update(delta)`, never a value carried from the last call.

## A product shot

```ts
import * as THREE from 'three';
import { Scene, type Frame, Stage3D, Animation, loadGLTF, orbit, fovOf } from 'reel';

export default class Bottle extends Scene {
  stage = new Stage3D(this.ctx, { fov: fovOf(85) });            // an 85 mm lens
  anim!: Animation;
  rig = orbit({ target: [0, 0.1, 0], radius: 1.2, height: [0.1, 0.25], from: -40, to: 30, at: [0, 6], fstop: 2.8 });

  override async init() {                                        // every load is awaited here
    const g = await loadGLTF(this.ctx.renderer, 'assets/bottle.glb');
    this.stage.scene.add(this.stage.labelled(g.scene, 'bottle'));  // labelled: check reports its box
    this.anim = new Animation(g.scene, g.animations, { loop: false });
    await this.stage.studio({ target: [0, 0.07, 0], radius: 0.12 });   // key, fill, rim, studio reflections
    this.stage.ground();                                         // shadows only, over the background colour
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.stage.camera(this.rig(f.lt));                           // per sub-frame: the move blurs
    this.anim.at(f.lt - 3);                                      // the model's clip, 3 s into the shot
    this.stage.render(out);
  }

  override dispose() { this.stage.dispose(); }
}
```

`examples/product3d` in the engine is this, with a kit title over it on track 1 and a size label on a plane in the set.

## The stage

`new Stage3D(this.ctx, { background, fov, near, far, antialias, shadows, unitsPerMetre, label })`, as a field of the scene.

- `background`: a palette key or `#rrggbb` (default `'bg'`, so the set sits in the theme), `'environment'` (the environment map, blurred by `backgroundBlur`), or `null`: transparent, for a stage on a track above 0 over other clips. In a render with alpha the theme's `bg` is left out too.
- `stage.scene` is a plain `THREE.Scene`: add meshes, groups and lights to it. `stage.cam` is the `PerspectiveCamera`.
- `stage.camera(pose)` places the camera for this sub-frame; `stage.render(out, { opacity })` renders and composites over `out` (an opaque background replaces it). Call both in every `render()`.
- `antialias`: `'auto'` (MSAA in one-sample renders, sub-pixel jitter with several), `'jitter'` (never MSAA: less memory), `'none'`.
- `shadows` (default on; `{ mapSize }`, default 2048). Meshes need `castShadow`/`receiveShadow` (loaded glTF meshes have both).
- Units are metres for the lens maths (`unitsPerMetre` otherwise). Keep a subject at real size: a bottle 0.15, a chair 0.9, a car 4.5.
- `stage.dispose()` in the scene's `dispose()` frees its targets, environments, geometry, materials and textures.

## Loading (in `init()`, awaited)

- `loadGLTF(renderer, 'assets/model.glb')`: glTF or GLB, with Draco and meshopt geometry and KTX2 textures decoded. Returns three's GLTF: `.scene`, `.animations`, `.cameras`. Colour textures are sRGB, data textures linear, as glTF says.
- `stage.environment('studio' | 'assets/room.hdr' | 'assets/sky.exr', intensity)`: image-based lighting, prefiltered (PMREM) for reflections and diffuse light. `'studio'` needs no file.
- `loadTexture('assets/wood.jpg', { color: true, repeat: [4, 4] })`: `color: false` for normal, roughness and other data maps. `loadHDR(src)` for an equirectangular float texture of your own.
- A file that is missing or does not parse throws from `init()`: the clip draws dark red, the command exits 1 and `reel check` reports a `sceneError` naming the file. Paths are relative to the project folder.
- Models: glTF from Blender (File > Export > glTF 2.0) or any permissively licensed source, its licence beside it. Keep them light: a few MB, textures 2K at most, Draco for heavy meshes. A model can also be built in code (`LatheGeometry`, `ExtrudeGeometry`) or exported from code with three's `GLTFExporter` (`examples/product3d/make_assets.ts`).

## Light and look

Materials are physically based: `MeshStandardMaterial` (`color`, `roughness`, `metalness`) and `MeshPhysicalMaterial` (adds `clearcoat`, `sheen`, `iridescence`). Light rigs, each awaited, each scaled by `intensity`, around a subject at `target` about `radius` across:

- `stage.studio({ target, radius, intensity, softness, rim })`: three-point light. A key high front left casting soft shadows, a cool fill from the right, a rim behind tinted towards the theme's accent (or `rim`, a palette key), and the studio environment.
- `stage.overhead({ … })`: one broad, very soft light from above, a hemisphere of white over the theme's background, the studio environment. Calm, catalogue light.
- `stage.outdoor({ elevation, azimuth, sky, softness, … })`: a warm sun with crisper shadows and a sky (hemisphere light and reflections) over the theme's background as ground.
- Your own lights work as in three.js; `stage.soft(light, softness)` makes one cast soft shadows (it moves over a disk `softness` world units across per sub-frame, and its `shadow.radius` blur drops to a texel there, since the moving light makes the penumbra; renders of one sample keep your `shadow.radius`. Set `castShadow` and its shadow camera yourself).
- `stage.ground({ y, opacity, color })`: shadows only over the background (default: no horizon line), or with `color` a matte floor.
- Shadows in one-sample renders are shadow maps blurred by PCF; in exports with `--samples` they become true penumbras that widen with distance from the caster. Values over ~0.85 bloom under themes with bloom; specular highlights on metal will.
- No ambient-occlusion pass: ground contact comes from the shadow catcher and the environment light.

## Cameras: rigs as functions of time

A rig is `(t) => CameraPose`; call it with `f.lt`. A pose is `{ position, target, fov?, roll?, focus?, fstop?, aperture? }` (positions `[x, y, z]`). Every rig takes `at: [from, to]` (seconds of the clip it moves over; holds outside), `ease` (a name from `ease` or a function; default `'inOutCubic'`) and the lens fields.

- `orbit({ target, radius, height, from, to })`: degrees about the vertical axis (0 is the +z side looking towards -z); `radius` and `height` take `[from, to]` to change as it goes.
- `dolly({ from, to, target })`: a straight move.
- `crane({ base, rise, target, targetRise })`: up or down, tilting to follow.
- `path({ points, target | lookAhead, closed })`: a smooth curve through the points (centripetal Catmull–Rom, no overshoot loops) at an even speed, looking at `target` or ahead along the path.
- `shots([{ t, position, target, fov, … }, …])`: keyframed poses, positions along a smooth curve through the keys, the rest eased.
- `lookAt(rig, [[t, point], …])`: change where any rig looks over time.
- `fovOf(mm)` / `focalOf(fov)`: focal length to vertical field of view on a full-frame sensor. 24 mm wide, 35 to 50 normal, 85 to 135 for products and faces.
- Plain three.js works too (`stage.cam.position.set(…)` then `stage.camera(…)` is optional); just compute it from `f.lt`.

## Depth of field

Give the pose `fstop` (f-number) or `aperture` (lens radius in world units), and `focus` (distance in focus; default the distance to `target`). Each sub-frame moves the camera over its lens disk with the focal plane held still, so the blur is physically right: it grows with distance from the focal plane, foreground and background both, with bokeh the shape of the aperture. It shows only with several sub-frames: look with `reel still --t 3 --samples 24`; plain stills are sharp everywhere. An 85 mm lens at f/2.8 focused at 1.2 m keeps about ±2 cm sharp; wide lenses and small subjects need wider apertures (`aperture: 0.02`) to show any blur.

## Animation

- `new Animation(gltf.scene, gltf.animations, { play: ['Walk'], loop })` then `anim.at(t, speed)` in render(). It sets the clips' time from scratch each call (skeletons, morph targets and transforms), so any t in any order gives the same pose. `anim.duration` is the longest clip.
- Your own motion: set `position`, `rotation`, `scale` from `f.lt` (`keys()`, `ease`, `springStep` from reel).
- `new Instances(geometry, material, count, (i, t, p) => { p.position.set(…); p.rotation.set(…); p.scale.setScalar(…); p.color = … })`, added to the scene, and `instances.update(f.lt)` in render(): thousands of objects in one draw, each placed by a function of its index and time (seed with `hash(i)`, never `Math.random()`).
- Physics or simulation that integrates state is a `stateful` scene: fixed `--samples N`, never `auto`.

## Text and UI in 3D

`new HtmlPlane({ html, css, size: [w, h], pxPerUnit })` is a mesh showing an HTML layer: place it like any object. Give it enough layer px for its size on screen (`pxPerUnit`; a plane 0.1 units wide at `pxPerUnit: 6000` is 600 layer px) and it is sharp at `--scale 2`. `{ layer: component.layer, size }` shows a kit component's layer instead. Unlit, transparent, no shadow; one-sided unless `doubleSided`. For titles that should not move with the set, use the kit on a track above instead: sharper, and check measures it exactly.

### Labels pinned to objects

A flat label that follows an object (a name beside a planet, a callout line) is 2D drawn where the object is on screen. `stage.project(point | object)` gives that after `stage.camera(pose)`: `{ x, y, depth, behind }` in logical px, to place an HTML layer or a Canvas2D line in the same scene. Skip the label while `behind`.

When the labels are a clip of their own on a track above (so they stay sharp and outside the stage's depth of field), both clips share the rig and the label clip asks for the stage clip's time:

```ts
// scenes/_space.ts, imported by both scenes
export const rig = orbit({ target: [0, 0, 0], radius: 6, height: 2, from: -30, to: 60, at: [0, 8] });
export const MOON: [number, number, number] = [1.2, 0.5, 0];

// scenes/labels.ts (track 1), in render():
const p = screenPoint(rig(f.t - this.ctx.clip('orbit').start), MOON, { fov: 35 });   // the stage's fov
if (!p.behind) this.tag.draw(this.ctx.renderer, out, { x: p.x + 40, y: p.y - 22 });
```

`screenPoint(pose, point, { fov })` is the stage's camera without the stage (no jitter, so the label is steady while the object blurs). `this.ctx.clip(id)` gives any clip's `start`, `end` and `track`, and throws when the id is gone. A point that moves (an orbiting body) comes from a function of time both scenes import too.

## What `reel check` reports

- A `stage` that sees none of its objects: `empty` (warning).
- Objects named with `stage.labelled(obj, 'name')`: off the frame (`offFrame`, a note), behind the camera (`offFrame`), or under 2% of the frame's short side across (`tiny`, a note).
- Text on an `HtmlPlane`, where it lands on screen: off the frame, too small, low contrast, overflowing, like any HTML text. A plane seen from behind reports nothing.
- Exempt a clip with `check: { exempt: ['empty'] }` (a deliberate empty shot), a box rule as usual.

## Performance and memory

- A stage with a few hundred thousand triangles renders in a few ms at 1080p (`reel perf`): `examples/product3d` runs at 8 ms a frame at 1x and 21 ms at `--scale 2` with one sample.
- Export with `--samples auto` pays per sub-frame for the shadow maps and the geometry; only fragment shading is skipped in converged tiles (the stage puts them at the near plane of its own depth test). Depth of field, soft shadows and the anti-aliasing jitter keep glossy highlights and fine detail (a bump or normal map, a noisy texture, a starfield) changing from step to step, so a clip with a stage stops at 108 sub-frames: at 1:1 in 4K, 108 cannot be told from 324. `maxSamples` on the clip overrides it: 324 for a whip pan whose streaks still step, 36 for a locked-off camera. `reel still --t <s> --samples auto --json` prints `subFrames` for a frame. A fixed `--samples N` below about 36 shows a soft shadow's penumbra as N stepped copies (the light is in N places and its shadow map is barely blurred); `--samples auto` adds sub-frames where that happens.
- Memory: the stage's target is 8 bytes a pixel plus depth (100 MB at 4K) and its MSAA target four times that (400 MB at 4K, only in one-sample renders). Shadow maps are 16 MB each at 2048. Free them in `dispose()`.
- Keep geometry modest (under ~1M triangles) and textures 2K; one shadow-casting light (the rigs cast from the key only).
- A texture map is as sharp as its texels: a 4K map wrapped round a planet is fine from orbit and a flat blur from a metre above the ground. There is no terrain or detail-texture helper: for a close-up, give the surface a `ShaderMaterial` of its own (prepend `GLSL_COMMON` for the noise functions) or a tiling detail map.

## What to look for in stills

- Scale and framing: the subject fills the frame you meant at the clip's first and last frame (`reel still --t 0,5.9`); the camera never passes through the subject or the ground.
- Light: highlights on the forms you want read, a shadow that grounds the subject, no black faces (raise the fill or the environment intensity), no blown metal (lower the key).
- Depth of field and motion blur: a still with `--samples 24` and `reel strip` of the move; plain stills show neither.
- 4K: `reel still --scale 2` of text planes and fine edges.
