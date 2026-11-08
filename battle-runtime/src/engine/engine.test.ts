/**
 * engine（行動の実行・番の始まりと終わり・施設・決着）のテスト。
 * M008 で BattleApp（app.ts）から処理を抜き出す前の振る舞い（app.ts の execute 〜 finish・startTeamTurn 〜 passTurn・judge）を、
 * 決まった乱数で 1 つずつ固定する。期待値はルールの関数（attackResult など）から求める。乱数は値だけでなく引く回数も確かめる。
 */
import { describe, expect, it } from 'vitest';
import { attackResult, facilityResult, mightOf, splashResult, splashUnits } from '../combat';
import { moraleChange, applyMorale } from '../morale';
import { moveRange } from '../movement';
import type { UnitData } from '@norden/map-runtime/core/units';
import type { TroopInit, UnitStatus } from '../unitStatus';
import { place, testMap } from '../test/fixtures';
import { battle, HIT, MISS, moveLeg, planAttack, planMoves, scripted } from '../test/engine';
import { afterStrike, beginAction, finishAction, nextPhase, resolveStrike, runAction } from './action';
import { isDone, newPlan } from './plan';
import { locked } from './state';
import { confusedPlan, confusedUnits, endTeamTurn, facilityTarget, facilityTargets, fireFacility, firingFacilities, judge, nextRoutUnit, passTurn, startBattle, startTeamTurn } from './turn';

/** 乱数の値 0.75・0.5・0.25 は、ランダム係数 0.5・0・−0.5 */
const ROLL_HI = 0.75;
const ROLL_MID = 0.5;
const ROLL_LO = 0.25;

const clone = (s: UnitStatus): UnitStatus => structuredClone(s);
const moraleAfter = (s: UnitStatus, delta: number) => {
  const c = clone(s);
  applyMorale(c, delta);
  return c.morale;
};

describe('移動', () => {
  it('予約した HEX へ移動を確定し、使った行動力を引く（乱数は引かない）', () => {
    const map = testMap();
    const inf = place(map, 'infantry', 'red', 2, 3);
    const state = battle(map, [inf]);
    const rng = scripted();
    const { report } = runAction(state, planMoves(state, inf, { col: 4, row: 3 }), 'confirm', undefined, rng)!;
    const s = state.statuses.get(inf)!;
    expect(map.unitAt(4, 3)).toBe(inf);
    expect([inf.col, inf.row]).toEqual([4, 3]);
    expect(s.moved).toBe(true);
    expect(report.moveCost).toBe(2);
    expect(s.ap).toBe(s.maxAp - 2);
    expect(rng.used).toBe(0);
  });

  it('予約が無ければ決定できない', () => {
    const map = testMap();
    const inf = place(map, 'infantry', 'red', 2, 3);
    const state = battle(map, [inf]);
    expect(beginAction(state, newPlan(state, inf)!, 'confirm', undefined, scripted())).toBeNull();
  });
});

