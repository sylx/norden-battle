/**
 * 人工物（HEX に 1 つ置ける構造物）の定義と、配置に関する補助関数。
 *
 * - bridge : 川・浅瀬の HEX に置く。featureDir（0..5）で向きを指定、省略時は両岸が陸になる向きを自動選択
 * - village: 陸の HEX に置く。家々が HEX 内に散らばる
 * - fort   : 陸の HEX に置く。隣接する fort HEX は 1 つの砦になり、外周に木柵が巡る
 * - castle : 陸の HEX に置く。隣接する castle HEX は 1 つの城になり、外周に城壁・塔・門ができる
 */
import type { Offset } from './hex';
import type { HexCell, HexMap } from './mapData';
import { TERRAIN_DEFS } from './terrainTypes';

export const FEATURE_IDS = ['bridge', 'village', 'fort', 'castle'] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

export interface FeatureDef {
  id: FeatureId;
  name: string;
  /** true = 水域にのみ置ける / false = 陸にのみ置ける */
  onWater: boolean;
  /** HEX に入るのに使う行動力。地形の moveCost の代わりに使う（省略時は地形のまま） */
  moveCost?: number;
}

export const FEATURE_DEFS: Record<FeatureId, FeatureDef> = {
  bridge: { id: 'bridge', name: '橋', onWater: true, moveCost: 1 },
  village: { id: 'village', name: '村', onWater: false },
  fort: { id: 'fort', name: '砦', onWater: false },
  castle: { id: 'castle', name: '城', onWater: false },
};

export function isFeatureId(v: unknown): v is FeatureId {
  return typeof v === 'string' && (FEATURE_IDS as readonly string[]).includes(v);
}

export function canPlaceFeature(cell: HexCell, feature: FeatureId): boolean {
  return TERRAIN_DEFS[cell.terrain].isWater === FEATURE_DEFS[feature].onWater;
}

function isLand(map: HexMap, o: Offset): boolean {
  const c = map.get(o.col, o.row);
  return !!c && !TERRAIN_DEFS[c.terrain].isWater;
}

/** 橋を架けられる軸（0..2）。両端の隣接 HEX が陸であるもの */
export function bridgeAxisCandidates(map: HexMap, col: number, row: number): number[] {
  const out: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const a = map.layout.neighborInDir(col, row, axis);
    const b = map.layout.neighborInDir(col, row, axis + 3);
    if (isLand(map, a) && isLand(map, b)) out.push(axis);
  }
  return out;
}

/** 橋の軸（0..2）。featureDir > 街道の向き > 両岸が陸の軸 > 片側でも陸がある軸 の順で決める */
export function bridgeAxis(map: HexMap, cell: HexCell): number {
  if (cell.featureDir !== undefined) return cell.featureDir % 3;
  const cands = bridgeAxisCandidates(map, cell.col, cell.row);
  // 街道が通っていればその向きに架ける
  if (cell.roads && cell.roads.length > 0) {
    const roadAxes = cell.roads.map((d) => d % 3);
    const both = roadAxes.find((axis) => cell.roads!.includes(axis) && cell.roads!.includes(axis + 3));
    if (both !== undefined) return both;
    const withLand = roadAxes.find((axis) => cands.includes(axis));
    return withLand ?? roadAxes[0];
  }
  if (cands.length > 0) return cands[0];
  for (let axis = 0; axis < 3; axis++) {
    if (isLand(map, map.layout.neighborInDir(cell.col, cell.row, axis))) return axis;
    if (isLand(map, map.layout.neighborInDir(cell.col, cell.row, axis + 3))) return axis;
  }
  return 0;
}

/** 同じ人工物が隣接してつながった領域の一覧 */
export function featureRegions(map: HexMap, feature: FeatureId): HexCell[][] {
  const { cols } = map.layout;
  const seen = new Set<number>();
  const regions: HexCell[][] = [];
  for (const cell of map.allCells()) {
    const k = cell.row * cols + cell.col;
    if (cell.feature !== feature || seen.has(k)) continue;
    const region: HexCell[] = [];
    const stack = [cell];
    seen.add(k);
    while (stack.length > 0) {
      const c = stack.pop()!;
      region.push(c);
      for (const n of map.layout.neighbors(c.col, c.row)) {
        const nk = n.row * cols + n.col;
        const nc = map.get(n.col, n.row)!;
        if (nc.feature !== feature || seen.has(nk)) continue;
        seen.add(nk);
        stack.push(nc);
      }
    }
    regions.push(region);
  }
  return regions;
}
