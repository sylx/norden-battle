/**
 * 攻撃の判定（射程・巻き添え・突撃・一斉攻撃・迎撃・ダメージ）のテスト。
 * M007 の段階 1 で攻撃の定義を汎用化する前の振る舞いを固定する（移し替えても同じ結果になることを確かめる）。
 */
import { describe, expect, it } from 'vitest';
import { UNIT_TYPES, type UnitType } from '@norden/map-runtime/core/units';
import {
  attackForecast,
  attackRange,
  attackResult,
  attackTargets,
  chargeLanding,
  hexDistance,
  inRange,
  interceptorsAt,
  splashResult,
  splashUnits,
  volleySupporters,
} from './combat';
import type { AttackId } from './attacks';
import { combatant, place, status, testMap } from './test/fixtures';

const ROLL0 = { damage: 0, counter: 0 };

describe('射程', () => {
  const map = testMap();
  const from = { col: 4, row: 3 };
  /** 同じ行（横一直線）で距離 d の HEX */
  const along = (d: number) => ({ col: 4 + d, row: 3 });
  /** 距離 2 で 6 方向の直線上にない HEX */
  const offLine = { col: 4, row: 1 };

  it('兵種ごとの最短・最長の射程', () => {
    const reach = (type: UnitType) => [1, 2, 3, 4].filter((d) => inRange(map, type, from, along(d)));
    expect(reach('infantry')).toEqual([1]);
    expect(reach('cavalry')).toEqual([1]);
    expect(reach('landsknecht')).toEqual([1]);
    expect(reach('archer')).toEqual([1, 2]);
    expect(reach('rifleman')).toEqual([1, 2]);
    expect(reach('mage')).toEqual([2, 3]);
    expect(reach('wizard')).toEqual([2, 3]);
    expect(reach('artillery')).toEqual([2, 3]);
  });

  it('ライフル兵は隣より遠い HEX は直線上だけ。弓兵は直線でなくても撃てる', () => {
    expect(hexDistance(map, from, offLine)).toBe(2);
    expect(inRange(map, 'rifleman', from, offLine)).toBe(false);
    expect(inRange(map, 'archer', from, offLine)).toBe(true);
  });

  it('攻撃できる相手は射程の中の敵だけ', () => {
    const m = testMap();
    const archer = place(m, 'archer', 'blue', 4, 3);
    const enemy = place(m, 'infantry', 'red', 6, 3);
    place(m, 'infantry', 'blue', 5, 3);
    place(m, 'infantry', 'red', 8, 3);
    expect(attackTargets(m, archer, archer)).toEqual([enemy]);
  });

  it('攻撃できる範囲の HEX の数（相手の有無に関わらない）', () => {
    const m = testMap();
    const count = (type: UnitType) => attackRange(m, place(m, type, 'blue', 4, 3), from).length;
    expect(count('infantry')).toBe(6);
    expect(count('archer')).toBe(18);
    expect(count('rifleman')).toBe(12);
    expect(count('mage')).toBe(30);
  });
});

describe('ライフル兵の巻き添え', () => {
  it('目標の手前の HEX にいるユニットに、敵・味方を問わず当たる', () => {
    const map = testMap();
    const rifle = place(map, 'rifleman', 'blue', 2, 3);
    const ally = place(map, 'infantry', 'blue', 3, 3);
    const target = place(map, 'infantry', 'red', 4, 3);
    expect(splashUnits(map, rifle, rifle, target, target, 'attack')).toEqual([ally]);
  });

  it('ほかの兵種・隣の目標では巻き添えは無い', () => {
    const map = testMap();
    const archer = place(map, 'archer', 'blue', 2, 3);
    place(map, 'infantry', 'blue', 3, 3);
    const target = place(map, 'infantry', 'red', 4, 3);
    expect(splashUnits(map, archer, archer, target, target, 'attack')).toEqual([]);
    const rifle = place(map, 'rifleman', 'blue', 5, 3);
    expect(splashUnits(map, rifle, rifle, target, target, 'attack')).toEqual([]);
  });

  it('巻き添えは目標と同じ計算で、反撃も撃ったユニットの士気の増減も無い', () => {
    const map = testMap();
    const rifle = combatant(place(map, 'rifleman', 'blue', 2, 3));
    const victim = combatant(place(map, 'infantry', 'blue', 3, 3));
    const r = splashResult(map, rifle, victim, 'attack', 0);
    expect(r.counter).toBe(0);
    expect(r.direct).toBe(false);
    expect(r.morale.attacker).toBe(0);
    expect(r.damage).toBe(attackResult(map, rifle, victim, 'attack', ROLL0, true).damage);
  });

  it('予測に巻き添えのダメージの幅が入る', () => {
    const map = testMap();
    const rifle = combatant(place(map, 'rifleman', 'blue', 2, 3));
    const victim = combatant(place(map, 'infantry', 'blue', 3, 3));
    const target = combatant(place(map, 'infantry', 'red', 4, 3));
    const f = attackForecast(map, rifle, target, 'attack', [victim]);
    expect(f.splash).toHaveLength(1);
    expect(f.splash[0].unit).toBe(victim.unit);
    expect(f.splash[0].damage[0]).toBeLessThan(f.splash[0].damage[1]);
  });
});