describe('攻撃', () => {
  it('攻撃と反撃（攻撃・反撃の順にランダム係数を引く）', () => {
    const map = testMap();
    const a = place(map, 'infantry', 'red', 3, 3);
    const d = place(map, 'infantry', 'blue', 4, 3);
    const state = battle(map, [a, d]);
    const sa = state.statuses.get(a)!;
    const sd = state.statuses.get(d)!;
    const exp = attackResult(map, { unit: a, status: clone(sa), pos: a }, { unit: d, status: clone(sd), pos: d }, 'attack', { damage: 0.5, counter: -0.5 });
    const ma = moraleAfter(sa, exp.morale.attacker);
    const md = moraleAfter(sd, exp.morale.defender);
    const rng = scripted(ROLL_HI, ROLL_LO);
    const { report } = runAction(state, planAttack(state, newPlan(state, a)!, 'attack', d), 'confirm', undefined, rng)!;
    expect(exp.damage).toBeGreaterThan(0);
    expect(exp.counter).toBeGreaterThan(0);
    expect(sd.soldiers).toBe(500 - exp.damage);
    expect(sa.soldiers).toBe(500 - exp.counter);
    expect(sa.morale).toBe(ma);
    expect(sd.morale).toBe(md);
    expect(sa.attacked && sa.justAttacked).toBe(true);
    expect(sa.ap).toBe(sa.maxAp - 2);
    expect(report.attack?.result).toEqual(exp);
    expect(rng.used).toBe(2);
  });

  it('殲滅されたユニットは行動の終わりまで盤面に残り、指揮官の捕縛は隣接する敵の数で決まる', () => {
    const map = testMap();
    const a = place(map, 'infantry', 'red', 3, 3);
    const d = place(map, 'infantry', 'blue', 4, 3);
    const state = battle(map, [a, [d, { soldiers: 5, name: 'ディー', commander: true }]]);
    startBattle(state);
    const rng = scripted(ROLL_MID, ROLL_MID, HIT);
    const run = beginAction(state, planAttack(state, newPlan(state, a)!, 'attack', d), 'confirm', undefined, rng)!;
    expect(nextPhase(state, run).phase?.kind).toBe('strike');
    const r = resolveStrike(state, run, rng);
    expect(r.targetDestroyed).toBe(true);
    expect(map.unitAt(4, 3)).toBe(d);
    expect(run.report.wipeouts).toMatchObject([{ unit: d, by: a, enemies: 1, captureChance: 0.3, captured: true, to: null }]);
    afterStrike(state, run);
    expect(nextPhase(state, run).phase).toBeNull();
    const fin = finishAction(state, run, rng);
    expect(fin.removed).toEqual([d]);
    expect(map.unitAt(4, 3)).toBeUndefined();
    expect(state.statuses.has(d)).toBe(false);
    expect(state.goneLeaders.get(d)).toBe('ディー');
    expect(state.wipedOut).toHaveLength(1);
    expect(state.fallen.get('attacker')).toEqual({ unit: d, reason: 'commander' });
    expect(rng.used).toBe(3);
    // 攻撃側が全滅した
    expect(judge(state, fin.ended)).toMatchObject({ kind: 'end', outcome: { winner: 'defender', reason: 'eliminated' } });
  });

  it('捕縛されなければ軍の最初の退却先へ落ち延びる', () => {
    const map = testMap();
    const a = place(map, 'infantry', 'red', 3, 3);
    const d = place(map, 'infantry', 'blue', 4, 3);
    const to = { id: 'b1', name: '青の拠点' };
    const state = battle(map, [a, [d, { soldiers: 5 }]], { retreats: { blue: [to] } });
    runAction(state, planAttack(state, newPlan(state, a)!, 'attack', d), 'confirm', undefined, scripted(ROLL_MID, ROLL_MID, MISS));
    expect(state.wipedOut[0]).toMatchObject({ captured: false, to });
  });

  it('一斉攻撃は、目標に隣接する味方が加わる', () => {
    const map = testMap();
    const a = place(map, 'infantry', 'red', 3, 3);
    place(map, 'infantry', 'red', 4, 2);
    const d = place(map, 'infantry', 'blue', 4, 3);
    const state = battle(map, map.allUnits());
    const { report } = runAction(state, planAttack(state, newPlan(state, a)!, 'volley', d), 'confirm', undefined, scripted(ROLL_MID, ROLL_MID))!;
    expect(report.attack?.result?.supporters).toBe(1);
    expect(state.statuses.get(a)!.ap).toBe(0);
  });

  it('突撃は相手を突き抜けて向こうの HEX へ飛び出る', () => {
    const map = testMap();
    const c = place(map, 'cavalry', 'red', 2, 3);
    const d = place(map, 'infantry', 'blue', 3, 3);
    const state = battle(map, [c, d]);
    const plan = planAttack(state, newPlan(state, c)!, 'charge', d);
    expect(plan.attack?.landing).toEqual({ col: 4, row: 3 });
    runAction(state, plan, 'confirm', undefined, scripted(ROLL_MID, ROLL_MID));
    expect(map.unitAt(4, 3)).toBe(c);
    expect(state.statuses.get(c)!.moved).toBe(true);
  });

  it('乱撃: 周りの敵・味方に巻き添えで当たり、敵に与えた分で士気が上がる。クールタイムは 1 多く入れる', () => {
    const map = testMap();
    const l = place(map, 'landsknecht', 'red', 4, 3);
    const ally = place(map, 'infantry', 'red', 3, 3);
    const enemy = place(map, 'infantry', 'blue', 5, 3);
    const state = battle(map, [l, ally, enemy]);
    const sl = state.statuses.get(l)!;
    const hits = splashUnits(map, l, l, null, l, 'rampage');
    expect(new Set(hits)).toEqual(new Set([ally, enemy]));
    const dmg = (u: typeof ally) => splashResult(map, { unit: l, status: clone(sl), pos: l }, { unit: u, status: clone(state.statuses.get(u)!), pos: u }, 'rampage', 0).damage;
    const dealt = dmg(enemy);
    const allyDmg = dmg(ally);
    const morale = moraleAfter(sl, moraleChange(dealt, 0, mightOf(l, sl), 50).attacker);
    const rng = scripted(ROLL_MID, ROLL_MID, ROLL_MID, ROLL_MID);
    const { report } = runAction(state, planAttack(state, newPlan(state, l)!, 'rampage', l), 'confirm', undefined, rng)!;
    expect(rng.used).toBe(4);
    expect(report.attack?.result).toBeNull();
    expect(report.attack?.splash.map((h) => [h.unit, h.friendly])).toEqual(hits.map((u) => [u, u === ally]));
    expect(state.statuses.get(ally)!.soldiers).toBe(500 - allyDmg);
    expect(state.statuses.get(enemy)!.soldiers).toBe(500 - dealt);
    expect(sl.morale).toBe(morale);
    expect(sl.cooldowns.rampage).toBe(2);
    startTeamTurn(state, 'red');
    expect(sl.cooldowns.rampage).toBe(1);
    startTeamTurn(state, 'red');
    expect(sl.cooldowns.rampage).toBeUndefined();
  });

  it('アーススパイクは空いた HEX を狙っても撃て、そこを耕す', () => {
    const map = testMap(9, 7, [{ col: 4, row: 3, terrain: 'forest' }]);
    const w = place(map, 'wizard', 'red', 2, 3);
    const state = battle(map, [[w, { spells: ['earthSpike'] }]]);
    const { report } = runAction(state, planAttack(state, newPlan(state, w)!, 'earthSpike', { col: 4, row: 3 }), 'confirm', undefined, scripted(ROLL_MID, ROLL_MID))!;
    expect(report.attack?.target).toBeNull();
    expect(report.attack?.plowed).not.toBeNull();
    expect(map.get(4, 3)?.terrain).toBe('wasteland');
  });

  it('状態異常を付ける攻撃（フロストノヴァで凍結すると、その軍の番は行動できない）', () => {
    const map = testMap();
    const w = place(map, 'wizard', 'red', 2, 3);
    const d = place(map, 'infantry', 'blue', 4, 3);
    const state = battle(map, [[w, { spells: ['frostNova'] }], d]);
    const rng = scripted(ROLL_MID, ROLL_MID, HIT);
    runAction(state, planAttack(state, newPlan(state, w)!, 'frostNova', d), 'confirm', undefined, rng);
    const sd = state.statuses.get(d)!;
    expect(sd.conditions).toEqual([{ id: 'freeze', turns: 1 }]);
    expect(rng.used).toBe(3);
    state.activeTeam = 'blue';
    startTeamTurn(state, 'blue');
    expect(sd.ap).toBe(0);
    expect(locked(sd)).toBe(true);
    expect(isDone(state, d)).toBe(true);
    // 付いたユニットの軍の番が終わると残りターンが減る
    passTurn(state);
    expect(sd.conditions).toEqual([]);
  });
});

