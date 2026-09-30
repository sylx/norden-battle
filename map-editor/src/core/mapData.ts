import { HexLayout, type GridSpec } from './hex';
import { isFeatureId, type FeatureId } from './features';
import { normalizeRoads } from './roads';
import { isTerrainId, type TerrainId } from './terrainTypes';
import { isTeamId, isUnitType, type UnitData } from './units';

/**
 * マップ JSON のフォーマット (version 1)
 *
 * {
 *   "version": 1,
 *   "name": "フルーエン近郊",
 *   "seed": 12345,                       // 地形ノイズのシード
 *   "grid": { "orientation": "flat", "cols": 24, "rows": 16, "hexSize": 1 },
 *   "cells": [ { "col": 0, "row": 0, "terrain": "plains", "elevation": 1, "feature": "village" }, ... ],
 *   "units": [ { "col": 3, "row": 5, "type": "infantry", "team": "blue", "facing": "right" }, ... ]
 * }
 *
 * - elevation は整数の標高レベル（0 = 水面の高さ）。
 * - feature は人工物（bridge / village / fort / castle）。省略可。
 * - featureDir は橋の向き（0..5 の方向。0 と 3 は同じ軸）。省略時は自動。
 * - roads は街道がつながっている方向（0..5）の配列。省略可。隣の HEX 側の逆方向は読み込み時に補う。
 * - cells に含まれない HEX は plains / elevation 0 として扱う。
 * - units はユニットの配置（1 HEX に 1 部隊）。省略可。facing は画像の左右の向き（省略時 right）。
 */
export interface HexCell {
  col: number;
  row: number;
  terrain: TerrainId;
  elevation: number;
  feature?: FeatureId;
  featureDir?: number;
  roads?: number[];
}

export interface MapData {
  version: 1;
  name: string;
  seed: number;
  grid: GridSpec;
  cells: HexCell[];
  units?: UnitData[];
}

export class MapParseError extends Error {}

export function parseMapData(json: unknown): MapData {
  const fail = (msg: string): never => {
    throw new MapParseError(msg);
  };
  if (typeof json !== 'object' || json === null) fail('JSON がオブジェクトではありません');
  const o = json as Record<string, unknown>;
  if (o.version !== 1) fail(`未対応の version: ${String(o.version)}`);

  const g = o.grid as Record<string, unknown> | undefined;
  if (!g || typeof g !== 'object') fail('grid がありません');
  const orientation = g!.orientation;
  if (orientation !== 'flat' && orientation !== 'pointy') fail('grid.orientation は "flat" か "pointy"');
  const cols = g!.cols;
  const rows = g!.rows;
  if (!Number.isInteger(cols) || (cols as number) <= 0) fail('grid.cols が不正です');
  if (!Number.isInteger(rows) || (rows as number) <= 0) fail('grid.rows が不正です');
  const hexSize = g!.hexSize ?? 1;
  if (typeof hexSize !== 'number' || hexSize <= 0) fail('grid.hexSize が不正です');

  const grid: GridSpec = {
    orientation: orientation as GridSpec['orientation'],
    cols: cols as number,
    rows: rows as number,
    hexSize: hexSize as number,
  };

  if (!Array.isArray(o.cells)) fail('cells が配列ではありません');
  const cells: HexCell[] = [];
  (o.cells as unknown[]).forEach((c, i) => {
    const cell = c as Record<string, unknown>;
    const col = cell?.col;
    const row = cell?.row;
    if (!Number.isInteger(col) || !Number.isInteger(row)) fail(`cells[${i}]: col/row が不正です`);
    if ((col as number) < 0 || (row as number) < 0 || (col as number) >= grid.cols || (row as number) >= grid.rows)
      fail(`cells[${i}]: (${String(col)}, ${String(row)}) はマップ範囲外です`);
    if (!isTerrainId(cell.terrain)) fail(`cells[${i}]: 未知の terrain "${String(cell.terrain)}"`);
    const elevation = cell.elevation ?? 0;
    if (!Number.isInteger(elevation)) fail(`cells[${i}]: elevation は整数で指定してください`);
    const out: HexCell = {
      col: col as number,
      row: row as number,
      terrain: cell.terrain as TerrainId,
      elevation: elevation as number,
    };
    if (cell.feature !== undefined) {
      if (!isFeatureId(cell.feature)) fail(`cells[${i}]: 未知の feature "${String(cell.feature)}"`);
      out.feature = cell.feature as FeatureId;
    }
    if (cell.featureDir !== undefined) {
      const d = cell.featureDir;
      if (!Number.isInteger(d) || (d as number) < 0 || (d as number) > 5) fail(`cells[${i}]: featureDir は 0..5 の整数`);
      out.featureDir = d as number;
    }
    if (cell.roads !== undefined) {
      const r = cell.roads;
      if (!Array.isArray(r) || !r.every((d) => Number.isInteger(d) && d >= 0 && d <= 5))
        fail(`cells[${i}]: roads は 0..5 の整数の配列`);
      const dirs = [...new Set(r as number[])].sort((p, q) => p - q);
      if (dirs.length > 0) out.roads = dirs;
    }
    cells.push(out);
  });

  const units: UnitData[] = [];
  if (o.units !== undefined && !Array.isArray(o.units)) fail('units が配列ではありません');
  const occupied = new Set<string>();
  ((o.units as unknown[] | undefined) ?? []).forEach((u, i) => {
    const unit = u as Record<string, unknown>;
    const col = unit?.col;
    const row = unit?.row;
    if (!Number.isInteger(col) || !Number.isInteger(row)) fail(`units[${i}]: col/row が不正です`);
    if ((col as number) < 0 || (row as number) < 0 || (col as number) >= grid.cols || (row as number) >= grid.rows)
      fail(`units[${i}]: (${String(col)}, ${String(row)}) はマップ範囲外です`);
    const key = `${String(col)},${String(row)}`;
    if (occupied.has(key)) fail(`units[${i}]: (${key}) には既にユニットがいます`);
    occupied.add(key);
    if (!isUnitType(unit.type)) fail(`units[${i}]: 未知の type "${String(unit.type)}"`);
    if (!isTeamId(unit.team)) fail(`units[${i}]: 未知の team "${String(unit.team)}"`);
    if (unit.facing !== undefined && unit.facing !== 'left' && unit.facing !== 'right')
      fail(`units[${i}]: facing は "left" か "right"`);
    const out: UnitData = { col: col as number, row: row as number, type: unit.type as UnitData['type'], team: unit.team as UnitData['team'] };
    if (unit.facing) out.facing = unit.facing as UnitData['facing'];
    units.push(out);
  });

  return {
    version: 1,
    name: typeof o.name === 'string' ? o.name : 'untitled',
    seed: typeof o.seed === 'number' ? o.seed : 1,
    grid,
    cells,
    ...(units.length > 0 ? { units } : {}),
  };
}

