/**
 * 人工物用マテリアル。
 * 頂点属性 aPattern で面ごとの模様（石積み・瓦・板張り・漆喰）を選び、ワールド座標からシェーダで描く。
 * テクスチャや UV を用意しなくても、どの向きの面にも継ぎ目なく模様が乗る。
 */
import * as THREE from 'three';

export const PAT = {
  None: 0,
  Masonry: 1,
  Roof: 2,
  Wood: 3,
  Plaster: 4,
} as const;
export type Pattern = (typeof PAT)[keyof typeof PAT];

const VERTEX_PARS = /* glsl */ `
attribute float aPattern;
varying float vPattern;
varying vec3 vSPos;
varying vec3 vSNor;
`;

const FRAGMENT_PARS = /* glsl */ `
varying float vPattern;
varying vec3 vSPos;
varying vec3 vSNor;

float sHash(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}
float sNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), f.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const FRAGMENT_PATTERN = /* glsl */ `
{
  int pat = int(vPattern + 0.5);
  vec3 sn = normalize(vSNor);
  // 面に沿った 2D 座標（水平面は xz、それ以外は「面に沿った水平方向」と高さ）
  vec2 fc = abs(sn.y) > 0.92 ? vSPos.xz : vec2(dot(vSPos.xz, normalize(vec2(-sn.z, sn.x) + 1e-5)), vSPos.y);
  if (pat == 1) {
    // 石積み
    vec2 b = fc / vec2(0.034, 0.017);
    b.x += mod(floor(b.y), 2.0) * 0.5;
    vec2 id = floor(b);
    vec2 f = fract(b);
    float fw = max(length(fwidth(b)), 1e-4);
    float fade = 1.0 - smoothstep(0.25, 0.8, fw);
    float m = min(min(f.x, 1.0 - f.x) * 2.0, min(f.y, 1.0 - f.y));
    float mortar = smoothstep(0.05, 0.05 + fw, m);
    float tint = 0.84 + 0.32 * sHash(id);
    diffuseColor.rgb *= mix(1.0, tint * mix(0.55, 1.0, mortar), fade);
  } else if (pat == 2) {
    // 瓦（段ごとに下端が暗い）
    vec2 b = fc / vec2(0.016, 0.009);
    b.x += mod(floor(b.y), 2.0) * 0.5;
    vec2 id = floor(b);
    vec2 f = fract(b);
    float fw = max(length(fwidth(b)), 1e-4);
    float fade = 1.0 - smoothstep(0.3, 0.9, fw);
    float shade = mix(0.6, 1.0, smoothstep(0.0, 0.45, f.y)) * mix(0.8, 1.0, smoothstep(0.0, 0.08 + fw, min(f.x, 1.0 - f.x)));
    float tint = 0.88 + 0.24 * sHash(id);
    diffuseColor.rgb *= mix(1.0, shade * tint, fade);
  } else if (pat == 3) {
    // 板張り（縦板）
    vec2 b = fc / vec2(0.011, 0.09);
    b.y += sHash(vec2(floor(b.x), 3.0)) * 3.0;
    vec2 id = floor(b);
    vec2 f = fract(b);
    float fw = max(length(fwidth(b)), 1e-4);
    float fade = 1.0 - smoothstep(0.3, 0.9, fw);
    float gap = smoothstep(0.03, 0.08 + fw, min(f.x, 1.0 - f.x));
    float grain = 0.92 + 0.08 * sin(f.y * 40.0 + sHash(id) * 20.0);
    diffuseColor.rgb *= mix(1.0, mix(0.55, 1.0, gap) * grain * (0.85 + 0.3 * sHash(id)), fade);
  } else if (pat == 4) {
    // 漆喰（うっすらした汚れ）
    float nz = sNoise(fc * 60.0) * 0.6 + sNoise(fc * 13.0) * 0.4;
    diffuseColor.rgb *= 0.9 + 0.14 * nz;
  }
}
`;

export function createStructureMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPattern = aPattern;\nvSNor = normalize(mat3(modelMatrix) * normal);')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_PATTERN}`);
  };
  m.customProgramCacheKey = () => 'structure-patterns';
  return m;
}