describe('迎撃', () => {
  /** 赤の歩兵（など）が (2,3) から (5,3) へ歩き、(6,3) で迎撃の構えの青の弓兵の射程（2）に (4,3) で入る */
  function setup(type: 'infantry' | 'cavalry' = 'infantry', soldiers = 500, ally = false) {
    const map = testMap();
    const mover = place(map, type, 'red', 2, 3);
    const archer = place(map, 'archer', 'blue', 6, 3);
    const units: (UnitData | [UnitData, Partial<TroopInit>])[] = [[mover, { soldiers }], archer];
    if (ally) units.push(place(map, 'infantry', 'red', 4, 3));
    const state = battle(map, units);
    state.statuses.get(archer)!.intercepting = true;
    const plan = planMoves(state, mover, { col: 5, row: 3 });
    return { map, mover, archer, state, plan };
  }

  it('弓兵の迎撃で足止めされ、残りの予約を捨てて行動を終える', () => {
    const { map, mover, archer, state, plan } = setup();
    const sm = state.statuses.get(mover)!;
    const sa = state.statuses.get(archer)!;
    const exp = attackResult(map, { unit: archer, status: clone(sa), pos: archer }, { unit: mover, status: clone(sm), pos: { col: 4, row: 3 } }, 'interceptFire', { damage: 0, counter: 0 });
    const rng = scripted(ROLL_MID);
    const { report } = runAction(state, plan, 'confirm', undefined, rng)!;
    expect(rng.used).toBe(1);
    expect(map.unitAt(4, 3)).toBe(mover);
    expect(report.halted).toBe(true);
    expect(report.intercepts).toMatchObject([{ unit: archer, halted: true, afterAttack: false, targetLeft: 500 - exp.damage }]);
    expect(sm.soldiers).toBe(500 - exp.damage);
    expect(sm.ap).toBe(0);
    expect(sa.intercepting).toBe(false);
  });

  it('味方のいる HEX で足止めされたら、通ってきた道を空いている HEX まで戻る', () => {
    const { map, mover, state, plan } = setup('infantry', 500, true);
    const ally = map.unitAt(4, 3)!;
    // いまの振る舞い: 撃たれた HEX にいる味方にも巻き添えで当たる（M008 の未決事項に記録。直すかは相談）
    const rng = scripted(ROLL_MID, ROLL_MID);
    const { report } = runAction(state, plan, 'confirm', undefined, rng)!;
    expect(rng.used).toBe(2);
    expect(report.intercepts[0].splash.map((h) => h.unit)).toEqual([ally]);
    expect(map.unitAt(3, 3)).toBe(mover);
  });

  it('騎兵は足止めされず、撃たれても続きを歩く', () => {
    const { map, mover, state, plan } = setup('cavalry');
    const { report } = runAction(state, plan, 'confirm', undefined, scripted(ROLL_MID))!;
    expect(report.halted).toBe(false);
    expect(report.intercepts).toHaveLength(1);
    expect(map.unitAt(5, 3)).toBe(mover);
  });

  it('迎撃で壊滅したら、撃たれた HEX で殲滅されてそこで打ち切る', () => {
    const { map, mover, state, plan } = setup('infantry', 3);
    const rng = scripted(ROLL_MID, MISS);
    const { report, finished } = runAction(state, plan, 'confirm', undefined, rng)!;
    expect(rng.used).toBe(2);
    expect(report.lost).toBe(true);
    expect(report.wipeouts).toMatchObject([{ unit: mover, enemies: 0, captureChance: 0.1, captured: false }]);
    expect(finished.removed).toEqual([mover]);
    expect(map.allUnits().includes(mover)).toBe(false);
  });
});

