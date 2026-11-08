/**
 * 雷のエフェクト（魔術師のサンダーフォール・トールハンマー）。相手の頭上の高いところから、ジグザグの稲妻が上から下へ一気に走って
 * 相手に落ちる。落ちたところで光がはじけて火花が散り、稲妻は形を変えながら何度か明滅して消える。
 *
 * - spawn: サンダーフォールの雷を 1 本落とす（THUNDER_STYLE）。
 * - storm: トールハンマー。目標の周りの地面に、だんだん間を詰めながら雷を次々と落とし（STORM_STYLE）、
 *   最後に太く高い雷を目標に落とす（HAMMER_STYLE。地面を這う放電が四方へ走り、何度も明滅する）。その後も余波の雷が落ちる。
 *   メテオフォール（areaFx.ts の PillarEffects。魔法陣となめらかな光の柱 1 本）と違って、魔法陣は無く、ギザギザの稲妻が何本も不規則に落ちる。
 *
 * 稲妻は折れ線を中点の変位で作り、何本かの枝を付けて、太さのある帯としてカメラ正対の面に描く。
 * どれもユニットの絵より手前に、深度テストをせず加算で描く。大きさは相手の絵の高さに合わせる。
 */
import * as THREE from 'three';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { createFlashMaterial, createFxMaterial, createSparks, createSparkTexture, FX_RENDER_ORDER, moveSparks } from './fxShared';

/** 稲妻が上から下へ走る時間（秒）。出してからこの時間で相手に落ちる */
const REVEAL_SEC = 0.06;
export const THUNDER_HIT_SEC = REVEAL_SEC;
/** 光るたびに暗くなる速さ（秒）と、消えるまでの間に残る明るさ、最後に光ってから消えるまでの時間（秒） */
const STROKE_DECAY_SEC = 0.07;
const STROKE_BASE = 0.25;
const AFTER_SEC = 0.2;
/** 折れ線を細かくする回数と、折れ曲がりの大きさ（区間の長さ比） */
const DETAIL = 6;
const JAGGED = 0.22;
/** 枝の長さ（幹の残りの長さ比）。枝の太さは幹の BRANCH_WIDTH 倍 */
const BRANCH_LENGTH = 0.35;
const BRANCH_WIDTH = 0.55;
/** 火花の速さ（絵の高さ比 / 秒）・重力・時間（秒）・大きさ */
const SPARK_SPEED = 2.6;
const SPARK_GRAVITY = 6;
const SPARK_SEC = 0.55;
const SPARK_SIZE = 0.08;
/** 地面を這う放電の長さ（絵の高さ比）と高さのばらつき */
const ARC_LENGTH = 1.6;
const ARC_RISE = 0.25;

/** 雷 1 本の見た目。長さは絵の高さ比（足元から） */
export interface BoltStyle {
  color: number;
  /** 稲妻の上端の高さ・下端（落ちるところ）の高さと、上端の左右のばらつき */
  top: number;
  bottom: number;
  topScatter: number;
  /** 光を含めた太さの半分 */
  width: number;
  branches: number;
  /** 落ちてから光り直す時刻（秒）。光り直すたびに形を変える */
  strokes: readonly number[];
  /** 落ちたところではじける光の大きさと時間（秒） */
  flashSize: number;
  flashSec: number;
  sparks: number;
  /** 落ちたところから地面を這って四方へ走る放電の本数 */
  arcs: number;
}

/** サンダーフォール */
export const THUNDER_STYLE: BoltStyle = {
  color: 0xb9a6ff,
  top: 3,
  bottom: 0.45,
  topScatter: 0.35,
  width: 0.09,
  branches: 3,
  strokes: [0, 0.1, 0.22],
  flashSize: 1.1,
  flashSec: 0.35,
  sparks: 30,
  arcs: 0,
};
/** トールハンマーの、目標の周りに次々と落ちる雷（空の高いところから細く速く） */
const STORM_STYLE: BoltStyle = {
  color: 0xc8d4ff,
  top: 7,
  bottom: 0.1,
  topScatter: 1.2,
  width: 0.07,
  branches: 4,
  strokes: [0, 0.07],
  flashSize: 1.4,
  flashSec: 0.25,
  sparks: 14,
  arcs: 0,
};
/** トールハンマーの、最後に目標へ落ちる太い雷 */
const HAMMER_STYLE: BoltStyle = {
  color: 0xd8deff,
  top: 8,
  bottom: 0.3,
  topScatter: 0.6,
  width: 0.26,
  branches: 8,
  strokes: [0, 0.08, 0.16, 0.27, 0.4],
  flashSize: 4.5,
  flashSec: 0.5,
  sparks: 90,
  arcs: 7,
};

