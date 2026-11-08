/**
 * 範囲の攻撃・大型の兵種のエフェクト。
 *
 * - ImpactEffects: 地面に広がる衝撃の輪と、はじける光・飛び散る破片（ゴーレム・ベヒーモスの殴り、フロストノヴァの氷、
 *   アーススパイクの岩、メテオの爆発、トールハンマーの雷の衝撃）。見た目は ImpactStyle で変える。
 * - BeamEffects: 口元に光を溜めてから光線を放ち、範囲をさっと横切るように薙ぎ払って焼き尽くす（ベヒーモスの光線）。
 *   光線の先が通った HEX から火球と煙の連続画像（ExplosionEffects）が立ち上がり、焼け跡が燃え上がる。
 * - PillarEffects: 地点を中心に魔法陣が描かれて回り、中心へ縮むと同時に空から細い光線が降りてきて太くなり、
 *   範囲が光で飽和して爆発する（メテオフォール）。飛び散る破片は ImpactEffects。
 *
 * ユニットの絵より手前に、深度テストをせず描く。光は加算（fxShared.ts）、光線の爆発画像は煙の色が残る透過合成。
 */
import * as THREE from 'three';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { ExplosionEffects } from './explosionFx';
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
/** トールハンマーの雷が落ちたところに広がる衝撃（雷の色） */
export const HAMMER_STYLE: ImpactStyle = { color: 0xdfe4ff, ringColor: 0x8fa0ff, size: 2.2, shards: 60, speed: 4.2, gravity: 3, sec: 1.0 };

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

/**
 * 光線の出どころ（ベヒーモスの口）。x は絵の幅比で、絵の中心から向いている側へ。y は足元から絵の高さ比。
 * 元の絵（右向き）で口に見えるところに合わせる。左向きの絵では x を左右反転する。
 * 絵はカメラ正対なので、幅はカメラの右、高さはカメラの上の向きに測る
 */
export const BEAM_MOUTH = { x: 0.14, y: 0.68 };
/** 溜め・薙ぎ払い・焼け跡が燃えて消えるまでの時間（秒） */
const BEAM_CHARGE_SEC = 0.7;
const BEAM_SWEEP_SEC = 0.55;
const BEAM_BURN_SEC = 1.0;
/** 薙ぎ払い終えてから光線が消えるまで（秒） */
const BEAM_FADE_SEC = 0.15;
/** 出してから当たるまでの時間（秒）: 範囲を薙ぎ払い終えて、焼け跡が一斉に燃え上がるとき */
export const BEAM_HIT_SEC = BEAM_CHARGE_SEC + BEAM_SWEEP_SEC;
const BEAM_COLOR = 0xffe0a0;
/** 光線の太さ・焼け跡の幅・範囲の外へはみ出して薙ぐ長さ（HEX の大きさ比） */
const BEAM_WIDTH = 0.45;
const BURN_WIDTH = 1.1;
const SWEEP_OVERSHOOT = 0.7;
/** 光線の通過から火球が噴き上がるまでの間（秒） */
const BEAM_EXPLOSION_DELAY_SEC = 0.06;

interface Beam {
  glow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  streak: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** 光線の先が地面に当たるところの光 */
  tip: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** 地面に寝かせた焼け跡（薙ぐ線に沿う帯） */
  trail: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** 口元: 足元と、そこからカメラの右・上の向きへずらす量（ワールド） */
  foot: THREE.Vector3;
  mouthX: number;
  mouthY: number;
  /** 薙ぐ線の始まりと終わり（地面） */
  sweepFrom: THREE.Vector3;
  sweepTo: THREE.Vector3;
  /** 範囲の HEX の地面の点と、光線の先がそこを通る薙ぎ払いの進み具合（0〜1）。はじけたら done */
  burns: { at: THREE.Vector3; k: number; done: boolean }[];
  hexSize: number;
  start: number;
}

export class BeamEffects {
  readonly group = new THREE.Group();
  private readonly plane = new THREE.PlaneGeometry(2, 2);
  private readonly explosions = new ExplosionEffects();
  private items: Beam[] = [];

  constructor() {
    this.group.name = 'beam-fx';
    this.group.add(this.explosions.group);
  }

