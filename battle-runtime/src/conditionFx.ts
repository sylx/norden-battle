/**
 * 状態（conditions.ts）のエフェクト。付いているあいだ、ユニットの絵に重ねて出し続ける。
 *
 * - 混乱: 頭の上で楕円の輪の上を円弧がぐるぐる回り、星が周りを回る。小さな光もまたたく。
 *   カメラ正対の板をシェーダで描く（輪の手前側＝下半分を明るく太くして、奥行きがあるように見せる）。
 * - 凍結: 絵の全体を氷で覆う。いまは仮で、絵と同じ大きさの青い半透明の四角を重ねる
 *   （氷の画像ができたら ICE_MATERIAL の map に差し替える）。
 *
 * ユニットの絵と同じく深度テストをしない。描画順は絵（UnitPlacement.renderOrder）のすぐ上にする
 * （選択中のユニットは絵が手前に上がるので、それに付いていく）。
 * 位置は毎フレーム絵に合わせる（移動のアニメーションにも付いていく）。絵の不透明度にも合わせる。
 */
import * as THREE from 'three';
import type { UnitData } from '@norden/map-runtime/core/units';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { hasCondition } from './conditions';
import type { UnitStatus } from './unitStatus';

/** 混乱の板の幅（絵の高さ比）。高さは幅の半分 */
const DIZZY_WIDTH = 0.62;
/** 混乱の板の中心の高さ（足元から、絵の高さ比） */
const DIZZY_LIFT = 0.88;
/** 凍結の仮の四角の色と不透明度 */
const ICE_COLOR = 0x70c8f0;
const ICE_OPACITY = 0.45;
/** 絵の描画順に足す量。氷は絵のすぐ上、混乱の輪はさらにその上 */
const ICE_ORDER = 0.5;
const DIZZY_ORDER = 0.6;

interface Marks {
  ice: THREE.Sprite | null;
  dizzy: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null;
}

export class ConditionEffects {
  readonly group = new THREE.Group();
  private readonly time: THREE.IUniform<number> = { value: 0 };
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly marks = new Map<UnitData, Marks>();

  constructor() {
    this.group.name = 'condition-fx';
  }

  dispose(): void {
    for (const unit of [...this.marks.keys()]) this.remove(unit);
    this.group.removeFromParent();
    this.geometry.dispose();
  }

  /** 毎フレーム、描画の前に呼ぶ。状態の付いたユニットに印を置き、外れたユニットの印を外す */
  update(placements: readonly UnitPlacement[], statuses: ReadonlyMap<UnitData, UnitStatus>, visible: boolean): void {
    this.group.visible = visible;
    this.time.value = performance.now() / 1000;
    const shown = new Set<UnitData>();
    for (const p of placements) {
      const status = statuses.get(p.unit);
      if (!status || status.conditions.length === 0) continue;
      shown.add(p.unit);
      let m = this.marks.get(p.unit);
      if (!m) {
        m = { ice: null, dizzy: null };
        this.marks.set(p.unit, m);
      }
      this.syncIce(m, p, hasCondition(status, 'freeze'));
      this.syncDizzy(m, p, hasCondition(status, 'confusion'));
    }
    for (const unit of [...this.marks.keys()]) if (!shown.has(unit)) this.remove(unit);
  }

  private syncIce(m: Marks, p: UnitPlacement, on: boolean): void {
    if (!on) {
      if (m.ice) disposeObject(m.ice);
      m.ice = null;
      return;
    }
    if (!m.ice) {
      m.ice = new THREE.Sprite(
        new THREE.SpriteMaterial({ color: ICE_COLOR, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }),
      );
      m.ice.center.set(0.5, 0);
      m.ice.frustumCulled = false;
      this.group.add(m.ice);
    }
    m.ice.position.copy(p.foot);
    m.ice.scale.set(p.width, p.height, 1);
    m.ice.renderOrder = p.renderOrder + ICE_ORDER;
    m.ice.material.opacity = ICE_OPACITY * p.opacity;
  }

  private syncDizzy(m: Marks, p: UnitPlacement, on: boolean): void {
    if (!on) {
      if (m.dizzy) disposeObject(m.dizzy);
      m.dizzy = null;
      return;
    }
    if (!m.dizzy) {
      m.dizzy = new THREE.Mesh(this.geometry, createDizzyMaterial(this.time));
      m.dizzy.frustumCulled = false;
      this.group.add(m.dizzy);
    }
    const u = m.dizzy.material.uniforms;
    const w = DIZZY_WIDTH * p.height;
    (u.uHalf.value as THREE.Vector2).set(w / 2, w / 4);
    u.uLift.value = DIZZY_LIFT * p.height;
    u.uOpacity.value = p.opacity;
    m.dizzy.position.copy(p.foot);
    m.dizzy.renderOrder = p.renderOrder + DIZZY_ORDER;
  }

