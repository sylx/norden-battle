/**
 * プロシージャルな兵士（試作）。
 *
 * Mixamo 骨格の各ボーンに、コードで作ったパーツ（胴・手足・頭・兜・武器・盾）を 1 本ずつ固定する。
 * 肌の変形（重み付け）がないので形が破綻せず、Mixamo のモーションをそのまま当てられる。
 * 全体を 1 つの SkinnedMesh にまとめるので、1 体 = 1 ドローコール。
 *
 * 寸法は骨格の基準姿勢から測る。u は身長 170 に対する 1（Mixamo なら 1u ≒ 1cm）。
 */
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { NormalizeTransform } from '../../catalog';
import { UNITS } from '../../units';
import { NormalizedModel } from '../normalize';
import { MIXAMO_PREFIX, promoteNodesToBones } from '../skeleton';
import { box, cone, dome, ellipsoid, frame, RigidMeshBuilder, tube } from './builder';

export const HELMET_TYPES = [
  ['none', 'なし（髪）'],
  ['cap', '革の帽子'],
  ['kettle', 'ケトルハット'],
  ['nasal', 'ノルマン兜'],
  ['greathelm', 'グレートヘルム'],
] as const;
export const ARMOR_TYPES = [
  ['tunic', 'チュニック'],
  ['mail', '鎖かたびら'],
  ['plate', '胸甲'],
] as const;
export const WEAPON_TYPES = [
  ['none', 'なし'],
  ['spear', '槍'],
  ['sword', '剣'],
  ['axe', '斧'],
] as const;
export const SHIELD_TYPES = [
  ['none', 'なし'],
  ['round', '丸盾'],
  ['heater', 'ヒーターシールド'],
] as const;

export type HelmetType = (typeof HELMET_TYPES)[number][0];
export type ArmorType = (typeof ARMOR_TYPES)[number][0];
export type WeaponType = (typeof WEAPON_TYPES)[number][0];
export type ShieldType = (typeof SHIELD_TYPES)[number][0];

export interface SoldierParams {
  /** 個体差（肌・髪・ズボンの色、ひげ、体格の揺れ）のシード */
  seed: number;
  teamColor: number;
  helmet: HelmetType;
  armor: ArmorType;
  weapon: WeaponType;
  shield: ShieldType;
  /** 頭の大きさ（1 = 等身大。ミニチュアらしく大きめにする） */
  headScale: number;
  /** 手足・胴の太さ */
  girth: number;
}

export const DEFAULT_SOLDIER: SoldierParams = {
  seed: 1,
  teamColor: 0x2f5fa8,
  helmet: 'kettle',
  armor: 'mail',
  weapon: 'spear',
  shield: 'round',
  headScale: 1.3,
  girth: 1.15,
};

export const TEAM_COLORS: { label: string; color: number }[] = [
  { label: '青', color: 0x2f5fa8 },
  { label: '赤', color: 0xa83232 },
  { label: '緑', color: 0x3a7a3a },
  { label: '黄', color: 0xc9a227 },
  { label: '紫', color: 0x6a3a8a },
];

const SKIN = [0xe8b896, 0xd9a47e, 0xc28a64, 0xf1cdb0, 0xa87452];
const HAIR = [0x3b2a1e, 0x6b4a2a, 0xa07a40, 0x2a2420, 0x8a3a1e, 0x8a8a84];
const TROUSERS = [0x4e4236, 0x3f4432, 0x5a4c3c, 0x3a3a40, 0x5c3f2e];
const LEATHER = 0x5e4028;
const BOOT = 0x3a291c;
const MAIL = 0x7c8288;
const METAL = 0xa4aab0;
const DARK = 0x1c1a18;
const WOOD = 0x7a5634;

/**
 * 骨格の雛形を作る。モデルの基準姿勢（GLB のノードの姿勢）の骨だけを取り出す。
 * Mixamo の "Without Skin" のモーションでも、キャラクターでもよい。
 */