describe('行動の終わり方', () => {
  it('鼓舞は士気を 10〜20 回復し、行動力 2 を使う', () => {
    const map = testMap();
    const inf = place(map, 'infantry', 'red', 2, 3);
    const state = battle(map, [[inf, { skills: ['inspire'] }]]);
    const { report } = runAction(state, newPlan(state, inf)!, 'inspire', undefined, scripted(0))!;
    const s = state.statuses.get(inf)!;
    expect(report.inspire).toBe(10);
    expect(s.morale).toBe(60);
    expect(s.ap).toBe(s.maxAp - 2);
  });

  it('待機は残りの行動力を捨てる。迎撃の構えは行動を終えて構える', () => {
    const map = testMap();
    const inf = place(map, 'infantry', 'red', 2, 3);
    const archer = place(map, 'archer', 'red', 2, 5);
    const state = battle(map, [inf, archer]);
    runAction(state, planMoves(state, inf, { col: 3, row: 3 }), 'wait', undefined, scripted());
    expect(state.statuses.get(inf)!.ap).toBe(0);
    const { report } = runAction(state, newPlan(state, archer)!, 'intercept', undefined, scripted())!;
    expect(report.intercept).toBe(true);
    expect(state.statuses.get(archer)).toMatchObject({ intercepting: true, ap: 0 });
  });

  it('退却はターンの初めだけ。失敗すると捕虜。軍団長の退却で決着し、負けた陣営の残りは強制退却する', () => {
    const map = testMap();
    const cmd = place(map, 'infantry', 'red', 3, 3);
    const other = place(map, 'archer', 'red', 1, 1);
    const enemy = place(map, 'infantry', 'blue', 4, 3);
    const to = { id: 'r1', name: '赤の拠点' };
    const state = battle(map, [[cmd, { commander: true }], other, enemy], { retreats: { red: [to] } });
    startBattle(state);
    expect(state.activeTeam).toBe('red');
    // 移動を予約していると退却できない
    expect(beginAction(state, planMoves(state, cmd, { col: 2, row: 3 }), 'retreat', to, scripted())).toBeNull();
    const rng = scripted(HIT);
    const { report, finished } = runAction(state, newPlan(state, cmd)!, 'retreat', to, rng)!;
    expect(report.retreat).toMatchObject({ unit: cmd, to, enemies: 1, failChance: 0.1, captured: true, forced: false });
    expect(finished.removed).toEqual([cmd]);
    expect(state.retreated).toHaveLength(1);
    const j = judge(state, finished.ended);
    expect(j).toMatchObject({ kind: 'routStart', outcome: { winner: 'attacker', reason: 'commanderRetreat' }, units: [other] });
    // 強制退却（ターンの初めでなくても退却する）
    expect(nextRoutUnit(state)).toBe(other);
    state.statuses.get(other)!.ap = 0;
    const forced = runAction(state, newPlan(state, other)!, 'retreat', to, scripted(MISS))!;
    expect(forced.report.retreat).toMatchObject({ forced: true, captured: false, enemies: 0 });
    expect(judge(state, forced.finished.ended)).toEqual({ kind: 'rout' });
    expect(nextRoutUnit(state)).toBeNull();
    expect(state.outcome).toMatchObject({ winner: 'attacker', reason: 'commanderRetreat', remaining: [{ unit: enemy }], captives: [{ unit: cmd, cause: 'retreat' }] });
  });
});