  private remove(unit: UnitData): void {
    const m = this.marks.get(unit);
    if (!m) return;
    if (m.ice) disposeObject(m.ice);
    if (m.dizzy) disposeObject(m.dizzy);
    this.marks.delete(unit);
  }
}

/** 印を外してマテリアルを捨てる（板の形は使い回しなので捨てない） */
function disposeObject(o: THREE.Sprite | THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>): void {
  o.removeFromParent();
  o.material.dispose();
}

/**
 * 混乱の板のマテリアル（ユニットごと。時間の uniform は共有する）。
 * 板は足元を原点に置き、頂点シェーダでカメラ正対に開いて uLift だけ上へずらす（ユニットのスプライトと同じ向き）。
 */
function createDizzyMaterial(time: THREE.IUniform<number>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: time,
      uHalf: { value: new THREE.Vector2(1, 0.5) },
      uLift: { value: 1 },
      uOpacity: { value: 1 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    vertexShader: /* glsl */ `
uniform vec2 uHalf;
uniform float uLift;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uHalf + vec2(0.0, uLift);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;

const float TAU = 6.2831853;
// 輪（楕円）の半径。板の座標は x: -2..2, y: -1..1
const vec2 RING = vec2(1.45, 0.42);

// 五芒星の符号付き距離（r: 外の半径、rf: 内の半径の比）
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

// 前の層の上に色 c・不透明度 a の層を重ねる（色は不透明度を掛けた値で持つ）
void over(inout vec4 acc, vec3 c, float a) {
  acc.rgb = c * a + acc.rgb * (1.0 - a);
  acc.a = a + acc.a * (1.0 - a);
}

void main() {
  vec2 p = (vUv * 2.0 - 1.0) * vec2(2.0, 1.0);
  vec4 acc = vec4(0.0);

  // 輪の上を回る 2 本の円弧。先が明るく、後ろへ細く消えていく。手前（下半分）を明るく太くする
  vec2 q = p / RING;
  float r = length(q);
  float ang = atan(q.y, q.x) / TAU;
  vec2 grad = q / (RING * max(r, 1e-4));
  float d = abs(r - 1.0) / max(length(grad), 1e-4);
  float front = 0.5 - 0.5 * q.y / max(r, 1e-4);
  float g = fract(2.0 * (ang - uTime * 0.55));
  float tail = step(g, 0.62) * smoothstep(0.0, 0.62, g);
  float w = mix(0.05, 0.1, front) * mix(0.4, 1.0, tail);
  float aa = fwidth(d) * 1.5;
  float line = (1.0 - smoothstep(w, w + aa, d)) * tail;
  float halo = (1.0 - smoothstep(w, w + 0.12, d)) * tail * 0.4;
  over(acc, vec3(0.2, 0.05, 0.3), halo);
  over(acc, mix(vec3(0.8, 0.55, 1.0), vec3(1.0), tail * tail), line * mix(0.6, 1.0, front));

  // 輪に沿って回る 3 つの星。手前では大きく、奥では小さく薄く。星自体もくるくる回る
  for (int i = 0; i < 3; i++) {
    float th = uTime * 1.8 + float(i) * TAU / 3.0;
    float f = 0.5 - 0.5 * sin(th);
    vec2 c = RING * vec2(cos(th), sin(th));
    float size = mix(0.15, 0.26, f);
    vec2 sp = rot(uTime * 3.0 + float(i)) * (p - c);
    float sd = sdStar5(sp, size, 0.45);
    float fill = 1.0 - smoothstep(0.0, fwidth(sd) * 1.5, sd);
    float glow = exp(-max(sd, 0.0) * 14.0) * 0.45;
    float k = mix(0.55, 1.0, f);
    over(acc, vec3(0.35, 0.2, 0.0), glow * k);
    over(acc, mix(vec3(1.0, 0.82, 0.2), vec3(1.0, 1.0, 0.85), smoothstep(0.0, -size * 0.6, sd)), fill * k);
  }

  // 周りに散ってまたたく小さな光（十字の光）
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float phase = uTime * 2.3 + fi * 1.7;
    float cycle = floor(phase / TAU);
    // またたくたびに少し場所を変える
    float h = fract(sin((fi + 1.0) * 12.9898 + cycle * 78.233) * 43758.5453);
    vec2 c = vec2((h * 2.0 - 1.0) * 1.7, (fract(h * 7.31) * 2.0 - 1.0) * 0.75);
    float blink = pow(max(sin(phase), 0.0), 3.0);
    vec2 dd = abs(p - c);
    float spark = exp(-dd.x * 45.0 - dd.y * 7.0) + exp(-dd.y * 45.0 - dd.x * 7.0);
    over(acc, vec3(1.0, 0.95, 0.75), clamp(spark * blink, 0.0, 1.0));
  }

  if (acc.a < 0.003) discard;
  gl_FragColor = vec4(acc.rgb / acc.a, acc.a * uOpacity);
}`,
  });
}
