/**
 * 光の矢の雨のエフェクト（弓兵の通常攻撃）。弓兵から無数の光の矢が少しずつずれて放たれ、
 * 放物線を描いて相手のまわりへ降り注ぐ。矢が刺さったところで小さく光り、
 * 矢の大半が届いた時点（当たりの時点）で相手の中心に光がはじける。
 *
 * 矢は 3D の放物線（ワールドの上向きに膨らむ）で飛ばし、尾を引く光の筋として画面に向けて描く。
 * 矢の数が多いので、全部の矢を 1 つのインスタンス描画にまとめ、位置は頂点シェーダで時刻から求める。
 * どれもユニットの絵より手前に、深度テストをせず加算で描く。
 */
import * as THREE from 'three';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { createFlashMaterial, createFxMaterial, FX_RENDER_ORDER } from './fxShared';

/** 矢の数 */
const ARROWS = 64;
/** 最初の矢から最後の矢を放つまでの時間（秒） */
const LAUNCH_SPREAD = 0.3;
export const ARROW_RELEASE_SEC = LAUNCH_SPREAD;
/** 矢が飛ぶ時間（秒）と、そのばらつき（± の割合） */
const FLIGHT_SEC = 0.55;
const FLIGHT_JITTER = 0.15;
/** 出してから矢の大半が届くまでの時間（秒）。この時点に当たりを合わせる */
export const ARROW_HIT_SEC = LAUNCH_SPREAD / 2 + FLIGHT_SEC;
/** 放物線の高さ（弓兵から相手までの距離比、と絵の高さ比の足し算）と、そのばらつき（± の割合） */
const APEX_RATE = 0.4;
const APEX_BASE = 0.3;
const APEX_JITTER = 0.2;
/** 矢を放つ高さ・届く高さ（絵の高さ比）と、放つところ・届くところのばらつき（絵の高さ比） */
const LAUNCH_HEIGHT = 0.6;
const LAUNCH_SCATTER = 0.15;
const TARGET_HEIGHT = 0.45;
const TARGET_SCATTER_X = 0.32;
const TARGET_SCATTER_Y = 0.3;
const TARGET_SCATTER_DEPTH = 0.2;
/** 矢の尾の長さ（飛ぶ道のりに対する比）と太さの半分（絵の高さ比） */
const TRAIL = 0.14;
const WIDTH = 0.022;
const COLOR = 0xa8ffd0;
/** 刺さったところの光の大きさ（絵の高さ比）と時間（秒） */
const IMPACT_SIZE = 0.09;
const IMPACT_SEC = 0.22;
/** 当たりの時点に相手の中心ではじける光の大きさ（絵の高さ比）と時間（秒） */
const FLASH_SIZE = 0.6;
const FLASH_SEC = 0.3;

interface Volley {
  arrows: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  impacts: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  /** 当たりの時点のはじける光。カメラ正対で、原点が相手の中心 */
  flashGroup: THREE.Group;
  flash: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  targetFoot: THREE.Vector3;
  height: number;
  start: number;
  /** 全部の矢が届いて光が消える時刻（出してからの秒） */
  end: number;
}

export class ArrowEffects {
  readonly group = new THREE.Group();
  private readonly plane = new THREE.PlaneGeometry(2, 2);
  private items: Volley[] = [];

  constructor() {
    this.group.name = 'arrow-fx';
  }

