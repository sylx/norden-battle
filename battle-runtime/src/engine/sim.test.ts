/**
 * 描画なしの 1 戦（engine/sim.ts）のテスト。ランダムに行動する仮の打ち手どうしで最後まで回し、
 * シードが同じなら同じ結果になること、止まらずに終わることを確かめる。
 * 結果はスナップショットに残し、以後の作り替えで戦闘の決まりが変わっていないことを確かめる（変わるときは理由を確かめて更新する）。
 */
import { describe, expect, it } from 'vitest';
import type { UnitData } from '@norden/map-runtime/core/units';
import { scenario } from '../test/scenario';
import { seededRng } from './rng';
import { randomPlayer, runBattle } from './sim';

/** 1 戦の結果を比べられる形にまとめる */
function play(seed: number) {
  const state = scenario();
  const result = runBattle(state, { players: { red: randomPlayer, blue: randomPlayer }, rng: seededRng(seed), playerRng: seededRng(seed * 7919 + 1), maxTurns: 30 });
  const unitText = (u: UnitData) => `${u.team}:${u.type}`;
  return {
    winner: result.outcome?.winner ?? null,
    reason: result.outcome?.reason ?? null,
    turn: result.turn,
    actions: result.actions,
    remaining: state.map
      .allUnits()
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((u) => `${unitText(u)}@${u.col},${u.row} ${state.statuses.get(u)!.soldiers}`),
    retreated: state.retreated.map((r) => `${unitText(r.unit)} t${r.turn}${r.captured ? ' 捕縛' : ''}${r.forced ? ' 強制' : ''}`),
    wipedOut: state.wipedOut.map((w) => `${unitText(w.unit)} t${w.turn}${w.captured ? ' 捕縛' : ''}`),
    captives: result.outcome?.captives?.length ?? 0,
  };
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

describe('描画なしの 1 戦', () => {
  it('シードが同じなら同じ結果になる', () => {
    for (const seed of SEEDS) expect(play(seed)).toEqual(play(seed));
  });

  it('シードが違えば結果も変わる', () => {
    const results = new Set(SEEDS.map((seed) => JSON.stringify(play(seed))));
    expect(results.size).toBeGreaterThan(1);
  });

  it('ターンの上限までに止まらずに終わる', () => {
    for (const seed of SEEDS) {
      const r = play(seed);
      expect(r.turn).toBeLessThanOrEqual(30);
      expect(r.actions).toBeGreaterThan(0);
    }
  });

  it('結果（スナップショット）', () => {
    expect(SEEDS.map(play)).toMatchSnapshot();
  });
});
