/**
 * 攻撃の計算（値は仮）。
 *
 * - 兵種ごとの射程（minRange〜maxRange、HEX の距離）。弓兵は 1〜2、ほかは 1。
 *   隣接したユニットを攻撃できない兵種（砲兵など）は minRange = 2 にする。
 * - ranged の兵種（弓兵）の攻撃は放物線の矢印で出す。
 * - moveAfterAttack の兵種（騎兵）だけ、攻撃の後に移動できる。ただし敵の ZOC の中からは動けない。
 * - 突撃（騎兵）は隣の相手を攻撃した後、相手を突き抜けて同じ向きの向こうの HEX へ飛び出る（chargeLanding）。
 *   その HEX にユニットがいる・通れない地形・マップの外なら飛び出さない。行動力は突撃の分だけで、ZOC は関係ない。
 * - 隣接（距離 1）の相手への攻撃は直接攻撃で、相手も反撃して両軍の兵数が減る。距離 2 以上は一方的に減らす。
 * - 士気の減少はまだ無い。
 */
import { axialDistance, type Offset } from '@norden/map-runtime/core/hex';
import type { HexMap } from '@norden/map-runtime/core/mapData';
import { dirBetween } from '@norden/map-runtime/core/roads';
import type { UnitData, UnitType } from '@norden/map-runtime/core/units';
import type { ActionId } from './actions';
import { enterCost } from './movement';
import type { UnitStatus } from './unitStatus';

export interface CombatDef {
  minRange: number;
  maxRange: number;
  /** 遠隔攻撃の兵種（矢印を放物線で出す） */
  ranged: boolean;
  /** 攻撃の後に移動できる */
  moveAfterAttack?: boolean;
  /** 攻撃力・防御力（倍率） */
  attack: number;
  defense: number;
}

export const COMBAT_DEFS: Record<UnitType, CombatDef> = {
  infantry: { minRange: 1, maxRange: 1, ranged: false, attack: 1.0, defense: 1.0 },
  archer: { minRange: 1, maxRange: 2, ranged: true, attack: 0.9, defense: 0.7 },
  cavalry: { minRange: 1, maxRange: 1, ranged: false, moveAfterAttack: true, attack: 1.2, defense: 0.9 },
  mage: { minRange: 1, maxRange: 1, ranged: false, attack: 1.3, defense: 0.6 },
};

/** 攻撃の種類ごとの威力の倍率と、受ける反撃の倍率 */
const ATTACK_KINDS: Partial<Record<ActionId, { power: number; counter: number }>> = {
  attack: { power: 1, counter: 1 },
  volley: { power: 1.3, counter: 1 },
  charge: { power: 1.5, counter: 1.2 },
};

/** 攻撃側の兵数に対する、与える損害の割合 */
const DAMAGE_RATE = 0.12;
/** 反撃する側（攻撃を受けた後の兵数）に対する、反撃で与える損害の割合 */
const COUNTER_RATE = 0.08;

export function isAttack(id: ActionId): boolean {
  return id in ATTACK_KINDS;
}

export function hexDistance(map: HexMap, a: Offset, b: Offset): number {
  const l = map.layout;
  return axialDistance(l.offsetToAxial(a.col, a.row), l.offsetToAxial(b.col, b.row));
}

/** unit が pos から攻撃できる敵ユニット */
export function attackTargets(map: HexMap, unit: UnitData, pos: Offset): UnitData[] {
  const { minRange, maxRange } = COMBAT_DEFS[unit.type];
  return map.allUnits().filter((u) => {
    if (u.team === unit.team) return false;
    const d = hexDistance(map, pos, u);
    return d >= minRange && d <= maxRange;
  });
}

/** pos から隣の target へ突撃したときに飛び出る HEX（飛び出せなければ null） */
export function chargeLanding(map: HexMap, pos: Offset, target: Offset): Offset | null {
  const dir = dirBetween(map, pos, target);
  if (dir < 0) return null;
  const n = map.layout.neighborInDir(target.col, target.row, dir);
  const from = map.get(target.col, target.row);
  const to = map.get(n.col, n.row);
  if (!from || !to || map.unitAt(n.col, n.row) || enterCost(from, dir, to) === null) return null;
  return n;
}

export interface AttackResult {
  /** 相手の兵数の減少 */
  damage: number;
  /** 反撃による自分の兵数の減少（直接攻撃でなければ 0） */
  counter: number;
  /** 隣接した相手への直接攻撃か */
  direct: boolean;
}

/** distance だけ離れた相手を action で攻撃したときの結果（予測にもそのまま使う） */
export function attackResult(
  attacker: UnitData,
  a: UnitStatus,
  defender: UnitData,
  d: UnitStatus,
  action: ActionId,
  distance: number,
): AttackResult {
  const kind = ATTACK_KINDS[action] ?? { power: 1, counter: 1 };
  const atk = COMBAT_DEFS[attacker.type];
  const def = COMBAT_DEFS[defender.type];
  const damage = Math.min(d.soldiers, Math.round((a.soldiers * DAMAGE_RATE * kind.power * atk.attack) / def.defense));
  const direct = distance <= 1;
  const counter = direct
    ? Math.min(a.soldiers, Math.round(((d.soldiers - damage) * COUNTER_RATE * kind.counter * def.attack) / atk.defense))
    : 0;
  return { damage, counter, direct };
}
