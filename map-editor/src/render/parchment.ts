/**
 * 羊皮紙に描いた地図風のポストプロセス。
 *
 * 地形・木・建物のシーンをいったん HDR のレンダーターゲットに描き、全画面シェーダで
 * トーンマップ → 彩度を落としてセピア寄りに → 紙の地合い・染み → 深度の輪郭をインクで → 周縁の焼け
 * の順に加工して画面に出す。ユニットはこの後に別シーンとしてそのまま重ねる（加工しない）ので、
 * 地図の中でユニットだけが鮮やかに浮く。
 *
 * 紙の染みは地面 (y = 0) 上のワールド座標で付けるので、パンしても地図と一緒に動く。
 * 細かい繊維の粒だけは画面座標で付ける（ズームで粗くならないように）。
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export interface ParchmentUniforms {
  [name: string]: THREE.IUniform;
  tColor: THREE.IUniform<THREE.Texture | null>;
  tDepth: THREE.IUniform<THREE.Texture | null>;
  uResolution: THREE.IUniform<THREE.Vector2>;
  uInvProjection: THREE.IUniform<THREE.Matrix4>;
  uCameraWorld: THREE.IUniform<THREE.Matrix4>;
  uNear: THREE.IUniform<number>;
  uFar: THREE.IUniform<number>;
  uExposure: THREE.IUniform<number>;
  uPaperScale: THREE.IUniform<number>;
  uSaturation: THREE.IUniform<number>;
  uSepia: THREE.IUniform<number>;
  uPaper: THREE.IUniform<number>;
  uFade: THREE.IUniform<number>;
  uOutline: THREE.IUniform<number>;
  uVignette: THREE.IUniform<number>;
  uPaperColor: THREE.IUniform<THREE.Color>;
  uInkColor: THREE.IUniform<THREE.Color>;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform float uNear;
uniform float uFar;
uniform float uExposure;
uniform float uPaperScale;
uniform float uSaturation;
uniform float uSepia;
uniform float uPaper;
uniform float uFade;
uniform float uOutline;
uniform float uVignette;
uniform vec3 uPaperColor;
uniform vec3 uInkColor;
varying vec2 vUv;

// three.js の ACESFilmicToneMapping と同じ
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilmic(vec3 color) {
  const mat3 ACESInputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777)
  );
  const mat3 ACESOutputMat = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602)
  );
  color *= uExposure / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, pow(c, vec3(0.41666)) * 1.055 - 0.055, step(0.0031308, c));
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v / 0.9375;
}

/** 画面上の点を通る視線と地面 (y = 0) の交点の XZ */
vec2 groundXZ(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  vec4 a = uInvProjection * vec4(ndc, -1.0, 1.0);
  vec4 b = uInvProjection * vec4(ndc, 1.0, 1.0);
  vec3 p0 = (uCameraWorld * vec4(a.xyz / a.w, 1.0)).xyz;
  vec3 p1 = (uCameraWorld * vec4(b.xyz / b.w, 1.0)).xyz;
  float dy = p1.y - p0.y;
  float t = dy < -1e-5 ? clamp(-p0.y / dy, 0.0, 1.0) : 1.0;
  return mix(p0, p1, t).xz;
}

/** 深度バッファ値 → 1/視距離（平面上では画面座標に対して線形になる） */
float invDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float z = uNear * uFar / (uFar - d * (uFar - uNear));
  return 1.0 / z;
}

void main() {
  vec3 base = toSRGB(acesFilmic(texture2D(tColor, vUv).rgb));

  // 彩度を落とし、明るさに応じてインク色〜紙色の階調へ寄せる
  float l = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 col = mix(vec3(l), base, uSaturation);
  vec3 sepia = mix(uInkColor, uPaperColor, smoothstep(0.02, 0.95, l));
  col = mix(col, sepia, uSepia);

  // 紙の地合い: 大きな染み + 細かいムラ（地図と一緒に動く）+ 繊維の粒（画面座標）
  vec2 w = groundXZ(vUv) / uPaperScale;
  float stain = fbm(w * 0.35);
  float blotch = fbm(w * 1.7 + 40.0);
  float fiber = vnoise(gl_FragCoord.xy * vec2(0.9, 0.25)) * 0.5 + vnoise(gl_FragCoord.xy * 0.6 + 7.0) * 0.5;
  float paperV = 0.9 + 0.12 * stain + 0.05 * (blotch - 0.5) + 0.05 * (fiber - 0.5);
  paperV -= 0.08 * smoothstep(0.62, 0.8, stain); // 濃い染み
  vec3 paperTint = vec3(1.0, 0.965, 0.9) * paperV;
  col *= mix(vec3(1.0), paperTint, uPaper);
  // 色あせ（インクの黒が紙色に浮く）
  col = mix(col, uPaperColor * paperTint, uFade);

  // 輪郭: 1/深度 のラプラシアン（平面ではほぼ 0、木や建物の縁・稜線で大きくなる）
  vec2 px = 1.0 / uResolution;
  float c0 = invDepth(vUv);
  float lap = invDepth(vUv + vec2(px.x, 0.0)) + invDepth(vUv - vec2(px.x, 0.0))
            + invDepth(vUv + vec2(0.0, px.y)) + invDepth(vUv - vec2(0.0, px.y)) - 4.0 * c0;
  float edge = smoothstep(0.006, 0.03, abs(lap) / max(c0, 1e-6));
  // 輪郭線もかすれさせる
  edge *= 0.75 + 0.25 * vnoise(gl_FragCoord.xy * 0.35);
  col = mix(col, uInkColor, edge * uOutline);

  // 周縁の焼け
  vec2 q = vUv - 0.5;
  q.x *= uResolution.x / uResolution.y;
  float r = length(q) + (stain - 0.5) * 0.08;
  float burn = smoothstep(0.45, 0.95, r) * uVignette;
  col *= mix(vec3(1.0), vec3(0.72, 0.56, 0.38), burn);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export class ParchmentEffect {
  enabled = true;
  readonly uniforms: ParchmentUniforms;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.uniforms = {
      tColor: { value: this.target.texture },
      tDepth: { value: this.target.depthTexture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uInvProjection: { value: new THREE.Matrix4() },
      uCameraWorld: { value: new THREE.Matrix4() },
      uNear: { value: 0.1 },
      uFar: { value: 500 },
      uExposure: { value: 1 },
      uPaperScale: { value: 1 },
      uSaturation: { value: 1 },
      uSepia: { value: 0 },
      uPaper: { value: 1 },
      uFade: { value: 0 },
      uOutline: { value: 0.87 },
      uVignette: { value: 0.6 },
      uPaperColor: { value: new THREE.Color(0.95, 0.89, 0.76) },
      uInkColor: { value: new THREE.Color(0.22, 0.15, 0.09) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /** 描画バッファのピクセルサイズで指定する */
  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    this.uniforms.uResolution.value.set(width, height);
  }

  /** scene を加工して画面（現在のレンダーターゲット = null）に描く */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    // render() でカメラの matrixWorld が更新されてから読む
    const u = this.uniforms;
    u.uInvProjection.value.copy(camera.projectionMatrixInverse);
    u.uCameraWorld.value.copy(camera.matrixWorld);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uExposure.value = renderer.toneMappingExposure;
    this.quad.render(renderer);
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
