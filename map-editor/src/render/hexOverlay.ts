/**
 * HEX グリッドのオーバーレイ。
 *
 * 地形メッシュのフラグメントシェーダ内でワールド XZ 座標から HEX を逆算して線を描く。
 * ジオメトリを別に持たないので、どんな起伏にも完全に沿い、Z ファイティングも起きない。
 * HEX ごとの塗り（移動範囲表示など）は cols×rows の DataTexture で渡す。
 */
import * as THREE from 'three';
import type { HexLayout } from '../core/hex';

export interface HexOverlayUniforms {
  [name: string]: THREE.IUniform;
  uHexSize: THREE.IUniform<number>;
  uHexFlat: THREE.IUniform<number>;
  uGridDim: THREE.IUniform<THREE.Vector2>;
  uGridColor: THREE.IUniform<THREE.Color>;
  uGridOpacity: THREE.IUniform<number>;
  uLineWidth: THREE.IUniform<number>;
  uHover: THREE.IUniform<THREE.Vector2>;
  uSelected: THREE.IUniform<THREE.Vector2>;
  uCellTex: THREE.IUniform<THREE.DataTexture>;
  uCellOpacity: THREE.IUniform<number>;
  uWaterLevel: THREE.IUniform<number>;
  uGrain: THREE.IUniform<number>;
}

const GLSL_COMMON = /* glsl */ `
uniform float uHexSize;
uniform int uHexFlat;
uniform vec2 uGridDim;
uniform vec3 uGridColor;
uniform float uGridOpacity;
uniform float uLineWidth;
uniform vec2 uHover;
uniform vec2 uSelected;
uniform sampler2D uCellTex;
uniform float uCellOpacity;
uniform float uWaterLevel;
uniform float uGrain;
varying vec3 vHexWorld;

// xy = オフセット座標 (col,row), z = 最寄りの辺までの距離
vec3 hexInfo(vec2 p) {
  float s = uHexSize;
  vec2 a;
  if (uHexFlat == 1) {
    a = vec2((2.0 / 3.0 * p.x) / s, (-1.0 / 3.0 * p.x + 0.57735027 * p.y) / s);
  } else {
    a = vec2((0.57735027 * p.x - 1.0 / 3.0 * p.y) / s, (2.0 / 3.0 * p.y) / s);
  }
  vec3 cube = vec3(a.x, a.y, -a.x - a.y);
  vec3 rc = round(cube);
  vec3 df = abs(rc - cube);
  if (df.x > df.y && df.x > df.z) rc.x = -rc.y - rc.z;
  else if (df.y > df.z) rc.y = -rc.x - rc.z;
  int q = int(rc.x);
  int r = int(rc.y);
  vec2 center;
  float m;
  ivec2 off;
  if (uHexFlat == 1) {
    center = vec2(s * 1.5 * float(q), s * 1.7320508 * (float(r) + float(q) * 0.5));
    off = ivec2(q, r + (q - (q & 1)) / 2);
    vec2 lp = p - center;
    m = max(abs(lp.y), max(abs(dot(lp, vec2(0.8660254, 0.5))), abs(dot(lp, vec2(0.8660254, -0.5)))));
  } else {
    center = vec2(s * 1.7320508 * (float(q) + float(r) * 0.5), s * 1.5 * float(r));
    off = ivec2(q + (r - (r & 1)) / 2, r);
    vec2 lp = p - center;
    m = max(abs(lp.x), max(abs(dot(lp, vec2(0.5, 0.8660254))), abs(dot(lp, vec2(0.5, -0.8660254)))));
  }
  return vec3(vec2(off), s * 0.8660254 - m);
}

float hexHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float hexValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hexHash(i);
  float b = hexHash(i + vec2(1.0, 0.0));
  float c = hexHash(i + vec2(0.0, 1.0));
  float d = hexHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

const GLSL_COLOR = /* glsl */ `
vec3 hexI = hexInfo(vHexWorld.xz);
float hexD = hexI.z;
float hexFw = fwidth(hexD);
bool hexInMap = hexI.x >= 0.0 && hexI.y >= 0.0 && hexI.x < uGridDim.x && hexI.y < uGridDim.y;
#ifdef HEX_CLIP_UNDERWATER
  // 水面下の地形には描かない（水面側で描く）
  hexInMap = hexInMap && vHexWorld.y > uWaterLevel - 0.005;
#endif
bool hexIsHover = hexInMap && all(equal(hexI.xy, uHover));
bool hexIsSel = hexInMap && all(equal(hexI.xy, uSelected));
float hexLine = 0.0;
vec3 hexLineColor = uGridColor;