  /** archer が target へ矢を射る */
  spawn(archer: UnitPlacement, target: UnitPlacement, camera: THREE.Camera): void {
    const h = target.height;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    const from = archer.foot.clone().addScaledVector(up, archer.height * LAUNCH_HEIGHT);
    const to = target.foot.clone().addScaledVector(up, h * TARGET_HEIGHT);
    const apex = from.distanceTo(to) * APEX_RATE + h * APEX_BASE;

    const start = new Float32Array(ARROWS * 3);
    const end = new Float32Array(ARROWS * 3);
    const apexes = new Float32Array(ARROWS);
    const launches = new Float32Array(ARROWS);
    const flights = new Float32Array(ARROWS);
    const v = new THREE.Vector3();
    let last = 0;
    for (let i = 0; i < ARROWS; i++) {
      v.copy(from)
        .addScaledVector(right, rand() * LAUNCH_SCATTER * h)
        .addScaledVector(up, rand() * LAUNCH_SCATTER * h)
        .toArray(start, i * 3);
      v.copy(to)
        .addScaledVector(right, rand() * TARGET_SCATTER_X * h)
        .addScaledVector(up, rand() * TARGET_SCATTER_Y * h)
        .addScaledVector(back, rand() * TARGET_SCATTER_DEPTH * h)
        .toArray(end, i * 3);
      apexes[i] = apex * (1 + rand() * APEX_JITTER);
      launches[i] = (i / (ARROWS - 1)) * LAUNCH_SPREAD;
      flights[i] = FLIGHT_SEC * (1 + rand() * FLIGHT_JITTER);
      last = Math.max(last, launches[i] + flights[i] * (1 + TRAIL));
    }
    const instance = {
      aStart: new THREE.InstancedBufferAttribute(start, 3),
      aEnd: new THREE.InstancedBufferAttribute(end, 3),
      aApex: new THREE.InstancedBufferAttribute(apexes, 1),
      aLaunch: new THREE.InstancedBufferAttribute(launches, 1),
      aFlight: new THREE.InstancedBufferAttribute(flights, 1),
    };
    const arrows = new THREE.Mesh(
      instancedQuad(instance, [0, -1, 1, -1, 0, 1, 1, 1]),
      createArrowMaterial(WIDTH * h),
    );
    const impacts = new THREE.Mesh(instancedQuad(instance, [-1, -1, 1, -1, -1, 1, 1, 1]), createImpactMaterial(IMPACT_SIZE * h));

    const flashGroup = new THREE.Group();
    const flash = new THREE.Mesh(this.plane, createFlashMaterial(COLOR));
    flash.visible = false;
    flashGroup.add(flash);
    for (const o of [arrows, impacts, flash]) {
      o.renderOrder = FX_RENDER_ORDER;
      o.frustumCulled = false;
    }
    this.group.add(arrows, impacts, flashGroup);
    this.items.push({
      arrows,
      impacts,
      flashGroup,
      flash,
      targetFoot: target.foot.clone(),
      height: h,
      start: performance.now(),
      end: Math.max(last, LAUNCH_SPREAD + FLIGHT_SEC * (1 + FLIGHT_JITTER) + IMPACT_SEC, ARROW_HIT_SEC + FLASH_SEC),
    });
  }

  /** 毎フレーム、描画の前に呼ぶ */
  update(camera: THREE.Camera): void {
    if (this.items.length === 0) return;
    const now = performance.now();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    this.items = this.items.filter((a) => {
      const t = (now - a.start) / 1000;
      if (t > a.end) {
        this.dispose(a);
        return false;
      }
      a.arrows.material.uniforms.uTime.value = t;
      a.impacts.material.uniforms.uTime.value = t;
      a.flashGroup.position.copy(a.targetFoot).addScaledVector(up, a.height * 0.5);
      a.flashGroup.quaternion.copy(camera.quaternion);
      const ft = (t - ARROW_HIT_SEC) / FLASH_SEC;
      a.flash.visible = ft >= 0 && ft < 1;
      if (a.flash.visible) {
        a.flash.material.uniforms.uT.value = ft;
        a.flash.scale.setScalar((FLASH_SIZE / 2) * a.height * (0.6 + 0.6 * Math.sqrt(ft)));
      }
      return true;
    });
  }

  clear(): void {
    for (const a of this.items) this.dispose(a);
    this.items = [];
  }

  private dispose(a: Volley): void {
    this.group.remove(a.arrows, a.impacts, a.flashGroup);
    for (const m of [a.arrows, a.impacts]) {
      m.geometry.dispose();
      m.material.dispose();
    }
    a.flash.material.dispose();
  }
}

/** −1〜1 の乱数 */
function rand(): number {
  return Math.random() * 2 - 1;
}

/** 矢 1 本ごとに 4 頂点の板を出すインスタンス描画（corners は 4 頂点の x, y。position に入れてシェーダで使う） */
function instancedQuad(instance: Record<string, THREE.InstancedBufferAttribute>, corners: number[]): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const pos = new Float32Array(12);
  for (let i = 0; i < 4; i++) pos.set([corners[i * 2], corners[i * 2 + 1], 0], i * 3);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  for (const [name, attr] of Object.entries(instance)) g.setAttribute(name, attr);
  g.instanceCount = ARROWS;
  return g;
}

