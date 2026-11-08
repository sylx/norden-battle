/**
 * 危険な HEX（CpuFeatures.danger）。部隊がそこで番を終えたとき、次の敵の番に受けそうなダメージ（兵数）を見積もる。
 *
 * - 敵の攻撃: 次の番にその HEX を攻撃できる敵（threat.ts の enemyReach）ごとに、使える攻撃のうち一番効くもののダメージ
 *   （ランダム係数が真ん中。地形・包囲・迎撃の構え・間接攻撃の割引も入る）。敵はほかの味方を狙うこともあるので、
 *   その敵が届く範囲にいる味方の部隊の数で割る（軍団長の部隊は、敵が狙いを集めるので割らない）
 * - 要塞砲: 相手の陣営に要塞砲があり、次の相手の番の終わりに撃つなら、射程にいる味方の部隊の数で割ったダメージ
 * - 移動の途中で受ける迎撃（walkIntercepts）: 迎撃の構えの間接ユニットの射程に入る HEX ごとのダメージと、弓兵・ライフル兵に
 *   足止めされる HEX
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { UnitData } from '@norden/map-runtime/core/units';
import { attackResult, COMBAT_DEFS, facilityResult, hexDistance, interceptorsAt } from '../combat';
import { DEFAULT_INTERVALS, firesOn, FORTRESS_CANNON_RANGE } from '../facilities';
import { movePath, type MoveStep } from '../movement';
import { rangeBonusAt, sideOf, TURN_ORDER, type BattleState } from '../engine/state';
import type { UnitStatus } from '../unitStatus';
import { cellKey, type Reach } from './threat';

/** 1 つの部隊の危険を見積もるときに使うもの（decide.ts が部隊ごとに作る） */
export interface DangerContext {
  state: BattleState;
  unit: UnitData;
  status: UnitStatus;
  reach: Map<UnitData, Reach>;
  /** 敵ごとの、ダメージを割る数（その敵が届く範囲にいる、unit 以外の味方の部隊の数 + 1） */
  share: Map<UnitData, number>;
  /** 要塞砲の 1 発のダメージを割る数（射程にいる unit 以外の味方の部隊の数 + 1。次の番に撃たなければ null） */
  cannon: number | null;
  /** HEX ごとの見積もり（同じ HEX を何度も数えない） */
  cache: Map<number, number>;
}

/** unit の危険を見積もる準備 */
export function dangerContext(state: BattleState, unit: UnitData, status: UnitStatus, reach: Map<UnitData, Reach>): DangerContext {
  const allies = state.map.allUnits().filter((u) => u.team === unit.team && u !== unit);
  const share = new Map<UnitData, number>();
  // 軍団長の部隊は敵が狙いを集めるので割らない
  for (const [enemy, r] of reach) share.set(enemy, status.commander ? 1 : 1 + allies.filter((a) => r.attack.has(cellKey(state, a))).length);
  return { state, unit, status, reach, share, cannon: cannonShare(state, unit, allies), cache: new Map() };
}

/** 次の相手の番の終わりに要塞砲が撃つなら、射程にいる unit 以外の味方の部隊の数 + 1（撃たなければ null） */
function cannonShare(state: BattleState, unit: UnitData, allies: readonly UnitData[]): number | null {
  const hold = state.stronghold;
  const foe = TURN_ORDER.find((t) => t !== unit.team && state.map.allUnits().some((u) => u.team === t));
  const side = foe && sideOf(foe);
  const cannon = side && state.facilities[side]?.fortressCannon;
  if (!hold || !foe || !cannon) return null;
  // 相手の次の番のターン（相手が先に動く軍なら、次のターン）
  const turn = TURN_ORDER.indexOf(foe) < TURN_ORDER.indexOf(unit.team) ? state.turn + 1 : state.turn;
  if (!firesOn(turn, cannon.interval ?? DEFAULT_INTERVALS.fortressCannon)) return null;
  return 1 + allies.filter((a) => inCannonRange(state, a)).length;
}

function inCannonRange(state: BattleState, pos: Offset): boolean {
  const hold = state.stronghold;
  return !!hold && hexDistance(state.map, hold, pos) <= FORTRESS_CANNON_RANGE && state.map.get(pos.col, pos.row)?.feature !== 'castle';
}

/** unit が pos で番を終えたときに、次の敵の番に受けそうなダメージ（兵数） */
export function dangerAt(ctx: DangerContext, pos: Offset): number {
  const { state, unit, status } = ctx;
  const key = cellKey(state, pos);
  const cached = ctx.cache.get(key);
  if (cached !== undefined) return cached;
  const map = state.map;
  let total = 0;
  for (const [enemy, r] of ctx.reach) {
    if (!r.attack.has(key) || r.attacks.length === 0) continue;
    const es = state.statuses.get(enemy);
    if (!es) continue;
    let best = 0;
    for (const id of r.attacks) {
      const res = attackResult(map, { unit: enemy, status: es, pos: enemy }, { unit, status, pos }, id, { damage: 0, counter: 0 });
      best = Math.max(best, res.damage);
    }
    total += best / (ctx.share.get(enemy) ?? 1);
  }
  if (ctx.cannon && inCannonRange(state, pos)) total += facilityResult(map, 'fortressCannon', { unit, status, pos }, 0).damage / ctx.cannon;
  ctx.cache.set(key, total);
  return total;
}

/** 移動の途中で受ける迎撃 */
export interface WalkIntercepts {
  /** 受けるダメージの合計（兵数） */
  damage: number;
  /** 足止めされる HEX（されなければ null） */
  haltAt: Offset | null;
}

/** unit が step まで歩くときに、迎撃の構えの間接ユニットから受ける迎撃（それぞれ 1 回だけ撃つ。足止めされたらそこまで） */
export function walkIntercepts(state: BattleState, unit: UnitData, status: UnitStatus, step: MoveStep): WalkIntercepts {
  const path = movePath([step]);
  const fired = new Set<UnitData>();
  let damage = 0;
  for (let i = 1; i < path.length; i++) {
    const shooters = interceptorsAt(state.map, state.statuses, unit, path[i], (u) => rangeBonusAt(state, u, u)).filter((s) => !fired.has(s));
    let halt = false;
    for (const shooter of shooters) {
      fired.add(shooter);
      const ss = state.statuses.get(shooter)!;
      damage += attackResult(state.map, { unit: shooter, status: ss, pos: shooter }, { unit, status, pos: path[i] }, 'interceptFire', { damage: 0, counter: 0 }).damage;
      if (COMBAT_DEFS[shooter.type].interceptHalts && !COMBAT_DEFS[unit.type].unhaltable) halt = true;
    }
    if (halt || damage >= status.soldiers) return { damage, haltAt: path[i] };
  }
  return { damage, haltAt: null };
}
