/**
 * 光の弾のエフェクト。撃つユニットの前で光が瞬き、光の弾が尾を引いて相手へ飛び、届いたところで光がはじける。
 *
 * - BULLET_STYLE（ライフル兵の通常攻撃・迎撃）: 小さな光の弾を何発か続けて撃ち、まっすぐ相手のまわりへ飛ばす。
 * - SHELL_STYLE（砲兵の通常攻撃・迎撃）: 大きな光の弾を 1 発、放物線（ワールドの上向きに膨らむ）で飛ばし、
 *   届いたところで大きく光がはじけて火花が散る。
 *
 * 弾の尾は、今の位置から少し前の位置までの道のりに沿った帯で、画面に向けて幅を付けて描く（毎フレーム頂点を置き直す）。
 * どれもユニットの絵より手前に、深度テストをせず加算で描く。大きさは相手の絵の高さに合わせる。
 */
import * as THREE from 'three';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { createFlashMaterial, createFxMaterial, createSparks, createSparkTexture, FX_RENDER_ORDER, moveSparks } from './fxShared';

/** 弾の飛ばし方と見た目（大きさは絵の高さ比、時間は秒） */
export interface ProjectileStyle {
  /** 弾の数と、最初の弾から最後の弾を撃つまでの時間 */
  shots: number;
  fireSpread: number;
  /** 弾が飛ぶ時間 */
  flight: number;
  /** 出してから弾の大半が届くまでの時間。この時点に当たりを合わせる */
  hitSec: number;
  /** 放物線の高さ（撃つユニットから相手までの距離比、と絵の高さ比の足し算）。0 ならまっすぐ */
  apexRate: number;
  apexBase: number;
  /** 撃つ高さ・撃つところを相手の側へずらす量・届く高さ */
  launchHeight: number;
  launchForward: number;
  targetHeight: number;
  /** 撃つところ・届くところのばらつき */
  launchScatter: number;
  targetScatter: number;
  /** 尾の長さ（飛ぶ時間に対する比）と、太さの半分 */
  trail: number;
  width: number;
  /** 弾の光の大きさ（半径） */
  headSize: number;
  color: number;
  /** 撃ったところで瞬く光の大きさと時間 */
  muzzleSize: number;
  muzzleSec: number;
  /** 届いたところではじける光の大きさと時間 */
  impactSize: number;
  impactSec: number;
  /** 届いたところで散る火花の数・速さ（絵の高さ比 / 秒）・重力・時間・大きさ（無ければ散らさない） */
  sparks?: { count: number; speed: number; gravity: number; sec: number; size: number };
}

/** ガンシップ: 上空から光の弾を広く連射して、目標の周りに降らせる（撃つところは目標の上空に置く） */
export const GUNSHIP_STYLE: ProjectileStyle = {
  shots: 44,
  fireSpread: 0.9,
  flight: 0.3,
  hitSec: 0.9 / 2 + 0.3,
  apexRate: 0,
  apexBase: 0,
  launchHeight: 0,
  launchForward: 0,
  targetHeight: 0.3,
  launchScatter: 1.6,
  targetScatter: 0.9,
  trail: 0.6,
  width: 0.02,
  headSize: 0.045,
  color: 0xffb860,
  muzzleSize: 0.12,
  muzzleSec: 0.06,
  impactSize: 0.2,
  impactSec: 0.16,
  sparks: { count: 6, speed: 1.6, gravity: 5, sec: 0.3, size: 0.05 },
};

/** ライフル兵: 小さな光の弾をまっすぐ続けて撃つ */
export const BULLET_STYLE: ProjectileStyle = {
  shots: 30,
  fireSpread: 0.3,
  flight: 0.14,
  hitSec: 0.3 / 2 + 0.14,
  apexRate: 0,
  apexBase: 0,
  launchHeight: 0.55,
  launchForward: 0.25,
  targetHeight: 0.45,
  launchScatter: 0.04,
  targetScatter: 0.22,
  trail: 0.6,
  width: 0.018,
  headSize: 0.05,
  color: 0xffe28a,
  muzzleSize: 0.22,
  muzzleSec: 0.1,
  impactSize: 0.3,
  impactSec: 0.18,
};

