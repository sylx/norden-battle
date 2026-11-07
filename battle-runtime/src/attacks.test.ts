/**
 * 攻撃の定義の解決（兵種からの補完）・狙える HEX・当たる範囲・状態とクールタイムのターンの数え方のテスト。
 */
import { describe, expect, it } from 'vitest';
import type { Offset } from '@norden/map-runtime/core/hex';
import { areaCells, attackResult, attacksOf, canAim, hexDistance, interceptorsAt, mainTargetAt, resolveAttack, splashUnits, volleySupporters } from './combat';
import { applyMorale } from './morale';
import { setCondition, tickConditions, tickCooldowns } from './conditions';
import { combatant, place, status, testMap } from './test/fixtures';

const key = (o: Offset) => `${o.col},${o.row}`;
const keys = (cells: readonly Offset[]) => cells.map(key).sort();

describe('攻撃の定義の解決', () => {
  it('射程・演出・魔法は兵種から埋める', () => {
    const t = resolveAttack('mage', 'thunderfall');
    expect(t.range).toEqual({ min: 2, max: 3 });
    expect(t.magic).toBe(true);
    expect(t.indirect).toBe(true);
    expect(t.fx).toBe('thunder');
    expect(resolveAttack('cavalry', 'charge').fx).toBe('lance');
  });

  it('兵種の形（ライフル兵の path と味方への巻き添え）は通常攻撃と迎撃だけに効く', () => {
    for (const id of ['attack', 'interceptFire'] as const) {
      const a = resolveAttack('rifleman', id);
      expect(a.shape).toEqual({ kind: 'path' });
      expect(a.friendlyFire).toBe(true);
    }
    expect(resolveAttack('archer', 'attack').shape).toEqual({ kind: 'single' });
    expect(resolveAttack('archer', 'attack').friendlyFire).toBe(false);
  });

  it('巻き添えの倍率は省略すれば目標と同じ', () => {
    const a = resolveAttack('infantry', 'attack');
    expect(a.splashPower).toBe(a.power);
    expect(a.cooldown).toBe(0);
  });
});

describe('当たる範囲', () => {
  const map = testMap(11, 9);
  const from = { col: 5, row: 4 };

  it('single は目標だけ、path は目標までの直線上', () => {
    expect(areaCells(map, from, { col: 8, row: 4 }, { kind: 'single' })).toEqual([{ col: 8, row: 4 }]);
    expect(areaCells(map, from, { col: 8, row: 4 }, { kind: 'path' })).toEqual([
      { col: 6, row: 4 },
      { col: 7, row: 4 },
      { col: 8, row: 4 },
    ]);
  });

  it('line は目標の向きへ決まった長さ（目標の先も）。マップの外は除く', () => {
    expect(areaCells(map, from, { col: 6, row: 4 }, { kind: 'line', length: 3 })).toEqual([
      { col: 6, row: 4 },
      { col: 7, row: 4 },
      { col: 8, row: 4 },
    ]);
    expect(areaCells(map, { col: 9, row: 4 }, { col: 10, row: 4 }, { kind: 'line', length: 3 })).toEqual([{ col: 10, row: 4 }]);
  });

  it('burst は目標とその周り、around は自分の周り（自分は除く）', () => {
    const burst = areaCells(map, from, { col: 7, row: 2 }, { kind: 'burst', radius: 1 });
    expect(burst).toHaveLength(7);
    expect(burst.every((o) => hexDistance(map, o, { col: 7, row: 2 }) <= 1)).toBe(true);
    const around = areaCells(map, from, from, { kind: 'around', radius: 1 });
    expect(keys(around)).toEqual(keys(map.layout.neighbors(from.col, from.row)));
  });

  it('path・line の攻撃は、隣より遠い HEX は直線上だけ狙える', () => {
    const off = { col: 5, row: 2 };
    expect(hexDistance(map, from, off)).toBe(2);
    expect(canAim(map, 'rifleman', 'attack', from, off)).toBe(false);
    expect(canAim(map, 'rifleman', 'attack', from, { col: 7, row: 4 })).toBe(true);
    expect(canAim(map, 'archer', 'attack', from, off)).toBe(true);
  });

  it('巻き添えに味方が入るのは friendlyFire の攻撃だけ', () => {
    const m = testMap();
    const rifle = place(m, 'rifleman', 'blue', 2, 3);
    const ally = place(m, 'infantry', 'blue', 3, 3);
    const target = place(m, 'infantry', 'red', 4, 3);
    expect(splashUnits(m, rifle, rifle, target, target, 'attack')).toEqual([ally]);
    // 範囲が目標だけの攻撃には巻き添えが無い
    const archer = place(m, 'archer', 'blue', 2, 4);
    expect(splashUnits(m, archer, archer, target, target, 'attack')).toEqual([]);
  });
});

