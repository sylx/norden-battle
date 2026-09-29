/**
 * 部隊（大量の兵士）のインスタンス描画。
 *
 * - 見た目の違う兵士（バリアント）ごとに InstancedMesh を 1 つ持つ。ジオメトリは buildSoldierGeometry のもの。
 * - 頂点シェーダで、ベイクしたテクスチャ（bakeAnimations）から自分の骨の行列を読んでスキニングする。
 *   どの頂点も 1 本の骨にしか付いていないので、読む行列は 1 本分（前後のフレームを補間）。
 * - インスタンスごとに、クリップ（開始行・フレーム数）・開始時刻・再生の速さ・チーム色を持つ。
 *   チーム色は teamShade 属性のある頂点だけを塗り替えるので、同じジオメトリを全チームで使い回せる。
 * - 影は customDepthMaterial に同じスキニングを入れて落とす。
 */
import * as THREE from 'three';
import type { NormalizeTransform } from '../../catalog';
import type { BakedAnimations } from './bake';

const VERTEX_PARS = /* glsl */ `
uniform highp sampler2D crowdBones;
uniform float crowdTime;
attribute vec4 skinIndex;
attribute float teamShade;
// x: 開始行, y: フレーム数（負ならループしない）, z: 開始時刻（秒）, w: 1 秒に進むフレーム数
attribute vec4 instanceAnim;
attribute vec3 instanceTeam;

mat4 crowdFetch(int bone, int row) {
  int x = bone * 4;
  return mat4(
    texelFetch(crowdBones, ivec2(x, row), 0),
    texelFetch(crowdBones, ivec2(x + 1, row), 0),
    texelFetch(crowdBones, ivec2(x + 2, row), 0),
    texelFetch(crowdBones, ivec2(x + 3, row), 0)
  );
}

mat4 crowdBoneMatrix() {
  float frames = abs(instanceAnim.y);
  float f = max(crowdTime - instanceAnim.z, 0.0) * instanceAnim.w;
  float f0;
  float f1;
  if (instanceAnim.y > 0.0) {
    f = mod(f, frames);
    f0 = floor(f);
    f1 = mod(f0 + 1.0, frames);
  } else {
    f = min(f, frames - 1.0);
    f0 = floor(f);
    f1 = min(f0 + 1.0, frames - 1.0);
  }
  int bone = int(skinIndex.x + 0.5);
  int start = int(instanceAnim.x + 0.5);
  mat4 a = crowdFetch(bone, start + int(f0));
  mat4 b = crowdFetch(bone, start + int(f1));
  return a + (b - a) * (f - f0);
}
`;

export interface CrowdUniforms {
  crowdBones: { value: THREE.DataTexture };
  crowdTime: { value: number };
}

