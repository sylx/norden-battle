/**
 * ルールの単体テストの道具。three.js を使わない HexMap と、ユニット・戦闘中の状態を作る。
 *
 * マップは pointy（odd-r）の平地。行が同じ HEX は横一直線（6 方向のうちの 2 つ）に並ぶので、直線の攻撃は行で並べて試す。
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import { HexMap, type HexCell, type MapData } from '@norden/map-runtime/core/mapData';
import type { TeamId, UnitData, UnitType } from '@norden/map-runtime/core/units';
import type { Combatant } from '../combat';
import { troopStatus, type TroopInit, type UnitStatus } from '../unitStatus';

/** cols × rows の平地のマップ。cells で一部の HEX を差し替える */
export function testMap(cols = 9, rows = 7, cells: Partial<HexCell>[] = []): HexMap {
  const grid: HexCell[] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) grid.push({ col, row, terrain: 'plains', elevation: 0 });
  for (const c of cells) {
    const i = grid.findIndex((g) => g.col === c.col && g.row === c.row);
    grid[i] = { ...grid[i], ...c };
  }
  const data: MapData = { version: 1, name: 'test', seed: 1, grid: { orientation: 'pointy', cols, rows, hexSize: 1 }, cells: grid, units: [] };
  return new HexMap(data);
}

/** map にユニットを置く */
export function place(map: HexMap, type: UnitType, team: TeamId, col: number, row: number): UnitData {
  const unit: UnitData = { type, team, col, row };
  map.setUnit(unit);
  return map.unitAt(col, row)!;
}

/** 戦闘中の状態（既定は兵 500・士気 50・統率 / 武力 / 知力 50） */
export function status(type: UnitType, init: Partial<TroopInit> = {}): UnitStatus {
  return troopStatus(type, { soldiers: 500, morale: 50, leadership: 50, strength: 50, intelligence: 50, ...init });
}

/** 攻撃の当事者（pos は既定でユニットのいる HEX） */
export function combatant(unit: UnitData, init: Partial<TroopInit> = {}, pos: Offset = unit): Combatant {
  return { unit, status: status(unit.type, init), pos };
}
