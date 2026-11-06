/**
 * 攻撃の定義の解決（兵種からの補完）・狙える HEX・当たる範囲・状態とクールタイムのターンの数え方のテスト。
 */
import { describe, expect, it } from 'vitest';
import type { Offset } from '@norden/map-runtime/core/hex';
import { areaCells, canAim, hexDistance, resolveAttack, splashUnits } from './combat';
import { setCondition, tickConditions, tickCooldowns } from './conditions';
import { place, status, testMap } from './test/fixtures';

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
