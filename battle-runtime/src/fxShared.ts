/**
 * 攻撃のエフェクト（slashFx.ts・lanceFx.ts）で共通に使う部品。
 * どれもユニットの絵より手前に、深度テストをせず加算で描く。
 */
import * as THREE from 'three';

/** ユニットの絵（10〜12）より手前 */
export const FX_RENDER_ORDER = 20;

/** 板に uv をそのまま渡す頂点シェーダ */
export const FX_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** 加算で描くシェーダの板（フラグメントシェーダは vec4(色 × 濃さ, 1) を出す） */
export function createFxMaterial(uniforms: Record<string, THREE.IUniform>, fragmentShader: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: FX_VERTEX,
    fragmentShader,
  });
}

/** 当たったところではじける光（丸い光と、横に長い十字のきらめき）。uT は 0〜1 の経過 */
export function createFlashMaterial(color: number): THREE.ShaderMaterial {
  return createFxMaterial(
    { uT: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    /* glsl */ `
uniform float uT;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float glow = exp(-r * r * 9.0);
  float streak = exp(-abs(p.y) * 40.0) * (1.0 - smoothstep(0.2, 1.0, abs(p.x)));
  float cross = exp(-abs(p.x) * 40.0) * (1.0 - smoothstep(0.05, 0.45, abs(p.y)));
  float fade = (1.0 - uT) * (1.0 - uT);
  float a = (glow * 0.9 + streak + cross * 0.6) * fade;
  vec3 col = mix(uColor, vec3(1.0), clamp(glow + streak * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(col * a, 1.0);
}`,
  );
}

/** 火花の点の絵（真ん中が白く光る丸） */
export function createSparkTexture(): THREE.Texture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/** count 個の火花（位置は毎フレーム書き換える） */
export function createSparks(count: number, texture: THREE.Texture, color: number, size: number): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const sparks = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      map: texture,
      color,
      size,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    }),
  );
  sparks.visible = false;
  return sparks;
}

/** 火花を、出してから t 秒後の位置へ動かす（velocities は x, y の組。gravity は下向き） */
export function moveSparks(sparks: THREE.Points, velocities: Float32Array, gravity: number, t: number): void {
  const pos = sparks.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, velocities[i * 2] * t, velocities[i * 2 + 1] * t - 0.5 * gravity * t * t, 0);
  }
  pos.needsUpdate = true;
}
