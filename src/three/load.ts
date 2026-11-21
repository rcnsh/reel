import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type { GLTF };

const LIBS = '/node_modules/three/examples/jsm/libs';

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

export async function loadGLTF(renderer: THREE.WebGLRenderer, src: string): Promise<GLTF> {
  await requireFile(src, '3D model');
  let g: GLTF;
  try { g = await gltf(renderer).loadAsync(src); } catch (e) { throw new Error(`3D model '${src}' did not load: ${(e as Error)?.message ?? e}`); }
  g.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

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
