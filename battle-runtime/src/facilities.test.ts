/**
 * 入城の決まり（城の HEX へ入れるのは番の最初の移動だけ）と、拠点の施設（撃つ間隔・ダメージ・射程が伸びる）のテスト。
 */
import { describe, expect, it } from 'vitest';
import { canAim, chargeLanding, facilityResult } from './combat';
import { firesOn, rangeBonus } from './facilities';
import { moveRange, nearCastle } from './movement';
import { combatant, place, testMap } from './test/fixtures';

/** (5..7, 3) が城の HEX のマップ */
const castleMap = () =>
  testMap(
    9,
    7,
    [5, 6, 7].map((col) => ({ col, row: 3, feature: 'castle' as const })),
  );

describe('入城の決まり', () => {
  it('castleLocked なら城の外から城の HEX へは入れない（城の中どうしは動ける）', () => {
    const map = castleMap();
    const cav = place(map, 'cavalry', 'blue', 3, 3);
    const key = (col: number, row: number) => row * map.layout.cols + col;
    expect(moveRange(map, cav, cav, 6).has(key(5, 3))).toBe(true);
    expect(moveRange(map, cav, cav, 6, { castleLocked: true }).has(key(5, 3))).toBe(false);
    const inside = place(map, 'infantry', 'blue', 5, 3);
    expect(moveRange(map, inside, inside, 4, { castleLocked: true }).has(key(6, 3))).toBe(true);
  });

  it('攻撃側の突撃は城の外から城の HEX へ飛び出さない', () => {
    const map = castleMap();
    const target = place(map, 'infantry', 'red', 4, 3);
    expect(chargeLanding(map, { col: 3, row: 3 }, target)).toEqual({ col: 5, row: 3 });
    expect(chargeLanding(map, { col: 3, row: 3 }, target, true)).toBeNull();
  });
});

describe('拠点の施設', () => {
  it('間隔のターンごとに撃つ', () => {
    expect([1, 2, 3, 4, 5, 6].filter((t) => firesOn(t, 3))).toEqual([3, 6]);
    expect([1, 2, 3].every((t) => firesOn(t, 1))).toBe(true);
  });

  it('施設の弾は反撃を受けず、ダメージと士気の減りがある', () => {
    const map = testMap();
    const target = combatant(place(map, 'infantry', 'blue', 3, 3));
    for (const kind of ['fortressCannon', 'gunship'] as const) {
      const r = facilityResult(map, kind, target, 0);
      expect(r.damage).toBeGreaterThan(0);
      expect(r.counter).toBe(0);
      expect(r.morale.defender).toBeLessThan(0);
    }
  });

  it('バリスタは弓兵、魔導台は魔術師の射程を 1 伸ばす', () => {
    expect(rangeBonus({ ballista: true }, 'archer', false)).toBe(1);
    expect(rangeBonus({ ballista: true }, 'mage', true)).toBe(0);
    expect(rangeBonus({ magicTower: true }, 'wizard', true)).toBe(1);
    expect(rangeBonus(undefined, 'archer', false)).toBe(0);
    const map = testMap();
    expect(canAim(map, 'archer', 'attack', { col: 1, row: 3 }, { col: 4, row: 3 })).toBe(false);
    expect(canAim(map, 'archer', 'attack', { col: 1, row: 3 }, { col: 4, row: 3 }, 1)).toBe(true);
  });
});

describe('入城の決まり（番の初めに城に接していたか）', () => {
  it('城の HEX の中か、そのとなりなら城に入れる', () => {
    const map = castleMap();
    expect(nearCastle(map, { col: 4, row: 3 })).toBe(true);
    expect(nearCastle(map, { col: 6, row: 3 })).toBe(true);
    expect(nearCastle(map, { col: 2, row: 3 })).toBe(false);
  });
});
