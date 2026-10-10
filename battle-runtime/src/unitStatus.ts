/**
 * 戦闘中のユニットの状態（兵士数・士気・行動力・指揮官）。マップのデータには保存しない。
 * まだ戦闘の処理が無いので、マップを読み込んだときに表示確認用の仮の値を配る。
 */
import type { UnitData, UnitType } from '@norden/map-runtime/core/units';
import type { SkillId } from './actions';
import faceSheetUrl from '../../assets/units/character_face.webp?url';

export interface UnitStatus {
  soldiers: number;
  maxSoldiers: number;
  /** 0..MAX_MORALE */
  morale: number;
  /** 残り行動力（0..maxAp） */
  ap: number;
  maxAp: number;
  /** 指揮官の顔（顔画像の左上から行ごとの通し番号 0..FACE_COUNT-1） */
  face: number;
  /** 指揮官のスキル */
  skills: SkillId[];
  /** 指揮官の統率・武力・知力（0..100。ダメージ・士気の増減に効く。damage.ts・morale.ts）。魔術師は武力の代わりに知力を使う */
  leadership: number;
  strength: number;
  intelligence: number;
  /** このターンに移動したか（移動も攻撃もしていなければ敵の ZOC の中からでも動き出せる） */
  moved: boolean;
  /** このターンに攻撃したか（攻撃は 1 ターンに 1 回） */
  attacked: boolean;
  /** 攻撃した後にまだ移動していないか（突撃で飛び出たのは攻撃のうち）。騎兵はこの間だけ敵の ZOC から動き出せる */
  justAttacked: boolean;
  /** 迎撃の構えで待機しているか（次に行動するか、間接ユニットが自動で攻撃するまで） */
  intercepting: boolean;
}

export const MAX_MORALE = 100;

/** 指揮官の顔画像。1 枚に FACE_GRID × FACE_GRID の顔を並べたもの */
export const FACE_SHEET_URL = faceSheetUrl;
export const FACE_GRID = 3;
export const FACE_COUNT = FACE_GRID * FACE_GRID;

/** 兵種ごとの最大行動力（仮） */
const MAX_AP: Record<UnitType, number> = {
  infantry: 4,
  archer: 4,
  cavalry: 6,
  mage: 4,
};

/** 兵種ごとの最大兵士数（仮） */
const MAX_SOLDIERS: Record<UnitType, number> = {
  infantry: 1000,
  archer: 800,
  cavalry: 600,
  mage: 400,
};

/** 顔ごとの指揮官のスキル（仮） */
const FACE_SKILLS: SkillId[][] = [
  ['inspire'],
  ['betray'],
  [],
  ['fireAttack', 'ambush'],
  ['betray', 'inspire'],
  [],
  ['ambush'],
  ['fireAttack'],
  ['inspire', 'ambush', 'betray'],
];

/** 顔ごとの指揮官の統率・武力・知力（仮） */
const FACE_ABILITIES: [leadership: number, strength: number, intelligence: number][] = [
  [82, 64, 71],
  [58, 77, 48],
  [45, 40, 92],
  [70, 88, 35],
  [90, 52, 80],
  [36, 72, 55],
  [64, 58, 66],
  [52, 94, 30],
  [76, 70, 84],
];

/** 表示確認用の仮の状態。兵士数・士気は HEX の位置から決まるばらつき、行動力は満タン、顔は軍ごとに順に割り当てる */
export function demoStatuses(units: readonly UnitData[]): Map<UnitData, UnitStatus> {
  const out = new Map<UnitData, UnitStatus>();
  const perTeam = new Map<string, number>();
  const sorted = [...units].sort((a, b) => a.team.localeCompare(b.team) || a.row - b.row || a.col - b.col);
  let teamOffset = 0;
  for (const u of sorted) {
    if (!perTeam.has(u.team)) {
      perTeam.set(u.team, 0);
      // 軍ごとに顔の割り当ての開始位置をずらす（少人数どうしで同じ顔が並ばないように）
      teamOffset = (perTeam.size - 1) * 4;
    }
    const i = perTeam.get(u.team)!;
    perTeam.set(u.team, i + 1);
    const max = MAX_SOLDIERS[u.type];
    const face = (teamOffset + i) % FACE_COUNT;
    out.set(u, {
      maxSoldiers: max,
      soldiers: Math.round((max * (0.3 + 0.7 * hash(u.col, u.row, 1))) / 10) * 10,
      morale: Math.round(20 + 80 * hash(u.col, u.row, 2)),
      ap: MAX_AP[u.type],
      maxAp: MAX_AP[u.type],
      face,
      skills: FACE_SKILLS[face] ?? [],
      leadership: FACE_ABILITIES[face]?.[0] ?? 50,
      strength: FACE_ABILITIES[face]?.[1] ?? 50,
      intelligence: FACE_ABILITIES[face]?.[2] ?? 50,
      moved: false,
      attacked: false,
      justAttacked: false,
      intercepting: false,
    });
  }
  return out;
}

/** 0..1 の決まった乱数 */
function hash(col: number, row: number, salt: number): number {
  let h = Math.imul(col * 374761393 + row * 668265263 + salt * 2147483647, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