describe('状態とクールタイムのターン', () => {
  it('状態は長いほうの残りターンになり、番の終わりに減って 0 で消える', () => {
    const s = status('infantry');
    setCondition(s, 'freeze', 2);
    setCondition(s, 'freeze', 1);
    setCondition(s, 'shock', 1);
    expect(s.conditions).toEqual([
      { id: 'freeze', turns: 2 },
      { id: 'shock', turns: 1 },
    ]);
    tickConditions(s);
    expect(s.conditions).toEqual([{ id: 'freeze', turns: 1 }]);
    tickConditions(s);
    expect(s.conditions).toEqual([]);
  });

  it('turns が 0 なら状態を外す', () => {
    const s = status('infantry');
    setCondition(s, 'confusion', 3);
    setCondition(s, 'confusion', 0);
    expect(s.conditions).toEqual([]);
  });

  it('クールタイムは番の始まりに減って 0 で消える', () => {
    const s = status('mage');
    s.cooldowns.thunderfall = 2;
    tickCooldowns(s);
    expect(s.cooldowns).toEqual({ thunderfall: 1 });
    tickCooldowns(s);
    expect(s.cooldowns).toEqual({});
  });
});

describe('ドラゴン・フレイムランス（M007 段階 2）', () => {
  it('ブレスは目標の向きへ直線 3 HEX に当たり、範囲の味方にも当たる。反撃は受けない', () => {
    const m = testMap();
    const dragon = place(m, 'dragon', 'blue', 2, 3);
    const target = place(m, 'infantry', 'red', 3, 3);
    const ally = place(m, 'infantry', 'blue', 4, 3);
    const beyond = place(m, 'archer', 'red', 5, 3);
    place(m, 'archer', 'red', 6, 3);
    expect(canAim(m, 'dragon', 'breath', dragon, { col: 5, row: 3 })).toBe(true);
    expect(hexDistance(m, dragon, { col: 2, row: 1 })).toBe(2);
    expect(canAim(m, 'dragon', 'breath', dragon, { col: 2, row: 1 })).toBe(false);
    expect(splashUnits(m, dragon, dragon, target, target, 'breath')).toEqual([ally, beyond]);
    const r = attackResult(m, combatant(dragon), combatant(target), 'breath', { damage: 0, counter: 0 });
    expect(r.direct).toBe(false);
    expect(r.counter).toBe(0);
  });

  it('クロウは直接攻撃で反撃を受ける。ブレスにはクールタイムがある', () => {
    const m = testMap();
    const dragon = place(m, 'dragon', 'blue', 2, 3);
    const target = place(m, 'infantry', 'red', 3, 3);
    expect(attackResult(m, combatant(dragon), combatant(target), 'claw', { damage: 0, counter: 0 }).counter).toBeGreaterThan(0);
    expect(resolveAttack('dragon', 'breath').cooldown).toBe(1);
  });

  it('魔法は magic の兵種だけが、持たせたときに使える（サンダーフォールの後に並ぶ）', () => {
    expect(attacksOf('mage', { spells: ['flameLance'] })).toEqual(['thunderfall', 'flameLance']);
    expect(attacksOf('wizard', { spells: [] })).toEqual(['thunderfall']);
    expect(attacksOf('infantry', { spells: ['flameLance'] })).toEqual(['attack', 'volley']);
  });

  it('フレイムランスは魔術師でも隣を狙えて、直線 2 HEX に当たる。魔法で知力を使う', () => {
    const m = testMap();
    const mage = place(m, 'mage', 'blue', 2, 3);
    expect(canAim(m, 'mage', 'flameLance', mage, { col: 3, row: 3 })).toBe(true);
    expect(canAim(m, 'mage', 'thunderfall', mage, { col: 3, row: 3 })).toBe(false);
    expect(areaCells(m, mage, { col: 3, row: 3 }, resolveAttack('mage', 'flameLance').shape)).toEqual([
      { col: 3, row: 3 },
      { col: 4, row: 3 },
    ]);
    expect(resolveAttack('mage', 'flameLance').magic).toBe(true);
  });

  it('ドラゴンの兵数は HP と呼ぶ（monster）', () => {
    expect(status('dragon').monster).toBe(true);
    expect(status('infantry').monster).toBeUndefined();
  });
});

