/**
 * CPU の思考（cpu/）のテスト。描画なしで戦わせて、ランダムな打ち手にはっきり勝ち越すこと・CPU どうしで最後まで戦えること・
 * シードが同じなら同じ結果になることを確かめる。手の細かい強さはシミュレータ（npm run sim）で見る。
 */
import { describe, expect, it } from 'vitest';
import type { UnitData } from '@norden/map-runtime/core/units';
import { place, status, testMap } from '../test/fixtures';
import { battle } from '../test/engine';
import { scenario } from '../test/scenario';
import { hexDistance, splashUnits } from '../combat';
import { Deployment, type Troop } from '../deployment';
import { runAction } from '../engine/action';
import { planPos } from '../engine/plan';
import { seededRng } from '../engine/rng';
import { randomPlayer, runBattle, type Player } from '../engine/sim';
import { judge } from '../engine/turn';
import { walkIntercepts } from './danger';
import { candidates, decide, type Mood } from './decide';
import { deployTroops } from './deploy';
import { cpuPlayer } from './player';
import { planTeam } from './strategy';
import { BASIC_FEATURES } from './types';

const cpu = cpuPlayer({ difficulty: 'normal' });
/** 段階 1 の CPU */
const basic = cpuPlayer({ difficulty: 'normal', features: BASIC_FEATURES });
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

  it('段階 1 の CPU より強い（防衛側でも攻撃側でも、段階 1 どうしより勝つ）', () => {
    // この場面は攻撃側が有利（段階 1 どうしで攻撃側が 9 割勝つ）。勝ち越しはシミュレータで、いろいろなマップで確かめる
    const wins = (red: Player, blue: Player, side: 'attacker' | 'defender') => SEEDS.filter((seed) => play(red, blue, seed).winner === side).length;
    expect(wins(cpu, basic, 'defender')).toBeGreaterThanOrEqual(wins(basic, basic, 'defender') + 2);
    expect(wins(basic, cpu, 'attacker')).toBeGreaterThanOrEqual(wins(basic, basic, 'attacker'));
  }, 60_000);
});