/** 砲兵: 大きな光の弾を 1 発、放物線で撃つ */
export const SHELL_STYLE: ProjectileStyle = {
  shots: 1,
  fireSpread: 0,
  flight: 0.85,
  hitSec: 0.85,
  apexRate: 0.35,
  apexBase: 0.8,
  launchHeight: 0.45,
  launchForward: 0.3,
  targetHeight: 0.4,
  launchScatter: 0,
  targetScatter: 0,
  trail: 0.22,
  width: 0.07,
  headSize: 0.2,
  color: 0xffa860,
  muzzleSize: 0.7,
  muzzleSec: 0.22,
  impactSize: 1.4,
  impactSec: 0.45,
  sparks: { count: 36, speed: 3, gravity: 6, sec: 0.6, size: 0.09 },
};

/** 尾の帯の区切りの数 */
const TRAIL_SEGMENTS = 12;

interface Shot {
  from: THREE.Vector3;
  to: THREE.Vector3;
  apex: number;
  launch: number;
  trail: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  head: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  muzzle: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  impact: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** 届いたところで散る火花（カメラ正対。原点が届いたところで、1 が絵の高さ） */
  sparkGroup: THREE.Group | null;
  sparks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null;
  velocities: Float32Array | null;
}

interface Salvo {
  shots: Shot[];
  height: number;
  start: number;
  /** 全部の弾が届いて光が消える時刻（出してからの秒） */
  end: number;
}

export class ProjectileEffects {
  readonly group = new THREE.Group();
  private readonly plane = new THREE.PlaneGeometry(2, 2);
  private readonly sparkTexture = createSparkTexture();
  private items: Salvo[] = [];
  private readonly style: ProjectileStyle;

  constructor(style: ProjectileStyle) {
    this.style = style;
    this.group.name = 'projectile-fx';
  }

  /** shooter が target へ弾を撃つ */
  spawn(shooter: UnitPlacement, target: UnitPlacement, camera: THREE.Camera): void {
    const st = this.style;
    const h = target.height;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    const center = target.foot.clone().addScaledVector(up, h * st.targetHeight);
    // 撃つところは、撃つユニットの絵の前（相手の側）
    const toward = Math.sign(center.clone().sub(shooter.foot).dot(right)) || 1;
    const muzzle = shooter.foot
      .clone()
      .addScaledVector(up, shooter.height * st.launchHeight)
      .addScaledVector(right, toward * shooter.height * st.launchForward);
    const apex = muzzle.distanceTo(center) * st.apexRate + h * st.apexBase;

    const shots: Shot[] = [];
    let end = 0;
    for (let i = 0; i < st.shots; i++) {
      const from = muzzle
        .clone()
        .addScaledVector(right, rand() * st.launchScatter * h)
        .addScaledVector(up, rand() * st.launchScatter * h);
      const to = center
        .clone()
        .addScaledVector(right, rand() * st.targetScatter * h)
        .addScaledVector(up, rand() * st.targetScatter * h)
        .addScaledVector(back, rand() * st.targetScatter * h);
      const launch = st.shots > 1 ? (i / (st.shots - 1)) * st.fireSpread : 0;
      const trail = new THREE.Mesh(createTrailGeometry(), createTrailMaterial(st.color));
      const head = new THREE.Mesh(this.plane, createHeadMaterial(st.color));
      const muzzleFlash = new THREE.Mesh(this.plane, createFlashMaterial(st.color));
      const impact = new THREE.Mesh(this.plane, createFlashMaterial(st.color));
      const objects: THREE.Object3D[] = [trail, head, muzzleFlash, impact];
      let sparkGroup: THREE.Group | null = null;
      let sparks: Shot['sparks'] = null;
      let velocities: Float32Array | null = null;
      if (st.sparks) {
        // 火花は届いたところから上と横へ飛び散る
        velocities = new Float32Array(st.sparks.count * 2);
        for (let k = 0; k < st.sparks.count; k++) {
          const a = Math.PI / 2 + rand() * 1.5;
          const v = st.sparks.speed * (0.3 + 0.7 * Math.random());
          velocities[k * 2] = Math.cos(a) * v;
          velocities[k * 2 + 1] = Math.sin(a) * v;
        }
        sparkGroup = new THREE.Group();
        sparkGroup.scale.setScalar(h);
        sparks = createSparks(st.sparks.count, this.sparkTexture, st.color, st.sparks.size * h);
        sparkGroup.add(sparks);
        objects.push(sparks);
      }
      for (const o of objects) {
        o.renderOrder = FX_RENDER_ORDER;
        o.frustumCulled = false;
        o.visible = false;
      }
      this.group.add(trail, head, muzzleFlash, impact, ...(sparkGroup ? [sparkGroup] : []));
      shots.push({ from, to, apex, launch, trail, head, muzzle: muzzleFlash, impact, sparkGroup, sparks, velocities });
      end = Math.max(end, launch + st.flight * (1 + st.trail), launch + st.flight + Math.max(st.impactSec, st.sparks?.sec ?? 0));
    }
    this.items.push({ shots, height: h, start: performance.now(), end });
  }

