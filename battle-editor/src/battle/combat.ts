/**
 * 攻撃の判定（値は仮）。ダメージの計算は damage.ts、士気の増減は morale.ts。
 *
 * - 兵種ごとの射程（minRange〜maxRange、HEX の距離）。弓兵は 1〜2、ほかは 1。
 *   隣接したユニットを攻撃できない兵種（砲兵など）は minRange = 2 にする。
 * - ranged の兵種（弓兵）の攻撃は放物線の矢印で出す。
 * - moveAfterAttack の兵種（騎兵）だけ、攻撃の後に移動できる。ただし敵の ZOC の中からは動けない。
 * - 突撃（騎兵）は隣の相手を攻撃した後、相手を突き抜けて同じ向きの向こうの HEX へ飛び出る（chargeLanding）。
 *   その HEX にユニットがいる・通れない地形・マップの外なら飛び出さない。行動力は突撃の分だけで、ZOC は関係ない。
 * - 隣接（距離 1）の相手への攻撃は直接攻撃で、相手も反撃して両軍の兵数が減る。距離 2 以上は一方的に減らす。
 * - 包囲（movement.ts の encircled）されている相手へのダメージは増える。
 * - 攻撃の後、与えたダメージと反撃で受けたダメージの比で両軍の士気が増減する。
 */
import { axialDistance, type Offset } from '@norden/map-runtime/core/hex';
import type { HexMap } from '@norden/map-runtime/core/mapData';
import { dirBetween } from '@norden/map-runtime/core/roads';
import type { UnitData, UnitType } from '@norden/map-runtime/core/units';
import type { ActionId } from './actions';
import { ATTACK_POWER, calcCounter, calcDamage, type Fighter } from './damage';
import { moraleChange, type MoraleChange } from './morale';
import { encircled, enterCost } from './movement';
import type { UnitStatus } from './unitStatus';

export interface CombatDef {
  minRange: number;
  maxRange: number;
  /** 遠隔攻撃の兵種（矢印を放物線で出す） */
  ranged: boolean;
  /** 攻撃の後に移動できる */
  moveAfterAttack?: boolean;
}

export const COMBAT_DEFS: Record<UnitType, CombatDef> = {
  infantry: { minRange: 1, maxRange: 1, ranged: false },
  archer: { minRange: 1, maxRange: 2, ranged: true },
  cavalry: { minRange: 1, maxRange: 1, ranged: false, moveAfterAttack: true },
  mage: { minRange: 1, maxRange: 1, ranged: false },
};

export function isAttack(id: ActionId): boolean {
  return id in ATTACK_POWER;
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

/** 攻撃の当事者 */
export interface Combatant {
  unit: UnitData;
  status: UnitStatus;
}

export interface AttackResult {
  /** 相手の兵数の減少 */
  damage: number;
  /** 反撃による自分の兵数の減少（直接攻撃でなければ 0） */
  counter: number;
  /** 隣接した相手への直接攻撃か */
  direct: boolean;
  /** 相手が包囲されているか（ダメージが増える） */
  encircled: boolean;
  /** 士気の増減 */
  morale: MoraleChange;
}

/** ランダム係数（−1〜1）。攻撃のダメージと反撃のダメージで別々に振る */
export interface AttackRolls {
  damage: number;
  counter: number;
}

/**
 * attacker が pos から defender を action で攻撃したときの結果。
 * 包囲は attacker を pos に置いて判定する（予約中はまだ pos にいないため）。
 */
export function attackResult(map: HexMap, attacker: Combatant, pos: Offset, defender: Combatant, action: ActionId, rolls: AttackRolls): AttackResult {
  const att = fighter(attacker, encircledAt(map, attacker.unit, pos, attacker.unit, pos));
  const def = fighter(defender, encircledAt(map, defender.unit, defender.unit, attacker.unit, pos));
  const direct = hexDistance(map, pos, defender.unit) <= 1;
  const damage = calcDamage(att, def, action, rolls.damage);
  const counter = direct ? calcCounter(att, { ...def, soldiers: def.soldiers - damage }, rolls.counter) : 0;
  return { damage, counter, direct, encircled: def.encircled, morale: moraleChange(damage, counter, att.strength, def.strength) };
}

/** 攻撃の結果の予測（ランダム係数が真ん中のときの結果と、ダメージ・反撃の幅） */
export interface AttackForecast {
  expected: AttackResult;
  damage: [min: number, max: number];
  counter: [min: number, max: number];
}

export function attackForecast(map: HexMap, attacker: Combatant, pos: Offset, defender: Combatant, action: ActionId): AttackForecast {
  const at = (damage: number, counter: number) => attackResult(map, attacker, pos, defender, action, { damage, counter });
  // 与えるダメージが少ないほど相手の兵が残って反撃が増える
  const low = at(-1, 1);
  const high = at(1, -1);
  return { expected: at(0, 0), damage: [low.damage, high.damage], counter: [high.counter, low.counter] };
}

function fighter({ unit, status }: Combatant, encircled: boolean): Fighter {
  const { soldiers, morale, leadership, strength } = status;
  return { type: unit.type, soldiers, morale, leadership, strength, encircled };
}

/** who が whoPos で包囲されているか（mover を moverPos に動かしたとして判定する） */
function encircledAt(map: HexMap, who: UnitData, whoPos: Offset, mover: UnitData, moverPos: Offset): boolean {
  const enemies = map
    .allUnits()
    .filter((u) => u.team !== who.team)
    .map((u) => (u === mover ? moverPos : u));
  return encircled(map, whoPos, enemies);
}
