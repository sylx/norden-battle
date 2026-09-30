/**
 * 骨格 × クリップの骨の姿勢をフロートテクスチャに焼き込む（部隊のインスタンス描画用）。
 *
 * テクスチャの 1 行 = 1 フレーム、1 本の骨 = 横に 4 テクセル（行列の 4 列）。
 * 行列はスキニング行列（その時刻の骨の姿勢 × 基準姿勢の逆行列）で、雛形の root の座標系。
 * 骨の順番は雛形を走査した順で、buildSoldierGeometry の skinIndex と一致する。
 */
import * as THREE from 'three';

export interface BakeClipInput {
  name: string;
  clip: THREE.AnimationClip;
  /** 省略時は名前から推定（death / die などはループしない） */
  loop?: boolean;
}

export interface BakedClip {
  name: string;
  /** テクスチャの開始行 */
  start: number;
  frames: number;
  duration: number;
  loop: boolean;
}

export interface BakedAnimations {
  texture: THREE.DataTexture;
  boneCount: number;
  fps: number;
  clips: BakedClip[];
  byName: Map<string, BakedClip>;
}

export const NON_LOOP_RE = /death|die|dying|dead|knock|fall/i;

export function bakeAnimations(template: THREE.Object3D, inputs: BakeClipInput[], fps = 30, maxRows = 4096): BakedAnimations {
  const root = template.clone(true);
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const inverses = bones.map((b) => b.matrixWorld.clone().invert());
  const rest = bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));

  const clips: BakedClip[] = [];
  let rows = 0;
  for (const input of inputs) {
    const loop = input.loop ?? !NON_LOOP_RE.test(input.name);
    const span = Math.max(1, Math.round(input.clip.duration * fps));
    // ループするクリップは最後のフレームの次が先頭に戻る。しないものは終わりの姿勢まで持つ
    const frames = loop ? span : span + 1;
    clips.push({ name: input.name, start: rows, frames, duration: input.clip.duration, loop });
    rows += frames;
  }
  if (rows > maxRows) throw new Error(`アニメーションが長すぎます（${rows} フレーム > ${maxRows}）`);

  const width = bones.length * 4;
  const data = new Float32Array(width * Math.max(rows, 1) * 4);
  const mixer = new THREE.AnimationMixer(root);
  const m = new THREE.Matrix4();
  inputs.forEach((input, ci) => {
    const baked = clips[ci];
    // 前のクリップの姿勢が残らないよう基準姿勢に戻す
    bones.forEach((b, i) => {
      b.position.copy(rest[i].p);
      b.quaternion.copy(rest[i].q);
      b.scale.copy(rest[i].s);
    });
    const action = mixer.clipAction(input.clip);
    action.setLoop(baked.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.play();
    for (let f = 0; f < baked.frames; f++) {
      const t = baked.loop ? (f / baked.frames) * input.clip.duration : Math.min(f / fps, input.clip.duration);
      mixer.setTime(t);
      root.updateMatrixWorld(true);
      const rowOffset = (baked.start + f) * width * 4;
      bones.forEach((b, i) => {
        m.multiplyMatrices(b.matrixWorld, inverses[i]);
        data.set(m.elements, rowOffset + i * 16);
      });
    }
    action.stop();
    mixer.uncacheAction(input.clip);
  });

  const texture = new THREE.DataTexture(data, width, Math.max(rows, 1), THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, boneCount: bones.length, fps, clips, byName: new Map(clips.map((c) => [c.name, c])) };
}