  /**
   * shooter の口元（BEAM_MOUTH）に光を溜めて光線を放ち、範囲（area の HEX の地面の点。center が狙った HEX）を横切るように薙ぎ払って焼く。
   * 薙ぐ向きは、撃つユニットから center への向きに直交する向き
   */
  spawn(shooter: UnitPlacement, center: THREE.Vector3, area: readonly THREE.Vector3[], hexSize: number): void {
    const mouthX = (shooter.facing === 'left' ? -1 : 1) * BEAM_MOUTH.x * shooter.width;
    const mouthY = BEAM_MOUTH.y * shooter.height;
    // 薙ぐ線: 撃つ向きに直交する向きに、範囲の端から端まで（少し奥へ斜めに）
    const forward = center.clone().sub(shooter.foot).setY(0);
    if (forward.lengthSq() < 1e-9) forward.set(1, 0, 0);
    forward.normalize();
    const across = new THREE.Vector3(-forward.z, 0, forward.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
    const points = area.length > 0 ? area : [center];
    const along = points.map((p) => p.clone().sub(center).dot(across));
    const lo = Math.min(...along) - SWEEP_OVERSHOOT * hexSize;
    const hi = Math.max(...along) + SWEEP_OVERSHOOT * hexSize;
    const lift = new THREE.Vector3(0, hexSize * 0.05, 0);
    const sweepFrom = center.clone().addScaledVector(across, lo).addScaledVector(forward, -0.3 * hexSize).add(lift);
    const sweepTo = center.clone().addScaledVector(across, hi).addScaledVector(forward, 0.3 * hexSize).add(lift);
    const burns = points.map((at, i) => ({ at: at.clone(), k: (along[i] - lo) / (hi - lo), done: false }));

    const glow = new THREE.Mesh(this.plane, createFlashMaterial(BEAM_COLOR));
    const streak = new THREE.Mesh(this.plane, createStreakMaterial(BEAM_COLOR));
    const tip = new THREE.Mesh(this.plane, createFlashMaterial(0xffc070));
    const trail = new THREE.Mesh(this.plane, createBurnTrailMaterial());
    // 焼け跡の板: x が薙ぐ向き、y が幅、法線が上
    const dir = sweepTo.clone().sub(sweepFrom);
    const len = dir.length();
    dir.normalize();
    const width = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    trail.matrixAutoUpdate = false;
    trail.matrix
      .makeBasis(dir.clone().multiplyScalar(len / 2), width.multiplyScalar((BURN_WIDTH * hexSize) / 2), new THREE.Vector3(0, 1, 0))
      .setPosition(sweepFrom.clone().add(sweepTo).multiplyScalar(0.5));
    for (const o of [trail, glow, streak, tip]) {
      o.renderOrder = FX_RENDER_ORDER;
      o.frustumCulled = false;
    }
    streak.visible = tip.visible = trail.visible = false;
    this.group.add(trail, glow, streak, tip);
    this.items.push({ glow, streak, tip, trail, foot: shooter.foot.clone(), mouthX, mouthY, sweepFrom, sweepTo, burns, hexSize, start: performance.now() });
  }

  update(camera: THREE.Camera): void {
    const now = performance.now();
    this.items = this.items.filter((b) => {
      const t = (now - b.start) / 1000;
      if (t > BEAM_HIT_SEC + BEAM_BURN_SEC) {
        this.dispose(b);
        return false;
      }
      const charge = Math.min(1, t / BEAM_CHARGE_SEC);
      const s = (t - BEAM_CHARGE_SEC) / BEAM_SWEEP_SEC;
      const firing = s >= 0;
      const fade = Math.max(0, (t - BEAM_HIT_SEC) / BEAM_FADE_SEC);
      const beamOn = firing && fade < 1;
      // 薙ぎ払いは素早く始まり、終わりで少し緩む
      const head = THREE.MathUtils.clamp(s, 0, 1);
      const k = 1 - (1 - head) ** 2;
      const width = BEAM_WIDTH * b.hexSize;

      // 溜め: 口元の光が脈打ちながら大きくなる。放っている間は大きく光り、終わると消える
      const from = b.foot
        .clone()
        .addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), b.mouthX)
        .addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), b.mouthY);
      b.glow.position.copy(from);
      b.glow.quaternion.copy(camera.quaternion);
      const pulse = 1 + 0.15 * Math.sin(t * 40);
      b.glow.visible = fade < 1;
      b.glow.scale.setScalar(width * (firing ? 2.2 * (1 - fade) : 0.4 + 1.8 * charge * charge) * pulse);
      b.glow.material.uniforms.uT.value = firing ? 0.3 + 0.7 * fade : 0.6 * (1 - charge);