/** MapData を引きやすい形に展開したもの */
export class HexMap {
  readonly data: MapData;
  readonly layout: HexLayout;
  private readonly cells: HexCell[];
  /** HEX のインデックス → ユニット */
  private readonly units = new Map<number, UnitData>();

  constructor(data: MapData) {
    this.data = data;
    this.layout = new HexLayout(data.grid);
    const { cols, rows } = data.grid;
    this.cells = new Array(cols * rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        this.cells[row * cols + col] = { col, row, terrain: 'plains', elevation: 0 };
      }
    }
    for (const c of data.cells) this.cells[c.row * cols + c.col] = { ...c, ...(c.roads ? { roads: [...c.roads] } : {}) };
    normalizeRoads(this);
    for (const u of data.units ?? []) this.units.set(u.row * cols + u.col, { ...u });
  }

  get(col: number, row: number): HexCell | undefined {
    if (!this.layout.inBounds(col, row)) return undefined;
    return this.cells[row * this.layout.cols + col];
  }

  /** マップ外はもっとも近い端の HEX を返す（外周の地形を自然に延長するため） */
  getClamped(col: number, row: number): HexCell {
    const c = Math.min(Math.max(col, 0), this.layout.cols - 1);
    const r = Math.min(Math.max(row, 0), this.layout.rows - 1);
    return this.cells[r * this.layout.cols + c];
  }

  /** 人工物を設定する（feature = null で撤去） */
  setFeature(col: number, row: number, feature: FeatureId | null, dir?: number): void {
    const cell = this.get(col, row);
    if (!cell) return;
    delete cell.feature;
    delete cell.featureDir;
    if (feature) cell.feature = feature;
    if (feature && dir !== undefined) cell.featureDir = dir;
  }

  setTerrain(col: number, row: number, terrain: TerrainId): void {
    const cell = this.get(col, row);
    if (cell) cell.terrain = terrain;
  }

  allCells(): readonly HexCell[] {
    return this.cells;
  }

  unitAt(col: number, row: number): UnitData | undefined {
    if (!this.layout.inBounds(col, row)) return undefined;
    return this.units.get(row * this.layout.cols + col);
  }

  /** ユニットを置く（同じ HEX のユニットは置き換える） */
  setUnit(unit: UnitData): void {
    if (!this.layout.inBounds(unit.col, unit.row)) return;
    this.units.set(unit.row * this.layout.cols + unit.col, { ...unit });
  }

  removeUnit(col: number, row: number): void {
    this.units.delete(row * this.layout.cols + col);
  }

  /** 全ユニットを入れ替える */
  replaceUnits(units: readonly UnitData[]): void {
    this.units.clear();
    for (const u of units) this.setUnit(u);
  }

  allUnits(): UnitData[] {
    return [...this.units.values()];
  }

  toJSON(): MapData {
    const { units: _, ...rest } = this.data;
    // HEX の並び順（row → col）で書き出す
    const units = [...this.units.entries()].sort((a, b) => a[0] - b[0]).map(([, u]) => ({ ...u }));
    return {
      ...rest,
      cells: this.cells.map((c) => ({ ...c, ...(c.roads ? { roads: [...c.roads] } : {}) })),
      ...(units.length > 0 ? { units } : {}),
    };
  }
}

/** 1 セル 1 行の読みやすい形で JSON 文字列化する */
export function stringifyMapData(data: MapData): string {
  const { cells, units, ...rest } = data;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  const list = (key: string, items: readonly object[]) =>
    `  "${key}": [\n${items.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]`;
  const parts = [list('cells', cells)];
  if (units && units.length > 0) parts.push(list('units', units));
  return `${head},\n${parts.join(',\n')}\n}\n`;
}