describe('番', () => {
  it('番の初め: 行動力が戻り、入城の決まりの印を付け、魔導台は城の魔術師のクールタイムをさらに減らす', () => {
    const map = testMap(9, 7, [
      { col: 4, row: 3, feature: 'castle' },
      { col: 7, row: 1, feature: 'castle' },
    ]);
    const near = place(map, 'infantry', 'blue', 5, 3);
    const far = place(map, 'infantry', 'blue', 1, 5);
    const wiz = place(map, 'wizard', 'blue', 7, 1);
    const state = battle(map, [near, far, wiz], { stronghold: { col: 1, row: 4 }, facilities: { attacker: { magicTower: true } } });
    const sw = state.statuses.get(wiz)!;
    sw.cooldowns.thorHammer = 3;
    state.statuses.get(near)!.ap = 0;
    startTeamTurn(state, 'blue');
    expect(state.statuses.get(near)).toMatchObject({ ap: state.statuses.get(near)!.maxAp, atCastle: true, atStronghold: false });
    expect(state.statuses.get(far)).toMatchObject({ atCastle: false, atStronghold: true });
    expect(sw.cooldowns.thorHammer).toBe(1);
  });

  it('混乱したユニットは番の終わりにランダムな HEX へ動いて行動を終える', () => {
    const map = testMap();
    const u = place(map, 'infantry', 'red', 4, 3);
    const state = battle(map, [u]);
    const s = state.statuses.get(u)!;
    s.conditions = [{ id: 'confusion', turns: 1 }];
    expect(confusedUnits(state)).toEqual([u]);
    const first = [...moveRange(map, u, u, s.ap, { escapeZoc: true, castleLocked: false, strongholdLocked: null }).values()][0];
    const plan = confusedPlan(state, u, scripted(0))!;
    runAction(state, plan, 'wait', undefined, scripted());
    expect([u.col, u.row]).toEqual([first.col, first.row]);
    expect(s.ap).toBe(0);
  });

  it('要塞砲は拠点から射程以内で城にいない敵を撃つ', () => {
    const map = testMap(14, 7, [{ col: 5, row: 3, feature: 'castle' }]);
    const def = place(map, 'infantry', 'red', 3, 3);
    const near = place(map, 'infantry', 'blue', 6, 3);
    place(map, 'infantry', 'blue', 5, 3);
    place(map, 'infantry', 'blue', 13, 0);
    const state = battle(map, map.allUnits(), { stronghold: { col: 4, row: 3 }, facilities: { defender: { fortressCannon: { interval: 1 } } } });
    startBattle(state);
    expect(state.activeTeam).toBe('red');
    expect(endTeamTurn(state)).toEqual({ kind: 'none' });
    expect(firingFacilities(state)).toEqual({ side: 'defender', kinds: ['fortressCannon'] });
    expect(facilityTargets(state, 'fortressCannon', 'defender')).toEqual([near]);
    const target = facilityTarget(state, 'fortressCannon', 'defender', scripted(0))!;
    expect(target).toBe(near);
    const sn = state.statuses.get(near)!;
    const exp = facilityResult(map, 'fortressCannon', { unit: near, status: clone(sn), pos: near }, 0);
    const r = fireFacility(state, 'fortressCannon', 'defender', near, scripted(ROLL_MID));
    expect(r).toMatchObject({ kind: 'fortressCannon', side: 'defender', turn: 1, left: 500 - exp.damage, destroyed: false, wipeout: null });
    expect(def).toBeDefined();
  });

  it('番を回す: 防衛側 → 攻撃側で 1 ターン', () => {
    const map = testMap();
    place(map, 'infantry', 'red', 1, 1);
    place(map, 'infantry', 'blue', 7, 5);
    const state = battle(map, map.allUnits());
    startBattle(state);
    expect([state.turn, state.activeTeam]).toEqual([1, 'red']);
    passTurn(state);
    expect([state.turn, state.activeTeam]).toEqual([1, 'blue']);
    passTurn(state);
    expect([state.turn, state.activeTeam]).toEqual([2, 'red']);
  });
});

