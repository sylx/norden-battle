/**
 * 範囲の攻撃・大型の兵種のエフェクト。
 *
 * - ImpactEffects: 地面に広がる衝撃の輪と、はじける光・飛び散る破片（ゴーレム・ベヒーモスの殴り、フロストノヴァの氷、
 *   アーススパイクの岩、光線・メテオの爆発）。見た目は ImpactStyle で変える。
 * - BeamEffects: 口元に光を溜めてから、目標へ太い光線を放つ（ベヒーモスの光線）。着弾の爆発は ImpactEffects。
 * - PillarEffects: 地点に照準の輪が出てから、空から光の柱が落ちる（メテオフォール。衛星兵器のような演出）。爆発は ImpactEffects。
 *
 * どれもユニットの絵より手前に、深度テストをせず加算で描く（fxShared.ts）。
 */
import * as THREE from 'three';
import { createFlashMaterial, createFxMaterial, createSparks, createSparkTexture, FX_RENDER_ORDER, moveSparks } from './fxShared';

/** 衝撃の見た目 */
export interface ImpactStyle {
  /** 光と破片の色 */
  color: number;
  /** 地面の輪の色 */
  ringColor: number;
  /** 大きさ（HEX の大きさ比。輪が広がる半径・光の大きさ） */
  size: number;
  /** 破片の数・速さ（大きさ比 / 秒）・重力・時間（秒） */
  shards: number;
  speed: number;
  gravity: number;
  sec: number;
}

export const SMASH_STYLE: ImpactStyle = { color: 0xffc070, ringColor: 0xc89050, size: 0.9, shards: 26, speed: 2.2, gravity: 5, sec: 0.6 };
export const FROST_STYLE: ImpactStyle = { color: 0xbfeaff, ringColor: 0x70c8ff, size: 0.8, shards: 34, speed: 1.6, gravity: 1.5, sec: 0.9 };
export const SPIKE_STYLE: ImpactStyle = { color: 0xd8a868, ringColor: 0x8a6438, size: 0.7, shards: 22, speed: 2.8, gravity: 7, sec: 0.7 };
export const BLAST_STYLE: ImpactStyle = { color: 0xffb050, ringColor: 0xff7020, size: 1.5, shards: 40, speed: 3.2, gravity: 4, sec: 0.9 };

/** 衝撃は出した時点で当たる（はじける光が最初に最も明るい） */
export const IMPACT_HIT_SEC = 0.02;

interface Impact {
  /** カメラ正対の板（光と破片） */
  board: THREE.Group;
  flash: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  sparks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  velocities: Float32Array;
  /** 地面に寝かせた輪 */
  ring: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  at: THREE.Vector3;
  scale: number;
  style: ImpactStyle;
  start: number;
}

export class ImpactEffects {
  readonly group = new THREE.Group();
  private readonly plane = new THREE.PlaneGeometry(2, 2);
  private readonly sparkTexture = createSparkTexture();
  private items: Impact[] = [];

  constructor() {
    this.group.name = 'impact-fx';
  }

  /** at（地面の点）に衝撃を出す。hexSize は HEX の大きさ（ワールド） */
  spawn(at: THREE.Vector3, hexSize: number, style: ImpactStyle): void {
    const scale = hexSize * style.size;
    const board = new THREE.Group();
    board.scale.setScalar(scale);
    const flash = new THREE.Mesh(this.plane, createFlashMaterial(style.color));
    flash.scale.setScalar(0.6);
    const velocities = new Float32Array(style.shards * 2);
    for (let i = 0; i < style.shards; i++) {
      // 上向きに扇形に飛び散る
      const a = Math.PI / 2 + (Math.random() * 2 - 1) * 1.2;
      const v = style.speed * (0.4 + 0.6 * Math.random());
      velocities[i * 2] = Math.cos(a) * v;
      velocities[i * 2 + 1] = Math.sin(a) * v;
    }
    const sparks = createSparks(style.shards, this.sparkTexture, style.color, 0.09 * scale);
    for (const o of [flash, sparks]) {
      o.renderOrder = FX_RENDER_ORDER;
      o.frustumCulled = false;
      board.add(o);
    }
    const ring = new THREE.Mesh(this.plane, createRingMaterial(style.ringColor));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(at).add(new THREE.Vector3(0, hexSize * 0.03, 0));
    ring.renderOrder = FX_RENDER_ORDER;
    ring.frustumCulled = false;
    this.group.add(board, ring);
    this.items.push({ board, flash, sparks, velocities, ring, at: at.clone(), scale, style, start: performance.now() });
  }

