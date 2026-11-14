// Loading 3D assets from the project folder: glTF/GLB models (with Draco, meshopt and KTX2 compression), HDR
// environment maps (.hdr, .exr) prefiltered for image-based lighting, and textures in the right colour space. Call
// these in a scene's init() and await them: everything is loaded before the first frame, and a file that is
// missing or does not parse throws, which makes it the clip's scene error (reported by `reel check`).
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type { GLTF };

/** Where the engine's copy of three.js keeps the decoders it loads at run time (served by the dev server). */
const LIBS = '/node_modules/three/examples/jsm/libs';

/** Throw a clear error for a project file that is not there (the dev server answers 404 for a missing media file). */
export async function requireFile(src: string, what: string) {
  let r: Response;
  try { r = await fetch(src, { method: 'HEAD', cache: 'no-store' }); } catch (e) { throw new Error(`${what} '${src}' did not load: ${(e as Error).message}`); }
  if (!r.ok) throw new Error(`${what} '${src}' is not in the project (${r.status}): a path relative to the project folder, such as assets/model.glb`);
}

let gltfLoader: GLTFLoader | null = null;
function gltf(renderer: THREE.WebGLRenderer) {
  if (gltfLoader) return gltfLoader;
  const draco = new DRACOLoader().setDecoderPath(`${LIBS}/draco/gltf/`);
  const ktx2 = new KTX2Loader().setTranscoderPath(`${LIBS}/basis/`).detectSupport(renderer);
  gltfLoader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  return gltfLoader;
}

/**
 * A glTF or GLB model (`assets/bottle.glb`): its scene (`.scene`), animations (`.animations`, see Animation) and
 * cameras. Draco- and meshopt-compressed geometry and KTX2 textures are decoded; colour textures come in as sRGB and
 * data textures (normal, roughness, metalness) as linear, as glTF specifies. Meshes cast and receive shadows.
 */
export async function loadGLTF(renderer: THREE.WebGLRenderer, src: string): Promise<GLTF> {
  await requireFile(src, '3D model');
  let g: GLTF;
  try { g = await gltf(renderer).loadAsync(src); } catch (e) { throw new Error(`3D model '${src}' did not load: ${(e as Error)?.message ?? e}`); }
  g.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/**
 * A texture from an image in the project. `color: true` (the default) for pictures shown as colour (base colour,
 * emissive: sRGB, decoded to linear when sampled), false for data (normal, roughness, masks: linear as stored).
 * Mipmapped, anisotropic, repeat wrapping off unless `repeat` is set.
 */
export async function loadTexture(src: string, o: { color?: boolean; repeat?: [number, number]; flipY?: boolean } = {}): Promise<THREE.Texture> {
  await requireFile(src, 'texture');
  let t: THREE.Texture;
  try { t = await new THREE.TextureLoader().loadAsync(src); } catch (e) { throw new Error(`texture '${src}' did not load: ${(e as Error)?.message ?? e}`); }
  t.colorSpace = o.color === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.flipY = o.flipY ?? true;
  if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...o.repeat); }
  return t;
}

/** An equirectangular HDR image (.hdr or .exr), as a linear float texture (not prefiltered: see environment()). */
export async function loadHDR(src: string): Promise<THREE.DataTexture> {
  await requireFile(src, 'environment map');
  const loader = /\.exr$/i.test(src) ? new EXRLoader() : new HDRLoader();
  loader.setDataType(THREE.HalfFloatType);
  let t: THREE.DataTexture;
  try { t = await loader.loadAsync(src); } catch (e) { throw new Error(`environment map '${src}' did not load: ${(e as Error)?.message ?? e}`); }
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

/**
 * Image-based lighting, prefiltered (PMREM) for physically based materials' reflections and diffuse light:
 * `'studio'` (three's room: soft boxes around a grey room, no file needed), or an equirectangular `.hdr` / `.exr` in
 * the project. Returns the prefiltered texture for `scene.environment` (and the equirectangular one, for
 * `scene.background` when the environment should be seen).
 */
export async function environment(renderer: THREE.WebGLRenderer, src: 'studio' | string): Promise<{ env: THREE.Texture; equirect: THREE.Texture | null; dispose(): void }> {
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    if (src === 'studio') {
      const room = new RoomEnvironment();
      const rt = pmrem.fromScene(room, 0.04);
      room.dispose();
      return { env: rt.texture, equirect: null, dispose: () => rt.dispose() };
    }
    const eq = await loadHDR(src);
    const rt = pmrem.fromEquirectangular(eq);
    return { env: rt.texture, equirect: eq, dispose: () => { rt.dispose(); eq.dispose(); } };
  } finally { pmrem.dispose(); }
}
