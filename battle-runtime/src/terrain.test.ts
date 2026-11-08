/**
 * 戦闘中の地形変化（アーススパイクで耕す）と、壁の崩れた城・砦の扱いのテスト。
 */
import { describe, expect, it } from 'vitest';
import { attackResult, cellDefense, chargeLanding } from './combat';
import { moveRange } from './movement';
import { plowCell, plowPreview, plowText } from './terrain';
import { combatant, place, testMap } from './test/fixtures';

const ROLL0 = { damage: 0, counter: 0 };

describe('耕す', () => {
  it('草原・森・山・湿地は荒地になる。水域は耕せない', () => {
    const map = testMap(9, 7, [
      { col: 2, row: 3, terrain: 'forest' },
      { col: 3, row: 3, terrain: 'mountain' },
      { col: 4, row: 3, terrain: 'water' },
      { col: 5, row: 3, terrain: 'deep_water' },
      { col: 6, row: 3, terrain: 'wasteland' },
    ]);
    for (const col of [1, 2, 3]) {
      const before = map.get(col, 3)!.terrain;
      expect(plowCell(map, { col, row: 3 })).toEqual({ at: { col, row: 3 }, from: before, road: false, breach: null });
      expect(map.get(col, 3)!.terrain).toBe('wasteland');
    }
    expect(plowCell(map, { col: 4, row: 3 })).toBeNull();
    expect(plowCell(map, { col: 5, row: 3 })).toBeNull();
    expect(map.get(4, 3)!.terrain).toBe('water');
    // 荒地はもう変わらない
    expect(plowCell(map, { col: 6, row: 3 })).toBeNull();
  });

  it('街道は壊れる（隣の HEX から来ている道も外れる）', () => {
    // pointy の向き 0 は右隣（同じ行）
    const map = testMap(9, 7, [
      { col: 2, row: 3, roads: [0] },
      { col: 3, row: 3, roads: [0, 3] },
      { col: 4, row: 3, roads: [3] },
    ]);
    const change = plowCell(map, { col: 3, row: 3 })!;
    expect(change.road).toBe(true);
    expect(map.get(3, 3)!.roads).toBeUndefined();
    expect(map.get(2, 3)!.roads).toBeUndefined();
    expect(map.get(4, 3)!.roads).toBeUndefined();
    expect(plowText(change)).toBe('草原が荒地に・街道が崩れた');
  });

  it('予測はマップを書き換えない', () => {
    const map = testMap();
    expect(plowPreview(map, { col: 3, row: 3 })?.from).toBe('plains');
    expect(map.get(3, 3)!.terrain).toBe('plains');
  });
});

describe('壁の崩れた城・砦', () => {
  /** (5..7, 3) が城の HEX のマップ */
  const castleMap = () => testMap(9, 7, [5, 6, 7].map((col) => ({ col, row: 3, feature: 'castle' as const })));

  it('城の HEX は城のまま壁が崩れる。地形効果は瓦礫の値になる', () => {
    const map = castleMap();
    expect(cellDefense(map.get(5, 3)!)).toBe(0.3);
    const change = plowCell(map, { col: 5, row: 3 })!;
    expect(change.breach).toBe('castle');
    expect(plowText(change)).toBe('草原が荒地に・城壁が崩れた');
    const cell = map.get(5, 3)!;
    expect(cell.feature).toBe('castle');
    expect(cell.breached).toBe(true);
    expect(cellDefense(cell)).toBe(0.1);
    // もう一度撃っても変わらない
    expect(plowCell(map, { col: 5, row: 3 })).toBeNull();
  });

  it('崩れた城の HEX へは入城の決まりに縛られずに入れ、そこから城の中へ進める', () => {
    const map = castleMap();
    const cav = place(map, 'cavalry', 'blue', 3, 3);
    const key = (col: number, row: number) => row * map.layout.cols + col;
    expect(moveRange(map, cav, cav, 8, { castleLocked: true }).has(key(5, 3))).toBe(false);
    plowCell(map, { col: 5, row: 3 });
    const range = moveRange(map, cav, cav, 8, { castleLocked: true });
    expect(range.has(key(5, 3))).toBe(true);
    expect(range.has(key(6, 3))).toBe(true);
    // 拠点の決まりはそのまま
    expect(moveRange(map, cav, cav, 8, { castleLocked: true, strongholdLocked: { col: 6, row: 3 } }).has(key(6, 3))).toBe(false);
  });

  it('崩れた城・砦の相手は突撃で突き抜けられ、砲兵の攻城の割引も無い', () => {
    const map = testMap(9, 7, [{ col: 4, row: 3, feature: 'fort' }]);
    const target = place(map, 'infantry', 'red', 4, 3);
    expect(chargeLanding(map, { col: 3, row: 3 }, target)).toBeNull();
    const art = combatant(place(map, 'artillery', 'blue', 1, 3));
    expect(attackResult(map, art, combatant(target), 'attack', ROLL0).defense).toBe(0.1);
    plowCell(map, { col: 4, row: 3 });
    expect(chargeLanding(map, { col: 3, row: 3 }, target)).toEqual({ col: 5, row: 3 });
    expect(attackResult(map, art, combatant(target), 'attack', ROLL0).defense).toBe(0.1);
  });
});
