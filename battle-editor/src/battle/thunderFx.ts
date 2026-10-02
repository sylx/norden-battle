/**
 * 雷のエフェクト（魔術師のサンダーフォール）。相手の頭上の高いところから、ジグザグの稲妻が上から下へ一気に走って
 * 相手に落ちる。落ちたところで光がはじけて火花が散り、稲妻は形を変えながら何度か明滅して消える。
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
/** 落ちてから稲妻が光り直す時刻（秒）。光り直すたびに形を変える */
const STROKES = [0, 0.1, 0.22];
/** 光るたびに暗くなる速さ（秒）と、消えるまでの間に残る明るさ、最後に光ってから消えるまでの時間（秒） */
const STROKE_DECAY_SEC = 0.07;
const STROKE_BASE = 0.25;
const AFTER_SEC = 0.2;
/** 稲妻の上端の高さ・下端（落ちるところ）の高さ（絵の高さ比、足元から）と、上端の左右のばらつき */
const TOP = 3;
const BOTTOM = 0.45;
const TOP_SCATTER = 0.35;
/** 折れ線を細かくする回数と、折れ曲がりの大きさ（区間の長さ比） */
const DETAIL = 6;
const JAGGED = 0.22;
/** 枝の数と、枝の長さ（幹の残りの長さ比）・折れ曲がり */
const BRANCHES = 3;
const BRANCH_LENGTH = 0.35;
/** 光を含めた太さの半分（絵の高さ比）。枝はその BRANCH_WIDTH 倍 */
const WIDTH = 0.09;
const BRANCH_WIDTH = 0.55;
const COLOR = 0xb9a6ff;
/** 落ちたところではじける光の大きさ（絵の高さ比）と時間（秒） */
const FLASH_SIZE = 1.1;
const FLASH_SEC = 0.35;
/** 火花の数・速さ（絵の高さ比 / 秒）・重力・時間（秒）・大きさ */
const SPARKS = 30;
const SPARK_SPEED = 2.6;
const SPARK_GRAVITY = 6;
const SPARK_SEC = 0.55;
const SPARK_SIZE = 0.08;

interface Thunder {
  /** カメラ正対。原点が相手の足元で、1 が絵の高さ */
  group: THREE.Group;
  bolt: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  flash: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  sparks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  velocities: Float32Array;
  foot: THREE.Vector3;
  start: number;
  /** 今の形で光っている STROKES の番号 */
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

  /** target の頭上に雷を落とす */
  spawn(target: UnitPlacement): void {
    const h = target.height;
    const group = new THREE.Group();
    group.scale.setScalar(h);
    const bolt = new THREE.Mesh(createBoltGeometry(), createBoltMaterial());
    const flash = new THREE.Mesh(this.plane, createFlashMaterial(COLOR));
    flash.position.y = BOTTOM;
    flash.visible = false;
    // 火花は落ちたところから上と横へ飛び散る
    const velocities = new Float32Array(SPARKS * 2);
    for (let i = 0; i < SPARKS; i++) {
      const a = Math.PI / 2 + (Math.random() * 2 - 1) * 1.4;
      const v = SPARK_SPEED * (0.3 + 0.7 * Math.random());
      velocities[i * 2] = Math.cos(a) * v;
      velocities[i * 2 + 1] = Math.sin(a) * v;
    }
    const sparks = createSparks(SPARKS, this.sparkTexture, COLOR, SPARK_SIZE * h);
    sparks.position.y = BOTTOM;
    for (const o of [bolt, flash, sparks]) {
      o.renderOrder = FX_RENDER_ORDER;
      o.frustumCulled = false;
      group.add(o);
    }
    this.group.add(group);
    this.items.push({ group, bolt, flash, sparks, velocities, foot: target.foot.clone(), start: performance.now(), stroke: 0 });
  }

