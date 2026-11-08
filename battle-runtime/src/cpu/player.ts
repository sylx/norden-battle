/**
 * CPU の打ち手（engine/sim.ts の Player）。BattleApp の CPU の番・描画なしの対戦シミュレータの両方で使う。
 *
 * - 動かす順（order）: 前に出る兵種（射程の無い兵種）を先に、射程のある兵種を後に、軍団長の部隊を最後に。同じ組では敵に近い部隊から
 *   （前の部隊が道を空け、敵を削ってから後ろの部隊が撃つ）
 * - 番の初め（beginTurn）: 戦況が動いていない番の数を数え（膠着したら前のめりにする）、部隊のいる HEX を覚える（次の番に往復しない。decide.ts の Mood）。軍の作戦は段階 2
 * - 強制退却の退却先は最初の拠点
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { TeamId, UnitData } from '@norden/map-runtime/core/units';
import { COMBAT_DEFS, hexDistance } from '../combat';
import type { Player } from '../engine/sim';
import { retreatDestinations, type BattleState } from '../engine/state';
import { decide, type Mood } from './decide';
import type { CpuOptions } from './types';

/** CPU の打ち手を作る（同じ打ち手をいくつの戦闘に使ってもよい。戦闘ごとの様子は BattleState ごとに持つ） */
export function cpuPlayer(options: CpuOptions): Player {
  /** 戦闘・軍ごとの、前の番の初めの盤面の兵数の合計・戦況が動いていない番の数・部隊のいた HEX */
  const moods = new WeakMap<BattleState, Map<TeamId, { total: number; mood: Mood; at: Map<UnitData, Offset> }>>();
  const moodOf = (state: BattleState): Mood => moods.get(state)?.get(state.activeTeam)?.mood ?? { urgency: 0 };
  return {
    beginTurn: (state) => {
      let teams = moods.get(state);
      if (!teams) moods.set(state, (teams = new Map()));
      const total = [...state.statuses.values()].reduce((sum, s) => sum + s.soldiers, 0);
      const prev = teams.get(state.activeTeam);
      const at = new Map(state.map.allUnits().filter((u) => u.team === state.activeTeam).map((u): [UnitData, Offset] => [u, { col: u.col, row: u.row }]));
      teams.set(state.activeTeam, { total, at, mood: { urgency: prev && prev.total === total ? prev.mood.urgency + 1 : 0, previous: prev?.at } });
    },
    decide: (state, unit) => decide(state, unit, options, moodOf(state)),
    order: (state, units) => orderUnits(state, units),
    routTo: (state, unit) => retreatDestinations(state, unit)[0],
  };
}

/** 動かす順に並べる */
export function orderUnits(state: BattleState, units: readonly UnitData[]): UnitData[] {
  const group = (u: UnitData) => (state.statuses.get(u)?.commander ? 2 : COMBAT_DEFS[u.type].ranged ? 1 : 0);
  const enemies = state.map.allUnits().filter((e) => units.length > 0 && e.team !== units[0].team);
  const near = (u: UnitData) => (enemies.length > 0 ? Math.min(...enemies.map((e) => hexDistance(state.map, u, e))) : 0);
  return [...units].sort((a, b) => group(a) - group(b) || near(a) - near(b));
}
