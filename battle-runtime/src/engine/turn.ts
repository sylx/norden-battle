/**
 * 軍の番の始まりと終わり・拠点の施設・決着。
 *
 * - ターンは軍ごとの交互（TURN_ORDER）。番を始めるとその軍の行動力が戻り、クールタイムが減り、入城の決まりの印を付け直す
 *   （魔導台は城の HEX の魔術師のクールタイムをさらに減らす）。凍結したユニットはその番に行動できない（行動力 0）。
 * - 番を終えるとき: 混乱したユニットはランダムな HEX へ勝手に動いて行動を終える（confusedPlan を 'wait' で実行する）→
 *   番を終えた軍のユニットは行動を終える（防衛拠点にいれば入城。endTeamTurn）→ その陣営の撃つ施設が間隔のターンごとに
 *   1 発ずつ撃つ（firingFacilities・facilityTarget・fireFacility）→ 状態の残りターンを減らして次の軍の番（passTurn）。
 * - 決着（judge）は行動を実行し終えるたびと、番を終えるとき・施設で殲滅したときに調べる。軍団長部隊の全滅・退却、入城で負けた陣営に
 *   部隊が残っていて退却先もあれば、先に強制退却させる（rout。1 部隊ずつ退却先を選んで退却させ、尽きたら戦闘を終える）。
 */
import type { DeploySide } from '@norden/map-runtime/core/mapData';
import { DEPLOY_SIDES } from '@norden/map-runtime/core/mapData';
import type { TeamId, UnitData } from '@norden/map-runtime/core/units';
import { COMBAT_DEFS, facilityResult, hexDistance, type AttackResult } from '../combat';
import { hasCondition, tickConditions, tickCooldowns } from '../conditions';
import { randomRoll } from '../damage';
import { SIDE_TEAM } from '../deployment';
import { DEFAULT_INTERVALS, firesOn, FORTRESS_CANNON_RANGE, type FiringFacility } from '../facilities';
import { applyMorale } from '../morale';
import { moveRange, nearCastle, nearStronghold } from '../movement';
import { judgeBattle, loserOf, sideUnits, type BattleOutcome, type CapturedUnit } from '../victory';
import type { WipeoutReport } from '../wipeout';
import { wipeOut } from './action';
import { newPlan, type Plan } from './plan';
import { pick, type Rng } from './rng';
import { castleLocked, facilitiesOf, markFallen, nextTeam, removeUnits, sideOf, strongholdLocked, TURN_ORDER, type BattleState } from './state';

/** 番の終わりに施設が撃った 1 発 */
export interface FacilityReport {
  kind: FiringFacility;
  /** 施設を持つ陣営 */
  side: DeploySide;
  turn: number;
  target: UnitData;
  result: AttackResult;
  /** 撃たれた後の兵数 */
  left: number;
  destroyed: boolean;
}

/**
 * 決着を調べた結果。none: 決着していない、routStart: 負けた陣営の残りの部隊（units）の強制退却を始めた、
 * rout: 強制退却の最中（次の部隊へ進む）、end: 戦闘を終えた（state.outcome）
 */
export type JudgeResult =
  | { kind: 'none' }
  | { kind: 'routStart'; outcome: BattleOutcome; units: UnitData[] }
  | { kind: 'rout' }
  | { kind: 'end'; outcome: BattleOutcome };

/** 配備を終えて戦闘を始める（全滅で負けにする陣営を決め、最初の軍の番にする） */
export function startBattle(state: BattleState): void {
  state.turn = 1;
  state.judged = new Set(DEPLOY_SIDES.filter((side) => sideUnits(state.map, side).length > 0));
  state.activeTeam = nextTeam(state, null);
  startTeamTurn(state, state.activeTeam);
}

/**
 * team の番を始める。行動力を最大まで戻して移動済み・攻撃済みを消し、クールタイムを減らす。入城の決まりの印を付け直し、
 * 魔導台の効果、凍結（行動力 0）を効かせる
 */
