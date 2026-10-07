/**
 * 地形の編集（標高ブラシ・地形の塗り・川・全地形クリア）の計算。
 * ドラッグ中は編集結果（CellEdits）を求めてプレビューし、離したときに applyEdits でマップへ書き込む。
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { HexCell, HexMap } from '@norden/map-runtime/core/mapData';
import { Noise } from '@norden/map-runtime/core/noise';
import { TERRAIN_DEFS, type TerrainId } from '@norden/map-runtime/core/terrainTypes';

/** エディタで扱う標高の範囲 */
export const MIN_ELEVATION = 0;
export const MAX_ELEVATION = 8;

/** 上げる / 下げる / 平らにする（なぞり始めた HEX の高さに） / 指定の高さにする */
export type ElevationMode = 'raise' | 'lower' | 'flatten' | 'set';

export interface ElevationBrush {
  mode: ElevationMode;
  /** 上げ下げする段数 */
  amount: number;
  /** 'set' の高さ */
  level: number;
  /** なぞった HEX から何 HEX 先まで効かせるか */
  radius: number;
  /** 裾野をなだらかにする（中心から 1 HEX 離れるごとに 1 段ずつ効きを弱める） */
  smooth: boolean;
  /** 上げたとき、2 段以上上げた HEX を山岳に、1 段の HEX（草原・荒地）を丘陵にする */
  shapeTerrain: boolean;
  /** 水域の HEX は変えない（水面の高さは一定なので、水域は標高 0 のままにする） */
  keepWater: boolean;
}

export interface TerrainBrush {
  terrain: TerrainId;
  /** ブラシでなぞる / 2 つの HEX を対角にした矩形 */
  shape: 'brush' | 'rect';
  radius: number;
  /** 矩形で陸の地形を塗るとき、水域と山岳はそのままにする（ブラシは指定どおりに上塗りする） */
  protect: boolean;
}

export interface RiverBrush {
  /** 川を引く / なぞった水域を陸に戻す */
  mode: 'draw' | 'erase';
  deep: boolean;
  /** 両岸の標高を川から離れるほど高くなるように削る（1 HEX 先は 1 段まで、2 HEX 先は 2 段まで） */
  carveBanks: boolean;
}

export interface ClearOptions {
  terrain: TerrainId;
  elevation: { mode: 'flat'; level: number } | { mode: 'random'; seed: number; min: number; max: number; scale: number };
  /** ランダムの標高で、高い所を丘陵・山岳にする */
  shapeTerrain: boolean;
  /** 人工物と街道も消す */
  clearFeatures: boolean;
}

export interface CellEdit {
  terrain: TerrainId;
  elevation: number;
}

/** HEX のインデックス（row * cols + col） → 編集後の地形・標高 */
export type CellEdits = Map<number, CellEdit>;

const BUILDINGS = new Set(['village', 'fort', 'castle']);

const isWater = (t: TerrainId) => TERRAIN_DEFS[t].isWater;
const clampElevation = (e: number) => Math.min(Math.max(Math.round(e), MIN_ELEVATION), MAX_ELEVATION);

/** path の各 HEX から radius 以内の HEX と、path までの最短の HEX 距離 */
export function distanceField(map: HexMap, path: readonly Offset[], radius: number): Map<number, number> {
  const { layout } = map;
  const out = new Map<number, number>();
  for (const p of path) {
    const a = layout.offsetToAxial(p.col, p.row);
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
        const o = layout.axialToOffset(a.q + dq, a.r + dr);
        if (!layout.inBounds(o.col, o.row)) continue;
        const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
        const k = o.row * layout.cols + o.col;
        const cur = out.get(k);
        if (cur === undefined || d < cur) out.set(k, d);
      }
    }
  }
  return out;
}

/** a と b を対角にした（オフセット座標の）矩形の HEX */
export function rectCells(map: HexMap, a: Offset, b: Offset): number[] {
  const out: number[] = [];
  const { cols } = map.layout;
  for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++) {
    for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col++) out.push(row * cols + col);
  }
  return out;
}

const cellAt = (map: HexMap, k: number): HexCell => map.allCells()[k];

/** 標高ブラシで path をなぞった結果。flattenLevel は 'flatten' の目標の高さ（なぞり始めた HEX の高さ） */
export function elevationEdits(map: HexMap, path: readonly Offset[], brush: ElevationBrush, flattenLevel: number): CellEdits {
  const edits: CellEdits = new Map();
  for (const [k, d] of distanceField(map, path, brush.radius)) {
    const cell = cellAt(map, k);
    if (brush.keepWater && isWater(cell.terrain)) continue;
    let elevation = cell.elevation;
    let terrain = cell.terrain;
    if (brush.mode === 'raise' || brush.mode === 'lower') {
      const delta = brush.smooth ? brush.amount - d : brush.amount;
      if (delta <= 0) continue;
      elevation = clampElevation(elevation + (brush.mode === 'raise' ? delta : -delta));
      if (brush.mode === 'raise' && brush.shapeTerrain && !isWater(terrain)) {
        if (delta >= 2) terrain = 'mountain';
        else if (terrain === 'plains' || terrain === 'wasteland') terrain = 'hills';
      }
    } else {
      const target = brush.mode === 'flatten' ? flattenLevel : brush.level;
      // なだらかにするときは、中心から d HEX 先は目標から d 段まで離れていてよい
      const tol = brush.smooth ? d : 0;
      elevation = clampElevation(Math.min(Math.max(elevation, target - tol), target + tol));
    }
    // 水域を持ち上げたら陸にする（水面より上の水域は見た目が陸になるため）
    if (isWater(terrain) && elevation > 0) terrain = 'plains';
    if (elevation !== cell.elevation || terrain !== cell.terrain) edits.set(k, { terrain, elevation });
  }
  return edits;
}

