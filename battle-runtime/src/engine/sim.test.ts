/**
 * 描画なしの 1 戦（engine/sim.ts）のテスト。ランダムに行動する仮の打ち手どうしで最後まで回し、
 * シードが同じなら同じ結果になること、止まらずに終わることを確かめる。
 * 結果はスナップショットに残し、以後の作り替えで戦闘の決まりが変わっていないことを確かめる（変わるときは理由を確かめて更新する）。
 */
import { describe, expect, it } from 'vitest';
import type { UnitData } from '@norden/map-runtime/core/units';
import { place, testMap } from '../test/fixtures';
import { battle } from '../test/engine';
import { seededRng } from './rng';
import { randomPlayer, runBattle } from './sim';
import type { BattleState } from './state';

/** 防衛側（赤）が拠点と城を守り、攻撃側（青）が東から攻める 14 × 9 のマップ */
function scenario(): BattleState {
  const map = testMap(14, 9, [
    { col: 2, row: 4, feature: 'castle' },
    { col: 3, row: 4, feature: 'castle' },
    { col: 2, row: 3, feature: 'castle' },
    { col: 6, row: 2, terrain: 'forest' },
    { col: 6, row: 3, terrain: 'forest' },
    { col: 7, row: 6, terrain: 'forest' },
    { col: 8, row: 4, terrain: 'hills' },
  ]);
  const red = (type: Parameters<typeof place>[1], col: number, row: number) => place(map, type, 'red', col, row);
  const blue = (type: Parameters<typeof place>[1], col: number, row: number) => place(map, type, 'blue', col, row);
  const units: (UnitData | [UnitData, object])[] = [
    [red('infantry', 3, 4), { commander: true, name: '赤の軍団長', skills: ['inspire'] }],
    red('archer', 2, 3),
    red('rifleman', 4, 5),
    [red('wizard', 2, 4), { spells: ['frostNova', 'earthSpike'] }],
    red('cavalry', 4, 2),
    red('landsknecht', 5, 4),
    [blue('infantry', 12, 4), { commander: true, name: '青の軍団長', skills: ['inspire'] }],
    blue('cavalry', 11, 2),
    blue('cavalry', 11, 6),
    blue('artillery', 13, 3),
    [blue('mage', 12, 6), { spells: ['meteorFall'] }],
    blue('dragon', 10, 4),
  ];
  return battle(map, units as Parameters<typeof battle>[1], {
    stronghold: { col: 2, row: 4 },
    retreats: { red: [{ id: 'r', name: '赤の後方' }], blue: [{ id: 'b', name: '青の後方' }] },
    facilities: { defender: { fortressCannon: { interval: 2 }, ballista: true } },
  });
}

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