export function startTeamTurn(state: BattleState, team: TeamId): void {
  const map = state.map;
  for (const [unit, status] of state.statuses) {
    if (unit.team !== team) continue;
    status.ap = status.maxAp;
    status.moved = false;
    status.attacked = false;
    status.justAttacked = false;
    tickCooldowns(status);
  }
  for (const [unit, status] of state.statuses) {
    if (unit.team !== team) continue;
    // 入城の決まり: 番の初めに城の HEX の中かそのとなりにいれば、この番は城の HEX へ入れる
    status.atCastle = nearCastle(map, unit);
    status.atStronghold = nearStronghold(map, state.stronghold, unit);
    // 魔導台: 城の HEX にいる魔術師はクールタイムがさらに 1 減る
    if (facilitiesOf(state, team)?.magicTower && COMBAT_DEFS[unit.type].magic && map.get(unit.col, unit.row)?.feature === 'castle') tickCooldowns(status);
    if (hasCondition(status, 'freeze')) status.ap = 0;
  }
}

/** いまの番の軍の、番の終わりに勝手に動く混乱したユニット（順に） */
export function confusedUnits(state: BattleState): UnitData[] {
  return state.map.allUnits().filter((u) => u.team === state.activeTeam && hasCondition(state.statuses.get(u) ?? { conditions: [] }, 'confusion'));
}

/**
 * 混乱した unit の、ランダムな HEX への移動の予約（'wait' で実行して行動を終える）。
 * 動ける HEX が無ければ、その場で行動を終えて（行動力 0）null
 */
export function confusedPlan(state: BattleState, unit: UnitData, rng: Rng): Plan | null {
  const status = state.statuses.get(unit);
  if (!status) return null;
  const steps = [...moveRange(state.map, unit, unit, status.ap, { escapeZoc: true, castleLocked: castleLocked(unit, status), strongholdLocked: strongholdLocked(state, unit, status) }).values()];
  const plan = newPlan(state, unit);
  if (steps.length === 0 || !plan) {
    status.ap = 0;
    return null;
  }
  plan.legs = [pick(rng, steps)];
  return plan;
}

/** 番を終える軍のユニットは行動を終える（防衛拠点にいれば入城）。決着を調べる */
export function endTeamTurn(state: BattleState): JudgeResult {
  return judge(state, state.map.allUnits().filter((u) => u.team === state.activeTeam));
}

/** いまの番の軍の陣営で、この番の終わりに撃つ施設（順に。撃たなければ空） */
export function firingFacilities(state: BattleState): { side: DeploySide; kinds: FiringFacility[] } | null {
  const side = sideOf(state.activeTeam);
  const f = side && state.facilities[side];
  const kinds = (['fortressCannon', 'gunship'] as const).filter((k) => {
    const w = f?.[k];
    return !!w && firesOn(state.turn, w.interval ?? DEFAULT_INTERVALS[k]);
  });
  return side && kinds.length > 0 ? { side, kinds } : null;
}

/** side の kind の施設が撃てる敵（要塞砲は拠点から射程以内で、城の HEX にいないもの。ガンシップは全域） */
export function facilityTargets(state: BattleState, kind: FiringFacility, side: DeploySide): UnitData[] {
  const map = state.map;
  const enemies = map.allUnits().filter((u) => u.team !== SIDE_TEAM[side] && state.statuses.has(u));
  if (kind === 'gunship') return enemies;
  const hold = state.stronghold;
  if (!hold) return [];
  return enemies.filter((u) => hexDistance(map, hold, u) <= FORTRESS_CANNON_RANGE && map.get(u.col, u.row)?.feature !== 'castle');
}

/** side の kind の施設が撃つ目標をランダムに選ぶ（撃てる敵がいなければ null で、撃たない） */
export function facilityTarget(state: BattleState, kind: FiringFacility, side: DeploySide, rng: Rng): UnitData | null {
  const targets = facilityTargets(state, kind, side);
  return targets.length > 0 ? pick(rng, targets) : null;
}

/**
 * 施設の 1 発（ランダム係数を引く）を兵数・士気に反映し、殲滅したら指揮官の捕縛を決めて戦場から除く
 * （決着は、殲滅したときに judge で調べる）
 */