      // 光線: 口元から薙ぐ線の上の点へ。出た瞬間が最も太い
      const end = b.sweepFrom.clone().lerp(b.sweepTo, k);
      b.streak.visible = b.tip.visible = beamOn;
      if (beamOn) {
        const flicker = 1 + 0.12 * Math.sin(t * 90);
        orientStreak(b.streak, from, end, width * (1.4 - 0.4 * head) * (1 - 0.7 * fade) * flicker, camera);
        b.streak.material.uniforms.uOpacity.value = 1.3 * (1 - fade);
        b.tip.position.copy(end);
        b.tip.quaternion.copy(camera.quaternion);
        b.tip.scale.setScalar(width * 2.2 * flicker * (1 - fade));
        b.tip.material.uniforms.uT.value = 0.25 + 0.5 * fade;
      }

      // 薙ぎ払いの進行式を逆算し、各 HEX の通過直後に画像の爆発を再生する。
      for (const burn of b.burns) {
        if (burn.done || !firing || k < burn.k) continue;
        burn.done = true;
        const crossedAt = BEAM_CHARGE_SEC + BEAM_SWEEP_SEC * (1 - Math.sqrt(1 - burn.k));
        this.explosions.spawn(burn.at, b.hexSize, b.start + (crossedAt + BEAM_EXPLOSION_DELAY_SEC) * 1000);
      }

      // 焼け跡: 光線の先まで焼け、通った直後は白く熱く、冷めながら赤く燃える。薙ぎ終えると一斉に燃え上がってから消える
      b.trail.visible = firing;
      if (firing) {
        const u = b.trail.material.uniforms;
        const after = t - BEAM_HIT_SEC;
        u.uHead.value = k;
        u.uTime.value = t;
        u.uFlare.value = after < 0 ? 0 : Math.exp(-after * 5) * 1.5;
        u.uFade.value = after < 0 ? 1 : Math.max(0, 1 - after / BEAM_BURN_SEC) ** 1.5;
      }
      return true;
    });
    // 光線が消えたあとも煙を更新し、新たな爆発は生まれたフレームから正しい位置で描く。
    this.explosions.update(camera);
  }

  clear(): void {
    for (const b of this.items) this.dispose(b);
    this.items = [];
    this.explosions.clear();
  }

  private dispose(b: Beam): void {
    const meshes = [b.glow, b.streak, b.tip, b.trail];
    this.group.remove(...meshes);
    for (const m of meshes) m.material.dispose();
  }
}

/**
 * 地面の焼け跡（板の x が薙ぐ向き、y が幅）。uHead（0〜1）まで焼けていて、先端ほど白く熱く、離れるほど赤く燃える。
 * uFlare は一斉に燃え上がる明るさ、uFade は全体の濃さ、uTime は炎の揺らぎ
 */
function createBurnTrailMaterial(): THREE.ShaderMaterial {
  return createFxMaterial(
    { uHead: { value: 0 }, uFlare: { value: 0 }, uFade: { value: 1 }, uTime: { value: 0 } },
    /* glsl */ `
uniform float uHead;
uniform float uFlare;
uniform float uFade;
uniform float uTime;
varying vec2 vUv;
void main() {
  float x = vUv.x;
  float y = abs(vUv.y * 2.0 - 1.0);
  float behind = uHead - x;
  float burnt = smoothstep(-0.01, 0.01, behind);
  // 縁が炎のように揺らぐ
  float n = 0.5 + 0.25 * sin(x * 47.0 + uTime * 13.0) + 0.25 * sin(x * 91.0 - uTime * 21.0 + vUv.y * 9.0);
  float edge = 1.0 - smoothstep(0.35 + 0.35 * n, 0.95, y);
  float ends = smoothstep(0.0, 0.06, x) * smoothstep(0.0, 0.06, 1.0 - x);
  // 先端ほど熱い
  float hot = exp(-max(behind, 0.0) * 9.0);
  float heat = clamp(hot + uFlare + 0.35, 0.0, 2.5);
  vec3 col = mix(vec3(0.6, 0.08, 0.02), vec3(1.0, 0.55, 0.15), clamp(heat, 0.0, 1.0));
  col = mix(col, vec3(1.0, 0.95, 0.8), clamp(heat - 1.0, 0.0, 1.0));
  float a = burnt * edge * ends * heat * (0.8 + 0.2 * n) * uFade;
  gl_FragColor = vec4(col * a, 1.0);
}`,
  );
}