#ifdef HEX_GRAIN
  // 頂点色だけだと単調なので細かい粒状感を足す
  float hexG = hexValueNoise(vHexWorld.xz * 9.0) * 0.6 + hexValueNoise(vHexWorld.xz * 23.0) * 0.4;
  diffuseColor.rgb *= 1.0 + (hexG - 0.5) * uGrain;
#endif

if (hexInMap) {
  vec4 hexCell = texelFetch(uCellTex, ivec2(hexI.xy), 0);
  diffuseColor.rgb = mix(diffuseColor.rgb, hexCell.rgb, hexCell.a * uCellOpacity);

  float lw = uLineWidth;
  float op = uGridOpacity;
  if (hexIsSel) {
    lw *= 3.0;
    op = 1.0;
    hexLineColor = vec3(1.0, 0.72, 0.18);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.85, 0.45), 0.12);
  } else if (hexIsHover) {
    lw *= 1.8;
    op = max(op, 0.9);
    hexLineColor = vec3(1.0, 0.95, 0.8);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.97, 0.85), 0.16);
  }
  hexLine = (1.0 - smoothstep(lw - hexFw, lw + hexFw, hexD)) * op;
  diffuseColor.rgb = mix(diffuseColor.rgb, hexLineColor, hexLine);
#ifdef HEX_WATER
  diffuseColor.a = mix(diffuseColor.a, 1.0, hexLine);
#endif
}
`;

const GLSL_EMISSIVE = /* glsl */ `
// 影の中でも線が見えるよう少し自己発光させる
totalEmissiveRadiance += hexLineColor * hexLine * 0.25;
`;

export class HexOverlay {
  readonly uniforms: HexOverlayUniforms;

  constructor() {
    this.uniforms = {
      uHexSize: { value: 1 },
      uHexFlat: { value: 1 },
      uGridDim: { value: new THREE.Vector2(1, 1) },
      uGridColor: { value: new THREE.Color(0x3a2c1e) },
      uGridOpacity: { value: 0.4 },
      uLineWidth: { value: 0.025 },
      uHover: { value: new THREE.Vector2(-1, -1) },
      uSelected: { value: new THREE.Vector2(-1, -1) },
      uCellTex: { value: HexOverlay.makeCellTexture(1, 1) },
      uCellOpacity: { value: 0.55 },
      uWaterLevel: { value: 0 },
      uGrain: { value: 0.22 },
    };
  }

  private static makeCellTexture(cols: number, rows: number): THREE.DataTexture {
    const tex = new THREE.DataTexture(new Uint8Array(cols * rows * 4), cols, rows, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  setLayout(layout: HexLayout): void {
    const u = this.uniforms;
    u.uHexSize.value = layout.size;
    u.uHexFlat.value = layout.flat ? 1 : 0;
    u.uGridDim.value.set(layout.cols, layout.rows);
    u.uLineWidth.value = 0.025 * layout.size;
    u.uCellTex.value.dispose();
    u.uCellTex.value = HexOverlay.makeCellTexture(layout.cols, layout.rows);
    u.uHover.value.set(-1, -1);
    u.uSelected.value.set(-1, -1);
  }

  /** HEX ごとの塗り色を設定する（color = null で塗りなし） */
  setCellColors(fn: (col: number, row: number) => THREE.Color | null): void {
    const tex = this.uniforms.uCellTex.value;
    const { width, height } = tex.image as { width: number; height: number };
    const data = tex.image.data as Uint8Array;
    const tmp = new THREE.Color();
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const c = fn(col, row);
        const k = (row * width + col) * 4;
        if (!c) {
          data[k + 3] = 0;
          continue;
        }
        tmp.copy(c).convertLinearToSRGB();
        data[k] = Math.round(tmp.r * 255);
        data[k + 1] = Math.round(tmp.g * 255);
        data[k + 2] = Math.round(tmp.b * 255);
        data[k + 3] = 255;
      }
    }
    tex.needsUpdate = true;
  }

  /** MeshStandardMaterial 系のマテリアルにオーバーレイを組み込む */
  apply(material: THREE.MeshStandardMaterial, opts: { water?: boolean; clipUnderwater?: boolean; grain?: boolean } = {}): void {
    material.defines ??= {};
    if (opts.water) material.defines.HEX_WATER = '';
    if (opts.clipUnderwater) material.defines.HEX_CLIP_UNDERWATER = '';
    if (opts.grain) material.defines.HEX_GRAIN = '';
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHexWorld;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvHexWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLSL_COMMON}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${GLSL_COLOR}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${GLSL_EMISSIVE}`);
    };
    material.customProgramCacheKey = () => `hex-overlay-${opts.water ? 1 : 0}${opts.clipUnderwater ? 1 : 0}${opts.grain ? 1 : 0}`;
    material.needsUpdate = true;
  }
}
