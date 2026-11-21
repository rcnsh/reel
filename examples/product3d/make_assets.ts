import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import path from 'node:path';

const out = path.join(import.meta.dir, 'assets');

const lathe = (pts: [number, number][], seg = 96) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
function rounded(pts: [number, number][], r: number, n = 6): [number, number][] {
  const o: [number, number][] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = new THREE.Vector2(...pts[i]!), a = new THREE.Vector2(...pts[i - 1]!).sub(p), b = new THREE.Vector2(...pts[i + 1]!).sub(p);
    const ra = Math.min(r, a.length() / 2), rb = Math.min(r, b.length() / 2);
    const s = p.clone().add(a.normalize().multiplyScalar(ra)), e = p.clone().add(b.normalize().multiplyScalar(rb));
    for (let k = 0; k <= n; k++) { const t = k / n, q = s.clone().multiplyScalar((1 - t) ** 2).add(p.clone().multiplyScalar(2 * t * (1 - t))).add(e.clone().multiplyScalar(t * t)); o.push([q.x, q.y]); }
  }
  o.push(pts.at(-1)!);
  return o;
}
const glass = new THREE.MeshPhysicalMaterial({ name: 'body', color: new THREE.Color('#1f4d3f'), roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
const gold = new THREE.MeshStandardMaterial({ name: 'gold', color: new THREE.Color('#d9b26f'), roughness: 0.28, metalness: 1 });
const body = new THREE.Mesh(lathe(rounded([[0, 0], [0.034, 0], [0.036, 0.012], [0.036, 0.094], [0.024, 0.114], [0.0115, 0.119], [0.0115, 0.126], [0, 0.126]], 0.006)), glass);
body.name = 'body';
const collar = new THREE.Mesh(lathe(rounded([[0, 0.118], [0.0135, 0.118], [0.0135, 0.128], [0, 0.128]], 0.0012)), gold);
collar.name = 'collar';
const cap = new THREE.Mesh(lathe(rounded([[0, 0], [0.019, 0], [0.019, 0.04], [0, 0.04]], 0.004)), gold);
cap.name = 'cap';
cap.position.y = 0.128;
const bottle = new THREE.Group();
bottle.name = 'bottle';
bottle.add(body, collar, cap);
const scene = new THREE.Scene().add(bottle);
const q = (deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (deg * Math.PI) / 180).toArray();
const open = new THREE.AnimationClip('open', 1.4, [
  new THREE.VectorKeyframeTrack('cap.position', [0, 0.5, 1.4], [0, 0.128, 0, 0, 0.131, 0, 0, 0.168, 0]),
  new THREE.QuaternionKeyframeTrack('cap.quaternion', [0, 0.5, 1.4], [...q(0), ...q(60), ...q(140)]),
]);
(globalThis as { FileReader?: unknown }).FileReader ??= class { result: unknown; onloadend?: () => void; readAsArrayBuffer(b: Blob) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); }); } };
const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations: [open] }) as ArrayBuffer;
await Bun.write(path.join(out, 'bottle.glb'), glb);

const Wd = 256, Ht = 128, px = new Uint8Array(Wd * Ht * 4);
const box = (dx: number, dy: number, dz: number, c: THREE.Vector3, size: number, k: number) => {
  const d = new THREE.Vector3(dx, dy, dz), a = Math.acos(Math.min(1, d.dot(c)));
  return k * (1 - THREE.MathUtils.smoothstep(a, size * 0.75, size));
};
for (let y = 0; y < Ht; y++) for (let x = 0; x < Wd; x++) {
  const phi = (x / Wd) * Math.PI * 2 - Math.PI, th = (y / Ht) * Math.PI;
  const dx = Math.sin(th) * Math.sin(phi), dy = Math.cos(th), dz = -Math.sin(th) * Math.cos(phi);
  let v = 0.035 + 0.05 * Math.max(0, dy);
  v += box(dx, dy, dz, new THREE.Vector3(-0.55, 0.65, 0.5).normalize(), 0.42, 9);
  v += box(dx, dy, dz, new THREE.Vector3(0.8, 0.35, 0.2).normalize(), 0.3, 3.5);
  const strip = Math.abs(dx - 0.3) < 0.06 && dz < -0.4 && dy > -0.1 && dy < 0.85 ? 6 : 0;
  v += strip;
  const warm = dy < 0 ? 0.02 : 0;
  const rgb = [v + warm * 1.2, v + warm, v + warm * 0.7];
  const m = Math.max(...rgb), e = m < 1e-32 ? 0 : Math.ceil(Math.log2(m) + 1e-9), s = m < 1e-32 ? 0 : 256 / 2 ** e;
  const i = (y * Wd + x) * 4;
  px.set([Math.min(255, rgb[0]! * s), Math.min(255, rgb[1]! * s), Math.min(255, rgb[2]! * s), m < 1e-32 ? 0 : e + 128], i);
}
const head = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${Ht} +X ${Wd}\n`);
await Bun.write(path.join(out, 'studio.hdr'), new Blob([head, px]));
console.log(`wrote ${path.join(out, 'bottle.glb')} (${glb.byteLength} bytes) and studio.hdr`);