describe('直接攻撃と反撃', () => {
  it('隣の相手への攻撃は直接攻撃で反撃を受ける', () => {
    const map = testMap();
    const a = combatant(place(map, 'infantry', 'blue', 3, 3));
    const d = combatant(place(map, 'infantry', 'red', 4, 3));
    const r = attackResult(map, a, d, 'attack', ROLL0);
    expect(r.direct).toBe(true);
    expect(r.counter).toBeGreaterThan(0);
  });

  it('距離 2 以上は一方的', () => {
    const map = testMap();
    const a = combatant(place(map, 'archer', 'blue', 2, 3));
    const d = combatant(place(map, 'infantry', 'red', 4, 3));
    const r = attackResult(map, a, d, 'attack', ROLL0);
    expect(r.direct).toBe(false);
    expect(r.counter).toBe(0);
  });

  it('サンダーフォールと迎撃の自動攻撃は、隣でも反撃を受けない', () => {
    const map = testMap();
    const a = combatant(place(map, 'mage', 'blue', 3, 3));
    const d = combatant(place(map, 'infantry', 'red', 4, 3));
    for (const kind of ['thunderfall', 'interceptFire'] as const) {
      const r = attackResult(map, a, d, kind, ROLL0);
      expect(r.direct).toBe(false);
      expect(r.counter).toBe(0);
    }
  });

  it('魔法は相手の武力で軽減されない（通常攻撃はされる）', () => {
    const map = testMap();
    const mage = place(map, 'mage', 'blue', 2, 3);
    const inf = place(map, 'infantry', 'blue', 3, 1);
    const target = place(map, 'infantry', 'red', 4, 3);
    const dmg = (attacker: typeof mage, kind: AttackId, strength: number) =>
      attackResult(map, combatant(attacker), combatant(target, { strength }), kind, ROLL0).damage;
    expect(dmg(mage, 'thunderfall', 10)).toBe(dmg(mage, 'thunderfall', 90));
    expect(dmg(inf, 'attack', 10)).toBeGreaterThan(dmg(inf, 'attack', 90));
  });

  it('魔術師は武力の代わりに知力を使う', () => {
    const map = testMap();
    const mage = place(map, 'mage', 'blue', 2, 3);
    const target = combatant(place(map, 'infantry', 'red', 4, 3));
    const dmg = (init: { strength: number; intelligence: number }) => attackResult(map, combatant(mage, init), target, 'thunderfall', ROLL0).damage;
    expect(dmg({ strength: 10, intelligence: 90 })).toBeGreaterThan(dmg({ strength: 90, intelligence: 10 }));
  });
});

describe('地形', () => {
  it('森にいる相手へのダメージは減る', () => {
    const map = testMap(9, 7, [{ col: 4, row: 3, terrain: 'forest' }]);
    const a = combatant(place(map, 'infantry', 'blue', 3, 3));
    const inForest = attackResult(map, a, combatant(place(map, 'infantry', 'red', 4, 3)), 'attack', ROLL0);
    const onPlains = attackResult(map, a, combatant(place(map, 'infantry', 'red', 2, 3)), 'attack', ROLL0);
    expect(inForest.defense).toBeGreaterThan(0);
    expect(inForest.damage).toBeLessThan(onPlains.damage);
  });

  it('砲兵が城にいる相手を撃つと地形効果が半分', () => {
    const map = testMap(9, 7, [{ col: 5, row: 3, feature: 'castle' }]);
    const target = combatant(place(map, 'infantry', 'red', 5, 3));
    const art = attackResult(map, combatant(place(map, 'artillery', 'blue', 3, 3)), target, 'attack', ROLL0);
    const archer = attackResult(map, combatant(place(map, 'archer', 'blue', 4, 1)), target, 'attack', ROLL0);
    expect(archer.defense).toBe(0.5);
    expect(art.defense).toBe(0.25);
  });

  it('弓兵は高い HEX から撃つとダメージが増える', () => {
    const map = testMap(9, 7, [{ col: 2, row: 3, elevation: 2 }]);
    const r = attackResult(map, combatant(place(map, 'archer', 'blue', 2, 3)), combatant(place(map, 'infantry', 'red', 4, 3)), 'attack', ROLL0);
    expect(r.highGround).toBe(2);
  });
});