/** トールハンマーの周りの雷の本数と、それを落とし終えるまでの時間（秒。だんだん間を詰める） */
const STORM_BOLTS = 14;
const STORM_SEC = 0.85;
/** 周りの雷が落ちる範囲（目標からの距離。HEX の大きさ比） */
const STORM_RADIUS = 1.8;
/** 最後の太い雷が落ちる時刻（秒。周りの雷を落とし終えた少し後） */
export const HAMMER_HIT_SEC = STORM_SEC + 0.1 + REVEAL_SEC;
/** 太い雷の後の余波の雷（本数と、落ちてから落ちきるまでの時間（秒）） */
const AFTERSHOCKS = 4;
const AFTERSHOCK_SEC = 0.5;

interface Thunder {
  /** カメラ正対。原点が落ちる足元で、1 が絵の高さ */
  group: THREE.Group;
  bolt: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  flash: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  sparks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  velocities: Float32Array;
  foot: THREE.Vector3;
  style: BoltStyle;
  /** 出す時刻（performance.now。先の時刻なら、それまで出さない） */
  start: number;
  /** 今の形で光っている strokes の番号 */
  stroke: number;
}

export class ThunderEffects {
  readonly group = new THREE.Group();
  private readonly plane = new THREE.PlaneGeometry(2, 2);
  private readonly sparkTexture = createSparkTexture();
  private items: Thunder[] = [];

  constructor() {
    this.group.name = 'thunder-fx';
  }

  /** target の頭上に雷を落とす（サンダーフォール） */
  spawn(target: UnitPlacement): void {
    this.strike(target.foot, target.height, THUNDER_STYLE, 0);
  }

  /**
   * トールハンマー: target の周りの地面に雷を次々と落とし、出してから HAMMER_HIT_SEC 秒で太い雷を target に落とす。
   * groundAt は地面の高さ、hexSize は HEX の大きさ（周りの雷が落ちる範囲に使う）
   */
  storm(target: UnitPlacement, groundAt: (x: number, z: number) => number, hexSize: number): void {
    const h = target.height;
    const around = (radius: number) => {
      const a = Math.random() * Math.PI * 2;
      const r = radius * hexSize * (0.25 + 0.75 * Math.sqrt(Math.random()));
      const x = target.foot.x + Math.cos(a) * r;
      const z = target.foot.z + Math.sin(a) * r;
      return new THREE.Vector3(x, groundAt(x, z), z);
    };
    // だんだん間を詰める（i 本目は 1 − (1 − i/n)² の時刻）
    for (let i = 0; i < STORM_BOLTS; i++) {
      const u = i / STORM_BOLTS;
      this.strike(around(STORM_RADIUS), h, STORM_STYLE, STORM_SEC * (1 - (1 - u) ** 2));
    }
    this.strike(target.foot, h, HAMMER_STYLE, HAMMER_HIT_SEC - REVEAL_SEC);
    for (let i = 0; i < AFTERSHOCKS; i++) {
      this.strike(around(STORM_RADIUS * 0.7), h, STORM_STYLE, HAMMER_HIT_SEC + 0.08 + (AFTERSHOCK_SEC * i) / AFTERSHOCKS);
    }
  }