/** 段階 2: すべての行動と軍の作戦 */
describe('CPU（段階 2）', () => {
  const normal = { difficulty: 'normal' as const };
  /** 軍の作戦を立てた様子 */
  const moodOf = (state: Parameters<typeof planTeam>[0], team: UnitData['team']): Mood => ({ urgency: 0, team: planTeam(state, team) });

  it('範囲攻撃で軍団長の部隊を巻き込まない', () => {
    const map = testMap(12, 7);
    const wizard = place(map, 'wizard', 'red', 1, 3);
    const enemy = place(map, 'infantry', 'blue', 5, 3);
    const commander = place(map, 'infantry', 'red', 6, 3);
    const state = battle(map, [[wizard, { spells: ['meteorFall'] }], enemy, [commander, { commander: true }]]);
    const d = decide(state, wizard, normal)!;
    if (d.plan.attack) expect(splashUnits(map, wizard, planPos(d.plan), d.plan.attack.target, d.plan.attack.at, d.plan.attack.id)).not.toContain(commander);
  });

  it('隣に味方がいれば乱撃を使わない', () => {
    const map = testMap();
    const lk = place(map, 'landsknecht', 'red', 3, 3);
    const enemy = place(map, 'infantry', 'blue', 4, 3);
    const ally = place(map, 'archer', 'red', 2, 3);
    const state = battle(map, [lk, enemy, ally]);
    const d = decide(state, lk, normal)!;
    expect(d.plan.attack?.id).not.toBe('rampage');
  });

  it('攻撃側は防衛拠点に入れるなら入って行動を終える（入城）', () => {
    const map = testMap();
    const hold = { col: 2, row: 3 };
    const unit = place(map, 'infantry', 'blue', 4, 3);
    const guard = place(map, 'infantry', 'red', 1, 1);
    const state = battle(map, [unit, guard], { stronghold: hold });
    state.activeTeam = 'blue';
    state.statuses.get(unit)!.atStronghold = true;
    state.statuses.get(unit)!.atCastle = true;
    const d = decide(state, unit, normal, moodOf(state, 'blue'))!;
    expect(planPos(d.plan)).toMatchObject(hold);
    const done = runAction(state, d.plan, d.end, d.to, seededRng(1))!;
    const r = judge(state, done.finished.ended);
    expect(r.kind).toBe('end');
    expect(state.outcome?.reason).toBe('stronghold');
  });

  it('防衛側は空いた拠点の隣に敵が来たら拠点を塞ぐ', () => {
    const map = testMap();
    const hold = { col: 2, row: 3 };
    const archer = place(map, 'archer', 'red', 1, 5);
    const enemy = place(map, 'infantry', 'blue', 3, 3);
    const state = battle(map, [archer, [enemy, { soldiers: 1500 }]], { stronghold: hold });
    const d = decide(state, archer, normal, moodOf(state, 'red'))!;
    expect(planPos(d.plan)).toMatchObject(hold);
  });

  it('撃てる敵がいない間接の兵種は、迎撃の構えで待つ', () => {
    const map = testMap(14, 7);
    const archer = place(map, 'archer', 'red', 2, 3);
    const enemy = place(map, 'infantry', 'blue', 9, 3);
    const state = battle(map, [archer, enemy]);
    const d = decide(state, archer, normal)!;
    expect(d.plan.attack).toBeNull();
    expect(d.end).toBe('intercept');
  });

  it('することが無く士気が低ければ鼓舞する', () => {
    const map = testMap(14, 7);
    const unit = place(map, 'infantry', 'red', 2, 3);
    const enemy = place(map, 'infantry', 'blue', 12, 3);
    const state = battle(map, [[unit, { morale: 30, skills: ['inspire'] }], enemy]);
    expect(decide(state, unit, normal)!.end).toBe('inspire');
  });

  it('兵が減って、どこへ動いても殲滅されそうな部隊は退却する', () => {
    const map = testMap();
    const unit = place(map, 'infantry', 'red', 3, 3);
    const foes = [place(map, 'cavalry', 'blue', 5, 2), place(map, 'cavalry', 'blue', 5, 4), place(map, 'infantry', 'blue', 6, 3)];
    const state = battle(map, [[unit, { soldiers: 40 }], ...foes], { retreats: { red: [{ id: 'r', name: '赤の後方' }] } });
    state.statuses.get(unit)!.initialSoldiers = 500;
    const d = decide(state, unit, normal)!;
    expect(d.end).toBe('retreat');
    expect(d.to?.id).toBe('r');
  });

  it('数で大きく劣り、軍団長の部隊が殲滅されそうなら、退却して負けを認める', () => {
    const map = testMap();
    const commander = place(map, 'infantry', 'red', 3, 3);
    const foes = [place(map, 'cavalry', 'blue', 5, 2), place(map, 'cavalry', 'blue', 5, 4), place(map, 'infantry', 'blue', 6, 3), place(map, 'infantry', 'blue', 6, 5)];
    const state = battle(map, [[commander, { soldiers: 60, commander: true }], ...foes], { retreats: { red: [{ id: 'r', name: '赤の後方' }] } });
    state.statuses.get(commander)!.initialSoldiers = 1000;
    const mood = moodOf(state, 'red');
    expect(mood.team?.concede).toBeGreaterThanOrEqual(4);
    expect(decide(state, commander, normal, mood)!.end).toBe('retreat');
    // 数で劣っていても、殲滅されそうでなければ（敵が遠い）ふつうに戦う
    for (const f of foes) map.moveUnit(f, f.col + 2, f.row);
    expect(decide(state, commander, normal, moodOf(state, 'red'))!.end).not.toBe('retreat');
  });

  it('迎撃の構えの弓兵の射程に入ると、そこで足止めされると見込む', () => {
    const map = testMap(12, 7);
    const unit = place(map, 'infantry', 'red', 1, 3);
    const archer = place(map, 'archer', 'blue', 6, 3);
    const state = battle(map, [unit, archer]);
    state.statuses.get(archer)!.intercepting = true;
    const step = candidates(state, unit).find((c) => c.step && c.step.col === 5 && c.step.row === 3)!.step!;
    const w = walkIntercepts(state, unit, state.statuses.get(unit)!, step);
    expect(w.haltAt).toEqual({ col: 4, row: 3 });
    expect(w.damage).toBeGreaterThan(0);
  });

  it('配備: 前に出る兵種を敵の側に、射程のある兵種をその後ろに、軍団長をさらに後ろに置く', () => {
    const map = testMap(12, 7);
    const attackerSlots = [0, 1, 2].flatMap((col) => [1, 2, 3, 4, 5].map((row) => ({ col, row })));
    const deploy = { defender: [{ col: 10, row: 3 }], attacker: attackerSlots };
    const statuses = new Map();
    const troop = (id: string, type: Troop['type'], commander = false): Troop => ({ id, side: 'attacker', type, status: status(type, { commander }) });
    const troops = [troop('c', 'infantry', true), troop('a', 'archer'), troop('m', 'mage'), troop('k', 'cavalry'), troop('i', 'infantry')];
    const state = battle(map, [], { stronghold: { col: 11, row: 3 } });
    state.statuses = statuses;
    const deployment = new Deployment(map, deploy, troops, statuses);
    deployTroops(state, deployment);
    const at = deployment.state()!.placed;
    const col = (id: string) => at.get(id)!.col;
    expect(at.size).toBe(5);
    expect(Math.min(col('k'), col('i'))).toBeGreaterThan(Math.max(col('a'), col('m')) - 1);
    expect(col('c')).toBeLessThan(Math.min(col('k'), col('i')));
    expect(hexDistance(map, at.get('m')!, { col: 11, row: 3 })).toBeGreaterThanOrEqual(hexDistance(map, at.get('a')!, { col: 11, row: 3 }));
  });
});
