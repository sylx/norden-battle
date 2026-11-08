/**
 * 光るランスで貫くエフェクト（騎兵の通常攻撃・突撃）。攻撃するユニットの前に短い光の槍が現れ、
 * 光を溜めてから相手へ向けて一気に伸びて貫く。貫いたところで光がはじけ、槍の向きに輪が広がり、
 * 相手の向こう側へ光の粒が抜けていく。
 *
 * 槍は攻撃するユニットの絵に付いて動く（踏み込みにも、突撃で相手を駆け抜けるのにも付いていく）。
 * 向きは出したときの、攻撃するユニットから相手への画面上の向きで決める。
 * どれもカメラ正対の板で、大きさは相手の絵の高さに合わせる。
 */
import * as THREE from 'three';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { createFlashMaterial, createFxMaterial, createSparks, createSparkTexture, FX_RENDER_ORDER, moveSparks } from './fxShared';

/** 槍が現れる時間と、伸びる前に光を溜める時間、一気に伸びる時間（秒） */
const APPEAR_SEC = 0.12;
const CHARGE_SEC = 0.08;
const THRUST_SEC = 0.12;
/** 出してから伸びきって相手を貫くまでの時間（秒）。この時点に当たりを合わせる */
export const LANCE_HIT_SEC = APPEAR_SEC + CHARGE_SEC + THRUST_SEC;
/** 貫いた後に槍が残る時間と、消えていく時間（秒） */
const HOLD_SEC = 0.25;
const FADE_SEC = 0.25;
/** 槍の長さ（絵の高さ比）と、伸びる前の長さ（槍の長さ比） */
const LENGTH = 1.5;
const REST = 0.3;
/** 光を含めた槍の太さの半分（絵の高さ比） */
const WIDTH = 0.16;
/** 槍の根元を、攻撃するユニットの中心から後ろへずらす量（絵の高さ比） */
const GRIP = 0.2;
/** 攻撃するユニットの中心の高さ（絵の高さ比） */
const HOLD_HEIGHT = 0.45;
const COLOR = 0xffd27a;
/** 貫いたところではじける光の、槍の向きの長さ・太さ（絵の高さ比）と時間（秒） */
const FLASH_LENGTH = 1.1;
const FLASH_WIDTH = 0.5;
const FLASH_SEC = 0.3;
/** 槍の向きに広がる輪（槍の向きに潰した楕円）の大きさ（絵の高さ比）・潰す割合・時間（秒）。2 つ目は向こう側に少し遅れて出す */
const RING_SIZE = 0.5;
const RING_SQUASH = 0.35;
const RING_SEC = 0.35;
const RING2_OFFSET = 0.4;
const RING2_DELAY = 0.06;
/** 向こう側へ抜ける光の粒の数・広がり（ラジアン）・速さ（絵の高さ比 / 秒）・重力・時間（秒）・大きさ */
const SPARKS = 26;
const SPARK_SPREAD = 0.4;
const SPARK_SPEED = 4;
const SPARK_GRAVITY = 3;
const SPARK_SEC = 0.5;
const SPARK_SIZE = 0.08;

interface Lance {
  /** 槍。カメラ正対で、原点が攻撃するユニットの中心 */
  lanceGroup: THREE.Group;
  lance: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** 貫いたところのエフェクト。カメラ正対で、原点が相手の中心 */
  burstGroup: THREE.Group;
  flash: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  rings: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[];
  sparks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  velocities: Float32Array;
  /** 攻撃するユニットの足元（絵の位置そのもの。動きに付いていく） */
  attackerFoot: THREE.Vector3;
  targetFoot: THREE.Vector3;
  height: number;
  start: number;
}

export class LanceEffects {
  readonly group = new THREE.Group();
  /** 中心の板と、左端が原点の板（槍。x が 0〜1 で根元から先） */
  private readonly plane = new THREE.PlaneGeometry(2, 2);
  private readonly bar = new THREE.PlaneGeometry(1, 2).translate(0.5, 0, 0);
  private readonly sparkTexture = createSparkTexture();
  private items: Lance[] = [];

  constructor() {
    this.group.name = 'lance-fx';
  }

