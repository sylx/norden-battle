/**
 * 戦闘の状態（BattleState）と、状態を読む小さな関数。
 *
 * engine（このディレクトリ）は戦闘のルールで状態を書き換える処理で、three.js・React・DOM を読み込まない。
 * BattleApp（app.ts）は演出の拍子（着いた・当たった瞬間）で engine の関数を呼び、描画なしで回すとき（CPU の番のスキップ・
 * 対戦シミュレータ）は同じ関数を待たずに順に呼ぶ（action.ts の runAction・turn.ts の runTurnEnd）。
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import { DEPLOY_SIDES, type DeploySide, type HexMap } from '@norden/map-runtime/core/mapData';
import type { TeamId, UnitData } from '@norden/map-runtime/core/units';
import { COMBAT_DEFS } from '../combat';
import { hasCondition } from '../conditions';
import { SIDE_TEAM } from '../deployment';
import { rangeBonus, type BattleFacilities, type SideFacilities } from '../facilities';
import type { RetreatDestination, RetreatDestinations, RetreatReport } from '../retreat';
import type { UnitStatus } from '../unitStatus';
import type { BattleOutcome, CommanderLoss } from '../victory';
import type { WipeoutReport } from '../wipeout';

/** 軍が行動する順（防衛側が先）。部隊のいない軍は飛ばす */
export const TURN_ORDER: readonly TeamId[] = [SIDE_TEAM.defender, SIDE_TEAM.attacker, 'green'];

/** 強制退却の最中の、その決着と、まだ退却先を選んでいない部隊（順に。退却先を選んでいる部隊は含まない） */
export interface RoutState {
  outcome: BattleOutcome;
  team: TeamId;
  queue: UnitData[];
}

/** 戦闘の状態 */
export interface BattleState {
  /** 戦場（BattleApp では描画と同じ HexMap。engine がユニットを動かし、BattleApp が絵を作り直す） */
  map: HexMap;
  /** 戦闘中のユニットの状態（戦場からいなくなったユニットは除く） */
  statuses: Map<UnitData, UnitStatus>;
  /** 何ターン目か（1 から。全軍が 1 回ずつ行動したら進む） */
  turn: number;
  /** いま行動している軍 */
  activeTeam: TeamId;
  /** 防衛拠点の HEX（無ければ入城では決着しない） */
  stronghold: Offset | null;
  /** 軍ごとの退却先の拠点（無い軍は退却できない） */
  retreats: RetreatDestinations;
  /** 陣営ごとの拠点の施設 */
  facilities: SideFacilities;
  /** 配備したユニットの部隊の ID */
  troopIds: Map<UnitData, string>;
  /** 殲滅・退却で戦場からいなくなったユニットを率いていた騎士の名前 */
  goneLeaders: Map<UnitData, string>;
  /** この戦闘で退却した・退却に失敗して捕虜になったユニット（順に） */
  retreated: RetreatReport[];
  /** この戦闘で殲滅されたユニット（順に） */
  wipedOut: WipeoutReport[];
  /** 全滅で負けにする陣営（戦闘が始まったときに部隊のいた陣営） */
  judged: Set<DeploySide>;
  /** 軍団長の部隊が殲滅された・退却した陣営と、そのこと */
  fallen: Map<DeploySide, CommanderLoss>;
  /** 戦闘の決着（まだなら null） */
  outcome: BattleOutcome | null;
  /** 強制退却の最中なら、その様子 */
  rout: RoutState | null;
}

/** 戦闘の状態を作るときに渡すもの（省略したものは無い） */
export interface BattleSetup {
  stronghold?: Offset | null;
  retreats?: RetreatDestinations;
  facilities?: SideFacilities;
  troopIds?: Map<UnitData, string>;
}

