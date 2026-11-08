/**
 * 範囲の攻撃・大型の兵種のエフェクト。
 *
 * - ImpactEffects: 地面に広がる衝撃の輪と、はじける光・飛び散る破片（ゴーレム・ベヒーモスの殴り、フロストノヴァの氷、
 *   アーススパイクの岩、光線・メテオの爆発）。見た目は ImpactStyle で変える。
 * - BeamEffects: 口元に光を溜めてから、目標へ太い光線を放つ（ベヒーモスの光線）。着弾の爆発は ImpactEffects。
 * - PillarEffects: 地点を中心に魔法陣が描かれて回り、中心へ縮むと同時に空から細い光線が降りてきて太くなり、
 *   範囲が光で飽和して爆発する（メテオフォール）。飛び散る破片は ImpactEffects。
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
/** 魔法陣の色と、光線・爆発の色 */
const CIRCLE_COLOR = 0x6cc0ff;
const PILLAR_COLOR = 0xc8e8ff;
/** 光線が降りてくる高さ（HEX の大きさ比） */
const PILLAR_HEIGHT = 14;
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
  private items: Pillar[] = [];

  constructor() {
    this.group.name = 'pillar-fx';
  }

  /**
   * at（地面の点）を中心に魔法陣を描き、空から光の柱を降らせて爆発させる。
   * radius は範囲の半径（ワールド。魔法陣と爆発の大きさ）
   */
  spawn(at: THREE.Vector3, hexSize: number, radius: number): void {
    const circle = new THREE.Mesh(this.plane, createMagicCircleMaterial(CIRCLE_COLOR));
    circle.rotation.x = -Math.PI / 2;
    circle.position.copy(at).add(new THREE.Vector3(0, hexSize * 0.04, 0));
    const blast = new THREE.Mesh(this.plane, createBlastMaterial(PILLAR_COLOR));
    blast.rotation.x = -Math.PI / 2;
    blast.position.copy(at).add(new THREE.Vector3(0, hexSize * 0.05, 0));
    blast.scale.setScalar(radius * 1.15);
    const beam = new THREE.Mesh(this.plane, createStreakMaterial(PILLAR_COLOR));
    const sky = new THREE.Mesh(this.plane, createGlowMaterial(PILLAR_COLOR));
    sky.position.copy(at).add(new THREE.Vector3(0, hexSize * PILLAR_HEIGHT, 0));
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

/**
 * 地面に寝かせる魔法陣（板の縁が外の輪）。外の輪・文字の帯・六芒星・内の輪と、逆に回る内側の紋様。
 * uDraw は描かれた割合（0〜1。外の輪から角度の順に、内側は少し遅れて描かれる）、uAngle は回転、uGlow は明るさ
 */
function createMagicCircleMaterial(color: number): THREE.ShaderMaterial {
  return createFxMaterial(
    { uDraw: { value: 0 }, uAngle: { value: 0 }, uGlow: { value: 1 }, uColor: { value: new THREE.Color(color) } },
    /* glsl */ `
#define PI 3.14159265
uniform float uDraw;
uniform float uAngle;
uniform float uGlow;
uniform vec3 uColor;
varying vec2 vUv;

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
/** 線からの距離 d、太さ w の線の濃さ */
float stroke(float d, float w) {
  return exp(-d * d / (w * w));
}
/** 角度 ang（0〜1）が描かれた割合 d まで来ているか（先端は少しぼかす） */
float reveal(float ang, float d) {
  return 1.0 - smoothstep(d - 0.015, d, ang);
}
float hash(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

void main() {
  vec2 p0 = vUv * 2.0 - 1.0;
  float r = length(p0);
  if (r > 1.0) discard;
  // 外側の層は uAngle で回り、内側の層は逆向きに速く回る
  vec2 p = rot(p0, uAngle);
  vec2 q = rot(p0, -uAngle * 1.7);
  float angP = atan(p.y, p.x) / (2.0 * PI) + 0.5;
  float angQ = atan(q.y, q.x) / (2.0 * PI) + 0.5;
  float dOuter = uDraw * 1.03;
  float dInner = clamp((uDraw - 0.3) / 0.7, 0.0, 1.0) * 1.03;

  // 外の二重の輪
  float outer = stroke(r - 0.965, 0.012) + stroke(r - 0.905, 0.006) * 0.8;
  // 文字の帯（0.79〜0.88）: 区画ごとに形の違う短い線で、文字のように見せる
  float band = stroke(r - 0.785, 0.005) * 0.8;
  const float CELLS = 40.0;
  float cell = floor(angP * CELLS);
  float cu = (fract(angP * CELLS) - 0.5) * (2.0 * PI * 0.835 / CELLS);
  float cv = r - 0.835;
  float h1 = hash(cell), h2 = hash(cell + 17.0), h3 = hash(cell + 41.0);
  float inGlyph = step(abs(cu), 0.05) * step(abs(cv), 0.032);
  float glyph = stroke(cu - (h1 - 0.5) * 0.04, 0.004) * step(abs(cv), 0.03 * (0.5 + 0.5 * h2));
  glyph += stroke(cv - (h2 - 0.5) * 0.04, 0.004) * step(abs(cu), 0.012 + 0.02 * h3);
  glyph += stroke(cu - cv * (h3 * 2.0 - 1.0), 0.004) * step(0.5, h1) * step(abs(cv), 0.028);
  glyph *= inGlyph;
  float ringsOuter = (outer + band + glyph * 0.9) * reveal(angP, dOuter);

  // 六芒星（頂点が文字の帯の内側の輪に触れる）と、その内側の輪
  const float R = 0.785;
  float star = 0.0;
  for (int k = 0; k < 6; k++) {
    float a = PI / 6.0 + float(k) * PI / 3.0;
    vec2 n = vec2(cos(a), sin(a));
    vec2 t = vec2(-n.y, n.x);
    star += stroke(dot(p, n) - R * 0.5, 0.006) * step(abs(dot(p, t)), R * 0.866);
  }
  float innerRing = stroke(r - R * 0.5, 0.006);
  float starLayer = (star + innerRing) * reveal(angP, dInner);

  // 逆に回る内側の紋様: 目盛りの輪と、中心の小さな輪・十字
  float ticks = step(abs(fract(angQ * 24.0) - 0.5), 0.12) * step(abs(r - 0.33), 0.025) * 0.7;
  float core = stroke(r - 0.28, 0.005) + stroke(r - 0.12, 0.006);
  core += (stroke(q.x, 0.005) * step(abs(q.y), 0.12) + stroke(q.y, 0.005) * step(abs(q.x), 0.12)) * 0.8;
  float innerLayer = (ticks + core) * reveal(angQ, dInner);

  // 描いている先端の光と、陣の中のうっすらした光
  float tipD = (angP - uDraw) * 30.0;
  float tip = exp(-tipD * tipD) * step(uDraw, 0.999) * smoothstep(0.6, 0.95, r) * 1.5;
  float fill = 0.12 * (1.0 - r * r) * uDraw;

  float lines = ringsOuter + starLayer + innerLayer;
  float a = (lines + tip + fill) * uGlow;
  vec3 col = mix(uColor, vec3(1.0), clamp(lines * 0.5 + tip, 0.0, 1.0));
  gl_FragColor = vec4(col * a, 1.0);
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
