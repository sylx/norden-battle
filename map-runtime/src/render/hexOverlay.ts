/**
 * HEX グリッドのオーバーレイ。
 *
 * 地形メッシュのフラグメントシェーダ内でワールド XZ 座標から HEX を逆算して線を描く。
 * ジオメトリを別に持たないので、どんな起伏にも完全に沿い、Z ファイティングも起きない。
 * HEX ごとの塗り（地形の確認用など）は cols×rows の DataTexture で渡す。
 * 移動範囲などの「範囲」は別の cols×rows のテクスチャで渡し、塗りと範囲の外周の縁取りで見せる。
 * 範囲の中の一部の HEX には印（別の色の斜線。移動範囲では「敵の ZOC で止まる」）を付けられる。
 * 範囲の中で薄く塗るだけの HEX（weak。攻撃範囲のうち相手のいない HEX など）も混ぜられる。
 */
import * as THREE from 'three';
import type { HexLayout, Offset } from '../core/hex';

/** 範囲の HEX。mark は印（斜線）を付け、weak は薄く塗る */
export type RangeCell = Offset & { mark?: boolean; weak?: boolean };

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
  /** 選択中のユニットの HEX（脈打つ光で強調する） */
  uFocus: THREE.IUniform<THREE.Vector2>;
  /** 強調の明滅に使う時間（秒） */
  uTime: THREE.IUniform<number>;
  /** 範囲（移動範囲など）。r = 1 は範囲内、r = 0.5 は範囲内で印付き、r = 0.25 は範囲内で薄く塗る、0 は範囲外 */
  uRangeTex: THREE.IUniform<THREE.DataTexture>;
  uRangeColor: THREE.IUniform<THREE.Color>;
  uRangeMarkColor: THREE.IUniform<THREE.Color>;
  /** 範囲を出しているか（0 / 1） */
  uRangeOn: THREE.IUniform<number>;
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
uniform vec2 uFocus;
uniform float uTime;
uniform sampler2D uRangeTex;
uniform vec3 uRangeColor;
uniform vec3 uRangeMarkColor;
uniform int uRangeOn;
uniform sampler2D uCellTex;
uniform float uCellOpacity;
uniform float uWaterLevel;
uniform float uGrain;
varying vec3 vHexWorld;

// xy = オフセット座標 (col,row), z = 最寄りの辺までの距離。lp = HEX の中心からの位置
vec3 hexInfo(vec2 p, out vec2 lp) {
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
    lp = p - center;
    m = max(abs(lp.y), max(abs(dot(lp, vec2(0.8660254, 0.5))), abs(dot(lp, vec2(0.8660254, -0.5)))));
  } else {
    center = vec2(s * 1.7320508 * (float(q) + float(r) * 0.5), s * 1.5 * float(r));
    off = ivec2(q + (r - (r & 1)) / 2, r);
    lp = p - center;
    m = max(abs(lp.x), max(abs(dot(lp, vec2(0.5, 0.8660254))), abs(dot(lp, vec2(0.5, -0.8660254)))));
  }
  return vec3(vec2(off), s * 0.8660254 - m);
}

vec3 hexInfo(vec2 p) {
  vec2 lp;
  return hexInfo(p, lp);
}

// 中心から lp の位置にいちばん近い辺の向こう側の HEX のオフセット座標
vec2 hexAcross(vec2 p, vec2 lp) {
  vec2 n0 = uHexFlat == 1 ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
  vec2 n1 = uHexFlat == 1 ? vec2(0.8660254, 0.5) : vec2(0.5, 0.8660254);
  vec2 n2 = uHexFlat == 1 ? vec2(0.8660254, -0.5) : vec2(0.5, -0.8660254);
  float d0 = dot(lp, n0);
  float d1 = dot(lp, n1);
  float d2 = dot(lp, n2);
  vec2 n = n0 * sign(d0);
  float best = abs(d0);
  if (abs(d1) > best) { n = n1 * sign(d1); best = abs(d1); }
  if (abs(d2) > best) n = n2 * sign(d2);
  // 隣の中心は辺の法線の向きに内接円の直径ぶん先
  return hexInfo(p - lp + n * (uHexSize * 1.7320508)).xy;
}