/**
 * 光の柱の段取り（秒）。
 * 魔法陣が描かれ（DRAW）、ゆっくり回り（SPIN）、中心へ縮みながら細い光線が降りてきて太くなり（CHARGE）、
 * 範囲が光で飽和して爆発する（BLAST）
 */
const PILLAR_DRAW_SEC = 0.6;
const PILLAR_SPIN_SEC = 0.7;
const PILLAR_CHARGE_SEC = 0.85;
/** 光線が空から地面に届くまで（CHARGE の初めの間） */
const PILLAR_FALL_SEC = 0.18;
const PILLAR_BLAST_SEC = 1.1;
/** 爆発のあと光線が消えるまで */
const PILLAR_FADE_SEC = 0.35;
/** 出してから当たるまでの時間（秒）: 光線が範囲いっぱいに太くなって爆発したとき */
export const PILLAR_HIT_SEC = PILLAR_DRAW_SEC + PILLAR_SPIN_SEC + PILLAR_CHARGE_SEC;
/** 光線・爆発の色（魔法陣は画像の青白い光を使う） */
const PILLAR_COLOR = 0xc8e8ff;
/**
 * 光線が降りてくる長さ（カメラから地点までの距離比）。光線は画面の真上から降りるよう、カメラの上の向きに伸ばす
 * （画面の面に沿う向きなので、画面のどこに出ても縦にまっすぐ写り、遠近で傾かない）
 */
const PILLAR_LENGTH = 1.2;
/** 魔法陣がゆっくり回る速さ（ラジアン / 秒） */
const CIRCLE_SPIN = 0.5;

interface Pillar {
  /** 地面に寝かせた魔法陣 */
  circle: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** 空から降りる光線 */
  beam: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** 光線の出どころ（空の点）と、光線が地面に当たるところの光（カメラ正対） */
  sky: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  foot: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** 爆発: 地面の範囲を埋める光と、範囲を包む光（カメラ正対） */
  blast: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  dome: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  at: THREE.Vector3;
  /** 範囲の半径（ワールド） */
  radius: number;
  hexSize: number;
  start: number;
}

export class PillarEffects {
  readonly group = new THREE.Group();
  private readonly plane = new THREE.PlaneGeometry(2, 2);
  // 戦闘画面を作る時点で読み込み始め、初回の詠唱に備える。
  private readonly circleTexture = getMagicCircleTexture();
  private items: Pillar[] = [];

  constructor() {
    this.group.name = 'pillar-fx';
  }

  /**
   * at（地面の点）を中心に魔法陣を描き、空から光の柱を降らせて爆発させる。
   * radius は範囲の半径（ワールド。魔法陣と爆発の大きさ）
   */
  spawn(at: THREE.Vector3, hexSize: number, radius: number): void {
    const circle = new THREE.Mesh(this.plane, createMagicCircleMaterial(this.circleTexture));
    circle.rotation.x = -Math.PI / 2;
    circle.position.copy(at).add(new THREE.Vector3(0, hexSize * 0.04, 0));
    const blast = new THREE.Mesh(this.plane, createBlastMaterial(PILLAR_COLOR));
    blast.rotation.x = -Math.PI / 2;
    blast.position.copy(at).add(new THREE.Vector3(0, hexSize * 0.05, 0));
    blast.scale.setScalar(radius * 1.15);
    const beam = new THREE.Mesh(this.plane, createStreakMaterial(PILLAR_COLOR));
    const sky = new THREE.Mesh(this.plane, createGlowMaterial(PILLAR_COLOR));
    const foot = new THREE.Mesh(this.plane, createGlowMaterial(PILLAR_COLOR));
    foot.position.copy(at).add(new THREE.Vector3(0, hexSize * 0.1, 0));
    const dome = new THREE.Mesh(this.plane, createGlowMaterial(PILLAR_COLOR));
    dome.position.copy(at).add(new THREE.Vector3(0, radius * 0.3, 0));
    for (const o of [circle, beam, sky, foot, blast, dome]) {
      o.renderOrder = FX_RENDER_ORDER;
      o.frustumCulled = false;
      o.visible = false;
    }
    this.group.add(circle, beam, sky, foot, blast, dome);
    this.items.push({ circle, beam, sky, foot, blast, dome, at: at.clone(), radius, hexSize, start: performance.now() });
  }