describe('段階 3 の兵種・魔法・状態', () => {
  it('乱撃は自分の周りの敵・味方すべてに当たり、目標は無い', () => {
    const m = testMap();
    const lk = place(m, 'landsknecht', 'blue', 4, 3);
    const enemy = place(m, 'infantry', 'red', 5, 3);
    const ally = place(m, 'infantry', 'blue', 3, 3);
    place(m, 'infantry', 'red', 6, 3);
    expect(mainTargetAt(m, lk, lk, 'rampage')).toBeNull();
    expect(new Set(splashUnits(m, lk, lk, null, lk, 'rampage'))).toEqual(new Set([enemy, ally]));
  });

  it('チェインライトニングは目標から隣り合う敵へ 2 回まで跳ぶ（味方には跳ばない）', () => {
    const m = testMap();
    const mage = place(m, 'mage', 'blue', 1, 3);
    const target = place(m, 'infantry', 'red', 3, 3);
    const second = place(m, 'infantry', 'red', 4, 3);
    place(m, 'infantry', 'blue', 3, 2);
    const third = place(m, 'infantry', 'red', 5, 3);
    place(m, 'infantry', 'red', 6, 3);
    expect(splashUnits(m, mage, mage, target, target, 'chainLightning')).toEqual([second, third]);
  });

  it('地点を狙う攻撃は、狙った HEX に敵がいればそれが目標で、いなければ目標は無い', () => {
    const m = testMap();
    const mage = place(m, 'mage', 'blue', 1, 3);
    const enemy = place(m, 'infantry', 'red', 4, 3);
    const ally = place(m, 'infantry', 'blue', 3, 2);
    expect(mainTargetAt(m, mage, enemy, 'earthSpike')).toBe(enemy);
    expect(mainTargetAt(m, mage, ally, 'earthSpike')).toBeNull();
    expect(mainTargetAt(m, mage, { col: 3, row: 3 }, 'earthSpike')).toBeNull();
    // 空いた HEX を狙っても周りの敵・味方に当たる
    expect(new Set(splashUnits(m, mage, mage, null, { col: 3, row: 3 }, 'earthSpike'))).toEqual(new Set([enemy, ally]));
    expect(canAim(m, 'mage', 'meteorFall', mage, { col: 6, row: 3 })).toBe(true);
  });

  it('光線は目標に大きく、周りには小さく当たる（味方にも）', () => {
    const m = testMap();
    const beh = place(m, 'behemoth', 'blue', 1, 3);
    const target = place(m, 'infantry', 'red', 3, 3);
    const ally = place(m, 'infantry', 'blue', 4, 3);
    expect(splashUnits(m, beh, beh, target, target, 'beam')).toEqual([ally]);
    const main = attackResult(m, combatant(beh), combatant(target), 'beam', { damage: 0, counter: 0 });
    const side = attackResult(m, combatant(beh), combatant(target), 'beam', { damage: 0, counter: 0 }, true);
    expect(side.damage).toBeLessThan(main.damage);
  });

  it('ブレインは反撃せず、一斉攻撃にも加わらない。士気は減らない', () => {
    const m = testMap();
    const inf = place(m, 'infantry', 'blue', 3, 3);
    const brain = place(m, 'brain', 'red', 4, 3);
    expect(attackResult(m, combatant(inf), combatant(brain), 'attack', { damage: 0, counter: 0 }).counter).toBe(0);
    const target = place(m, 'infantry', 'blue', 5, 3);
    place(m, 'infantry', 'red', 6, 3);
    expect(volleySupporters(m, place(m, 'infantry', 'red', 5, 2), target)).not.toContain(brain);
    const s = status('brain');
    expect(s.steadfast).toBe(true);
    expect(s.noRetreat).toBe(true);
    const morale = s.morale;
    applyMorale(s, -20);
    expect(s.morale).toBe(morale);
    applyMorale(s, 5);
    expect(s.morale).toBe(morale + 5);
  });

  it('感電した迎撃の構えのユニットは撃たない。凍結・感電すると構えが解ける', () => {
    const m = testMap();
    const archer = place(m, 'archer', 'red', 6, 3);
    const mover = place(m, 'cavalry', 'blue', 1, 3);
    const s = { ...status('archer'), intercepting: true };
    expect(interceptorsAt(m, new Map([[archer, s]]), mover, { col: 4, row: 3 })).toEqual([archer]);
    const shocked = { ...status('archer'), intercepting: true, conditions: [{ id: 'shock' as const, turns: 1 }] };
    expect(interceptorsAt(m, new Map([[archer, shocked]]), mover, { col: 4, row: 3 })).toEqual([]);
    const frozen = { ...status('archer'), intercepting: true };
    setCondition(frozen, 'freeze', 1);
    expect(frozen.intercepting).toBe(false);
  });
});
