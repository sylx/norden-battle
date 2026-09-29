/**
 * 読み込んだモデルを GLB に変換する。
 * FBX・OBJ の Phong / Lambert マテリアルは glTF で表せないので、先に MeshStandardMaterial に置き換える。
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export async function exportGlb(root: THREE.Object3D, animations: THREE.AnimationClip[]): Promise<ArrayBuffer> {
  toStandardMaterials(root);
  const out = await new GLTFExporter().parseAsync(root, { binary: true, animations, onlyVisible: false });
  if (!(out instanceof ArrayBuffer)) throw new Error('GLB への変換に失敗しました');
  return out;
}

function toStandardMaterials(root: THREE.Object3D): void {
  const cache = new Map<THREE.Material, THREE.Material>();
  const convert = (m: THREE.Material): THREE.Material => {
    if (!(m instanceof THREE.MeshPhongMaterial || m instanceof THREE.MeshLambertMaterial)) return m;
    let s = cache.get(m);
    if (!s) {
      s = new THREE.MeshStandardMaterial({
        name: m.name,
        color: m.color,
        map: m.map,
        normalMap: m instanceof THREE.MeshPhongMaterial ? m.normalMap : null,
        emissive: m.emissive,
        emissiveMap: m.emissiveMap,
        alphaMap: m.alphaMap,
        transparent: m.transparent,
        opacity: m.opacity,
        alphaTest: m.alphaTest,
        side: m.side,
        vertexColors: m.vertexColors,
        roughness: m instanceof THREE.MeshPhongMaterial ? 1 - Math.min(m.shininess, 100) / 125 : 0.9,
        metalness: 0,
      });
      cache.set(m, s);
    }
    return s;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
  });
}
