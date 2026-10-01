/**
 * 戦闘中のユニットの状態（兵士数・士気・行動力・指揮官）。マップのデータには保存しない。
 * まだ戦闘の処理が無いので、マップを読み込んだときに表示確認用の仮の値を配る。
 */
import type { UnitData, UnitType } from '@norden/map-runtime/core/units';
import type { SkillId } from './actions';
import faceSheetUrl from '../../../assets/units/character_face.webp?url';

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
  /** このターンに移動したか（していなければ敵の ZOC の中からでも動き出せる） */
  moved: boolean;
  /** このターンに攻撃したか（攻撃は 1 ターンに 1 回） */
  attacked: boolean;
}

export const MAX_MORALE = 100;
const MAX_AP = 5;

/** 指揮官の顔画像。1 枚に FACE_GRID × FACE_GRID の顔を並べたもの */
export const FACE_SHEET_URL = faceSheetUrl;
export const FACE_GRID = 3;
export const FACE_COUNT = FACE_GRID * FACE_GRID;

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

/** 表示確認用の仮の状態。兵士数・士気・行動力は HEX の位置から決まるばらつき、顔は軍ごとに順に割り当てる */
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
      // 行動力は満タン寄りにする（0〜MAX_AP、半分は満タン）
      ap: Math.min(MAX_AP, Math.floor(hash(u.col, u.row, 3) * MAX_AP * 2)),
      maxAp: MAX_AP,
      face,
      skills: FACE_SKILLS[face] ?? [],
      moved: false,
      attacked: false,
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