  /** 毎フレーム、描画の前に呼ぶ */
  update(camera: THREE.Camera): void {
    if (this.items.length === 0) return;
    const st = this.style;
    const now = performance.now();
    const view = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    this.items = this.items.filter((s) => {
      const t = (now - s.start) / 1000;
      if (t > s.end) {
        this.dispose(s);
        return false;
      }
      const h = s.height;
      for (const shot of s.shots) {
        const u = (t - shot.launch) / st.flight;
        const arc = (k: number, out: THREE.Vector3) =>
          out.lerpVectors(shot.from, shot.to, k).setY(out.y + 4 * shot.apex * k * (1 - k));

        // 弾と尾: 撃ってから届くまで弾を出し、尾は届いた後も先へ縮んで消える
        shot.head.visible = u > 0 && u <= 1;
        if (shot.head.visible) {
          arc(u, shot.head.position);
          shot.head.quaternion.copy(camera.quaternion);
          shot.head.scale.setScalar(st.headSize * h);
        }
        shot.trail.visible = u > 0 && u - st.trail < 1;
        if (shot.trail.visible) placeTrail(shot.trail.geometry, arc, Math.max(u - st.trail, 0), Math.min(u, 1), st.width * h, view);

        // 撃ったところの瞬き・届いたところではじける光
        flashAt(shot.muzzle, shot.from, (t - shot.launch) / st.muzzleSec, st.muzzleSize * h, camera);
        flashAt(shot.impact, shot.to, (t - shot.launch - st.flight) / st.impactSec, st.impactSize * h, camera);

        if (st.sparks && shot.sparkGroup && shot.sparks && shot.velocities) {
          const since = t - shot.launch - st.flight;
          const k = since / st.sparks.sec;
          shot.sparks.visible = k >= 0 && k < 1;
          if (shot.sparks.visible) {
            shot.sparkGroup.position.copy(shot.to);
            shot.sparkGroup.quaternion.copy(camera.quaternion);
            moveSparks(shot.sparks, shot.velocities, st.sparks.gravity, since);
            shot.sparks.material.opacity = (1 - k) ** 1.5;
          }
        }
      }
      return true;
    });
  }

  clear(): void {
    for (const s of this.items) this.dispose(s);
    this.items = [];
  }

  private dispose(s: Salvo): void {
    for (const shot of s.shots) {
      this.group.remove(shot.trail, shot.head, shot.muzzle, shot.impact);
      if (shot.sparkGroup) this.group.remove(shot.sparkGroup);
      shot.trail.geometry.dispose();
      for (const m of [shot.trail, shot.head, shot.muzzle, shot.impact]) m.material.dispose();
      shot.sparks?.geometry.dispose();
      shot.sparks?.material.dispose();
    }
  }
}