  /** attacker が target を貫く */
  spawn(attacker: UnitPlacement, target: UnitPlacement, camera: THREE.Camera): void {
    const h = target.height;
    // 画面上の向き（カメラの右・上方向の成分）
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const d = target.foot.clone().sub(attacker.foot);
    const angle = Math.atan2(d.dot(up), d.dot(right));

    const lanceGroup = new THREE.Group();
    lanceGroup.scale.setScalar(h);
    const lanceAim = new THREE.Group();
    lanceAim.rotation.z = angle;
    const lance = new THREE.Mesh(this.bar, createLanceMaterial());
    lance.position.x = -GRIP;
    lance.scale.set(LENGTH, WIDTH, 1);
    lanceAim.add(lance);
    lanceGroup.add(lanceAim);

    const burstGroup = new THREE.Group();
    burstGroup.scale.setScalar(h);
    const burstAim = new THREE.Group();
    burstAim.rotation.z = angle;
    // はじける光は、向こう側へ少しずらして槍の向きに長く伸ばす
    const flash = new THREE.Mesh(this.plane, createFlashMaterial(COLOR));
    flash.position.x = 0.15;
    const rings = [0, RING2_OFFSET].map((x) => {
      const ring = new THREE.Mesh(this.plane, createRingMaterial());
      ring.position.x = x;
      return ring;
    });
    burstAim.add(flash, ...rings);
    // 光の粒は槍の向きを中心に向こう側へ抜ける
    const velocities = new Float32Array(SPARKS * 2);
    for (let i = 0; i < SPARKS; i++) {
      const a = angle + (Math.random() * 2 - 1) * SPARK_SPREAD;
      const v = SPARK_SPEED * (0.3 + 0.7 * Math.random());
      velocities[i * 2] = Math.cos(a) * v;
      velocities[i * 2 + 1] = Math.sin(a) * v + 0.4;
    }
    const sparks = createSparks(SPARKS, this.sparkTexture, COLOR, SPARK_SIZE * h);
    burstGroup.add(burstAim, sparks);

    for (const o of [lance, flash, ...rings, sparks]) {
      o.renderOrder = FX_RENDER_ORDER;
      o.frustumCulled = false;
    }
    flash.visible = false;
    for (const r of rings) r.visible = false;
    this.group.add(lanceGroup, burstGroup);
    this.items.push({
      lanceGroup,
      lance,
      burstGroup,
      flash,
      rings,
      sparks,
      velocities,
      attackerFoot: attacker.foot,
      targetFoot: target.foot.clone(),
      height: h,
      start: performance.now(),
    });
  }

  /** 毎フレーム、描画の前に呼ぶ */
  update(camera: THREE.Camera): void {
    if (this.items.length === 0) return;
    const now = performance.now();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    this.items = this.items.filter((l) => {
      const t = (now - l.start) / 1000;
      const sinceHit = t - LANCE_HIT_SEC;
      if (sinceHit > Math.max(HOLD_SEC + FADE_SEC, FLASH_SEC, RING2_DELAY + RING_SEC, SPARK_SEC)) {
        this.dispose(l);
        return false;
      }
      l.lanceGroup.position.copy(l.attackerFoot).addScaledVector(up, l.height * HOLD_HEIGHT);
      l.lanceGroup.quaternion.copy(camera.quaternion);
      l.burstGroup.position.copy(l.targetFoot).addScaledVector(up, l.height * 0.5);
      l.burstGroup.quaternion.copy(camera.quaternion);

      // 槍: 現れて光を溜め、一気に伸びて貫き、しばらく残って消える
      const u = l.lance.material.uniforms;
      const thrust = THREE.MathUtils.clamp((t - APPEAR_SEC - CHARGE_SEC) / THRUST_SEC, 0, 1);
      const fade = THREE.MathUtils.clamp((sinceHit - HOLD_SEC) / FADE_SEC, 0, 1);
      u.uExtend.value = REST + (1 - REST) * (1 - (1 - thrust) ** 3);
      u.uAlpha.value = Math.min(t / APPEAR_SEC, 1) * (1 - fade);
      // 光を溜めている間と貫いた瞬間は明るくする
      const charge = THREE.MathUtils.clamp((t - APPEAR_SEC) / CHARGE_SEC, 0, 1) * (1 - thrust);
      u.uGlow.value = 1 + charge * 0.8 + Math.max(0, 1 - Math.abs(sinceHit) / 0.1) * 0.8;
      u.uTime.value = t;
      l.lance.visible = fade < 1;

      const ft = sinceHit / FLASH_SEC;
      l.flash.visible = ft >= 0 && ft < 1;
      if (l.flash.visible) {
        l.flash.material.uniforms.uT.value = ft;
        const g = 0.6 + 0.6 * Math.sqrt(ft);
        l.flash.scale.set((FLASH_LENGTH / 2) * g, (FLASH_WIDTH / 2) * g, 1);
      }

      l.rings.forEach((ring, i) => {
        const rt = (sinceHit - i * RING2_DELAY) / RING_SEC;
        ring.visible = rt >= 0 && rt < 1;
        if (!ring.visible) return;
        ring.material.uniforms.uT.value = rt;
        const g = RING_SIZE * (1 - i * 0.25) * (0.3 + 0.9 * Math.sqrt(rt));
        ring.scale.set(g * RING_SQUASH, g, 1);
      });

      const st = sinceHit / SPARK_SEC;
      l.sparks.visible = st >= 0 && st < 1;
      if (l.sparks.visible) {
        moveSparks(l.sparks, l.velocities, SPARK_GRAVITY, sinceHit);
        l.sparks.material.opacity = (1 - st) ** 1.5;
      }
      return true;
    });
  }

