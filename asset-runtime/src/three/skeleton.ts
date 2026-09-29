/**
 * スケルトンの判定と、Mixamo の骨の名前の正規化。
 *
 * Mixamo の骨の名前は書き出し方によって "mixamorig:Hips" "mixamorig1:Hips" "mixamorigHips" などに揺れる
 * （three.js のローダーは ":" を取り除く）。すべて "mixamorigHips" の形にそろえておけば、
 * どのキャラにもどのモーションもそのまま当てられる。
 */
import * as THREE from 'three';
import type { SkeletonKind } from '../catalog';

export const MIXAMO_PREFIX = 'mixamorig';

/** 判定に使う主要な骨（接頭辞なし） */
const MIXAMO_KEY_BONES = ['Hips', 'Spine', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightUpLeg', 'RightLeg', 'RightFoot'];

const MIXAMO_NAME_RE = /^mixamorig\d*:?/;

/** 骨の名前を正規化する（Mixamo 以外の名前はそのまま） */
export function canonicalBoneName(name: string): string {
  return MIXAMO_NAME_RE.test(name) ? MIXAMO_PREFIX + name.replace(MIXAMO_NAME_RE, '') : name;
}

export function collectBones(root: THREE.Object3D): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  return bones;
}

/** 骨の名前（正規化済み）からスケルトンの種類を判定する */
export function detectSkeletonKind(boneNames: string[]): SkeletonKind {
  if (boneNames.length === 0) return 'none';
  const set = new Set(boneNames);
  return MIXAMO_KEY_BONES.every((b) => set.has(MIXAMO_PREFIX + b)) ? 'mixamo' : 'other';
}

/**
 * モデルの骨とアニメーションのトラックの名前を正規化し、スケルトンの種類を返す。
 * root と clips はその場で書き換える。
 */
export function normalizeSkeleton(root: THREE.Object3D, clips: THREE.AnimationClip[]): SkeletonKind {
  const bones = collectBones(root);
  for (const b of bones) b.name = canonicalBoneName(b.name);
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf('.');
      if (dot > 0) track.name = canonicalBoneName(track.name.slice(0, dot)) + track.name.slice(dot);
    }
  }
  return detectSkeletonKind(bones.map((b) => b.name));
}

/**
 * スキンを持たないモーションだけのファイル（Mixamo の Without Skin を GLB にしたもの）は、
 * 読み込むと骨が普通の Object3D になる。アニメーションの対象になっているノードを Bone に戻す。
 * @returns Bone に戻したノードの数
 */
export function promoteAnimatedNodesToBones(root: THREE.Object3D, clips: THREE.AnimationClip[]): number {
  const targets = new Set<string>();
  for (const clip of clips) {
    for (const track of clip.tracks) targets.add(THREE.PropertyBinding.parseTrackName(track.name).nodeName);
  }
  const replace: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && targets.has(o.name) && !(o as THREE.Bone).isBone && o.type === 'Object3D') replace.push(o);
  });
  for (const o of replace) {
    const bone = new THREE.Bone();
    bone.name = o.name;
    bone.position.copy(o.position);
    bone.quaternion.copy(o.quaternion);
    bone.scale.copy(o.scale);
    bone.userData = o.userData;
    const parent = o.parent!;
    parent.children[parent.children.indexOf(o)] = bone;
    bone.parent = parent;
    o.parent = null;
    for (const c of [...o.children]) bone.add(c);
  }
  root.updateMatrixWorld(true);
  return replace.length;
}