function patchMaterial(material: THREE.Material, uniforms: CrowdUniforms, depth: boolean): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERTEX_PARS}`);
    if (depth) {
      vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\nmat4 crowdM = crowdBoneMatrix();\ntransformed = (crowdM * vec4(transformed, 1.0)).xyz;');
    } else {
      vs = vs
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nmat4 crowdM = crowdBoneMatrix();\nobjectNormal = mat3(crowdM) * objectNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = (crowdM * vec4(transformed, 1.0)).xyz;')
        .replace('#include <color_vertex>', '#include <color_vertex>\nif (teamShade > 0.0) vColor.rgb = instanceTeam * teamShade;');
    }
    shader.vertexShader = vs;
  };
  material.customProgramCacheKey = () => (depth ? 'crowd-depth' : 'crowd');
}

export interface CrowdInstance {
  /** 置き場所（normalize の後に掛かる。位置・向き） */
  matrix: THREE.Matrix4;
  team: THREE.Color;
  clip: string;
  /** クリップの再生を始める時刻（秒、Crowd の時計）。負にすると途中から始まる */
  startTime: number;
  speed: number;
}

interface VariantMesh {
  mesh: THREE.InstancedMesh;
  anim: THREE.InstancedBufferAttribute;
  team: THREE.InstancedBufferAttribute;
}

export class Crowd {
  readonly object = new THREE.Group();
  readonly uniforms: CrowdUniforms;
  private readonly baked: BakedAnimations;
  private readonly variants: VariantMesh[] = [];
  private readonly normalize: THREE.Matrix4;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly depthMaterial: THREE.MeshDepthMaterial;
  private readonly _m = new THREE.Matrix4();

  /**
   * @param geometries バリアントごとのジオメトリ（同じ骨格の雛形から作ったもの）
   * @param normalize 雛形の座標系 → 身長 UNITS.soldierHeight・足元が原点（buildSoldierGeometry の transform）
   * @param capacity バリアントごとの最大数
   */
  constructor(baked: BakedAnimations, geometries: THREE.BufferGeometry[], normalize: NormalizeTransform, capacity: number) {
    this.baked = baked;
    this.object.name = 'crowd';
    this.uniforms = { crowdBones: { value: baked.texture }, crowdTime: { value: 0 } };
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.72, metalness: 0 });
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    patchMaterial(this.material, this.uniforms, false);
    patchMaterial(this.depthMaterial, this.uniforms, true);

    const [px, py, pz] = normalize.pivot;
    this.normalize = new THREE.Matrix4().makeTranslation(px, py, pz).premultiply(new THREE.Matrix4().makeScale(normalize.scale, normalize.scale, normalize.scale));

    for (const geometry of geometries) {
      const mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
      mesh.customDepthMaterial = this.depthMaterial;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // 骨で動くので、基準姿勢のバウンディングでは判定できない
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const team = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('instanceAnim', anim);
      geometry.setAttribute('instanceTeam', team);
      this.variants.push({ mesh, anim, team });
      this.object.add(mesh);
    }
  }

  get variantCount(): number {
    return this.variants.length;
  }

  get count(): number {
    return this.variants.reduce((n, v) => n + v.mesh.count, 0);
  }

  /** 兵士を 1 体足す。戻り値は [バリアント, 番号]（set で使う） */
  add(variant: number, inst: CrowdInstance): [number, number] {
    const v = this.variants[variant];
    if (!v) throw new Error(`バリアント ${variant} はありません`);
    if (v.mesh.count >= v.anim.count) throw new Error('部隊の上限を超えました');
    const index = v.mesh.count++;
    this.set(variant, index, inst);
    return [variant, index];
  }

  set(variant: number, index: number, inst: Partial<CrowdInstance>): void {
    const v = this.variants[variant];
    if (inst.matrix) {
      v.mesh.setMatrixAt(index, this._m.multiplyMatrices(inst.matrix, this.normalize));
      v.mesh.instanceMatrix.needsUpdate = true;
    }
    if (inst.team) {
      v.team.setXYZ(index, inst.team.r, inst.team.g, inst.team.b);
      v.team.needsUpdate = true;
    }
    if (inst.clip !== undefined) {
      const c = this.baked.byName.get(inst.clip) ?? this.baked.clips[0];
      const rate = c.loop ? c.frames / c.duration : this.baked.fps;
      v.anim.setXYZW(index, c.start, c.loop ? c.frames : -c.frames, inst.startTime ?? 0, rate * (inst.speed ?? 1));
      v.anim.needsUpdate = true;
    } else if (inst.startTime !== undefined) {
      v.anim.setZ(index, inst.startTime);
      v.anim.needsUpdate = true;
    }
  }

  clear(): void {
    for (const v of this.variants) v.mesh.count = 0;
  }

  /** 時計を進める（秒） */
  setTime(t: number): void {
    this.uniforms.crowdTime.value = t;
  }

  get time(): number {
    return this.uniforms.crowdTime.value;
  }

  dispose(): void {
    for (const v of this.variants) {
      v.mesh.geometry.dispose();
      v.mesh.dispose();
    }
    this.material.dispose();
    this.depthMaterial.dispose();
    this.object.removeFromParent();
  }
}