/** map と statuses で戦闘の状態を作る（配備の前。戦闘は turn.ts の startBattle で始める） */
export function createBattleState(map: HexMap, statuses: Map<UnitData, UnitStatus>, setup: BattleSetup = {}): BattleState {
  return {
    map,
    statuses,
    turn: 1,
    activeTeam: TURN_ORDER[0],
    stronghold: setup.stronghold ?? null,
    retreats: setup.retreats ?? {},
    facilities: setup.facilities ?? {},
    troopIds: setup.troopIds ?? new Map(),
    goneLeaders: new Map(),
    retreated: [],
    wipedOut: [],
    judged: new Set(),
    fallen: new Map(),
    outcome: null,
    rout: null,
  };
}

/** team の陣営（攻撃側・防衛側でない軍は undefined） */
export function sideOf(team: TeamId): DeploySide | undefined {
  return DEPLOY_SIDES.find((s) => SIDE_TEAM[s] === team);
}

/** team の陣営の施設（無ければ undefined） */
export function facilitiesOf(state: BattleState, team: TeamId): BattleFacilities | undefined {
  const side = sideOf(team);
  return side && state.facilities[side];
}

/** unit が pos（城の HEX）にいるときに施設で伸びる射程（バリスタ・魔導台） */
export function rangeBonusAt(state: BattleState, unit: UnitData, pos: Offset): number {
  if (state.map.get(pos.col, pos.row)?.feature !== 'castle') return 0;
  return rangeBonus(facilitiesOf(state, unit.team), unit.type, !!COMBAT_DEFS[unit.type].magic);
}

/** 入城の決まりで、unit が城の外から城の HEX へ入れないか（防衛側でない軍で、番の初めに城の HEX の中にもとなりにもいなかった） */
export function castleLocked(unit: UnitData, status: UnitStatus): boolean {
  return unit.team !== SIDE_TEAM.defender && !status.atCastle;
}

/** 入城の決まりで、unit が入れない拠点の HEX（防衛側でない軍で、番の初めに拠点の HEX の中にもとなりにもいなかった。入れるなら null） */
export function strongholdLocked(state: BattleState, unit: UnitData, status: UnitStatus): Offset | null {
  return unit.team !== SIDE_TEAM.defender && !status.atStronghold ? state.stronghold : null;
}

/** 混乱・凍結していて操作できないユニットか（混乱したユニットは番の終わりに勝手に動く） */
export function locked(status: UnitStatus | undefined): boolean {
  return !!status && (hasCondition(status, 'confusion') || hasCondition(status, 'freeze'));
}

/** unit の軍の退却先の拠点 */
export function retreatDestinations(state: BattleState, unit: UnitData): readonly RetreatDestination[] {
  return state.retreats[unit.team] ?? [];
}

/** ユニットを率いる騎士の名前（戦場からいなくなったユニットも引ける。騎士がいなければ undefined） */
export function leaderOf(state: BattleState, unit: UnitData): string | undefined {
  return state.statuses.get(unit)?.name ?? state.goneLeaders.get(unit);
}

/** TURN_ORDER で after の次の、部隊のいる軍（after = null なら最初の軍。どの軍にも部隊がいなければ after のまま） */
export function nextTeam(state: BattleState, after: TeamId | null): TeamId {
  const teams = new Set(state.map.allUnits().map((u) => u.team));
  const start = after === null ? -1 : TURN_ORDER.indexOf(after);
  for (let i = 1; i <= TURN_ORDER.length; i++) {
    const team = TURN_ORDER[(start + i) % TURN_ORDER.length];
    if (teams.has(team)) return team;
  }
  return after ?? TURN_ORDER[0];
}

/** 戦場からユニットを除く（騎士の名前は記録に残す） */
export function removeUnits(state: BattleState, units: readonly UnitData[]): void {
  for (const u of units) {
    state.map.removeUnit(u.col, u.row);
    const leader = state.statuses.get(u)?.name;
    if (leader) state.goneLeaders.set(u, leader);
    state.statuses.delete(u);
  }
}

/** 軍団長の部隊がいなくなったら、その陣営の負けにする（もう負けていればそのまま） */
export function markFallen(state: BattleState, unit: UnitData, status: UnitStatus, reason: CommanderLoss['reason']): void {
  const side = sideOf(unit.team);
  if (status.commander && side && !state.fallen.has(side)) state.fallen.set(side, { unit, reason });
}
