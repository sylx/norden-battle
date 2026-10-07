import { HexLayout, type GridSpec, type Offset, type Vec2 } from './hex';
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
 *   "units": [ { "col": 3, "row": 5, "type": "infantry", "team": "blue" }, ... ]
 * }
 *
 * - elevation は整数の標高レベル（0 = 水面の高さ）。
 * - feature は人工物（bridge / village / fort / castle）。省略可。
 * - featureDir は橋の向き（0..5 の方向。0 と 3 は同じ軸）。省略時は自動。
 * - roads は街道がつながっている方向（0..5）の配列。省略可。隣の HEX 側の逆方向は読み込み時に補う。
 * - cells に含まれない HEX は plains / elevation 0 として扱う。
 * - units はユニットの配置（1 HEX に 1 部隊）。省略可。
 *   画像の左右の向きは保存せず、配置から決める（以前の形式の facing は読み込み時に無視する）。
 * - link は街道マップ（戦略マップの街道 A–B の両端の都市を描いたマップ）の両端の都市 ID。省略可。
 * - battleAreas は街道マップ上の戦闘の範囲（左上の HEX）。防衛する都市の ID で引く。省略可。
 *   大きさは BATTLE_AREA_SIZE。切り出しは battleArea.ts の cropMap。
 * - origin は切り出したマップの、元のマップでの左上の HEX（cropMap が付ける）。省略可。
 *   地形のノイズなどを元の座標で引き、切り出しても元のマップと同じ見た目にする。
 * - deployments は街道マップの戦闘の初期配置地点。battleAreas と同じく防衛する都市の ID で引き、
 *   攻撃側・防衛側の HEX（街道マップの座標）を持つ。範囲の外の HEX は切り出したときに落ちる。省略可。
 * - deploy は切り出したマップの初期配置地点（cropBattleArea が deployments から作る。切り出したマップの座標）。省略可。
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
  link?: MapLink;
  battleAreas?: Record<string, Offset>;
  origin?: Offset;
  deployments?: Record<string, BattleDeployment>;
  deploy?: BattleDeployment;
  cells: HexCell[];
  units?: UnitData[];
}

/** 戦闘の初期配置の陣営 */
export const DEPLOY_SIDES = ['attacker', 'defender'] as const;
export type DeploySide = (typeof DEPLOY_SIDES)[number];

/** 戦闘の初期配置地点（戦闘でユーザーがユニットを置ける HEX）。陣営ごとの HEX の並び */
export type BattleDeployment = Record<DeploySide, Offset[]>;

/** 戦闘の範囲の大きさ（HEX 数）。街道マップの battleAreas はこの大きさで切り出す */
export const BATTLE_AREA_SIZE = { cols: 16, rows: 16 } as const;

/** 街道マップの両端の都市（戦略マップの都市 ID） */
export interface MapLink {
  cities: [string, string];
}

/**
 * オフセット座標の偶奇: flat（odd-q）では列、pointy（odd-r）では行が偶数でないと、
 * その位置を原点にしたとき HEX のずれ方が反転する。切り出しの左上はこの条件を満たす必要がある。
 */