  update(camera: THREE.Camera): void {
    if (this.items.length === 0) return;
    const now = performance.now();
    this.items = this.items.filter((p) => {
      const t = (now - p.start) / 1000;
      if (t > PILLAR_HIT_SEC + PILLAR_BLAST_SEC) {
        this.dispose(p);
        return false;
      }
      const chargeAt = PILLAR_DRAW_SEC + PILLAR_SPIN_SEC;
      const draw = Math.min(1, t / PILLAR_DRAW_SEC);
      const charge = THREE.MathUtils.clamp((t - chargeAt) / PILLAR_CHARGE_SEC, 0, 1);
      const after = t - PILLAR_HIT_SEC;

      // 魔法陣: 外から順に描かれ、ゆっくり回る。縮むときは回りを速めながら明るくなり、中心の点へ消える
      p.circle.visible = charge < 1;
      if (p.circle.visible) {
        const pop = 0.92 + 0.08 * (1 - (1 - draw) ** 3);
        p.circle.scale.setScalar(p.radius * pop * (1 - charge * charge));
        const u = p.circle.material.uniforms;
        u.uDraw.value = draw;
        u.uAngle.value = CIRCLE_SPIN * t + 5 * charge ** 3;
        u.uGlow.value = (0.5 + 0.5 * draw) * (1 + 2.5 * charge * charge) * (1 + 0.08 * Math.sin(t * 9));
      }

      // 光線: 空の点が灯り、細い光線が降りてきて、爆発に向けてどんどん太くなる。爆発のあとは広がりながら消える
      const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      p.sky.position.copy(p.at).addScaledVector(screenUp, camera.position.distanceTo(p.at) * PILLAR_LENGTH);
      const fall = (t - chargeAt) / PILLAR_FALL_SEC;
      const fade = Math.max(0, after / PILLAR_FADE_SEC);
      p.beam.visible = fall > 0 && fade < 1;
      if (p.beam.visible) {
        const top = p.sky.position;
        const bottom = top.clone().lerp(p.at, Math.min(1, fall));
        const thin = p.hexSize * 0.05;
        const width = after < 0 ? thin + p.radius * 2.4 * charge ** 3.5 : p.radius * 2.4 * (1 + 0.3 * fade);
        orientStreak(p.beam, top, bottom, width, camera);
        const flicker = 1 + 0.15 * Math.sin(t * 70);
        p.beam.material.uniforms.uOpacity.value = after < 0 ? (0.8 + 1.7 * charge * charge) * flicker : 2.5 * (1 - fade) ** 2;
      }
      const skyOn = THREE.MathUtils.clamp((t - chargeAt + 0.2) / 0.2, 0, 1);
      p.sky.visible = skyOn > 0 && fade < 1;
      if (p.sky.visible) {
        p.sky.quaternion.copy(camera.quaternion);
        p.sky.scale.setScalar(p.hexSize * (0.6 + 1.6 * charge) * skyOn);
        p.sky.material.uniforms.uPower.value = (1 + charge) * (1 - fade);
      }
      p.foot.visible = fall >= 1 && after < 0;
      if (p.foot.visible) {
        p.foot.quaternion.copy(camera.quaternion);
        p.foot.scale.setScalar(p.hexSize * 0.4 + p.radius * 1.2 * charge * charge);
        p.foot.material.uniforms.uPower.value = 0.8 + 1.5 * charge * (1 + 0.2 * Math.sin(t * 50));
      }

      // 爆発: 範囲が白く飽和し、衝撃の輪が外へ走って、色が戻りながら消える
      const k = after / PILLAR_BLAST_SEC;
      p.blast.visible = p.dome.visible = k >= 0;
      if (k >= 0) {
        p.blast.material.uniforms.uT.value = k;
        p.dome.quaternion.copy(camera.quaternion);
        p.dome.scale.setScalar(p.radius * (1.5 + 0.6 * (1 - (1 - k) ** 2)));
        p.dome.material.uniforms.uPower.value = 3 * (1 - k) ** 2.5;
      }
      return true;
    });
  }

  clear(): void {
    for (const p of this.items) this.dispose(p);
    this.items = [];
  }

  private dispose(p: Pillar): void {
    const meshes = [p.circle, p.beam, p.sky, p.foot, p.blast, p.dome];
    this.group.remove(...meshes);
    for (const m of meshes) m.material.dispose();
  }
}