  /** 毎フレーム、描画の前に呼ぶ */
  update(camera: THREE.Camera): void {
    if (this.items.length === 0) return;
    const now = performance.now();
    this.items = this.items.filter((s) => {
      const t = (now - s.start) / 1000;
      const k = t / s.style.sec;
      if (k >= 1) {
        this.dispose(s);
        return false;
      }
      s.board.position.copy(s.at).add(new THREE.Vector3(0, s.scale * 0.35, 0));
      s.board.quaternion.copy(camera.quaternion);
      const ft = Math.min(1, k * 2.2);
      s.flash.visible = ft < 1;
      s.flash.material.uniforms.uT.value = ft;
      s.flash.scale.setScalar(0.5 + 0.7 * Math.sqrt(ft));
      s.sparks.visible = true;
      moveSparks(s.sparks, s.velocities, s.style.gravity, t);
      s.sparks.material.opacity = (1 - k) ** 1.5;
      // 輪は外へ広がりながら消える
      s.ring.scale.setScalar(s.scale * (0.2 + 0.9 * (1 - (1 - k) ** 2)));
      s.ring.material.uniforms.uT.value = k;
      return true;
    });
  }

  clear(): void {
    for (const s of this.items) this.dispose(s);
    this.items = [];
  }

  private dispose(s: Impact): void {
    this.group.remove(s.board, s.ring);
    s.flash.material.dispose();
    s.sparks.material.dispose();
    s.sparks.geometry.dispose();
    s.ring.material.dispose();
  }
}