  /** foot に、絵の高さ height の大きさで style の雷を delaySec 秒後に落とし始める */
  private strike(foot: THREE.Vector3, height: number, style: BoltStyle, delaySec: number): void {
    const group = new THREE.Group();
    group.scale.setScalar(height);
    group.visible = false;
    const bolt = new THREE.Mesh(createBoltGeometry(style), createBoltMaterial(style.color));
    const flash = new THREE.Mesh(this.plane, createFlashMaterial(style.color));
    flash.position.y = style.bottom;
    flash.visible = false;
    // 火花は落ちたところから上と横へ飛び散る
    const velocities = new Float32Array(style.sparks * 2);
    for (let i = 0; i < style.sparks; i++) {
      const a = Math.PI / 2 + (Math.random() * 2 - 1) * 1.4;
      const v = SPARK_SPEED * (0.3 + 0.7 * Math.random()) * (style.flashSize / THUNDER_STYLE.flashSize) ** 0.5;
      velocities[i * 2] = Math.cos(a) * v;
      velocities[i * 2 + 1] = Math.sin(a) * v;
    }
    const sparks = createSparks(style.sparks, this.sparkTexture, style.color, SPARK_SIZE * height);
    sparks.position.y = style.bottom;
    for (const o of [bolt, flash, sparks]) {
      o.renderOrder = FX_RENDER_ORDER;
      o.frustumCulled = false;
      group.add(o);
    }
    this.group.add(group);
    this.items.push({ group, bolt, flash, sparks, velocities, foot: foot.clone(), style, start: performance.now() + delaySec * 1000, stroke: 0 });
  }

  /** 毎フレーム、描画の前に呼ぶ */
  update(camera: THREE.Camera): void {
    if (this.items.length === 0) return;
    const now = performance.now();
    this.items = this.items.filter((th) => {
      const t = (now - th.start) / 1000;
      const { strokes, flashSec, flashSize } = th.style;
      const sinceHit = t - THUNDER_HIT_SEC;
      const boltEnd = strokes[strokes.length - 1] + AFTER_SEC;
      if (sinceHit > Math.max(boltEnd, flashSec, SPARK_SEC)) {
        this.dispose(th);
        return false;
      }
      th.group.visible = t >= 0;
      if (t < 0) return true;
      th.group.position.copy(th.foot);
      th.group.quaternion.copy(camera.quaternion);

      // 稲妻: 上から下へ走って落ち、光り直すたびに形を変えて明滅し、最後に消える
      let stroke = 0;
      while (stroke + 1 < strokes.length && sinceHit >= strokes[stroke + 1]) stroke++;
      if (stroke !== th.stroke) {
        th.stroke = stroke;
        th.bolt.geometry.dispose();
        th.bolt.geometry = createBoltGeometry(th.style);
      }
      const u = th.bolt.material.uniforms;
      u.uReveal.value = Math.min(t / REVEAL_SEC, 1);
      const since = sinceHit - strokes[stroke];
      const flicker = sinceHit < 0 ? 1 : STROKE_BASE + (1 - STROKE_BASE) * Math.exp(-Math.max(since, 0) / STROKE_DECAY_SEC);
      const fade = THREE.MathUtils.clamp((boltEnd - sinceHit) / AFTER_SEC, 0, 1);
      u.uIntensity.value = flicker * (sinceHit > strokes[strokes.length - 1] ? fade : 1);
      th.bolt.visible = sinceHit < boltEnd;

      const ft = sinceHit / flashSec;
      th.flash.visible = ft >= 0 && ft < 1;
      if (th.flash.visible) {
        th.flash.material.uniforms.uT.value = ft;
        th.flash.scale.setScalar((flashSize / 2) * (0.6 + 0.6 * Math.sqrt(ft)));
      }

      const st = sinceHit / SPARK_SEC;
      th.sparks.visible = st >= 0 && st < 1;
      if (th.sparks.visible) {
        moveSparks(th.sparks, th.velocities, SPARK_GRAVITY, sinceHit);
        th.sparks.material.opacity = (1 - st) ** 1.5;
      }
      return true;
    });
  }

  clear(): void {
    for (const th of this.items) this.dispose(th);
    this.items = [];
  }

  private dispose(th: Thunder): void {
    this.group.remove(th.group);
    th.bolt.geometry.dispose();
    th.bolt.material.dispose();
    th.flash.material.dispose();
    th.sparks.material.dispose();
    th.sparks.geometry.dispose();
  }
}

/** a から b へのジグザグの折れ線（中点を左右にずらすのを detail 回くり返す） */
function jagged(a: THREE.Vector2, b: THREE.Vector2, detail: number, amount: number): THREE.Vector2[] {
  let points = [a, b];
  let offset = a.distanceTo(b) * amount;
  for (let n = 0; n < detail; n++) {
    const next: THREE.Vector2[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1];
      const q = points[i];
      const d = q.clone().sub(p);
      const side = new THREE.Vector2(-d.y, d.x).normalize();
      next.push(p.clone().add(q).multiplyScalar(0.5).addScaledVector(side, (Math.random() * 2 - 1) * offset), q);
    }
    points = next;
    offset *= 0.5;
  }
  return points;
}