export function createSkeletonTemplate(source: THREE.Object3D): THREE.Object3D | null {
  const clone = SkeletonUtils.clone(source);
  clone.updateMatrixWorld(true);
  const hips = clone.getObjectByName(`${MIXAMO_PREFIX}Hips`);
  if (!hips) return null;
  // Hips の source 基準の姿勢をそのまま新しい root 直下に持ってくる
  const rel = new THREE.Matrix4().copy(clone.matrixWorld).invert().multiply(hips.matrixWorld);
  const root = new THREE.Group();
  root.name = 'soldier';
  hips.removeFromParent();
  rel.decompose(hips.position, hips.quaternion, hips.scale);
  root.add(hips);
  // 末端の骨（HeadTop_End など）はスキンにもモーションにも使われず、普通のノードとして読み込まれている
  promoteNodesToBones(hips, (o) => o.name.startsWith(MIXAMO_PREFIX));
  // 骨以外（武器・装飾のメッシュ）と、FBX の複数スキン用に複製された骨（名前が _1 などで終わる）を捨てる
  const drop: THREE.Object3D[] = [];
  hips.traverse((o) => {
    if (o !== hips && (!(o as THREE.Bone).isBone || /_\d+$/.test(o.name))) drop.push(o);
  });
  for (const o of drop) o.removeFromParent();
  root.updateMatrixWorld(true);
  return root;
}

export interface SoldierBuild {
  object: NormalizedModel;
  mesh: THREE.SkinnedMesh;
  triangles: number;
}

let sharedMaterial: THREE.MeshStandardMaterial | null = null;

export function soldierMaterial(): THREE.MeshStandardMaterial {
  return (sharedMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.72, metalness: 0 }));
}

