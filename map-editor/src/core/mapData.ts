import { HexLayout, type GridSpec } from './hex';
import { isTerrainId, type TerrainId } from './terrainTypes';

/**
 * マップ JSON のフォーマット (version 1)
 *
 * {
 *   "version": 1,
 *   "name": "フルーエン近郊",
 *   "seed": 12345,                       // 地形ノイズのシード
 *   "grid": { "orientation": "flat", "cols": 24, "rows": 16, "hexSize": 1 },
 *   "cells": [ { "col": 0, "row": 0, "terrain": "plains", "elevation": 1 }, ... ]
 * }
 *
 * - elevation は整数の標高レベル（0 = 水面の高さ）。
 * - cells に含まれない HEX は plains / elevation 0 として扱う。
 */
export interface HexCell {
  col: number;
  row: number;
  terrain: TerrainId;
  elevation: number;
}

export interface MapData {
  version: 1;
  name: string;
  seed: number;
  grid: GridSpec;
  cells: HexCell[];
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
    cells.push({
      col: col as number,
      row: row as number,
      terrain: cell.terrain as TerrainId,
      elevation: elevation as number,
    });
  });

  return {
    version: 1,
    name: typeof o.name === 'string' ? o.name : 'untitled',
    seed: typeof o.seed === 'number' ? o.seed : 1,
    grid,
    cells,
  };
}

/** MapData を引きやすい形に展開したもの */
export class HexMap {
  readonly data: MapData;
  readonly layout: HexLayout;
  private readonly cells: HexCell[];

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
    for (const c of data.cells) this.cells[c.row * cols + c.col] = { ...c };
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

  allCells(): readonly HexCell[] {
    return this.cells;
  }

  toJSON(): MapData {
    return { ...this.data, cells: this.cells.map((c) => ({ ...c })) };
  }
}

/** 1 セル 1 行の読みやすい形で JSON 文字列化する */
export function stringifyMapData(data: MapData): string {
  const { cells, ...rest } = data;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  const body = cells.map((c) => `    ${JSON.stringify(c)}`).join(',\n');
  return `${head},\n  "cells": [\n${body}\n  ]\n}\n`;
}
