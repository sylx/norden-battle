/**
 * 光の剣の斬撃のエフェクト（歩兵の通常攻撃）。相手の絵の前を光の刃が弧を描いて振り抜け、
 * 通った跡に三日月形の光の筋を残す。刃が相手の中心を通ったところで光がはじけ、火花が散る。
 *
 * どれもカメラ正対の板で、ユニットの絵より手前に深度テストをせず加算で描く。
 * 大きさは相手の絵の高さに合わせ、左向きの攻撃は左右を反転する。
 */
import * as THREE from 'three';
import type { Facing } from '@norden/map-runtime/core/units';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { createFlashMaterial, createFxMaterial, createSparks, createSparkTexture, FX_RENDER_ORDER, moveSparks } from './fxShared';

/** 刃が弧を振り抜く時間（秒）。半分の時点で相手の中心を通る */
const SWEEP_SEC = 0.32;
/** 振り抜いた後に跡が消えるまでの時間（秒） */
const FADE_SEC = 0.6;
/** 出してから刃が相手の中心を通るまでの時間（秒）。この時点に当たりを合わせる */
export const SLASH_HIT_SEC = SWEEP_SEC / 2;
/** 弧の半径（絵の高さ比）と、振り抜く角度の半分 */
const RADIUS = 0.62;
const HALF_ARC = THREE.MathUtils.degToRad(65);
/**
 * 弧の真ん中（相手の中心）の、弧の中心から見た向き（右向きの攻撃。左上から右下へ振り下ろす）と、そのばらつき
 */
const MID_ANGLE = THREE.MathUtils.degToRad(40);
const MID_JITTER = THREE.MathUtils.degToRad(12);
/** 跡の長さ（振り抜く弧に対する比） */
const TRAIL = 0.75;
const COLOR = 0x8fd4ff;
/** 当たったところではじける光の大きさ（絵の高さ比）と時間（秒） */
const FLASH_SIZE = 0.75;
const FLASH_SEC = 0.3;
/** 火花の数・速さ（絵の高さ比 / 秒）・重力（絵の高さ比 / 秒²）・時間（秒）・大きさ */
const SPARKS = 22;
const SPARK_SPEED = 2.4;
const SPARK_GRAVITY = 5;
const SPARK_SEC = 0.5;
const SPARK_SIZE = 0.09;

interface Slash {
  /** カメラ正対。原点が相手の中心で、1 が絵の高さ */
  group: THREE.Group;
  arc: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  flash: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  sparks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  velocities: Float32Array;
  foot: THREE.Vector3;
  height: number;
  start: number;
}

export class SlashEffects {
  readonly group = new THREE.Group();
  private readonly plane = new THREE.PlaneGeometry(2, 2);
  private readonly sparkTexture = createSparkTexture();
  private items: Slash[] = [];

  constructor() {
    this.group.name = 'slash-fx';
  }

  /** target（攻撃される相手）を、facing の向きに攻撃するユニットが斬る */
  spawn(target: UnitPlacement, facing: Facing): void {
    const mid = MID_ANGLE + (Math.random() * 2 - 1) * MID_JITTER;
    const group = new THREE.Group();
    group.scale.set(target.height * (facing === 'left' ? -1 : 1), target.height, target.height);

    // 弧の中心を、弧の真ん中が相手の中心を通るところに置く
    const arc = new THREE.Mesh(this.plane, createArcMaterial(mid + HALF_ARC, mid - HALF_ARC));
    arc.position.set(-Math.cos(mid) * RADIUS, -Math.sin(mid) * RADIUS, 0);
    arc.scale.setScalar(RADIUS);

    // はじける光は、刃が中心を通る向き（弧の接線）に長く伸ばす
    const flash = new THREE.Mesh(this.plane, createFlashMaterial(COLOR));
    flash.rotation.z = mid - Math.PI / 2;
    flash.scale.setScalar(FLASH_SIZE / 2);
    flash.visible = false;

    // 火花は刃の進む向きを中心に飛び散る
    const velocities = new Float32Array(SPARKS * 2);
    const dir = mid - Math.PI / 2;
    for (let i = 0; i < SPARKS; i++) {
      const a = dir + (Math.random() * 2 - 1) * 0.9;
      const v = SPARK_SPEED * (0.35 + 0.65 * Math.random());
      velocities[i * 2] = Math.cos(a) * v;
      velocities[i * 2 + 1] = Math.sin(a) * v + 0.6;
    }
    const sparks = createSparks(SPARKS, this.sparkTexture, COLOR, SPARK_SIZE * target.height);

    for (const o of [arc, flash, sparks]) {
      o.renderOrder = FX_RENDER_ORDER;
      o.frustumCulled = false;
      group.add(o);
    }
    this.group.add(group);
    this.items.push({ group, arc, flash, sparks, velocities, foot: target.foot.clone(), height: target.height, start: performance.now() });
  }