/** 矢の放物線（u は 0〜1 の進み具合） */
const ARC_GLSL = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute float aApex;
attribute float aLaunch;
attribute float aFlight;
uniform float uTime;
vec3 arc(float u) {
  return mix(aStart, aEnd, u) + vec3(0.0, 4.0 * aApex * u * (1.0 - u), 0.0);
}
// 描かないときは画面の外（クリップされる）に置く
const vec4 HIDDEN = vec4(0.0, 0.0, 2.0, 1.0);
`;

/**
 * 矢。position.x が 0（尾）〜1（先）、position.y が −1〜1（太さ）。
 * 先を今の位置、尾を TRAIL だけ前の位置に置き、その向きに画面上で太さを付ける。
 * 届いた後も尾は進み続けて、筋が先へ縮んで消える
 */
function createArrowMaterial(width: number): THREE.ShaderMaterial {
  const m = createFxMaterial(
    { uTime: { value: 0 }, uWidth: { value: width }, uTrail: { value: TRAIL }, uColor: { value: new THREE.Color(COLOR) } },
    /* glsl */ `
uniform vec3 uColor;
varying vec2 vCorner;
void main() {
  float along = clamp(vCorner.x, 0.0, 1.0);
  float core = exp(-vCorner.y * vCorner.y * 10.0);
  // 尾ほど薄く、先（矢じり）は白く光る
  float tip = exp(-pow((1.0 - along) * 5.0, 2.0));
  float a = core * (along * along * 0.85 + tip * 0.9);
  vec3 col = mix(uColor, vec3(1.0), core * (0.3 + 0.7 * tip));
  gl_FragColor = vec4(col * a, 1.0);
}`,
  );
  m.vertexShader = /* glsl */ `
${ARC_GLSL}
uniform float uWidth;
uniform float uTrail;
varying vec2 vCorner;
void main() {
  vCorner = position.xy;
  float u = (uTime - aLaunch) / aFlight;
  if (u <= 0.0 || u - uTrail >= 1.0) {
    gl_Position = HIDDEN;
    return;
  }
  vec4 head = modelViewMatrix * vec4(arc(clamp(u, 0.0, 1.0)), 1.0);
  vec4 tail = modelViewMatrix * vec4(arc(clamp(u - uTrail, 0.0, 1.0)), 1.0);
  vec2 d = head.xy - tail.xy;
  float len = length(d);
  vec2 dir = len > 1e-5 ? d / len : vec2(1.0, 0.0);
  vec2 side = vec2(-dir.y, dir.x);
  vec4 p = mix(tail, head, position.x);
  // 先は矢じりの光の分だけ少し前へ伸ばす
  p.xy += dir * uWidth * 2.0 * position.x + side * uWidth * position.y;
  gl_Position = projectionMatrix * p;
}`;
  return m;
}

/** 刺さったところの小さな光（十字のきらめき）。position.xy が −1〜1 */
function createImpactMaterial(size: number): THREE.ShaderMaterial {
  const m = createFxMaterial(
    { uTime: { value: 0 }, uSize: { value: size }, uLife: { value: IMPACT_SEC }, uColor: { value: new THREE.Color(COLOR) } },
    /* glsl */ `
uniform vec3 uColor;
varying vec2 vCorner;
varying float vT;
void main() {
  vec2 p = vCorner;
  float glow = exp(-dot(p, p) * 7.0);
  float cross = exp(-abs(p.x) * 18.0) * exp(-abs(p.y) * 2.5) + exp(-abs(p.y) * 18.0) * exp(-abs(p.x) * 2.5);
  float a = (glow + cross * 0.6) * (1.0 - vT) * (1.0 - vT);
  vec3 col = mix(uColor, vec3(1.0), glow);
  gl_FragColor = vec4(col * a, 1.0);
}`,
  );
  m.vertexShader = /* glsl */ `
${ARC_GLSL}
uniform float uSize;
uniform float uLife;
varying vec2 vCorner;
varying float vT;
void main() {
  vCorner = position.xy;
  float t = (uTime - aLaunch - aFlight) / uLife;
  vT = t;
  if (t < 0.0 || t >= 1.0) {
    gl_Position = HIDDEN;
    return;
  }
  vec4 c = modelViewMatrix * vec4(aEnd, 1.0);
  c.xy += position.xy * uSize * (0.5 + 0.8 * sqrt(t));
  gl_Position = projectionMatrix * c;
}`;
  return m;
}
