/**
 * 炎の奔流のエフェクト（ドラゴンのブレス・魔術師のフレイムランス）。撃つユニットの口元（絵の上のほう）から、当たる範囲の端まで
 * 炎の粒を続けて吹き出す。粒は進みながら広がり、白から黄・橙・赤へ色を変えて暗く消える。先頭が範囲の端に届いたころに当たる。
 *
 * 粒はカメラ正対の点で、ユニットの絵より手前に深度テストをせず加算で描く（色が暗いほど薄く見える）。
 * フレイムランスは細く速く、色を青白く寄せた槍のような炎にする（BreathStyle）。
 */
import * as THREE from 'three';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { createSparkTexture, FX_RENDER_ORDER } from './fxShared';

/** 炎の見た目 */
export interface BreathStyle {
  /** 炎を吹き出し続ける時間（秒） */
  emitSec: number;
  /** 粒が範囲の端まで進む時間（秒） */
  travelSec: number;
  /** 粒の数 */
  count: number;
  /** 粒の大きさ（撃つユニットの絵の高さ比） */
  size: number;
  /** 端での広がりの半径（絵の高さ比） */
  spread: number;
  /** 生まれたとき・中ほど・消える前の色 */
  colors: [hot: number, mid: number, cool: number];
}

export const BREATH_STYLE: BreathStyle = {
  emitSec: 0.75,
  travelSec: 0.5,
  count: 420,
  size: 0.42,
  spread: 0.55,
  colors: [0xfff2c0, 0xff8a20, 0xa01808],
};

export const FLAME_LANCE_STYLE: BreathStyle = {
  emitSec: 0.45,
  travelSec: 0.32,
  count: 220,
  size: 0.3,
  spread: 0.18,
  colors: [0xf4f8ff, 0xffb040, 0xd03010],
};

/** 出してから当たるまでの時間（秒）: 最初の粒が範囲の端に届くころ */
export function breathHitSec(style: BreathStyle): number {
  return style.travelSec;
}

/** 口元の高さ（絵の高さ比） */
const MOUTH = 0.62;
/** 当たる高さ（相手の絵の高さ比。範囲の HEX に立つユニットの胴のあたり） */
const BODY = 0.4;

interface Particle {
  /** 生まれる時刻（出してからの秒） */
  born: number;
  /** 寿命（秒） */
  life: number;
  /** 進む向きに直交する広がり（-1..1 の 2 軸） */
  side: number;
  lift: number;
}

interface Breath {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  particles: Particle[];
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** 進む向きに直交する横・上の向き（ワールド。長さは広がりの半径） */
  across: THREE.Vector3;
  up: THREE.Vector3;
  style: BreathStyle;
  colors: THREE.Color[];
  start: number;
}

export class BreathEffects {
  readonly group = new THREE.Group();
  private readonly texture = createSparkTexture();
  private items: Breath[] = [];

  constructor() {
    this.group.name = 'breath-fx';
  }

  /** shooter の口元から end（範囲の端の HEX の足元）まで炎を吹く */
  spawn(shooter: UnitPlacement, end: THREE.Vector3, style: BreathStyle): void {
    const h = shooter.height;
    const from = shooter.foot.clone().add(new THREE.Vector3(0, h * MOUTH, 0));
    const to = end.clone().add(new THREE.Vector3(0, h * BODY, 0));
    const dir = to.clone().sub(from).normalize();
    const across = new THREE.Vector3(0, 1, 0).cross(dir).normalize().multiplyScalar(h * style.spread);
    const up = dir.clone().cross(across).normalize().multiplyScalar(h * style.spread * 0.6);
    const particles = Array.from({ length: style.count }, (_, i): Particle => ({
      born: (i / style.count) * style.emitSec,
      life: style.travelSec * (1 + Math.random() * 0.35),
      side: Math.random() * 2 - 1,
      lift: Math.random() * 2 - 1,
    }));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(style.count * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(style.count * 3), 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        map: this.texture,
        size: h * style.size,
        vertexColors: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
      }),
    );
    points.renderOrder = FX_RENDER_ORDER;
    points.frustumCulled = false;
    this.group.add(points);
    this.items.push({
      points,
      particles,
      from,
      to,
      across,
      up,
      style,
      colors: style.colors.map((c) => new THREE.Color(c)),
      start: performance.now(),
    });
  }

  /** 毎フレーム、描画の前に呼ぶ */
  update(): void {
    if (this.items.length === 0) return;
    const now = performance.now();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    this.items = this.items.filter((b) => {
      const t = (now - b.start) / 1000;
      if (t > b.style.emitSec + b.style.travelSec * 1.4) {
        this.dispose(b);
        return false;
      }
      const pos = b.points.geometry.attributes.position as THREE.BufferAttribute;
      const col = b.points.geometry.attributes.color as THREE.BufferAttribute;
      const [hot, mid, cool] = b.colors;
      b.particles.forEach((q, i) => {
        const age = (t - q.born) / q.life;
        if (age < 0 || age > 1) {
          // まだ生まれていない・消えた粒は黒（加算なので見えない）
          col.setXYZ(i, 0, 0, 0);
          pos.setXYZ(i, b.from.x, b.from.y, b.from.z);
          return;
        }
        // 進み（出だしが速く、端で少し緩む）と、進むほど大きくなる広がり
        const k = 1 - (1 - age) * (1 - age);
        const spread = Math.min(1, k * 1.3);
        p.lerpVectors(b.from, b.to, k)
          .addScaledVector(b.across, q.side * spread)
          .addScaledVector(b.up, q.lift * spread);
        pos.setXYZ(i, p.x, p.y, p.z);
        // 白 → 黄・橙 → 赤 → 暗く消える
        if (age < 0.35) c.copy(hot).lerp(mid, age / 0.35);
        else c.copy(mid).lerp(cool, (age - 0.35) / 0.65);
        c.multiplyScalar((1 - age) ** 1.4 * 1.2);
        col.setXYZ(i, c.r, c.g, c.b);
      });
      pos.needsUpdate = true;
      col.needsUpdate = true;
      return true;
    });
  }

  clear(): void {
    for (const b of this.items) this.dispose(b);
    this.items = [];
  }

  private dispose(b: Breath): void {
    this.group.remove(b.points);
    b.points.geometry.dispose();
    b.points.material.dispose();
  }
}
