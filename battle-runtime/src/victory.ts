/**
 * 戦闘の勝敗。BattleApp が、行動を実行し終えるたびと軍の番を終えるときに judgeBattle で調べ、決着したら戦闘を終える。
 *
 * - 攻撃側: すべての部隊が殲滅または退却（退却に失敗して捕虜になったものも含む）したら負け。
 * - 防衛側: すべての部隊が殲滅または退却したら負け。防衛拠点（マップの stronghold）で攻撃側のユニットが行動を終えたら負け（入城）。
 *   行動を終えるのは、実行し終えてもう行動できなくなった（行動済みの E の印が付いた）ときと、拠点にいるまま軍の番を終えたとき。
 *   拠点に入っても、行動力が残っていて拠点から動いたら入城しない。
 * - どちらの陣営も、軍団長の部隊（UnitStatus.commander）が殲滅されたら負け（軍団長部隊の全滅）。
 *   軍団長の部隊が退却しても負け（軍団長部隊の退却。退却に失敗して捕虜になったときも）。
 * - 両軍が同時に負けになったとき（相討ち）は防衛側の勝ち（攻め落とせなかった）。
 * - 軍団長部隊の全滅・退却、入城で負けた陣営に残っている部隊は、BattleApp が強制退却させてから戦闘を終える
 *   （退却先が無ければそのまま終える）。
 * - 捕縛した指揮官は、勝った陣営のものだけが捕虜になる（BattleOutcome.captives）。負けた陣営の捕縛は無効。
 * - 戦闘が始まったときに部隊のいなかった陣営は、いなくなっても負けにしない（表示確認用のマップなど）。
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { DeploySide, HexMap } from '@norden/map-runtime/core/mapData';
import type { UnitData } from '@norden/map-runtime/core/units';
import { SIDE_TEAM } from './deployment';
import type { UnitStatus } from './unitStatus';

/**
 * eliminated: 負けた陣営の部隊がすべて殲滅・退却した、stronghold: 攻撃側が防衛拠点で行動を終えた（入城）、
 * commander: 負けた陣営の軍団長の部隊が殲滅された（軍団長部隊の全滅）、
 * commanderRetreat: 負けた陣営の軍団長の部隊が退却した（軍団長部隊の退却。退却に失敗して捕虜になったときも）
 */
export type BattleEndReason = 'eliminated' | 'stronghold' | 'commander' | 'commanderRetreat';

export const BATTLE_END_REASON_NAMES: Record<BattleEndReason, string> = {
  eliminated: '全軍の殲滅・退却',
  stronghold: '入城',
  commander: '軍団長部隊の全滅',
  commanderRetreat: '軍団長部隊の退却',
};

/** 軍団長の部隊が戦場からいなくなったこと（殲滅された・退却した） */
export interface CommanderLoss {
  unit: UnitData;
  reason: 'commander' | 'commanderRetreat';
}

/** 戦闘の決着 */
export interface BattleOutcome {
  winner: DeploySide;
  reason: BattleEndReason;
  /** 決着したターン */
  turn: number;
  /** 入城したユニット（入城のとき）・いなくなった軍団長の部隊のユニット（軍団長部隊の全滅・退却のとき。もうマップにはいない） */
  unit?: UnitData;
  /** 決着したときに戦場に残っていた部隊（退却・殲滅した部隊は含まない）。BattleApp が戦闘を終えるときに付ける */
  remaining?: readonly RemainingUnit[];
  /**
   * 勝った陣営が捕縛した指揮官（退却に失敗した・殲滅されて捕縛された、負けた陣営の部隊）。BattleApp が戦闘を終えるときに付ける。
   * 負けた陣営が捕縛したものは無効なので含まない
   */
  captives?: readonly CapturedUnit[];
}

/** 指揮官が捕縛された部隊と、どう捕縛されたか（retreat: 退却に失敗した、wipeout: 殲滅されて捕縛された） */
export interface CapturedUnit {
  /** 捕縛された部隊のユニット（もうマップにはいない） */
  unit: UnitData;
  /** 配備した部隊の ID（Troop.id。マップに最初から置いてあったユニットは null） */
  troopId: string | null;
  /** 捕縛されたときの戦闘中の状態 */
  status: UnitStatus;
  /** 何ターン目に捕縛されたか */
  turn: number;
  cause: 'retreat' | 'wipeout';
}

/** 決着したときに戦場に残っていた部隊と、その状態（兵士数など） */
export interface RemainingUnit {
  unit: UnitData;
  /** 配備した部隊の ID（Troop.id。マップに最初から置いてあったユニットは null） */
  troopId: string | null;
  status: UnitStatus;
}

/** 負けた陣営 */
export function loserOf({ winner }: BattleOutcome): DeploySide {
  return winner === 'attacker' ? 'defender' : 'attacker';
}

/** side の陣営のユニット */
export function sideUnits(map: HexMap, side: DeploySide): UnitData[] {
  return map.allUnits().filter((u) => u.team === SIDE_TEAM[side]);
}

/**
 * いまのマップで決着しているか（していなければ null）。
 * stronghold は防衛拠点（無ければ入城では決着しない）、ended はいま行動を終えたユニット（このうち防衛拠点にいる攻撃側のユニットが入城する）、
 * judged は全滅で負けにする陣営（戦闘が始まったときに部隊のいた陣営）、fallen は軍団長の部隊が殲滅された・退却した陣営と、そのこと
 */
export function judgeBattle(
  map: HexMap,
  stronghold: Offset | null,
  ended: readonly UnitData[],
  judged: ReadonlySet<DeploySide>,
  turn: number,
  fallen: ReadonlyMap<DeploySide, CommanderLoss> = new Map(),
): BattleOutcome | null {
  const gone = (side: DeploySide) => judged.has(side) && sideUnits(map, side).length === 0;
  if (gone('attacker')) return { winner: 'defender', reason: 'eliminated', turn };
  const attackerCommander = fallen.get('attacker');
  if (attackerCommander) return { winner: 'defender', turn, ...attackerCommander };
  const occupant = stronghold && map.unitAt(stronghold.col, stronghold.row);
  if (occupant && occupant.team === SIDE_TEAM.attacker && ended.includes(occupant)) {
    return { winner: 'attacker', reason: 'stronghold', turn, unit: occupant };
  }
  if (gone('defender')) return { winner: 'attacker', reason: 'eliminated', turn };
  const defenderCommander = fallen.get('defender');
  if (defenderCommander) return { winner: 'attacker', turn, ...defenderCommander };
  return null;
}