export function isAlignedOrigin(grid: GridSpec, o: Offset): boolean {
  return (grid.orientation === 'flat' ? o.col : o.row) % 2 === 0;
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

  const offsetOf = (v: unknown, what: string): Offset => {
    const p = v as Record<string, unknown> | null;
    if (typeof p !== 'object' || p === null || !Number.isInteger(p.col) || !Number.isInteger(p.row))
      fail(`${what}: col/row が不正です`);
    const out = { col: p!.col as number, row: p!.row as number };
    if (!isAlignedOrigin(grid, out))
      fail(`${what}: ${grid.orientation === 'flat' ? '列' : '行'}は偶数にしてください`);
    return out;
  };

  let link: MapLink | undefined;
  if (o.link !== undefined) {
    const cities = (o.link as Record<string, unknown> | null)?.cities;
    if (!Array.isArray(cities) || cities.length !== 2 || !cities.every((c) => typeof c === 'string' && c !== '') || cities[0] === cities[1])
      fail('link.cities は異なる 2 つの都市 ID の配列');
    link = { cities: [(cities as string[])[0], (cities as string[])[1]] };
  }

  let battleAreas: Record<string, Offset> | undefined;
  if (o.battleAreas !== undefined) {
    if (typeof o.battleAreas !== 'object' || o.battleAreas === null || Array.isArray(o.battleAreas))
      fail('battleAreas がオブジェクトではありません');
    battleAreas = {};
    for (const [city, v] of Object.entries(o.battleAreas as Record<string, unknown>)) {
      const area = offsetOf(v, `battleAreas.${city}`);
      if (area.col < 0 || area.row < 0 || area.col + BATTLE_AREA_SIZE.cols > grid.cols || area.row + BATTLE_AREA_SIZE.rows > grid.rows)
        fail(`battleAreas.${city}: ${BATTLE_AREA_SIZE.cols}×${BATTLE_AREA_SIZE.rows} の範囲がマップに収まりません`);
      battleAreas[city] = area;
    }
  }

  const origin = o.origin === undefined ? undefined : offsetOf(o.origin, 'origin');

  const deploymentOf = (v: unknown, what: string): BattleDeployment => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${what} がオブジェクトではありません`);
    const out: BattleDeployment = { attacker: [], defender: [] };
    const seen = new Set<string>();
    for (const side of DEPLOY_SIDES) {
      const list = (v as Record<string, unknown>)[side];
      if (list === undefined) continue;
      if (!Array.isArray(list)) fail(`${what}.${side} が配列ではありません`);
      (list as unknown[]).forEach((p, i) => {
        const q = p as Record<string, unknown> | null;
        if (typeof q !== 'object' || q === null || !Number.isInteger(q.col) || !Number.isInteger(q.row))
          fail(`${what}.${side}[${i}]: col/row が不正です`);
        const col = q!.col as number;
        const row = q!.row as number;
        if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) fail(`${what}.${side}[${i}]: (${col}, ${row}) はマップ範囲外です`);
        if (seen.has(`${col},${row}`)) fail(`${what}.${side}[${i}]: (${col}, ${row}) が重複しています`);
        seen.add(`${col},${row}`);
        out[side].push({ col, row });
      });
    }
    return out;
  };

  let deployments: Record<string, BattleDeployment> | undefined;
  if (o.deployments !== undefined) {
    if (typeof o.deployments !== 'object' || o.deployments === null || Array.isArray(o.deployments))
      fail('deployments がオブジェクトではありません');
    deployments = {};
    for (const [city, v] of Object.entries(o.deployments as Record<string, unknown>)) deployments[city] = deploymentOf(v, `deployments.${city}`);
  }
  const deploy = o.deploy === undefined ? undefined : deploymentOf(o.deploy, 'deploy');

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
    units.push({ col: col as number, row: row as number, type: unit.type as UnitData['type'], team: unit.team as UnitData['team'] });
  });

  return {
    version: 1,
    name: typeof o.name === 'string' ? o.name : 'untitled',
    seed: typeof o.seed === 'number' ? o.seed : 1,
    grid,
    ...(link ? { link } : {}),
    ...(battleAreas ? { battleAreas } : {}),
    ...(origin ? { origin } : {}),
    ...(deployments ? { deployments } : {}),
    ...(deploy ? { deploy } : {}),
    cells,
    ...(units.length > 0 ? { units } : {}),
  };
}

/** 初期配置地点の写し */
export function cloneDeployment(d: BattleDeployment): BattleDeployment {
  return { attacker: d.attacker.map((o) => ({ ...o })), defender: d.defender.map((o) => ({ ...o })) };
}

/** MapData を引きやすい形に展開したもの */
export class HexMap {
  readonly data: MapData;
  readonly layout: HexLayout;
  /**
   * 地形のノイズ・木の配置などを引く座標のずれ（ワールド座標）。切り出したマップ（origin あり）では
   * 元のマップでの位置になり、元のマップと同じ見た目になる。
   */
  readonly noiseOffset: Vec2;
  private readonly cells: HexCell[];
  /** HEX のインデックス → ユニット */
  private readonly units = new Map<number, UnitData>();

  constructor(data: MapData) {
    this.data = data;
    this.layout = new HexLayout(data.grid);
    this.noiseOffset = data.origin ? this.layout.offsetToWorld(data.origin.col, data.origin.row) : { x: 0, z: 0 };
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

  setElevation(col: number, row: number, elevation: number): void {
    const cell = this.get(col, row);
    if (cell) cell.elevation = Math.round(elevation);
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

  /** ユニットを空いている HEX へ動かす（同じオブジェクトの col・row を書き換える）。動かせたら true */
  moveUnit(unit: UnitData, col: number, row: number): boolean {
    const { cols } = this.layout;
    const from = unit.row * cols + unit.col;
    if (this.units.get(from) !== unit || !this.layout.inBounds(col, row) || this.unitAt(col, row)) return false;
    this.units.delete(from);
    unit.col = col;
    unit.row = row;
    this.units.set(row * cols + col, unit);
    return true;
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
      ...(rest.link ? { link: { cities: [...rest.link.cities] } } : {}),
      ...(rest.battleAreas ? { battleAreas: Object.fromEntries(Object.entries(rest.battleAreas).map(([k, v]) => [k, { ...v }])) } : {}),
      ...(rest.deployments
        ? { deployments: Object.fromEntries(Object.entries(rest.deployments).map(([k, v]) => [k, cloneDeployment(v)])) }
        : {}),
      ...(rest.deploy ? { deploy: cloneDeployment(rest.deploy) } : {}),
      cells: this.cells.map((c) => ({ ...c, ...(c.roads ? { roads: [...c.roads] } : {}) })),
      ...(units.length > 0 ? { units } : {}),
    };
  }
}

/** 1 セル 1 行の読みやすい形で JSON 文字列化する（初期配置地点は陣営ごとに 1 行） */
export function stringifyMapData(data: MapData): string {
  const { cells, units, deployments, deploy, ...rest } = data;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  const list = (key: string, items: readonly object[]) =>
    `  "${key}": [\n${items.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]`;
  const sides = (d: BattleDeployment, indent: string) =>
    `{\n${DEPLOY_SIDES.map((side) => `${indent}  "${side}": ${JSON.stringify(d[side])}`).join(',\n')}\n${indent}}`;
  const parts: string[] = [];
  if (deployments) {
    const entries = Object.entries(deployments).map(([city, d]) => `    ${JSON.stringify(city)}: ${sides(d, '    ')}`);
    parts.push(entries.length > 0 ? `  "deployments": {\n${entries.join(',\n')}\n  }` : '  "deployments": {}');
  }
  if (deploy) parts.push(`  "deploy": ${sides(deploy, '  ')}`);
  parts.push(list('cells', cells));
  if (units && units.length > 0) parts.push(list('units', units));
  return `${head},\n${parts.join(',\n')}\n}\n`;
}
