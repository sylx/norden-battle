/**
 * 移動の計算。HEX に入るのに使う行動力は地形（橋は人工物）の moveCost で、
 * 街道でつながった隣の HEX から入るときは半分になる（平地＋街道で 0.5）。
 *
 * - 敵のいる HEX は通れない。味方のいる HEX は通り抜けられるが、止まれない。
 * - 移動できる HEX = 最短で入るのに使う行動力が、残りの行動力以内の HEX。
 */
import { FEATURE_DEFS } from '@norden/map-runtime/core/features';
import type { Offset } from '@norden/map-runtime/core/hex';
import type { HexCell, HexMap } from '@norden/map-runtime/core/mapData';
import { hasRoad } from '@norden/map-runtime/core/roads';
import { TERRAIN_DEFS } from '@norden/map-runtime/core/terrainTypes';
import type { UnitData } from '@norden/map-runtime/core/units';

/** 移動できる HEX への最短経路 */
export interface MoveStep {
  col: number;
  row: number;
  /** ここまでに使う行動力 */
  cost: number;
  /** 1 つ前の HEX（出発地なら null） */
  prev: MoveStep | null;
}

/** from から dir の向きの隣 to に入るのに使う行動力（null は入れない） */
export function enterCost(from: HexCell, dir: number, to: HexCell): number | null {
  const feature = to.feature ? FEATURE_DEFS[to.feature].moveCost : undefined;
  const base = feature ?? TERRAIN_DEFS[to.terrain].moveCost;
  if (base === null) return null;
  return hasRoad(from, dir) ? base / 2 : base;
}

/**
 * unit が ap の行動力で移動できる HEX（出発地を除く）と、そこへの最短経路。
 * キーは HEX のインデックス（row × cols + col）。
 */
export function moveRange(map: HexMap, unit: UnitData, ap: number): Map<number, MoveStep> {
  const { cols } = map.layout;
  const key = (o: Offset) => o.row * cols + o.col;
  const start: MoveStep = { col: unit.col, row: unit.row, cost: 0, prev: null };
  const best = new Map<number, MoveStep>([[key(start), start]]);
  const done = new Set<number>();
  // 範囲は狭い（行動力 ÷ 最小コスト程度の半径）ので、未確定の中から最小を毎回探す素朴なダイクストラで足りる
  const open: MoveStep[] = [start];
  while (open.length > 0) {
    let i = 0;
    for (let j = 1; j < open.length; j++) if (open[j].cost < open[i].cost) i = j;
    const cur = open.splice(i, 1)[0];
    const k = key(cur);
    if (done.has(k)) continue;
    done.add(k);
    const from = map.get(cur.col, cur.row)!;
    for (let dir = 0; dir < 6; dir++) {
      const n = map.layout.neighborInDir(cur.col, cur.row, dir);
      const to = map.get(n.col, n.row);
      if (!to) continue;
      const other = map.unitAt(n.col, n.row);
      if (other && other.team !== unit.team) continue;
      const c = enterCost(from, dir, to);
      if (c === null) continue;
      const cost = cur.cost + c;
      if (cost > ap) continue;
      const nk = key(n);
      const prev = best.get(nk);
      if (prev && prev.cost <= cost) continue;
      const step = { col: n.col, row: n.row, cost, prev: cur };
      best.set(nk, step);
      open.push(step);
    }
  }
  // 出発地と味方のいる HEX には止まれない
  for (const [k, step] of best) {
    if (map.unitAt(step.col, step.row)) best.delete(k);
  }
  return best;
}

/** 出発地から step までの HEX（出発地・到着地を含む） */
export function movePath(step: MoveStep): Offset[] {
  const out: Offset[] = [];
  for (let s: MoveStep | null = step; s; s = s.prev) out.push({ col: s.col, row: s.row });
  return out.reverse();
}
