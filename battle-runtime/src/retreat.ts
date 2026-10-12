/**
 * 退却。戦場から隣接する自領の拠点へ部隊を逃がす（ターンの初めだけ。行動力は使わない）。
 *
 * - 退却先の拠点は使う側が軍ごとに渡す（RetreatDestinations。ゲームでは戦場の拠点に街道でつながる自勢力の拠点）。
 *   退却先が無い軍のユニットは退却を選べない。
 * - 退却は失敗することがある。失敗する確率は隣接している敵ユニットの数で決まる（retreatFailChance）。
 *   失敗したユニットは捕虜になる。成功しても失敗しても、そのユニットは戦場から消える。
 * - 結果は RetreatReport で知らせる（BattleApp の retreat のイベント・retreated）。捕虜をどう扱うかは使う側が決める。
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { HexMap } from '@norden/map-runtime/core/mapData';
import type { TeamId, UnitData } from '@norden/map-runtime/core/units';
import type { UnitStatus } from './unitStatus';

/** 退却先の拠点 */
export interface RetreatDestination {
  /** 使う側で拠点を見分ける ID（ゲームでは拠点の ID） */
  id: string;
  /** 一覧に出す名前 */
  name: string;
}

/** 軍ごとの退却先の拠点（無い軍は退却できない） */
export type RetreatDestinations = Partial<Record<TeamId, readonly RetreatDestination[]>>;

/** 退却の結果 */
export interface RetreatReport {
  /** 退却したユニット（もうマップにはいない。col・row は退却したときの HEX） */
  unit: UnitData;
  /** 配備した部隊の ID（Troop.id。マップに最初から置いてあったユニットは null） */
  troopId: string | null;
  /** 退却したときの戦闘中の状態（兵士数・士気など） */
  status: UnitStatus;
  /** 何ターン目に退却したか */
  turn: number;
  to: RetreatDestination;
  /** 隣接していた敵ユニットの数 */
  enemies: number;
  /** 失敗する確率（0〜1） */
  failChance: number;
  /** 退却に失敗して捕虜になったか */
  captured: boolean;
}

/** 隣接している敵ユニットの数ごとの、退却に失敗する確率（これより多ければ最後の値） */
export const RETREAT_FAIL_CHANCE: readonly number[] = [0.01, 0.1, 0.25, 0.5];

/** 隣接している敵ユニットが enemies 部隊いるときに、退却に失敗する確率 */
export function retreatFailChance(enemies: number): number {
  return RETREAT_FAIL_CHANCE[Math.min(enemies, RETREAT_FAIL_CHANCE.length - 1)];
}

/** unit が pos（省略時はいる HEX）にいるときに隣接している敵ユニット */
export function adjacentEnemies(map: HexMap, unit: UnitData, pos: Offset = unit): UnitData[] {
  return map.layout
    .neighbors(pos.col, pos.row)
    .map((o) => map.unitAt(o.col, o.row))
    .filter((u): u is UnitData => !!u && u.team !== unit.team);
}
