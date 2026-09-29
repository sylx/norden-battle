/**
 * 取り込み時の初期値（カテゴリの推定・スケールと原点の初期値）。
 */
import { UNITS, type CategoryId, type NormalizeTransform, type Vec3Tuple } from '@norden/asset-runtime';
import type * as THREE from 'three';
import type { ParsedModel } from './loadModel';
import { withNormalized } from './stats';

/** カテゴリごとの高さの目安（null は実寸から換算する） */
export const CATEGORY_HEIGHT: Record<CategoryId, number | null> = {
  building: UNITS.houseHeight,
  fortification: UNITS.castleWallHeight,
  prop: null,
  nature: UNITS.treeHeight,
  character: UNITS.soldierHeight,
  equipment: null,
  // モーションは同じ骨格のキャラと同じ大きさで見る
  animation: UNITS.soldierHeight,
};

/** 身長 1.75m の人を基準にした 1m あたりの長さ */
const HUMAN_METERS = 1.75;

export function guessCategory(p: ParsedModel): CategoryId {
  let meshes = 0;
  let skinned = false;
  p.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes++;
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  if (meshes === 0 && p.animations.length > 0) return 'animation';
  if (skinned) return 'character';
  return 'prop';
}

/** 回転なし・足元に原点・カテゴリの目安の高さ（なければ実寸換算）にそろえた変換 */
export function initialTransform(root: THREE.Object3D, category: CategoryId): NormalizeTransform {
  return withNormalized(root, (n) => {
    const pivot: Vec3Tuple = n.feetPivot();
    const h = n.measureRotated().max.y + pivot[1];
    const target = CATEGORY_HEIGHT[category];
    let scale = 1;
    if (h > 0 && target !== null) {
      scale = target / h;
    } else if (h > 0) {
      // 実寸（m）とみなして換算する。大きすぎるものは cm とみなす（Mixamo など）
      const unitsPerMeter = (category === 'equipment' ? UNITS.soldierHeight : UNITS.humanHeight) / HUMAN_METERS;
      scale = unitsPerMeter * (h > 30 ? 0.01 : 1);
    }
    return { rotation: [0, 0, 0], pivot: pivot.map(round) as Vec3Tuple, scale: roundScale(scale) };
  });
}

const round = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
/** 有効数字 4 桁 */
export const roundScale = (v: number) => Number(v.toPrecision(4));
