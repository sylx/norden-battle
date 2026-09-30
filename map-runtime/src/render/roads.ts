/**
 * 街道のメッシュ。道の中心線に沿って地形に貼り付く帯を作り、縁はアルファでぼかす。
 */
import * as THREE from 'three';
import type { Vec2 } from '../core/hex';
import { ROAD_WIDTH } from '../core/roads';
import type { Heightmap } from '../core/terrainGen';

const FADE = 0.03;
const LIFT = 0.006;

const DIRT = new THREE.Color(0x8d7858);
const DIRT_WORN = new THREE.Color(0xa08a68);

export function buildRoadMesh(paths: Vec2[][], hm: Heightmap, waterLevel: number, hexSize: number): THREE.Mesh | null {
  if (paths.length === 0) return null;
  const hw = (ROAD_WIDTH * hexSize) / 2;
  const fade = FADE * hexSize;
  // 横断方向の 4 点: 外側(透明) - 内側 - 内側 - 外側(透明)
  const offsets = [-(hw + fade), -hw * 0.6, hw * 0.6, hw + fade];
  const alphas = [0, 1, 1, 0];

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const n = [0, 0, 0];
  const c = new THREE.Color();

  for (const path of paths) {
    if (path.length < 2) continue;
    const base = pos.length / 3;
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const a = path[Math.max(i - 1, 0)];
      const b = path[Math.min(i + 1, path.length - 1)];
      const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const px = -(b.z - a.z) / tl;
      const pz = (b.x - a.x) / tl;
      // 水に入るところは消す
      const center = hm.heightAt(p.x, p.z);
      const dry = THREE.MathUtils.smoothstep(center, waterLevel + 0.002, waterLevel + 0.03);
      for (let k = 0; k < 4; k++) {
        const x = p.x + px * offsets[k];
        const z = p.z + pz * offsets[k];
        pos.push(x, hm.heightAt(x, z) + LIFT, z);
        hm.normalAt(x, z, n);
        nor.push(n[0], n[1], n[2]);
        c.copy(k === 1 || k === 2 ? DIRT_WORN : DIRT);
        col.push(c.r, c.g, c.b, alphas[k] * dry);
      }
      if (i > 0) {
        const r0 = base + (i - 1) * 4;
        const r1 = base + i * 4;
        for (let k = 0; k < 3; k++) {
          idx.push(r0 + k, r0 + k + 1, r1 + k + 1);
          idx.push(r0 + k, r1 + k + 1, r1 + k);
        }
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();

  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoadPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvRoadPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vRoadPos;
float roadHash(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float roadNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(roadHash(i), roadHash(i + vec2(1.0, 0.0)), f.x), mix(roadHash(i + vec2(0.0, 1.0)), roadHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float g = roadNoise(vRoadPos.xz * 40.0) * 0.5 + roadNoise(vRoadPos.xz * 9.0) * 0.5;
  diffuseColor.rgb *= 0.82 + 0.3 * g;
  // 縁を不規則にかじる
  diffuseColor.a *= smoothstep(0.15, 0.55, diffuseColor.a + (roadNoise(vRoadPos.xz * 22.0) - 0.5) * 0.5);
}`,
      );
  };
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  mesh.renderOrder = 0;
  mesh.name = 'roads';
  return mesh;
}