/** 地形を塗った結果。cells は塗る HEX のインデックス */
export function terrainEdits(map: HexMap, cells: Iterable<number>, brush: TerrainBrush): CellEdits {
  const edits: CellEdits = new Map();
  const toWater = isWater(brush.terrain);
  for (const k of cells) {
    const cell = cellAt(map, k);
    if (cell.terrain === brush.terrain) continue;
    if (!toWater && brush.protect && brush.shape === 'rect' && (isWater(cell.terrain) || cell.terrain === 'mountain')) continue;
    // 建物のある HEX は森にしない（どうせ木が生えない）
    if (brush.terrain === 'forest' && cell.feature && BUILDINGS.has(cell.feature)) continue;
    // 水面の高さは一定なので、水域は標高 0 にする
    edits.set(k, { terrain: brush.terrain, elevation: toWater ? 0 : cell.elevation });
  }
  return edits;
}

/** 川を path に沿って引いた（消した）結果 */
export function riverEdits(map: HexMap, path: readonly Offset[], brush: RiverBrush): CellEdits {
  if (brush.mode === 'erase') return riverEraseEdits(map, path);
  const edits: CellEdits = new Map();
  const terrain: TerrainId = brush.deep ? 'deep_water' : 'water';
  if (brush.carveBanks) {
    for (const [k, d] of distanceField(map, path, 2)) {
      if (d === 0) continue;
      const cell = cellAt(map, k);
      if (isWater(cell.terrain) || cell.elevation <= d) continue;
      edits.set(k, { terrain: cell.terrain, elevation: d });
    }
  }
  const { cols } = map.layout;
  for (const o of path) {
    const k = o.row * cols + o.col;
    const cell = cellAt(map, k);
    if (cell.terrain !== terrain || cell.elevation !== 0) edits.set(k, { terrain, elevation: 0 });
  }
  return edits;
}

/** なぞった水域を草原に戻す。標高は隣の陸（なぞった HEX を除く）の最も低い高さにそろえる */
function riverEraseEdits(map: HexMap, path: readonly Offset[]): CellEdits {
  const edits: CellEdits = new Map();
  const { layout } = map;
  const keys = new Set(path.map((o) => o.row * layout.cols + o.col));
  for (const k of keys) {
    const cell = cellAt(map, k);
    if (!isWater(cell.terrain)) continue;
    let elevation = Infinity;
    for (const n of layout.neighbors(cell.col, cell.row)) {
      const nk = n.row * layout.cols + n.col;
      const nc = cellAt(map, nk);
      if (!keys.has(nk) && !isWater(nc.terrain)) elevation = Math.min(elevation, nc.elevation);
    }
    edits.set(k, { terrain: 'plains', elevation: Number.isFinite(elevation) ? elevation : 0 });
  }
  return edits;
}

/**
 * 地形が変わった HEX の人工物を合わせる: 水域になった HEX の建物は撤去し、街道が通っていれば橋を架ける。
 * 陸になった HEX の橋は撤去する。
 */
function fixFeature(cell: HexCell): void {
  if (isWater(cell.terrain)) {
    if (cell.feature && BUILDINGS.has(cell.feature)) {
      delete cell.feature;
      delete cell.featureDir;
    }
    if (!cell.feature && cell.roads && cell.roads.length > 0) cell.feature = 'bridge';
  } else if (cell.feature === 'bridge') {
    delete cell.feature;
    delete cell.featureDir;
  }
}

/** 編集結果をマップに書き込む */
export function applyEdits(map: HexMap, edits: CellEdits): void {
  for (const [k, e] of edits) {
    const cell = cellAt(map, k);
    cell.terrain = e.terrain;
    cell.elevation = e.elevation;
    fixFeature(cell);
  }
}

/** 全 HEX を 1 つの地形にする（標高は一定かランダム） */
export function clearTerrain(map: HexMap, opt: ClearOptions): void {
  const { layout } = map;
  const el = opt.elevation;
  const noise = el.mode === 'random' ? new Noise(el.seed * 131 + 7) : null;
  const lo = el.mode === 'random' ? Math.min(el.min, el.max) : 0;
  const hi = el.mode === 'random' ? Math.max(el.min, el.max) : 0;
  for (const cell of map.allCells()) {
    let terrain = opt.terrain;
    let elevation = el.mode === 'flat' ? el.level : 0;
    if (el.mode === 'random' && noise) {
      const w = layout.offsetToWorld(cell.col, cell.row);
      const f = el.scale / layout.size;
      // fBm は ±1 まで届きにくいので少し広げる
      const v = Math.min(Math.max(0.5 + 0.75 * noise.fbm(w.x * f, w.z * f, 4), 0), 1);
      elevation = lo + Math.round(v * (hi - lo));
      if (opt.shapeTerrain && !isWater(terrain) && hi - lo >= 2) {
        const t = (elevation - lo) / (hi - lo);
        if (t >= 0.8) terrain = 'mountain';
        else if (t >= 0.55) terrain = 'hills';
      }
    }
    cell.terrain = terrain;
    cell.elevation = isWater(terrain) ? 0 : clampElevation(elevation);
    if (opt.clearFeatures) {
      delete cell.feature;
      delete cell.featureDir;
      delete cell.roads;
    } else {
      fixFeature(cell);
    }
  }
}