/** 複数の詠唱・戦闘画面で共有する画像。個々のエフェクトの破棄時には解放しない。 */
let magicCircleTexture: THREE.Texture | undefined;
function getMagicCircleTexture(): THREE.Texture {
  if (!magicCircleTexture) {
    magicCircleTexture = new THREE.TextureLoader().load(
      new URL('../../../assets/fx/pillar-magic-circle.webp', import.meta.url).href,
    );
    magicCircleTexture.colorSpace = THREE.SRGBColorSpace;
    magicCircleTexture.anisotropy = 4;
  }
  return magicCircleTexture;
}

/**
 * 透過画像の魔法陣。外周と中央の紋様を隙間で分け、中央だけ逆向きに回す。
 * uDraw は描かれた割合（0〜1。外周から角度順に現れ、中央は少し遅れる）、uAngle は回転、uGlow は明るさ。
 */
function createMagicCircleMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return createFxMaterial(
    { uMap: { value: texture }, uDraw: { value: 0 }, uAngle: { value: 0 }, uGlow: { value: 1 } },
    /* glsl */ `
#define PI 3.14159265
uniform sampler2D uMap;
uniform float uDraw;
uniform float uAngle;
uniform float uGlow;
varying vec2 vUv;

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
float reveal(vec2 p, float d) {
  float angle = atan(p.y, p.x) / (2.0 * PI) + 0.5;
  return 1.0 - smoothstep(d - 0.025, d, angle);
}

void main() {
  vec2 p0 = vUv * 2.0 - 1.0;
  float r = length(p0);
  if (r > 1.0) discard;
  vec2 outerUv = rot(p0, uAngle);
  vec2 innerUv = rot(p0, -uAngle * 1.7);
  vec4 outer = texture2D(uMap, outerUv * 0.5 + 0.5);
  vec4 inner = texture2D(uMap, innerUv * 0.5 + 0.5);
  // 画像の中央の紋様と外周の間にある隙間で、回転する層を切り替える。
  float outerMask = smoothstep(0.28, 0.32, r);
  float outerDraw = reveal(outerUv, uDraw * 1.03);
  float innerDraw = reveal(innerUv, clamp((uDraw - 0.3) / 0.7, 0.0, 1.0) * 1.03);
  // 加算合成なので、透過部分の RGB が発光しないよう画像の alpha を掛ける。
  vec3 light = outer.rgb * outer.a * outerMask * outerDraw;
  light += inner.rgb * inner.a * (1.0 - outerMask) * innerDraw;
  float edgeFade = 1.0 - smoothstep(0.97, 1.0, r);
  gl_FragColor = vec4(light * uGlow * edgeFade, 1.0);
}`,
  );
}

/** 地面の範囲を埋める爆発の光（板の 0.8 くらいまでが範囲）。uT は 0〜1 の経過で、初めは白く飽和し、衝撃の輪が外へ走る */
function createBlastMaterial(color: number): THREE.ShaderMaterial {
  return createFxMaterial(
    { uT: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    /* glsl */ `
uniform float uT;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float k = uT;
  float fill = 1.0 - smoothstep(0.7, 0.92, r);
  float sat = fill * pow(1.0 - k, 2.0) * 3.0;
  float shockR = 0.55 + 0.4 * (1.0 - pow(1.0 - k, 2.0));
  float shockD = (r - shockR) / 0.05;
  float shock = exp(-shockD * shockD) * (1.0 - k) * 1.6;
  float a = (sat + shock) * step(r, 1.0);
  vec3 col = mix(uColor, vec3(1.0), clamp(sat * 0.6, 0.0, 1.0));
  gl_FragColor = vec4(col * a, 1.0);
}`,
  );
}

/** 丸い光（カメラ正対の板）。uPower が 1 を超えると芯から白く飽和する */
function createGlowMaterial(color: number): THREE.ShaderMaterial {
  return createFxMaterial(
    { uPower: { value: 1 }, uColor: { value: new THREE.Color(color) } },
    /* glsl */ `
uniform float uPower;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float glow = exp(-r * r * 5.0) * (1.0 - smoothstep(0.75, 1.0, r));
  float core = exp(-r * r * 30.0);
  float a = (glow * 0.8 + core) * uPower;
  vec3 col = mix(uColor, vec3(1.0), clamp(core + glow * uPower * 0.4, 0.0, 1.0));
  gl_FragColor = vec4(col * a, 1.0);
}`,
  );
}
