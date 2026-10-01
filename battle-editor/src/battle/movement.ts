/**
 * 移動の計算。HEX に入るのに使う行動力は地形（橋は人工物）の moveCost で、
 * 街道でつながった隣の HEX から入るときは半分になる（平地＋街道で 0.5）。
 *
 * - 敵のいる HEX は通れない。味方のいる HEX は通り抜けられるが、止まれない。
 * - 移動できる HEX = 最短で入るのに使う行動力が、残りの行動力以内の HEX。
 * - 移動は何回かに分けて予約できる（予約した移動先から続きを探す）。
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
  /** ここまでに使う行動力（それまでに予約した分を含む） */
  cost: number;
  /** 1 つ前の HEX（この回の移動の出発地なら null） */
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
 * unit が from から移動できる HEX（from を除く）と、そこへの最短経路。
 * spent はそれまでに予約した移動で使った行動力で、合わせて ap 以内のところまで行ける。
 * キーは HEX のインデックス（row × cols + col）。
 */
export function moveRange(map: HexMap, unit: UnitData, from: Offset, ap: number, spent = 0): Map<number, MoveStep> {
  const { cols } = map.layout;
  const key = (o: Offset) => o.row * cols + o.col;
  const start: MoveStep = { col: from.col, row: from.row, cost: spent, prev: null };
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
      if (other && other !== unit && other.team !== unit.team) continue;
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
  // 出発地と味方のいる HEX には止まれない（動かすユニットが元いた HEX には戻れる）
  best.delete(key(from));
  for (const [k, step] of best) {
    const other = map.unitAt(step.col, step.row);
    if (other && other !== unit) best.delete(k);
  }
  return best;
}

/** 予約した移動（各回の到着地の MoveStep）をつないだ経路。最初の出発地からすべての到着地までの HEX */
export function movePath(legs: readonly MoveStep[]): Offset[] {
  const out: Offset[] = [];
  for (const leg of legs) {
    const part: Offset[] = [];
    for (let s: MoveStep | null = leg; s; s = s.prev) part.push({ col: s.col, row: s.row });
    part.reverse();
    // 2 回目からは出発地（前の回の到着地）がだぶるので省く
    out.push(...(out.length > 0 ? part.slice(1) : part));
  }
  return out;
}
