/**
 * engine のテストの道具。決まった値を順に返す乱数と、テスト用の戦闘の状態・予約の作り方。
 */
import type { HexMap } from '@norden/map-runtime/core/mapData';
import type { UnitData } from '@norden/map-runtime/core/units';
import type { MenuAttackId } from '../attacks';
import { ATTACK_DEFS } from '../attacks';
import { resolveAttack } from '../combat';
import { addLeg, moveCells, newPlan, setAttack, type Plan } from '../engine/plan';
import type { Rng } from '../engine/rng';
import { createBattleState, type BattleSetup, type BattleState } from '../engine/state';
import type { TroopInit, UnitStatus } from '../unitStatus';
import { status } from './fixtures';

/** 決まった値を順に返す乱数（足りなくなったら投げる）。used は引いた回数 */
export interface ScriptedRng extends Rng {
  used: number;
  left(): number;
}

export function scripted(...values: number[]): ScriptedRng {
  let i = 0;
  return {
    get used() {
      return i;
    },
    left: () => values.length - i,
    next() {
      if (i >= values.length) throw new Error(`乱数が足りない（${values.length} 個）`);
      return values[i++];
    },
  };
}

/** ランダム係数（−1〜1）が r になる乱数の値 */
export const R = (r: number) => (r + 1) / 2;
/** chance が当たる・外れる値 */
export const HIT = 0;
export const MISS = 0.999999;

/** map に置いたユニットと戦闘中の状態で戦闘の状態を作る（状態の既定は fixtures の status） */
export function battle(map: HexMap, units: readonly (UnitData | [UnitData, Partial<TroopInit>])[], setup: BattleSetup = {}): BattleState {
  const statuses = new Map<UnitData, UnitStatus>();
  for (const u of units) {
    const [unit, init] = Array.isArray(u) ? u : [u, {}];
    statuses.set(unit, status(unit.type, init));
  }
  return createBattleState(map, statuses, setup);
}

/** unit の予約を作り、順に to へ移動を予約する（移動できなければ投げる） */
export function planMoves(state: BattleState, unit: UnitData, ...to: { col: number; row: number }[]): Plan {
  const plan = newPlan(state, unit)!;
  for (const o of to) moveLeg(state, plan, o);
  return plan;
}

/** plan に to への移動を予約する（移動できなければ投げる） */
export function moveLeg(state: BattleState, plan: Plan, to: { col: number; row: number }): void {
  const step = moveCells(state, plan).get(to.row * state.map.layout.cols + to.col);
  if (!step) throw new Error(`(${to.col}, ${to.row}) へ移動できない`);
  addLeg(plan, step);
}

/** plan に id の攻撃を at を狙って予約する */
export function planAttack(state: BattleState, plan: Plan, id: MenuAttackId, at: { col: number; row: number }): Plan {
  const def = ATTACK_DEFS[id];
  setAttack(state, plan, { id, name: def.name, cost: def.cost }, resolveAttack(plan.unit.type, id), at);
  return plan;
}
