/**
 * モデルの統計（ポリ数・マテリアル・テクスチャ・骨・アニメーション・大きさ）。
 */
import { IDENTITY_TRANSFORM, type AssetStats, type Vec3Tuple } from '@norden/asset-runtime';
import { NormalizedModel } from '@norden/asset-runtime/three';
import * as THREE from 'three';

export function computeStats(root: THREE.Object3D, animations: THREE.AnimationClip[]): AssetStats {
  let triangles = 0;
  let vertices = 0;
  let meshes = 0;
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const bones = new Set<THREE.Bone>();

  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.add(o as THREE.Bone);
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes++;
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    if (pos) vertices += pos.count;
    triangles += Math.floor((g.index ? g.index.count : (pos?.count ?? 0)) / 3);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(m);
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
    }
  });

  let maxTextureSize = 0;
  for (const t of textures) {
    const img = t.image as { width?: number; height?: number } | null;
    if (img?.width && img.height) maxTextureSize = Math.max(maxTextureSize, img.width, img.height);
  }

  return {
    triangles,
    vertices,
    meshes,
    materials: materials.size,
    textures: textures.size,
    maxTextureSize,
    bones: bones.size,
    animations: animations.map((c) => ({ name: c.name, duration: Math.round(c.duration * 1000) / 1000 })),
    rawSize: measureRaw(root),
  };
}

/** 正規化前（回転なし）の大きさ */
export function measureRaw(root: THREE.Object3D): Vec3Tuple {
  return withNormalized(root, (n) => {
    const box = n.measureRotated();
    if (box.isEmpty()) return [0, 0, 0];
    const s = box.getSize(new THREE.Vector3());
    return [round(s.x), round(s.y), round(s.z)];
  });
}

/** 親から外れているモデルを一時的に NormalizedModel に包んで計算する */
export function withNormalized<T>(root: THREE.Object3D, fn: (n: NormalizedModel) => T): T {
  const n = new NormalizedModel(root, IDENTITY_TRANSFORM);
  try {
    return fn(n);
  } finally {
    root.removeFromParent();
    root.updateMatrixWorld(true);
  }
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;
