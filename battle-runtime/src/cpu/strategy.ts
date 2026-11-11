/**
 * 軍の作戦（CpuFeatures.strategy）。番の初めに軍ごとに立てる（player.ts の beginTurn → planTeam）。
 *
 * - 攻撃側: 防衛拠点へ向かい、拠点で行動を終えて入城を狙う（decide.ts の位置の点数・入城の点数）
 * - 防衛側: 拠点の守りの部隊（garrison）を 1 つ決めて拠点に置く（拠点にいる部隊。いなければ射程のある部隊・軍団長でない部隊・拠点に近い部隊を選ぶ）。
 *   拠点が空いていて、拠点の隣に攻撃側のユニットがいれば（次の番に入城できる）、どの部隊でも拠点に入って塞ぐ・その敵を討つ
 * - 軍団長の部隊は前に出しすぎない（敵に近づく重みを下げる）。危険な HEX は danger.ts で重く見る
 * - 弱った相手に狙いを集める（decide.ts の攻撃の点数）
 * - 負けを認める: 味方の兵力が戦闘の初めの CONCEDE_LEFT 以下に減り、敵の兵力が味方の CONCEDE_STALL_RATIO 倍以上なら、軍団長の部隊を最初に動かし、
 *   敵が CONCEDE_RATIO 倍以上でどこへ動いても次の敵の番に殲滅されそうなとき、または戦況が CONCEDE_STALL 番動いていないときに退却する
 *   （戦闘を終え、残りの部隊は強制退却。殲滅されて捕縛されるのを避ける・逃げ回って決着しないのを避ける）。
 *   そうでなければ、ふつうに戦う（相手の軍団長を討てば勝てる）
 * - 軍団長の性格（temper.ts の ArmyTemper）で、全軍の前に出る度合い・拠点の周りに留まる広さ・軍団長の出方・負けを認めるしきい値を変える
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { TeamId, UnitData } from '@norden/map-runtime/core/units';
import { COMBAT_DEFS, hexDistance } from '../combat';
import { SIDE_TEAM } from '../deployment';
import type { BattleState } from '../engine/state';
import type { UnitStatus } from '../unitStatus';
import { armyTemperOf, type ArmyTemper } from './temper';
import { power, worth } from './worth';

/** 軍の作戦 */
export interface TeamPlan {
  /** 防衛側の拠点の守りの部隊（攻撃側・拠点が無いなら null） */
  garrison: UnitData | null;
  /**
   * 負けを認めるか考える（味方の兵力が戦闘の初めの CONCEDE_LEFT 以下）ときの、敵の兵力 ÷ 味方の兵力（軍団長の重さを入れない）。
   * 考えないなら 0。考えるなら軍団長の部隊を最初に動かす（decide.ts の退却）
   */
  concede: number;
  /** 軍団長の性格で決まる軍の気質 */
  army: ArmyTemper;
}

/** 軍の兵力（兵数 × 兵の重さの合計）。いまの味方・敵と、戦闘の初めの味方 */
export interface Forces {
  own: number;
  foe: number;
  ownInitial: number;
}

/**
 * team から見た兵力。commander なら軍団長の部隊の兵を重く数える（狙う・守る重さ。worth.ts）。
 * 負けを認めるか・退却するかは、軍団長の重さを入れない兵力で比べる（軍団長だけが残っても数で勝っているように見えないように）
 */
export function forcesOf(state: BattleState, team: TeamId, commander = true): Forces {
  const w = commander ? worth : power;
  let own = 0;
  let foe = 0;
  let ownInitial = 0;
  for (const [u, s] of state.statuses) {
    const f = s.soldiers * w(u, s);
    if (u.team === team) {
      own += f;
      ownInitial += s.initialSoldiers * w(u, s);
    } else foe += f;
  }
  // 戦場からいなくなった（殲滅・退却した）味方も、戦闘の初めの兵力に数える
  const gone: { unit: UnitData; status: UnitStatus }[] = [...state.wipedOut, ...state.retreated];
  for (const g of gone) if (g.unit.team === team) ownInitial += g.status.initialSoldiers * w(g.unit, g.status);
  return { own, foe, ownInitial };
}

/** 番の初めに、team の軍の作戦を立てる（personality なら軍団長の性格で軍の気質を変える） */
export function planTeam(state: BattleState, team: TeamId, personality = true): TeamPlan {
  const army = armyTemperOf(commanderOf(state, team), personality);
  const f = forcesOf(state, team, false);
  const ratio = f.own > 0 ? f.foe / f.own : Infinity;
  const concede = f.own <= f.ownInitial * army.concedeLeft && ratio >= army.concedeStallRatio ? ratio : 0;
  return { garrison: chooseGarrison(state, team), concede, army };
}

/** team の軍団長の部隊の状態（いなければ undefined） */
export function commanderOf(state: BattleState, team: TeamId): UnitStatus | undefined {
  for (const [u, s] of state.statuses) if (u.team === team && s.commander) return s;
  return undefined;
}

/** 防衛側の拠点の守りの部隊（拠点に近い部隊。射程のある部隊・軍団長でない部隊を選ぶ）。攻撃側・拠点が無い・部隊がいなければ null */
export function chooseGarrison(state: BattleState, team: TeamId): UnitData | null {
  const hold = state.stronghold;
  if (!hold || team !== SIDE_TEAM.defender) return null;
  // もう拠点にいる部隊がいれば、それが守る
  const there = state.map.unitAt(hold.col, hold.row);
  if (there && there.team === team) return there;
  const cost = (u: UnitData) => {
    const s = state.statuses.get(u);
    return hexDistance(state.map, u, hold) * 10 + (s?.commander ? 25 : 0) + (COMBAT_DEFS[u.type].ranged ? 0 : 8);
  };
  const units = state.map.allUnits().filter((u) => u.team === team && state.statuses.has(u));
  return units.reduce<UnitData | null>((a, u) => (!a || cost(u) < cost(a) ? u : a), null);
}

/** 防衛側から見て、拠点が空いていて（または unit がいて）、拠点の隣に攻撃側のユニットがいる（次の番に入城される） */
export function strongholdUrgent(state: BattleState, team: TeamId, unit: UnitData): boolean {
  const hold = state.stronghold;
  if (!hold || team !== SIDE_TEAM.defender) return false;
  const there = state.map.unitAt(hold.col, hold.row);
  if (there && there !== unit) return false;
  return nearStrongholdEnemies(state, team).length > 0;
}

/** 防衛拠点の HEX かその隣にいる、team の敵（攻撃側）のユニット */
export function nearStrongholdEnemies(state: BattleState, team: TeamId): UnitData[] {
  const hold = state.stronghold;
  if (!hold) return [];
  return state.map.allUnits().filter((u) => u.team !== team && hexDistance(state.map, u, hold) <= 1);
}

/** pos が防衛拠点か */
export function atStronghold(state: BattleState, pos: Offset): boolean {
  const hold = state.stronghold;
  return !!hold && hold.col === pos.col && hold.row === pos.row;
}