export function fireFacility(state: BattleState, kind: FiringFacility, side: DeploySide, target: UnitData, rng: Rng): FacilityReport & { wipeout: WipeoutReport | null } {
  const status = state.statuses.get(target)!;
  const result = facilityResult(state.map, kind, { unit: target, status, pos: target }, randomRoll(rng));
  status.soldiers -= result.damage;
  applyMorale(status, result.morale.defender);
  const destroyed = status.soldiers <= 0;
  const w = destroyed ? wipeOut(state, { wipeouts: [] }, target, status, target, null, [], rng) : null;
  if (w) {
    removeUnits(state, [target]);
    state.wipedOut.push(w);
    markFallen(state, target, status, 'commander');
  }
  return { kind, side, turn: state.turn, target, result, left: Math.max(0, status.soldiers), destroyed, wipeout: w };
}

/** 番を終えた軍の状態の残りターンを減らして、次の軍の番にする（全軍が 1 回ずつ行動したらターンの数を進める） */
export function passTurn(state: BattleState): void {
  for (const [unit, status] of state.statuses) if (unit.team === state.activeTeam) tickConditions(status);
  const next = nextTeam(state, state.activeTeam);
  if (TURN_ORDER.indexOf(next) <= TURN_ORDER.indexOf(state.activeTeam)) state.turn++;
  state.activeTeam = next;
  startTeamTurn(state, next);
}

/**
 * 決着したか調べる。決着していたら、軍団長部隊の全滅・退却、入城で負けた陣営に部隊（退却できない部隊を除く）が残っていて退却先もあれば
 * 強制退却を始め、なければ戦闘を終える。強制退却の最中なら rout（次の部隊へ進む）。
 * ended はいま行動を終えたユニット（防衛拠点にいる攻撃側のユニットなら入城）
 */
export function judge(state: BattleState, ended: readonly UnitData[] = []): JudgeResult {
  if (state.outcome) return { kind: 'none' };
  if (state.rout) return { kind: 'rout' };
  const outcome = judgeBattle(state.map, state.stronghold, ended, state.judged, state.turn, state.fallen);
  if (!outcome) return { kind: 'none' };
  const team = SIDE_TEAM[loserOf(outcome)];
  // 退却できない部隊（ブレイン）は戦場に残る
  const left = state.map.allUnits().filter((u) => u.team === team && !state.statuses.get(u)?.noRetreat);
  if (left.length === 0 || !state.retreats[team]?.length) return { kind: 'end', outcome: endBattle(state, outcome) };
  state.rout = { outcome, team, queue: left };
  return { kind: 'routStart', outcome, units: left };
}

/** 強制退却で、次に退却する部隊（もう戦場にいない部隊は飛ばす）。残っていなければ戦闘を終えて null */
export function nextRoutUnit(state: BattleState): UnitData | null {
  const rout = state.rout;
  if (!rout) return null;
  let unit = rout.queue.shift();
  while (unit && !state.map.allUnits().includes(unit)) unit = rout.queue.shift();
  if (unit) return unit;
  state.rout = null;
  endBattle(state, rout.outcome);
  return null;
}

/**
 * 戦闘を終える。戦場に残った部隊を outcome.remaining に、勝った陣営が捕縛した指揮官（退却に失敗した・殲滅されて捕縛された
 * 負けた陣営の部隊。退却・殲滅の順）を outcome.captives に付けて、state.outcome にする
 */
export function endBattle(state: BattleState, judged: BattleOutcome): BattleOutcome {
  const remaining = state.map.allUnits().flatMap((unit) => {
    const status = state.statuses.get(unit);
    return status ? [{ unit, troopId: state.troopIds.get(unit) ?? null, status }] : [];
  });
  const loser = SIDE_TEAM[loserOf(judged)];
  const captives = [...state.retreated.map((r) => ({ ...r, cause: 'retreat' as const })), ...state.wipedOut.map((w) => ({ ...w, cause: 'wipeout' as const }))]
    .filter((r) => r.captured && r.unit.team === loser)
    .map(({ unit, troopId, status, turn, cause }): CapturedUnit => ({ unit, troopId, status, turn, cause }));
  const outcome: BattleOutcome = { ...judged, remaining, captives };
  state.outcome = outcome;
  return outcome;
}
