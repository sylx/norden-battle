/**
 * 行動の予約（Plan）と、予約を読む・作る関数。
 *
 * 予約は、移動（何回かに分けられる）と攻撃（1 ターンに 1 回）の並び。攻撃を予約した後は移動できない（騎兵だけは攻撃の後にも
 * 移動を予約できる。一撃離脱）。予約は「決定」などで action.ts の beginAction に渡して実行する。
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { UnitData } from '@norden/map-runtime/core/units';
import { canAct, type MenuAction, type MenuContext } from '../actions';
import type { MenuAttackId } from '../attacks';
import { attackRange, attackTargets, attacksOf, chargeLanding, COMBAT_DEFS, mainTargetAt, resolveAttack, splashUnits, volleySupporters, type ResolvedAttack } from '../combat';
import { inEnemyZoc, moveRange, type MoveOptions, type MoveStep } from '../movement';
import type { UnitStatus } from '../unitStatus';
import { castleLocked, locked, rangeBonusAt, retreatDestinations, strongholdLocked, type BattleState } from './state';

/** 一斉攻撃で、ほかの味方と取り囲んでいない相手を選んだときの知らせ */
export const NOT_SURROUNDED = '包囲していません';

/** 予約した攻撃 */
export interface PlannedAttack {
  action: MenuAction;
  /** 攻撃の ID（action.id と同じ） */
  id: MenuAttackId;
  /** 目標（自分が中心の攻撃と、地点を狙って敵がいない HEX を選んだときは null） */
  target: UnitData | null;
  /** 狙った HEX（自分が中心の攻撃は攻撃する HEX） */
  at: Offset;
  /** 何回目の移動の後に攻撃するか（legs のうち、これより前が攻撃前の移動、以降が攻撃後の移動） */
  afterLeg: number;
  /** 突撃で飛び出る HEX（突撃でない・飛び出せないなら null） */
  landing: Offset | null;
}

/** ユニットの予約 */
export interface Plan {
  unit: UnitData;
  status: UnitStatus;
  /** 予約した移動（各回の到着地。cost はそこまでに予約した行動の合計） */
  legs: MoveStep[];
  /** 予約した攻撃 */
  attack: PlannedAttack | null;
}

/** unit の空の予約（戦場にいなければ null） */
export function newPlan(state: BattleState, unit: UnitData): Plan | null {
  const status = state.statuses.get(unit);
  return status ? { unit, status, legs: [], attack: null } : null;
}

/** 予約があるか */
export function planned(plan: Plan): boolean {
  return plan.legs.length > 0 || !!plan.attack;
}

/** 攻撃が予約の最後か（攻撃の後の移動が無いか） */
export function attackIsLast(plan: Plan): boolean {
  return !!plan.attack && plan.attack.afterLeg === plan.legs.length;
}

/** 予約した行動（移動・攻撃）で使う行動力。移動の cost はそれまでの予約を含む合計なので、最後の予約から求まる */
export function planCost(plan: Plan): number {
  return (plan.legs.at(-1)?.cost ?? 0) + (attackIsLast(plan) ? (plan.attack!.action.cost ?? 0) : 0);
}

/** 予約した移動で使う行動力 */
export function moveCost(plan: Plan): number {
  return planCost(plan) - (plan.attack?.action.cost ?? 0);
}

/** ターンの初めか（まだ移動も攻撃もしておらず、予約も無い） */
export function turnStart(plan: Plan): boolean {
  return !plan.status.moved && !plan.status.attacked && !planned(plan);
}

/** 攻撃する HEX（攻撃の前の移動の先） */
export function attackPos(plan: Plan): Offset {
  const i = plan.attack?.afterLeg ?? plan.legs.length;
  return i > 0 ? plan.legs[i - 1] : plan.unit;
}

/** 予約した行動の後にいる HEX（最後の移動先、突撃で飛び出る先。予約が無ければユニットのいる HEX） */
export function planPos(plan: Plan): Offset {
  if (attackIsLast(plan) && plan.attack!.landing) return plan.attack!.landing;
  return plan.legs.at(-1) ?? plan.unit;
}

/**
 * 続きの移動を探すときの条件。ターンの初めは敵の ZOC から動き出せる。
 * 騎兵（moveAfterAttack）は攻撃の直後（予約した攻撃の後、または実行した攻撃の後にまだ移動していない）も動き出せる（一撃離脱）。
 * 攻撃側のユニットは、番の初めに城の HEX の中かそのとなりにいなければ、城の外から城の HEX へ入れない（入城の決まり）。拠点の HEX も同じ。
 */
export function moveOptions(state: BattleState, plan: Plan): MoveOptions {
  const afterAttack = !!COMBAT_DEFS[plan.unit.type].moveAfterAttack && (attackIsLast(plan) || (plan.status.justAttacked && !planned(plan)));
  return {
    spent: planCost(plan),
    escapeZoc: turnStart(plan) || afterAttack,
    castleLocked: castleLocked(plan.unit, plan.status),
    strongholdLocked: strongholdLocked(state, plan.unit, plan.status),
  };
}

