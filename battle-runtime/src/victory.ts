/**
 * 戦闘の勝敗。行動を実行し終えるたびに BattleApp が judgeBattle で調べ、決着したら戦闘を終える。
 *
 * - 攻撃側: すべての部隊が殲滅または退却（退却に失敗して捕虜になったものも含む）したら負け。
 * - 防衛側: すべての部隊が殲滅または退却したら負け。防衛拠点（マップの stronghold）に攻撃側のユニットが入ったら負け（入城）。
 *   入城は、行動を終えたときに防衛拠点の HEX にいること（通り過ぎただけでは入城しない。突撃で飛び出た先なら入城）。
 * - 両軍が同時にいなくなったとき（相討ち）は防衛側の勝ち（攻め落とせなかった）。
 * - 戦闘が始まったときに部隊のいなかった陣営は、いなくなっても負けにしない（表示確認用のマップなど）。
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { DeploySide, HexMap } from '@norden/map-runtime/core/mapData';
import type { UnitData } from '@norden/map-runtime/core/units';
import { SIDE_TEAM } from './deployment';

/** eliminated: 負けた陣営の部隊がすべて殲滅・退却した、stronghold: 攻撃側が防衛拠点に入った（入城） */
export type BattleEndReason = 'eliminated' | 'stronghold';

export const BATTLE_END_REASON_NAMES: Record<BattleEndReason, string> = {
  eliminated: '全軍の殲滅・退却',
  stronghold: '入城',
};

/** 戦闘の決着 */
export interface BattleOutcome {
  winner: DeploySide;
  reason: BattleEndReason;
  /** 決着したターン */
  turn: number;
  /** 入城したユニット（入城のときだけ） */
  unit?: UnitData;
}

/** side の陣営のユニット */
export function sideUnits(map: HexMap, side: DeploySide): UnitData[] {
  return map.allUnits().filter((u) => u.team === SIDE_TEAM[side]);
}

/**
 * いまのマップで決着しているか（していなければ null）。stronghold は防衛拠点（無ければ入城では決着しない）、
 * judged は全滅で負けにする陣営（戦闘が始まったときに部隊のいた陣営）
 */
export function judgeBattle(
  map: HexMap,
  stronghold: Offset | null,
  judged: ReadonlySet<DeploySide>,
  turn: number,
): BattleOutcome | null {
  const gone = (side: DeploySide) => judged.has(side) && sideUnits(map, side).length === 0;
  if (gone('attacker')) return { winner: 'defender', reason: 'eliminated', turn };
  const occupant = stronghold && map.unitAt(stronghold.col, stronghold.row);
  if (occupant && occupant.team === SIDE_TEAM.attacker) return { winner: 'attacker', reason: 'stronghold', turn, unit: occupant };
  if (gone('defender')) return { winner: 'attacker', reason: 'eliminated', turn };
  return null;
}