/** −1〜1 の乱数 */
function rand(): number {
  return Math.random() * 2 - 1;
}

/** はじける光を at に出す（t は 0〜1 の経過。範囲の外なら隠す） */
function flashAt(flash: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>, at: THREE.Vector3, t: number, size: number, camera: THREE.Camera): void {
  flash.visible = t >= 0 && t < 1;
  if (!flash.visible) return;
  flash.position.copy(at);
  flash.quaternion.copy(camera.quaternion);
  flash.material.uniforms.uT.value = t;
  flash.scale.setScalar((size / 2) * (0.6 + 0.6 * Math.sqrt(t)));
}

/** 尾の帯。区切りごとに 2 頂点（aAlong: 0 が尾・1 が先、aSide: −1〜1）。位置は placeTrail で毎フレーム置く */
function createTrailGeometry(): THREE.BufferGeometry {
  const n = TRAIL_SEGMENTS + 1;
  const along: number[] = [];
  const side: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    along.push(i / TRAIL_SEGMENTS, i / TRAIL_SEGMENTS);
    side.push(-1, 1);
    if (i > 0) {
      const v = i * 2;
      index.push(v - 2, v - 1, v, v, v - 1, v + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(index);
  return g;
}

/** 尾の帯を、道のりの u0（尾）〜 u1（先）に沿って置く。幅は道のりの向きと視線に直交する向きに付け、尾ほど細くする */
function placeTrail(
  g: THREE.BufferGeometry,
  arc: (k: number, out: THREE.Vector3) => THREE.Vector3,
  u0: number,
  u1: number,
  width: number,
  view: THREE.Vector3,
): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const next = new THREE.Vector3();
  const side = new THREE.Vector3();
  const du = Math.max((u1 - u0) / TRAIL_SEGMENTS, 1e-4);
  for (let i = 0; i <= TRAIL_SEGMENTS; i++) {
    const k = u0 + (u1 - u0) * (i / TRAIL_SEGMENTS);
    arc(k, p);
    arc(k - du, prev);
    arc(k + du, next);
    side.subVectors(next, prev).cross(view);
    if (side.lengthSq() < 1e-12) side.set(0, 1, 0);
    side.normalize().multiplyScalar(width * (0.25 + 0.75 * (i / TRAIL_SEGMENTS)));
    pos.setXYZ(i * 2, p.x - side.x, p.y - side.y, p.z - side.z);
    pos.setXYZ(i * 2 + 1, p.x + side.x, p.y + side.y, p.z + side.z);
  }
  pos.needsUpdate = true;
}

/** 尾。芯は白く、まわりに色の付いた光。尾ほど薄い */
function createTrailMaterial(color: number): THREE.ShaderMaterial {
  const m = createFxMaterial(
    { uColor: { value: new THREE.Color(color) } },
    /* glsl */ `
uniform vec3 uColor;
varying float vAlong;
varying float vSide;
void main() {
  float core = exp(-vSide * vSide * 12.0);
  float glow = exp(-vSide * vSide * 2.5) * 0.5;
  float a = (core + glow) * vAlong * vAlong;
  vec3 col = mix(uColor, vec3(1.0), core * vAlong);
  gl_FragColor = vec4(col * a, 1.0);
}`,
  );
  m.vertexShader = /* glsl */ `
attribute float aAlong;
attribute float aSide;
varying float vAlong;
varying float vSide;
void main() {
  vAlong = aAlong;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
  return m;
}

/** 弾の光（真ん中が白く光る丸） */
function createHeadMaterial(color: number): THREE.ShaderMaterial {
  return createFxMaterial(
    { uColor: { value: new THREE.Color(color) } },
    /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  float core = exp(-r2 * 18.0);
  float glow = exp(-r2 * 4.0) * 0.7;
  vec3 col = mix(uColor, vec3(1.0), clamp(core * 1.5, 0.0, 1.0));
  gl_FragColor = vec4(col * (core + glow), 1.0);
}`,
  );
}
