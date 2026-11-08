/**
 * CPU の思考（cpu/）のテスト。描画なしで戦わせて、ランダムな打ち手にはっきり勝ち越すこと・CPU どうしで最後まで戦えること・
 * シードが同じなら同じ結果になることを確かめる。手の細かい強さはシミュレータ（npm run sim）で見る。
 */
import { describe, expect, it } from 'vitest';
import { place, testMap } from '../test/fixtures';
import { battle } from '../test/engine';
import { scenario } from '../test/scenario';
import { seededRng } from '../engine/rng';
import { randomPlayer, runBattle, type Player } from '../engine/sim';
import { candidates, decide } from './decide';
import { cpuPlayer } from './player';

const cpu = cpuPlayer({ difficulty: 'normal' });
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function play(red: Player, blue: Player, seed: number) {
  const state = scenario();
  const r = runBattle(state, { players: { red, blue }, rng: seededRng(seed), playerRng: seededRng(seed + 99), maxTurns: 30 });
  return { winner: r.outcome?.winner ?? null, reason: r.outcome?.reason ?? null, turn: r.turn, actions: r.actions };
}

describe('CPU', () => {
  it('防衛側の CPU はランダムな打ち手に勝ち越す', () => {
    const wins = SEEDS.filter((seed) => play(cpu, randomPlayer, seed).winner === 'defender').length;
    expect(wins).toBeGreaterThanOrEqual(8);
  });

  it('攻撃側の CPU はランダムな打ち手に勝ち越す', () => {
    const wins = SEEDS.filter((seed) => play(randomPlayer, cpu, seed).winner === 'attacker').length;
    expect(wins).toBeGreaterThanOrEqual(8);
  });

  it('CPU どうしで最後まで戦い、シードが同じなら同じ結果になる', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const a = play(cpu, cpu, seed);
      expect(a.winner).not.toBeNull();
      expect(play(cpu, cpu, seed)).toEqual(a);
    }
  });

  it('殲滅できる相手を攻撃する', () => {
    const map = testMap();
    const a = place(map, 'infantry', 'red', 3, 3);
    const weak = place(map, 'infantry', 'blue', 4, 3);
    place(map, 'infantry', 'blue', 4, 4);
    const state = battle(map, [a, [weak, { soldiers: 20 }], map.unitAt(4, 4)!]);
    const d = decide(state, a, { difficulty: 'normal' })!;
    expect(d.plan.attack?.target).toBe(weak);
  });

  it('射程のある兵種は敵の隣で撃たない（離れてから撃つ）', () => {
    const map = testMap();
    const archer = place(map, 'archer', 'red', 3, 3);
    const enemy = place(map, 'infantry', 'blue', 4, 3);
    const state = battle(map, [archer, enemy]);
    const best = candidates(state, archer).sort((x, y) => y.score - x.score)[0];
    expect(best.attack).not.toBeNull();
    const pos = best.step ?? archer;
    expect(Math.abs(pos.col - enemy.col) + Math.abs(pos.row - enemy.row)).toBeGreaterThan(1);
  });
});