/**
 * 稲妻の帯（幹と枝、地面を這う放電）。頂点ごとに、上端からの進み具合（aAlong。枝は分かれたところの値から続ける）と、
 * 帯の中心からの横のずれ（aSide。−1〜1）を持たせる
 */
function createBoltGeometry(style: BoltStyle): THREE.BufferGeometry {
  const { top: topY, bottom, topScatter, width } = style;
  const top = new THREE.Vector2((Math.random() * 2 - 1) * topScatter, topY);
  const trunk = jagged(top, new THREE.Vector2(0, bottom), DETAIL, JAGGED);
  const lines: { points: THREE.Vector2[]; along: number[]; width: number; taper: boolean }[] = [
    { points: trunk, along: trunk.map((_, i) => i / (trunk.length - 1)), width, taper: false },
  ];
  for (let n = 0; n < style.branches; n++) {
    // 幹の上 7 割のどこかから、下向き・外向きに分かれる
    const i = Math.floor(Math.random() * trunk.length * 0.7);
    const from = trunk[i];
    const rest = from.y - bottom;
    const dir = new THREE.Vector2((Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6), -1).normalize();
    const to = from.clone().addScaledVector(dir, rest * BRANCH_LENGTH * (0.6 + Math.random() * 0.8));
    const points = jagged(from, to, DETAIL - 2, JAGGED);
    const a0 = i / (trunk.length - 1);
    const a1 = a0 + (1 - a0) * BRANCH_LENGTH;
    lines.push({ points, along: points.map((_, k) => a0 + ((a1 - a0) * k) / (points.length - 1)), width: width * BRANCH_WIDTH, taper: true });
  }
  // 地面を這う放電: 落ちたところから左右へ、低く折れ曲がりながら走る（幹が落ちきった時点で現れる）
  for (let n = 0; n < style.arcs; n++) {
    const s = n % 2 === 0 ? 1 : -1;
    const from = new THREE.Vector2(0, bottom * 0.4);
    const to = new THREE.Vector2(s * ARC_LENGTH * (0.5 + Math.random() * 0.5), (Math.random() * 2 - 1) * ARC_RISE);
    const points = jagged(from, to, DETAIL - 1, JAGGED * 1.5);
    lines.push({ points, along: points.map(() => 1), width: width * BRANCH_WIDTH * 0.7, taper: true });
  }

  const positions: number[] = [];
  const along: number[] = [];
  const side: number[] = [];
  const index: number[] = [];
  for (const line of lines) {
    const { points } = line;
    const base = positions.length / 3;
    for (let i = 0; i < points.length; i++) {
      const p = points[Math.max(i - 1, 0)];
      const q = points[Math.min(i + 1, points.length - 1)];
      const n = new THREE.Vector2(p.y - q.y, q.x - p.x).normalize();
      // 枝は先へ細くする
      const w = line.width * (line.taper ? 1 - (0.7 * i) / (points.length - 1) : 1);
      for (const s of [-1, 1]) {
        positions.push(points[i].x + n.x * w * s, points[i].y + n.y * w * s, 0);
        along.push(line.along[i]);
        side.push(s);
      }
      if (i > 0) {
        const v = base + i * 2;
        index.push(v - 2, v - 1, v, v, v - 1, v + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(index);
  return g;
}

/** 稲妻。芯は白く、まわりに色の付いた光。uReveal より先（下）はまだ走っていないので描かない */
function createBoltMaterial(color: number): THREE.ShaderMaterial {
  const m = createFxMaterial(
    { uReveal: { value: 0 }, uIntensity: { value: 1 }, uColor: { value: new THREE.Color(color) } },
    /* glsl */ `
uniform float uReveal;
uniform float uIntensity;
uniform vec3 uColor;
varying float vAlong;
varying float vSide;
void main() {
  if (vAlong > uReveal) discard;
  float core = exp(-vSide * vSide * 40.0);
  float glow = exp(-vSide * vSide * 4.0) * 0.55;
  // 走っている先端は明るく
  float head = exp(-pow((uReveal - vAlong) * 12.0, 2.0)) * (1.0 - step(1.0, uReveal));
  float a = (core + glow + head) * uIntensity;
  vec3 col = mix(uColor, vec3(1.0), clamp(core + head, 0.0, 1.0));
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