  /** 毎フレーム、描画の前に呼ぶ */
  update(camera: THREE.Camera): void {
    if (this.items.length === 0) return;
    const now = performance.now();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    this.items = this.items.filter((s) => {
      const t = (now - s.start) / 1000;
      const sinceHit = t - SLASH_HIT_SEC;
      if (t > SWEEP_SEC + FADE_SEC && sinceHit > Math.max(FLASH_SEC, SPARK_SEC)) {
        this.dispose(s);
        return false;
      }
      s.group.position.copy(s.foot).addScaledVector(up, s.height * 0.5);
      s.group.quaternion.copy(camera.quaternion);

      // 刃は振り抜いた後も跡の長さだけ進めて、跡を後ろから消していく
      const u = s.arc.material.uniforms;
      u.uHead.value = t < SWEEP_SEC ? t / SWEEP_SEC : 1 + ((t - SWEEP_SEC) / FADE_SEC) * TRAIL;
      s.arc.visible = t < SWEEP_SEC + FADE_SEC;

      const ft = sinceHit / FLASH_SEC;
      s.flash.visible = ft >= 0 && ft < 1;
      if (s.flash.visible) {
        s.flash.material.uniforms.uT.value = ft;
        s.flash.scale.setScalar((FLASH_SIZE / 2) * (0.6 + 0.6 * Math.sqrt(ft)));
      }

      const st = sinceHit / SPARK_SEC;
      s.sparks.visible = st >= 0 && st < 1;
      if (s.sparks.visible) {
        moveSparks(s.sparks, s.velocities, SPARK_GRAVITY, sinceHit);
        s.sparks.material.opacity = (1 - st) ** 1.5;
      }
      return true;
    });
  }

  clear(): void {
    for (const s of this.items) this.dispose(s);
    this.items = [];
  }

  private dispose(s: Slash): void {
    this.group.remove(s.group);
    s.arc.material.dispose();
    s.flash.material.dispose();
    s.sparks.material.dispose();
    s.sparks.geometry.dispose();
  }
}

/** 弧の刃と跡。弧の中心が板の中心で、板の縁（半径 1）が刃の先 */
function createArcMaterial(a0: number, a1: number): THREE.ShaderMaterial {
  return createFxMaterial(
    {
      uHead: { value: 0 },
      uA0: { value: a0 },
      uA1: { value: a1 },
      uTrail: { value: TRAIL },
      uColor: { value: new THREE.Color(COLOR) },
    },
    /* glsl */ `
uniform float uHead;
uniform float uA0;
uniform float uA1;
uniform float uTrail;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  // 振り始め（0）から振り終わり（1）までの進み具合と、刃からの遅れ
  float s = (atan(p.y, p.x) - uA0) / (uA1 - uA0);
  float behind = uHead - s;

  // 跡: 刃に近いほど太く明るい三日月。外側の縁が鋭く光り、内側へぼける
  float k = (s >= 0.0 && s <= 1.0 && behind >= 0.0) ? clamp(1.0 - behind / uTrail, 0.0, 1.0) : 0.0;
  float rim = 0.93;
  float dr = r - rim;
  float w = 0.04 + 0.2 * k;
  float edge = 1.0 - smoothstep(0.0, 0.015 + 0.02 * k, abs(dr));
  float fill = dr < 0.0 ? smoothstep(-w, 0.0, dr) : 1.0 - smoothstep(0.0, 0.02, dr);
  float halo = exp(-abs(dr) * 14.0) * 0.35;
  float trail = k * k * (edge + fill * fill * 0.55 + halo);

  // 刃: 刃の位置で中心から外へ伸びる光の線（先へ細くなる）。振り抜いたら消える
  float across = (s - uHead) * abs(uA1 - uA0) * r;
  float bw = mix(0.035, 0.006, smoothstep(0.55, 1.0, r));
  float along = smoothstep(0.35, 0.6, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float on = 1.0 - smoothstep(0.95, 1.1, uHead);
  float blade = on * along * ((1.0 - smoothstep(bw * 0.5, bw, abs(across))) + exp(-abs(across) * 22.0) * 0.5);

  float a = clamp(trail + blade, 0.0, 1.5);
  // 芯は白く、まわりは色を付ける
  vec3 col = mix(uColor, vec3(1.0), clamp(edge * k + blade, 0.0, 1.0));
  gl_FragColor = vec4(col * a, 1.0);
}`,
  );
}