  /** 毎フレーム、描画の前に呼ぶ */
  update(camera: THREE.Camera): void {
    if (this.items.length === 0) return;
    const now = performance.now();
    this.items = this.items.filter((th) => {
      const t = (now - th.start) / 1000;
      const sinceHit = t - THUNDER_HIT_SEC;
      const boltEnd = STROKES[STROKES.length - 1] + AFTER_SEC;
      if (sinceHit > Math.max(boltEnd, FLASH_SEC, SPARK_SEC)) {
        this.dispose(th);
        return false;
      }
      th.group.position.copy(th.foot);
      th.group.quaternion.copy(camera.quaternion);

      // 稲妻: 上から下へ走って落ち、光り直すたびに形を変えて明滅し、最後に消える
      let stroke = 0;
      while (stroke + 1 < STROKES.length && sinceHit >= STROKES[stroke + 1]) stroke++;
      if (stroke !== th.stroke) {
        th.stroke = stroke;
        th.bolt.geometry.dispose();
        th.bolt.geometry = createBoltGeometry();
      }
      const u = th.bolt.material.uniforms;
      u.uReveal.value = Math.min(t / REVEAL_SEC, 1);
      const since = sinceHit - STROKES[stroke];
      const flicker = sinceHit < 0 ? 1 : STROKE_BASE + (1 - STROKE_BASE) * Math.exp(-Math.max(since, 0) / STROKE_DECAY_SEC);
      const fade = THREE.MathUtils.clamp((boltEnd - sinceHit) / AFTER_SEC, 0, 1);
      u.uIntensity.value = flicker * (sinceHit > STROKES[STROKES.length - 1] ? fade : 1);
      th.bolt.visible = sinceHit < boltEnd;

      const ft = sinceHit / FLASH_SEC;
      th.flash.visible = ft >= 0 && ft < 1;
      if (th.flash.visible) {
        th.flash.material.uniforms.uT.value = ft;
        th.flash.scale.setScalar((FLASH_SIZE / 2) * (0.6 + 0.6 * Math.sqrt(ft)));
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
 * 稲妻の帯（幹と枝）。頂点ごとに、上端からの進み具合（aAlong。枝は分かれたところの値から続ける）と、
 * 帯の中心からの横のずれ（aSide。−1〜1）を持たせる
 */
function createBoltGeometry(): THREE.BufferGeometry {
  const top = new THREE.Vector2((Math.random() * 2 - 1) * TOP_SCATTER, TOP);
  const trunk = jagged(top, new THREE.Vector2(0, BOTTOM), DETAIL, JAGGED);
  const lines: { points: THREE.Vector2[]; along: number[]; width: number }[] = [
    { points: trunk, along: trunk.map((_, i) => i / (trunk.length - 1)), width: WIDTH },
  ];
  for (let n = 0; n < BRANCHES; n++) {
    // 幹の上 7 割のどこかから、下向き・外向きに分かれる
    const i = Math.floor(Math.random() * trunk.length * 0.7);
    const from = trunk[i];
    const rest = from.y - BOTTOM;
    const dir = new THREE.Vector2((Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6), -1).normalize();
    const to = from.clone().addScaledVector(dir, rest * BRANCH_LENGTH * (0.6 + Math.random() * 0.8));
    const points = jagged(from, to, DETAIL - 2, JAGGED);
    const a0 = i / (trunk.length - 1);
    const a1 = a0 + (1 - a0) * BRANCH_LENGTH;
    lines.push({ points, along: points.map((_, k) => a0 + ((a1 - a0) * k) / (points.length - 1)), width: WIDTH * BRANCH_WIDTH });
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
      const w = line.width * (line === lines[0] ? 1 : 1 - (0.7 * i) / (points.length - 1));
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
function createBoltMaterial(): THREE.ShaderMaterial {
  const m = createFxMaterial(
    { uReveal: { value: 0 }, uIntensity: { value: 1 }, uColor: { value: new THREE.Color(COLOR) } },
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