describe('一斉攻撃・突撃', () => {
  it('一斉攻撃には相手に隣接する直接攻撃の味方が加わる（弓兵は加わらない）', () => {
    const map = testMap();
    const attacker = place(map, 'infantry', 'blue', 3, 3);
    const target = place(map, 'infantry', 'red', 4, 3);
    const cav = place(map, 'cavalry', 'blue', 5, 3);
    place(map, 'archer', 'blue', 4, 2);
    expect(volleySupporters(map, attacker, target)).toEqual([cav]);
    const r = attackResult(map, combatant(attacker), combatant(target), 'volley', ROLL0);
    expect(r.supporters).toBe(1);
    expect(r.damage).toBeGreaterThan(attackResult(map, combatant(attacker), combatant(target), 'attack', ROLL0).damage);
  });

  it('突撃は相手の向こうの HEX へ飛び出る。ふさがっていれば飛び出さない', () => {
    const map = testMap();
    const target = place(map, 'infantry', 'red', 4, 3);
    expect(chargeLanding(map, { col: 3, row: 3 }, target)).toEqual({ col: 5, row: 3 });
    place(map, 'infantry', 'red', 5, 3);
    expect(chargeLanding(map, { col: 3, row: 3 }, target)).toBeNull();
  });

  it('城・砦にいる相手は突き抜けられない', () => {
    const map = testMap(9, 7, [{ col: 4, row: 3, feature: 'fort' }]);
    const target = place(map, 'infantry', 'red', 4, 3);
    expect(chargeLanding(map, { col: 3, row: 3 }, target)).toBeNull();
  });
});

describe('迎撃', () => {
  it('迎撃の構えの間接ユニットのうち、射程に入るものが撃つ', () => {
    const map = testMap();
    const archer = place(map, 'archer', 'red', 6, 3);
    const inf = place(map, 'infantry', 'red', 5, 3);
    const idle = place(map, 'archer', 'red', 6, 5);
    const mover = place(map, 'cavalry', 'blue', 1, 3);
    const statuses = new Map([
      [archer, { ...status('archer'), intercepting: true }],
      [inf, { ...status('infantry'), intercepting: true }],
      [idle, status('archer')],
    ]);
    expect(interceptorsAt(map, statuses, mover, { col: 4, row: 3 })).toEqual([archer]);
    expect(interceptorsAt(map, statuses, mover, { col: 2, row: 3 })).toEqual([]);
  });

  it('近接ユニットの迎撃の構えは、受けるダメージを減らし反撃を増やす（魔法には効かない）', () => {
    const map = testMap();
    const a = combatant(place(map, 'infantry', 'blue', 3, 3));
    const target = place(map, 'infantry', 'red', 4, 3);
    const normal = attackResult(map, a, combatant(target), 'attack', ROLL0);
    const guard = attackResult(map, a, { ...combatant(target), status: { ...status('infantry'), intercepting: true } }, 'attack', ROLL0);
    expect(guard.damage).toBeLessThan(normal.damage);
    expect(guard.counter).toBeGreaterThan(normal.counter);
    const mage = combatant(place(map, 'mage', 'blue', 2, 3));
    const m1 = attackResult(map, mage, combatant(target), 'thunderfall', ROLL0);
    const m2 = attackResult(map, mage, { ...combatant(target), status: { ...status('infantry'), intercepting: true } }, 'thunderfall', ROLL0);
    expect(m2.damage).toBe(m1.damage);
  });
});

describe('ダメージの表（移し替えの前後で変わらないこと）', () => {
  /** 兵種ごとの攻撃の種類 */
  const KINDS: Record<UnitType, AttackId[]> = {
    infantry: ['attack', 'volley'],
    archer: ['attack', 'interceptFire'],
    cavalry: ['attack', 'volley', 'charge'],
    mage: ['thunderfall', 'interceptFire'],
    wizard: ['thunderfall', 'interceptFire'],
    rifleman: ['attack', 'interceptFire'],
    artillery: ['attack', 'interceptFire'],
    landsknecht: ['attack', 'volley'],
  };

  it('兵種 × 攻撃の種類 × 相手の兵種', () => {
    const table: Record<string, string> = {};
    for (const type of UNIT_TYPES) {
      for (const kind of KINDS[type]) {
        for (const defType of UNIT_TYPES) {
          const map = testMap();
          // 射程に合わせて置く（隣か、距離 2 の直線上）
          const near = inRange(map, type, { col: 3, row: 3 }, { col: 4, row: 3 });
          const a = combatant(place(map, type, 'blue', near ? 3 : 2, 3), { strength: 60, intelligence: 70, leadership: 55, morale: 60, soldiers: 600 });
          const d = combatant(place(map, defType, 'red', 4, 3), { strength: 45, intelligence: 40, leadership: 50, morale: 50, soldiers: 500 });
          const r = attackResult(map, a, d, kind, ROLL0);
          table[`${type} ${kind} → ${defType}`] = `dmg ${r.damage} ctr ${r.counter} morale ${r.morale.attacker}/${r.morale.defender}`;
        }
      }
    }
    expect(table).toMatchSnapshot();
  });
});