bool hexInRange(vec2 off) {
  if (off.x < 0.0 || off.y < 0.0 || off.x >= uGridDim.x || off.y >= uGridDim.y) return false;
  return texelFetch(uRangeTex, ivec2(off), 0).r > 0.125;
}

bool hexRangeMarked(vec2 off) {
  float r = texelFetch(uRangeTex, ivec2(off), 0).r;
  return r > 0.375 && r < 0.75;
}

bool hexRangeWeak(vec2 off) {
  return texelFetch(uRangeTex, ivec2(off), 0).r < 0.375;
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
vec2 hexLp;
vec3 hexI = hexInfo(vHexWorld.xz, hexLp);
float hexD = hexI.z;
float hexFw = fwidth(hexD);
bool hexInMap = hexI.x >= 0.0 && hexI.y >= 0.0 && hexI.x < uGridDim.x && hexI.y < uGridDim.y;
#ifdef HEX_CLIP_UNDERWATER
  // 水面下の地形には描かない（水面側で描く）
  hexInMap = hexInMap && vHexWorld.y > uWaterLevel - 0.005;
#endif
bool hexIsHover = hexInMap && all(equal(hexI.xy, uHover));
bool hexIsSel = hexInMap && all(equal(hexI.xy, uSelected));
bool hexIsFocus = hexInMap && all(equal(hexI.xy, uFocus));
float hexLine = 0.0;
vec3 hexLineColor = uGridColor;
float hexFocus = 0.0;
vec3 hexFocusColor = vec3(1.0, 0.76, 0.22);
float hexRangeEdge = 0.0;

#ifdef HEX_GRAIN
  // 頂点色だけだと単調なので細かい粒状感を足す
  float hexG = hexValueNoise(vHexWorld.xz * 9.0) * 0.6 + hexValueNoise(vHexWorld.xz * 23.0) * 0.4;
  diffuseColor.rgb *= 1.0 + (hexG - 0.5) * uGrain;
#endif

if (hexInMap) {
  vec4 hexCell = texelFetch(uCellTex, ivec2(hexI.xy), 0);
  diffuseColor.rgb = mix(diffuseColor.rgb, hexCell.rgb, hexCell.a * uCellOpacity);

  bool hexIsRange = uRangeOn == 1 && hexInRange(hexI.xy);
  if (hexIsRange) {
    // 範囲内はゆっくり明滅する塗り（weak は薄く）。印付きの HEX は別の色の斜線を重ねる
    float hexFill = hexRangeWeak(hexI.xy) ? 0.12 : 0.3 + 0.06 * sin(uTime * 2.5);
    diffuseColor.rgb = mix(diffuseColor.rgb, uRangeColor, hexFill);
    if (hexRangeMarked(hexI.xy)) {
      float stripe = step(0.5, fract((vHexWorld.x - vHexWorld.z) / (uHexSize * 0.22)));
      diffuseColor.rgb = mix(diffuseColor.rgb, uRangeMarkColor, 0.25 + 0.3 * stripe);
    }
    // 範囲の外周（隣が範囲外の辺）に縁取りと内側へのにじみ
    float ew = uLineWidth * 2.5;
    if (hexD < ew * 6.0 && !hexInRange(hexAcross(vHexWorld.xz, hexLp))) {
      float line = 1.0 - smoothstep(ew - hexFw, ew + hexFw, hexD);
      float glow = exp(-hexD / (ew * 2.0)) * 0.5;
      hexRangeEdge = max(line, glow);
    }
  }

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
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(uRangeColor, vec3(1.0), 0.45), hexRangeEdge);

  if (hexIsFocus) {
    // 0 = 辺、1 = 中心
    float t = clamp(hexD / (uHexSize * 0.8660254), 0.0, 1.0);
    float pulse = 0.5 + 0.5 * sin(uTime * 4.0);
    // 脈打つ太い縁取り
    float bw = uLineWidth * (3.0 + 1.5 * pulse);
    float rim = 1.0 - smoothstep(bw - hexFw, bw + hexFw, hexD);
    // 縁から内側へにじむ光
    float glow = exp(-t * 6.0) * (0.35 + 0.35 * pulse);
    // 中心から縁へ繰り返し広がる波紋
    float ph = fract(uTime * 0.6);
    float ring = (1.0 - smoothstep(0.0, 0.07, abs(t - (1.0 - ph)))) * sin(ph * 3.14159265) * 0.5;
    hexFocus = clamp(max(rim, 0.1 + glow + ring), 0.0, 1.0);
    hexFocusColor = mix(hexFocusColor, vec3(1.0, 0.97, 0.85), rim * pulse);
    diffuseColor.rgb = mix(diffuseColor.rgb, hexFocusColor, hexFocus);
  }
#ifdef HEX_WATER
  diffuseColor.a = mix(diffuseColor.a, 1.0, max(max(hexLine, hexFocus), hexRangeEdge));
#endif
}
`;

const GLSL_EMISSIVE = /* glsl */ `
// 影の中でも線が見えるよう少し自己発光させる
totalEmissiveRadiance += hexLineColor * hexLine * 0.25;
totalEmissiveRadiance += hexFocusColor * hexFocus * 0.6;
totalEmissiveRadiance += uRangeColor * hexRangeEdge * 0.5;
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
      uFocus: { value: new THREE.Vector2(-1, -1) },
      uTime: { value: 0 },
      uRangeTex: { value: HexOverlay.makeRangeTexture(1, 1) },
      uRangeColor: { value: new THREE.Color(0x4aa8ff) },
      uRangeMarkColor: { value: new THREE.Color(0xff8a3a) },
      uRangeOn: { value: 0 },
      uCellTex: { value: HexOverlay.makeCellTexture(1, 1) },
      uCellOpacity: { value: 0.55 },
      uWaterLevel: { value: 0 },
      uGrain: { value: 0.6 },
    };
  }

  private static makeCellTexture(cols: number, rows: number): THREE.DataTexture {
    const tex = new THREE.DataTexture(new Uint8Array(cols * rows * 4), cols, rows, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  private static makeRangeTexture(cols: number, rows: number): THREE.DataTexture {
    const tex = new THREE.DataTexture(new Uint8Array(cols * rows), cols, rows, THREE.RedFormat);
    // 1 画素 1 バイトなので、行の幅が 4 の倍数でなくてもずれないように
    tex.unpackAlignment = 1;
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
    u.uFocus.value.set(-1, -1);
    u.uRangeTex.value.dispose();
    u.uRangeTex.value = HexOverlay.makeRangeTexture(layout.cols, layout.rows);
    u.uRangeOn.value = 0;
  }

  /** 範囲（移動範囲など）を出す。mark の付いた HEX には印を付け、weak の HEX は薄く塗る。cells = null で消す */
  setRange(cells: Iterable<RangeCell> | null, color?: THREE.ColorRepresentation, markColor?: THREE.ColorRepresentation): void {
    const u = this.uniforms;
    const tex = u.uRangeTex.value;
    const { width } = tex.image as { width: number };
    const data = tex.image.data as Uint8Array;
    data.fill(0);
    for (const o of cells ?? []) data[o.row * width + o.col] = o.mark ? 128 : o.weak ? 64 : 255;
    tex.needsUpdate = true;
    u.uRangeOn.value = cells ? 1 : 0;
    if (color !== undefined) u.uRangeColor.value.set(color);
    if (markColor !== undefined) u.uRangeMarkColor.value.set(markColor);
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
