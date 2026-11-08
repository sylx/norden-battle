/**
 * CPU の打ち手（engine/sim.ts の Player）。BattleApp の CPU の番・描画なしの対戦シミュレータの両方で使う。
 *
 * - 配備（deploy）: 兵種に合わせて前後を考えて置く（deploy.ts。CpuFeatures.deploy を切ると自動配置）
 * - 番の初め（beginTurn）: 戦況が動いていない番の数を数え（膠着したら前のめりにする）、部隊のいる HEX を覚える（次の番に往復しない）。
 *   軍の作戦を立てる（strategy.ts。拠点の守りの部隊・負けを認めるか）
 * - 動かす順（order）: 前に出る兵種（射程の無い兵種）を先に、射程のある兵種を後に、軍団長の部隊を最後に。同じ組では敵に近い部隊から
 *   （前の部隊が道を空け、敵を削ってから後ろの部隊が撃つ）。負けを認めそうなら軍団長の部隊が最初（退却して戦闘を終える）
 * - 強制退却の退却先は最初の拠点
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { TeamId, UnitData } from '@norden/map-runtime/core/units';
import { COMBAT_DEFS, hexDistance } from '../combat';
import type { Player } from '../engine/sim';
import { retreatDestinations, type BattleState } from '../engine/state';
import { decide, type Mood } from './decide';
import { deployTroops } from './deploy';
import { chooseGarrison, planTeam } from './strategy';
import { featuresOf, type CpuOptions } from './types';
import { CONCEDE_RATIO, CONCEDE_STALL, CONCEDE_STALL_RATIO } from './weights';

/** CPU の打ち手を作る（同じ打ち手をいくつの戦闘に使ってもよい。戦闘ごとの様子は BattleState ごとに持つ） */
export function cpuPlayer(options: CpuOptions): Player {
  const features = featuresOf(options);
  /** 戦闘・軍ごとの、前の番の初めの盤面の兵数の合計・戦況が動いていない番の数・部隊のいた HEX */
  const moods = new WeakMap<BattleState, Map<TeamId, { total: number; mood: Mood; at: Map<UnitData, Offset> }>>();
  const moodOf = (state: BattleState): Mood => {
    const mood = moods.get(state)?.get(state.activeTeam)?.mood ?? { urgency: 0 };
    // 拠点の守りの部隊がいなくなったら選び直す
    const team = mood.team;
    if (team?.garrison && !state.statuses.has(team.garrison)) team.garrison = chooseGarrison(state, state.activeTeam);
    return mood;
  };
  return {
    deploy: (state, deployment) => (features.deploy ? deployTroops(state, deployment) : deployment.auto()),
    beginTurn: (state) => {
      let teams = moods.get(state);
      if (!teams) moods.set(state, (teams = new Map()));
      const total = [...state.statuses.values()].reduce((sum, s) => sum + s.soldiers, 0);
      const prev = teams.get(state.activeTeam);
      const at = new Map(state.map.allUnits().filter((u) => u.team === state.activeTeam).map((u): [UnitData, Offset] => [u, { col: u.col, row: u.row }]));
      const mood: Mood = { urgency: prev && prev.total === total ? prev.mood.urgency + 1 : 0, previous: prev?.at };
      if (features.strategy) mood.team = planTeam(state, state.activeTeam);
      teams.set(state.activeTeam, { total, at, mood });
    },
    decide: (state, unit) => decide(state, unit, options, moodOf(state)),
    order: (state, units) => {
      // 負けを認めそうなら、軍団長の部隊を最初に動かす（ほかの部隊が動く前に退却して戦闘を終える）
      const mood = moodOf(state);
      const ratio = mood.team?.concede ?? 0;
      return orderUnits(state, units, ratio >= CONCEDE_RATIO || (ratio >= CONCEDE_STALL_RATIO && mood.urgency >= CONCEDE_STALL));
    },
    routTo: (state, unit) => retreatDestinations(state, unit)[0],
  };
}

/** 動かす順に並べる（concede なら軍団長の部隊を最初に） */
export function orderUnits(state: BattleState, units: readonly UnitData[], concede = false): UnitData[] {
  const group = (u: UnitData) => {
    const commander = !!state.statuses.get(u)?.commander;
    if (commander) return concede ? -1 : 2;
    return COMBAT_DEFS[u.type].ranged ? 1 : 0;
  };
  const enemies = state.map.allUnits().filter((e) => units.length > 0 && e.team !== units[0].team);
  const near = (u: UnitData) => (enemies.length > 0 ? Math.min(...enemies.map((e) => hexDistance(state.map, u, e))) : 0);
  return [...units].sort((a, b) => group(a) - group(b) || near(a) - near(b));
}