/** 予約の後に移動できる HEX と、そこへの最短経路 */
export function moveCells(state: BattleState, plan: Plan): Map<number, MoveStep> {
  return moveRange(state.map, plan.unit, planPos(plan), plan.status.ap, moveOptions(state, plan));
}

/** 予約 plan の後の行動メニューの状況 */
export function menuContext(state: BattleState, plan: Plan): MenuContext {
  const map = state.map;
  const pos = planPos(plan);
  const options = moveOptions(state, plan);
  const attacks = attacksOf(plan.unit.type, plan.status);
  // 狙える相手のいる攻撃（自分が中心の攻撃は、範囲に敵がいるとき。耕す攻撃は敵がいなくても、射程に HEX があれば地形に撃てる）
  const bonus = rangeBonusAt(state, plan.unit, pos);
  const targetable = attacks.filter((id) => {
    const a = resolveAttack(plan.unit.type, id);
    if (a.aim === 'self') return splashUnits(map, plan.unit, pos, null, pos, id).some((u) => u.team !== plan.unit.team);
    if (a.plows) return attackRange(map, plan.unit, pos, id, bonus).length > 0;
    return attackTargets(map, plan.unit, pos, id, bonus).length > 0;
  });
  return {
    unit: plan.unit,
    status: plan.status,
    ap: plan.status.ap - planCost(plan),
    canMove: moveRange(map, plan.unit, pos, plan.status.ap, options).size > 0,
    zocLocked: inEnemyZoc(map, plan.unit, pos) && !options.escapeZoc,
    turnStart: turnStart(plan),
    canRetreat: retreatDestinations(state, plan.unit).length > 0,
    planned: planned(plan),
    attackPlanned: !!plan.attack,
    canMoveAfterAttack: !!COMBAT_DEFS[plan.unit.type].moveAfterAttack,
    hasTargets: targetable.length > 0,
    targetable,
    hasVolleyTargets: attacks.includes('volley') && attackTargets(map, plan.unit, pos, 'volley').some((t) => volleySupporters(map, plan.unit, t).length > 0),
  };
}

/** いまの番の軍の unit が行動済みか（操作できない、またはもう移動・攻撃・迎撃などのどれもできない。E の印） */
export function isDone(state: BattleState, unit: UnitData): boolean {
  const status = state.statuses.get(unit);
  if (!status) return false;
  return locked(status) || !canAct(menuContext(state, { unit, status, legs: [], attack: null }));
}

/** 予約の後に attack で狙える HEX（敵ユニットを狙う攻撃は敵のいる HEX、地点を狙う攻撃は射程のすべての HEX、自分が中心の攻撃はいる HEX） */
export function aimCells(state: BattleState, plan: Plan, attack: ResolvedAttack): Offset[] {
  const pos = planPos(plan);
  if (attack.aim === 'self') return [{ col: pos.col, row: pos.row }];
  const bonus = rangeBonusAt(state, plan.unit, pos);
  const cells = attack.aim === 'unit' ? attackTargets(state.map, plan.unit, pos, attack.id, bonus) : attackRange(state.map, plan.unit, pos, attack.id, bonus);
  return cells.map((o) => ({ col: o.col, row: o.row }));
}

/** attack で target を攻撃できない理由（できれば null）。一斉攻撃は、ほかの味方とも隣接している相手しか選べない */
export function rejectReason(state: BattleState, plan: Plan, attack: ResolvedAttack, target: UnitData): string | null {
  if (attack.special !== 'volley') return null;
  return volleySupporters(state.map, plan.unit, target).length > 0 ? null : NOT_SURROUNDED;
}

/** 移動を 1 回分予約する */
export function addLeg(plan: Plan, step: MoveStep): void {
  plan.legs.push(step);
}

/** attack を at を狙って予約する（目標は at のユニット。自分が中心の攻撃は at が攻撃する HEX。突撃なら飛び出る先も決める） */
export function setAttack(state: BattleState, plan: Plan, action: MenuAction, attack: ResolvedAttack, at: Offset): void {
  const pos = planPos(plan);
  const target = mainTargetAt(state.map, plan.unit, at, attack.id);
  const landing = attack.special === 'charge' && target ? chargeLanding(state.map, pos, target, castleLocked(plan.unit, plan.status), strongholdLocked(state, plan.unit, plan.status)) : null;
  plan.attack = { action, id: attack.id as MenuAttackId, target, at: { col: at.col, row: at.row }, afterLeg: plan.legs.length, landing };
}

/** 最後の予約を取り消す */
export function undoPlan(plan: Plan): void {
  if (attackIsLast(plan)) plan.attack = null;
  else plan.legs.pop();
}