/** 地面の輪（板の縁が輪。uT は 0〜1 の経過で、太さと濃さが減る） */
function createRingMaterial(color: number): THREE.ShaderMaterial {
  return createFxMaterial(
    { uT: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    /* glsl */ `
uniform float uT;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float w = mix(0.35, 0.05, uT);
  float ring = exp(-pow((r - (1.0 - w)) / w, 2.0) * 3.0) * step(r, 1.0);
  float a = ring * (1.0 - uT) * 1.3;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), ring * 0.4) * a, 1.0);
}`,
  );
}

/** 光の帯（板の x が長さの向き、y が太さ。uT は 0〜1 の経過、uCore は芯の白さ） */
function createStreakMaterial(color: number): THREE.ShaderMaterial {
  return createFxMaterial(
    { uOpacity: { value: 1 }, uColor: { value: new THREE.Color(color) } },
    /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float y = abs(vUv.y * 2.0 - 1.0);
  // 両端をやわらかくする
  float ends = smoothstep(0.0, 0.04, vUv.x) * smoothstep(0.0, 0.04, 1.0 - vUv.x);
  float core = exp(-y * y * 40.0);
  float glow = exp(-y * y * 5.0) * 0.6;
  float a = (core + glow) * ends * uOpacity;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core) * a, 1.0);
}`,
  );
}

/** 板 mesh（2×2 の平面）を、a から b への帯にして、帯の向きを軸にカメラへ向ける。width は太さ（ワールド） */
function orientStreak(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, width: number, camera: THREE.Camera): void {
  const x = b.clone().sub(a);
  const len = x.length();
  x.normalize();
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const toCam = camera.position.clone().sub(mid);
  const z = toCam.sub(x.clone().multiplyScalar(toCam.dot(x))).normalize();
  const y = z.clone().cross(x).normalize();
  mesh.matrixAutoUpdate = false;
  mesh.matrix.makeBasis(x.multiplyScalar(len / 2), y.multiplyScalar(width / 2), z).setPosition(mid);
  mesh.matrixWorldNeedsUpdate = true;
}

/** 光線の溜め・放つ時間（秒） */
const BEAM_CHARGE_SEC = 0.7;
const BEAM_FIRE_SEC = 0.55;
/** 出してから当たるまでの時間（秒）: 溜め終えて光線が届いたとき */
export const BEAM_HIT_SEC = BEAM_CHARGE_SEC + 0.05;
const BEAM_COLOR = 0xffe0a0;

interface Beam {
  glow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  streak: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  from: THREE.Vector3;
  to: THREE.Vector3;
  width: number;
  start: number;
}

export class BeamEffects {
  readonly group = new THREE.Group();
  private readonly plane = new THREE.PlaneGeometry(2, 2);
  private items: Beam[] = [];

  constructor() {
    this.group.name = 'beam-fx';
  }

  /** from（口元）に光を溜めて、to へ光線を放つ。width は光線の太さ（ワールド） */
  spawn(from: THREE.Vector3, to: THREE.Vector3, width: number): void {
    const glow = new THREE.Mesh(this.plane, createFlashMaterial(BEAM_COLOR));
    const streak = new THREE.Mesh(this.plane, createStreakMaterial(BEAM_COLOR));
    for (const o of [glow, streak]) {
      o.renderOrder = FX_RENDER_ORDER;
      o.frustumCulled = false;
    }
    streak.visible = false;
    this.group.add(glow, streak);
    this.items.push({ glow, streak, from: from.clone(), to: to.clone(), width, start: performance.now() });
  }

  update(camera: THREE.Camera): void {
    if (this.items.length === 0) return;
    const now = performance.now();
    this.items = this.items.filter((b) => {
      const t = (now - b.start) / 1000;
      if (t > BEAM_CHARGE_SEC + BEAM_FIRE_SEC) {
        this.group.remove(b.glow, b.streak);
        b.glow.material.dispose();
        b.streak.material.dispose();
        return false;
      }
      // 溜め: 口元の光が脈打ちながら大きくなる。放つ間は小さくなって消える
      const charge = Math.min(1, t / BEAM_CHARGE_SEC);
      const firing = t >= BEAM_CHARGE_SEC;
      const f = firing ? (t - BEAM_CHARGE_SEC) / BEAM_FIRE_SEC : 0;
      b.glow.position.copy(b.from);
      b.glow.quaternion.copy(camera.quaternion);
      const pulse = 1 + 0.15 * Math.sin(t * 40);
      b.glow.scale.setScalar(b.width * (firing ? 2.2 * (1 - f) : 0.4 + 1.8 * charge * charge) * pulse);
      b.glow.material.uniforms.uT.value = firing ? 0.3 + 0.7 * f : 0.6 * (1 - charge);
      // 光線: 出た瞬間が最も太く、細くなって消える
      b.streak.visible = firing;
      if (firing) {
        orientStreak(b.streak, b.from, b.to, b.width * (1.6 - 1.2 * f), camera);
        b.streak.material.uniforms.uOpacity.value = (1 - f) ** 0.7;
      }
      return true;
    });
  }

  clear(): void {
    for (const b of this.items) {
      this.group.remove(b.glow, b.streak);
      b.glow.material.dispose();
      b.streak.material.dispose();
    }
    this.items = [];
  }
}

/** 照準の輪が出てから柱が地面に届くまで（秒）と、柱が残る時間（秒） */
const PILLAR_AIM_SEC = 0.55;
const PILLAR_FALL_SEC = 0.12;
const PILLAR_HOLD_SEC = 0.6;
/** 出してから当たるまでの時間（秒）: 柱が地面に届いたとき */
export const PILLAR_HIT_SEC = PILLAR_AIM_SEC + PILLAR_FALL_SEC;
const PILLAR_COLOR = 0xc8e8ff;
/** 柱の高さ（HEX の大きさ比） */
const PILLAR_HEIGHT = 14;

interface Pillar {
  aim: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  pillar: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  at: THREE.Vector3;
  hexSize: number;
  start: number;
}

export class PillarEffects {
  readonly group = new THREE.Group();
  private readonly plane = new THREE.PlaneGeometry(2, 2);
  private items: Pillar[] = [];

  constructor() {
    this.group.name = 'pillar-fx';
  }

  /** at（地面の点）に照準の輪を出し、空から光の柱を落とす */
  spawn(at: THREE.Vector3, hexSize: number): void {
    const aim = new THREE.Mesh(this.plane, createRingMaterial(PILLAR_COLOR));
    aim.rotation.x = -Math.PI / 2;
    aim.position.copy(at).add(new THREE.Vector3(0, hexSize * 0.04, 0));
    const pillar = new THREE.Mesh(this.plane, createStreakMaterial(PILLAR_COLOR));
    for (const o of [aim, pillar]) {
      o.renderOrder = FX_RENDER_ORDER;
      o.frustumCulled = false;
    }
    pillar.visible = false;
    this.group.add(aim, pillar);
    this.items.push({ aim, pillar, at: at.clone(), hexSize, start: performance.now() });
  }

  update(camera: THREE.Camera): void {
    if (this.items.length === 0) return;
    const now = performance.now();
    this.items = this.items.filter((p) => {
      const t = (now - p.start) / 1000;
      if (t > PILLAR_HIT_SEC + PILLAR_HOLD_SEC) {
        this.group.remove(p.aim, p.pillar);
        p.aim.material.dispose();
        p.pillar.material.dispose();
        return false;
      }
      // 照準: 大きな輪が絞り込まれていく（明滅しながら）
      const a = Math.min(1, t / PILLAR_AIM_SEC);
      p.aim.visible = t < PILLAR_HIT_SEC;
      p.aim.scale.setScalar(p.hexSize * (2.4 - 1.4 * a));
      p.aim.material.uniforms.uT.value = 0.5 - 0.4 * Math.abs(Math.sin(t * 18));
      // 柱: 空から一気に地面へ届き、太いまま光ってから細くなって消える
      const fall = (t - PILLAR_AIM_SEC) / PILLAR_FALL_SEC;
      p.pillar.visible = fall >= 0;
      if (p.pillar.visible) {
        const top = p.at.clone().add(new THREE.Vector3(0, p.hexSize * PILLAR_HEIGHT, 0));
        const bottom = top.clone().lerp(p.at, Math.min(1, fall));
        const hold = Math.max(0, (t - PILLAR_HIT_SEC) / PILLAR_HOLD_SEC);
        orientStreak(p.pillar, top, bottom, p.hexSize * 1.1 * (1 - 0.8 * hold), camera);
        p.pillar.material.uniforms.uOpacity.value = 1 - hold * hold;
      }
      return true;
    });
  }

  clear(): void {
    for (const p of this.items) {
      this.group.remove(p.aim, p.pillar);
      p.aim.material.dispose();
      p.pillar.material.dispose();
    }
    this.items = [];
  }
}