  clear(): void {
    for (const l of this.items) this.dispose(l);
    this.items = [];
  }

  private dispose(l: Lance): void {
    this.group.remove(l.lanceGroup, l.burstGroup);
    for (const m of [l.lance, l.flash, ...l.rings]) m.material.dispose();
    l.sparks.material.dispose();
    l.sparks.geometry.dispose();
  }
}

/**
 * 槍。板の x が 0（根元）〜1（伸びきった先）、y が −1〜1（光を含めた太さ）。
 * uExtend で先の位置を決める（先 3 割が穂先で、根元で広がって先へ尖る）
 */
function createLanceMaterial(): THREE.ShaderMaterial {
  return createFxMaterial(
    {
      uExtend: { value: REST },
      uAlpha: { value: 0 },
      uGlow: { value: 1 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(COLOR) },
    },
    /* glsl */ `
uniform float uExtend;
uniform float uAlpha;
uniform float uGlow;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float x = vUv.x;
  float y = vUv.y * 2.0 - 1.0;
  // 今の槍の長さに対する位置（1 が先）
  float xr = x / uExtend;
  if (xr > 1.1) discard;
  float ay = abs(y);
  float head = smoothstep(0.66, 0.72, xr);
  float hw = mix(0.13, 0.42 * clamp((1.0 - xr) / 0.28, 0.0, 1.0), head);
  float body = xr <= 1.0 ? 1.0 : 0.0;
  float core = (1.0 - smoothstep(hw * 0.45, hw, ay)) * body;
  // まわりの光は先へ流れるように揺らす
  float flow = 0.75 + 0.25 * sin(x * 40.0 - uTime * 45.0);
  float glow = exp(-max(ay - hw * 0.5, 0.0) * 5.0) * 0.45 * flow * body;
  // 根元はぼかして消す
  float base = smoothstep(0.0, 0.2, xr);
  // 穂先のきらめき
  vec2 d = vec2((xr - 1.0) * 6.0, y);
  float tip = exp(-dot(d, d) * 6.0) * 0.9;
  float a = ((core + glow) * base + tip) * uGlow;
  vec3 col = mix(uColor, vec3(1.0), clamp(core * 0.8 + tip, 0.0, 1.0));
  gl_FragColor = vec4(col * a * uAlpha, 1.0);
}`,
  );
}

/** 広がる輪。uT は 0〜1 の経過で、広がりながら太くなって消える */
function createRingMaterial(): THREE.ShaderMaterial {
  return createFxMaterial(
    { uT: { value: 0 }, uColor: { value: new THREE.Color(COLOR) } },
    /* glsl */ `
uniform float uT;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float w = 0.05 + 0.12 * uT;
  float band = exp(-pow((r - 0.8) / w, 2.0));
  float a = band * (1.0 - uT) * (1.0 - uT);
  vec3 col = mix(uColor, vec3(1.0), band * (1.0 - uT));
  gl_FragColor = vec4(col * a, 1.0);
}`,
  );
}