describe('決着', () => {
  it('攻撃側が防衛拠点で行動を終えたら入城（退却先が無ければすぐに終える）', () => {
    const map = testMap();
    const a = place(map, 'infantry', 'blue', 3, 3);
    place(map, 'infantry', 'red', 7, 5);
    const state = battle(map, map.allUnits(), { stronghold: { col: 4, row: 3 } });
    startBattle(state);
    state.activeTeam = 'blue';
    startTeamTurn(state, 'blue');
    const plan = planMoves(state, a, { col: 4, row: 3 });
    const { finished } = runAction(state, plan, 'confirm', undefined, scripted())!;
    // 行動力が残っているので、まだ行動を終えていない
    expect(finished.ended).toEqual([]);
    expect(judge(state, finished.ended)).toEqual({ kind: 'none' });
    // 拠点にいるまま番を終えると入城
    expect(endTeamTurn(state)).toMatchObject({ kind: 'end', outcome: { winner: 'attacker', reason: 'stronghold', unit: a } });
    expect(state.outcome?.remaining).toHaveLength(2);
  });

  it('戦闘が始まったときに部隊のいなかった陣営は、いなくても負けにしない', () => {
    const map = testMap();
    place(map, 'infantry', 'red', 1, 1);
    const state = battle(map, map.allUnits());
    startBattle(state);
    expect(judge(state)).toEqual({ kind: 'none' });
  });
});

describe('予約', () => {
  it('攻撃の後は移動を予約できない（騎兵は一撃離脱できる）', () => {
    const map = testMap();
    const c = place(map, 'cavalry', 'red', 3, 3);
    const d = place(map, 'infantry', 'blue', 4, 3);
    const state = battle(map, [c, d]);
    const plan = planAttack(state, newPlan(state, c)!, 'attack', d);
    moveLeg(state, plan, { col: 2, row: 3 });
    runAction(state, plan, 'confirm', undefined, scripted(ROLL_MID, ROLL_MID));
    expect(map.unitAt(2, 3)).toBe(c);
  });
});