function rng(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSoldier(template: THREE.Object3D, p: SoldierParams): SoldierBuild {
  const root = template.clone(true);
  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const boneIndex = new Map(bones.map((b, i) => [b.name, i]));
  const bi = (...names: string[]) => {
    for (const n of names) {
      const i = boneIndex.get(MIXAMO_PREFIX + n);
      if (i !== undefined) return i;
    }
    return 0;
  };
  const J = (name: string, fallback?: () => THREE.Vector3) => {
    const b = root.getObjectByName(MIXAMO_PREFIX + name);
    if (b) return new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    if (fallback) return fallback();
    throw new Error(`骨がありません: ${MIXAMO_PREFIX}${name}`);
  };

  const R = rng(p.seed);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(R() * arr.length)];
  const jitter = (hex: number, amt = 0.05) => new THREE.Color(hex).multiplyScalar(1 - amt + R() * amt * 2);

  const team = new THREE.Color(p.teamColor);
  const skin = new THREE.Color(pick(SKIN));
  const hair = new THREE.Color(pick(HAIR));
  const trousers = new THREE.Color(pick(TROUSERS));
  const beard = R() < 0.4;
  const g = p.girth * (0.95 + R() * 0.1);

  // --- 骨格の寸法 ---
  const Y = new THREE.Vector3(0, 1, 0);
  const hips = J('Hips');
  const neck = J('Neck');
  const head = J('Head');
  const headTop = J('HeadTop_End', () => head.clone().addScaledVector(Y, (neck.distanceTo(head) || 10) * 2));
  const spine1 = J('Spine1', () => hips.clone().lerp(neck, 0.45));
  const lUp = J('LeftUpLeg');
  const rUp = J('RightUpLeg');
  const Lx = lUp.clone().sub(rUp).setY(0);
  if (Lx.lengthSq() < 1e-8) Lx.set(1, 0, 0);
  Lx.normalize();
  const F = new THREE.Vector3().crossVectors(Lx, Y).normalize();

  const toes = ['Left', 'Right'].flatMap((s) => [J(`${s}ToeBase`, () => J(`${s}Foot`)).y, J(`${s}Toe_End`, () => J(`${s}Foot`)).y]);
  const toeY = Math.min(...toes);
  const u = (headTop.y - toeY) / 168;
  const groundY = toeY - 2 * u;
  const bodyH = headTop.y - groundY;

  const b = new RigidMeshBuilder();
  const add = (part: { geo: THREE.BufferGeometry; matrix: THREE.Matrix4 }, color: THREE.Color | number, bone: number, amt = 0.04) =>
    b.add(part.geo, part.matrix, typeof color === 'number' ? jitter(color, amt) : color.clone().multiplyScalar(1 - amt + R() * amt * 2), bone);

  const armored = p.armor !== 'tunic';
  const sleeve = armored ? new THREE.Color(MAIL) : team;

  // --- 脚 ---
  for (const s of ['Left', 'Right']) {
    const upLeg = J(`${s}UpLeg`);
    const leg = J(`${s}Leg`);
    const foot = J(`${s}Foot`);
    const toeEnd = J(`${s}Toe_End`, () => J(`${s}ToeBase`, () => foot.clone().addScaledVector(F, 12 * u)).addScaledVector(F, 8 * u));
    add(tube(upLeg, leg, 7.4 * u * g, 5.8 * u * g, 7, F), trousers, bi(`${s}UpLeg`));
    const cuff = leg.clone().lerp(foot, 0.3);
    add(tube(leg, cuff, 5.6 * u * g, 5.2 * u * g, 7, F), trousers, bi(`${s}Leg`));
    add(tube(cuff.clone().addScaledVector(Y, 2 * u), foot, 5.9 * u * g, 4.8 * u * g, 7, F), BOOT, bi(`${s}Leg`));
    // 足（足首の骨に固定し、つま先の曲げは無視）
    const fwd = toeEnd.clone().sub(foot).setY(0);
    if (fwd.lengthSq() < 1e-8) fwd.copy(F);
    fwd.normalize();
    const back = foot.clone().addScaledVector(fwd, -5 * u);
    const front = toeEnd.clone().addScaledVector(fwd, 1.5 * u);
    const len = front.clone().sub(back).dot(fwd);
    const top = foot.y + 2 * u;
    const c = back.clone().addScaledVector(fwd, len / 2).setY((groundY + top) / 2);
    add(box(c, Y, fwd, 9.5 * u * Math.sqrt(g), top - groundY, len), BOOT, bi(`${s}Foot`));
  }

  // --- 胴 ---
  const shoulderHalf = J('LeftArm').distanceTo(J('RightArm')) / 2;
  const waistR = 14.5 * u * g;
  const skirtBot = hips.clone().addScaledVector(Y, -17 * u);
  if (armored) add(tube(hips.clone().addScaledVector(Y, -21 * u), hips, waistR * 1.18, waistR * 1.02, 8, F, 1, 0.72), MAIL, bi('Hips'));
  add(tube(skirtBot, hips.clone().addScaledVector(Y, 4 * u), waistR * 1.2, waistR * 1.0, 8, F, 1, 0.74), team, bi('Hips'));
  const chestTop = neck.clone().addScaledVector(Y, -1.5 * u);
  const torsoColor = p.armor === 'plate' ? new THREE.Color(METAL) : team;
  add(tube(hips.clone().addScaledVector(Y, 3 * u), spine1, waistR, waistR * 1.04, 8, F, 1, 0.7), p.armor === 'plate' ? new THREE.Color(MAIL) : team, bi('Spine'));
  add(tube(spine1, chestTop, waistR * 1.04, Math.max(shoulderHalf * 0.92, waistR), 8, F, 1, 0.62), torsoColor, bi('Spine2', 'Spine1', 'Spine'));
  // ベルトとバックル
  add(tube(hips.clone().addScaledVector(Y, 1 * u), hips.clone().addScaledVector(Y, 5.5 * u), waistR * 1.06, waistR * 1.06, 8, F, 1, 0.74), LEATHER, bi('Spine'));
  add(box(hips.clone().addScaledVector(Y, 3.2 * u).addScaledVector(F, waistR * 1.06 * 0.74 + 0.4 * u), Y, F, 4 * u, 3.5 * u, 1.4 * u), METAL, bi('Spine'));
  if (p.armor === 'plate') {
    // 胸甲の上にチームカラーの帯（たすき）
    const mid = spine1.clone().lerp(chestTop, 0.5).addScaledVector(F, waistR * 0.62 * 1.02);
    add(box(mid, Y, F, 5 * u, spine1.distanceTo(chestTop) * 1.05, 1.2 * u), team, bi('Spine2', 'Spine1', 'Spine'));
  }

  // --- 首・頭 ---
  add(tube(neck, head, 5 * u, 4.6 * u, 6, F), skin, bi('Neck'));
  const r = head.distanceTo(headTop) * 0.55 * p.headScale;
  const hc = head.clone().addScaledVector(Y, r * 0.82);
  const H = bi('Head');
  add(ellipsoid(hc, Y, F, r * 0.9, r, r * 0.95), skin, H, 0.02);
  const face = (fwdK: number, upK: number, sideK = 0) => hc.clone().addScaledVector(F, r * fwdK).addScaledVector(Y, r * upK).addScaledVector(Lx, r * sideK);
  add(box(face(0.93, -0.1), Y, F, r * 0.22, r * 0.3, r * 0.26), skin.clone().multiplyScalar(0.92), H, 0);
  for (const side of [-1, 1]) add(box(face(0.84, 0.1, side * 0.33), Y, F, r * 0.14, r * 0.14, r * 0.12), DARK, H, 0);
  if (beard && p.helmet !== 'greathelm') add(box(face(0.6, -0.62), Y, F, r * 1.0, r * 0.55, r * 0.55), hair, H, 0.02);
  switch (p.helmet) {
    case 'none':
      add(dome(hc.clone().addScaledVector(Y, r * 0.02).addScaledVector(F, -r * 0.04), Y, F, r * 1.02, r * 1.04), hair, H, 0.02);
      break;
    case 'cap':
      add(dome(hc.clone().addScaledVector(Y, r * 0.12), Y, F, r * 1.06, r * 0.95), LEATHER, H);
      break;
    case 'kettle':
      add(dome(hc.clone().addScaledVector(Y, r * 0.14), Y, F, r * 1.08, r * 1.0), METAL, H);
      add(tube(hc.clone().addScaledVector(Y, r * 0.12), hc.clone().addScaledVector(Y, r * 0.22), r * 1.7, r * 1.6, 12, F), METAL, H);
      break;
    case 'nasal':
      add(cone(hc.clone().addScaledVector(Y, r * 0.08), Y, F, r * 1.1, r * 1.35, 8), METAL, H);
      add(box(face(1.04, -0.15), Y, F, r * 0.16, r * 0.62, r * 0.12), METAL, H);
      break;
    case 'greathelm':
      add(tube(hc.clone().addScaledVector(Y, -r * 1.02), hc.clone().addScaledVector(Y, r * 0.95), r * 1.14, r * 1.1, 10, F), METAL, H);
      add(box(face(1.1, 0.14), Y, F, r * 1.3, r * 0.14, r * 0.12), DARK, H, 0);
      add(box(face(0.0, 1.05), Y, F, r * 0.18, r * 0.5, r * 1.4), team, H);
      break;
  }

  // --- 腕 ---
  for (const s of ['Left', 'Right']) {
    const arm = J(`${s}Arm`);
    const fore = J(`${s}ForeArm`);
    const hand = J(`${s}Hand`);
    const mid = J(`${s}HandMiddle1`, () => hand.clone().addScaledVector(hand.clone().sub(fore).normalize(), 8 * u));
    const out = s === 'Left' ? Lx : Lx.clone().negate();
    add(tube(arm, fore, 5.3 * u * g, 4.5 * u * g, 6, F), sleeve, bi(`${s}Arm`));
    const wristGuard = fore.clone().lerp(hand, 0.4);
    add(tube(fore, wristGuard, 4.5 * u * g, 4.2 * u * g, 6, F), sleeve, bi(`${s}ForeArm`));
    add(tube(wristGuard, hand, 4.4 * u * g, 3.8 * u * g, 6, F), LEATHER, bi(`${s}ForeArm`));
    const fdir = mid.clone().sub(hand).normalize();
    add(box(hand.clone().addScaledVector(fdir, 4.2 * u), fdir, F, 5 * u, 8.5 * u, 4 * u), p.armor === 'plate' ? new THREE.Color(LEATHER) : skin, bi(`${s}Hand`));
    if (p.armor === 'plate') add(dome(arm.clone().addScaledVector(Y, 1.5 * u), Y.clone().addScaledVector(out, 0.5), F, 7.5 * u * g, 6 * u * g, 8), METAL, bi(`${s}Arm`));
  }

  // --- 武器（右手） ---
  const rHand = J('RightHand');
  const rMid = J('RightHandMiddle1', () => rHand.clone().addScaledVector(rHand.clone().sub(J('RightForeArm')).normalize(), 8 * u));
  const fdir = rMid.clone().sub(rHand).normalize();
  const grip = rHand.clone().addScaledVector(fdir, 4.2 * u);
  // 握った柄の向き: 指の向きと上に直交し、正面を向く方（T ポーズで手のひらが下なら正面）
  const axis = new THREE.Vector3().crossVectors(fdir, Y);
  if (axis.lengthSq() < 1e-6) axis.copy(F);
  axis.normalize();
  if (axis.dot(F) < 0) axis.negate();
  const at = (k: number) => grip.clone().addScaledVector(axis, k * u);
  const W = bi('RightHand');
  switch (p.weapon) {
    case 'spear':
      add(tube(at(-60), at(115), 1.7 * u, 1.7 * u, 5, fdir), WOOD, W);
      add(cone(at(115), axis, fdir, 3.2 * u, 22 * u, 4), METAL, W);
      break;
    case 'sword':
      add(tube(at(-7), at(7), 2 * u, 2 * u, 5, fdir), LEATHER, W);
      add(ellipsoid(at(-9), axis, fdir, 2.6 * u, 2.6 * u, 2.6 * u, 0), METAL, W);
      add(box(at(8.5), axis, fdir, 2.8 * u, 2.8 * u, 19 * u), METAL, W);
      add(box(at(46), axis, fdir, 1.6 * u, 72 * u, 6 * u), METAL, W, 0.02);
      break;
    case 'axe':
      add(tube(at(-14), at(66), 2 * u, 2 * u, 5, fdir), WOOD, W);
      add(box(at(56).addScaledVector(fdir, 7 * u), axis, fdir, 1.8 * u, 16 * u, 15 * u), METAL, W);
      break;
  }

  // --- 盾（左の前腕） ---
  if (p.shield !== 'none') {
    const lFore = J('LeftForeArm');
    const lHand = J('LeftHand');
    const d = lHand.clone().sub(lFore).normalize();
    // 前腕の外側（T ポーズで手のひらが下なら上）
    const n = Y.clone().addScaledVector(d, -Y.dot(d));
    if (n.lengthSq() < 1e-6) n.copy(Lx);
    n.normalize();
    const center = lFore.clone().lerp(lHand, 0.45).addScaledVector(n, 4.5 * u * g + 2 * u);
    const S = bi('LeftForeArm');
    const trim = team.clone().offsetHSL(0, -0.1, 0.22);
    if (p.shield === 'round') {
      add(tube(center.clone().addScaledVector(n, -1.3 * u), center.clone().addScaledVector(n, 1.3 * u), 27 * u, 27 * u, 14, d), WOOD, S);
      add(tube(center.clone().addScaledVector(n, 1.2 * u), center.clone().addScaledVector(n, 1.6 * u), 24 * u, 24 * u, 14, d), team, S);
      add(box(center.clone().addScaledVector(n, 1.7 * u), n, d, 6 * u, 0.5 * u, 46 * u), trim, S);
      add(dome(center.clone().addScaledVector(n, 1.6 * u), n, d, 6 * u, 4 * u, 8), METAL, S);
    } else {
      const shape = new THREE.Shape();
      shape.moveTo(-22, 22);
      shape.lineTo(22, 22);
      shape.lineTo(22, 0);
      shape.quadraticCurveTo(20, -22, 0, -34);
      shape.quadraticCurveTo(-20, -22, -22, 0);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.6, bevelEnabled: false, curveSegments: 4 });
      geo.translate(0, 0, -1.3);
      // 盾の上辺は肘の方（腕を下ろすと上を向く）
      const m = frame(center, d.clone().negate(), n, u, u, u);
      b.add(geo, m, team, S);
      add(box(center.clone().addScaledVector(n, 1.5 * u).addScaledVector(d, 4 * u), d, n, 7 * u, 50 * u, 0.6 * u), trim, S);
    }
  }

  // --- 骨に結びつける ---
  const geometry = b.build();
  const mesh = new THREE.SkinnedMesh(geometry, soldierMaterial());
  mesh.name = 'soldier-body';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  const scale = UNITS.soldierHeight / bodyH;
  const t: NormalizeTransform = { rotation: [0, 0, 0], pivot: [-hips.x, -groundY, -hips.z], scale };
  const object = new NormalizedModel(root, t);
  return { object, mesh, triangles: b.triangles };
}

/** Mixamo 骨格の兵士が作れるか（必要な骨があるか） */
export function canBuildSoldier(template: THREE.Object3D): boolean {
  return ['Hips', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot'].every(
    (n) => !!template.getObjectByName(MIXAMO_PREFIX + n),
  );
}
