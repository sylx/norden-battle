/**
 * 移動の計算。HEX に入るのに使う行動力は地形（橋は人工物）の moveCost で、
 * 街道でつながった隣の HEX から入るときは半分になる（平地＋街道で 0.5）。
 *
 * - 敵のいる HEX は通れない。味方のいる HEX は通り抜けられるが、止まれない。
 * - 移動できる HEX = 最短で入るのに使う行動力が、残りの行動力以内の HEX。
 * - 移動は何回かに分けて予約できる（予約した移動先から続きを探す）。
 *
 * ZOC（支配領域）: 敵ユニットに隣接する HEX は、その敵の ZOC。
 * - 敵の ZOC に入ったらそこで止まり、それ以上は移動できない（あとは攻撃などをするしかない）。
 * - 敵の ZOC の中にいるユニットは移動できない。ただし、そのターンにまだ移動も攻撃もしていなければ（ターンの初めは）
 *   ZOC の中から動き出せる（escapeZoc）。ただし ZOC から ZOC へは移れない（周りを ZOC で囲まれると動けない＝包囲）。
 * - ZOC_IGNORE の兵種は ZOC を気にせず動ける（いまは無し。騎兵などの例外はここに足す）。
 *
 * 包囲: 隣の HEX がどれも入れない（マップの外・通れない地形）か、敵がいるか、敵の ZOC の中で、
 * 隣に敵が 1 体以上いれば包囲されている（ZOC から ZOC へは移れないので逃げ場が無い）。
 * 例えば、敵 2 体に反対側から挟まれると周りがすべて ZOC になって包囲になる。包囲されると受けるダメージが増える（damage.ts）。
 */
import { FEATURE_DEFS } from '@norden/map-runtime/core/features';
import type { Offset } from '@norden/map-runtime/core/hex';
import type { HexCell, HexMap } from '@norden/map-runtime/core/mapData';
import { hasRoad } from '@norden/map-runtime/core/roads';
import { TERRAIN_DEFS } from '@norden/map-runtime/core/terrainTypes';
import type { UnitData, UnitType } from '@norden/map-runtime/core/units';

/** ZOC を気にせず動ける兵種 */
const ZOC_IGNORE: readonly UnitType[] = [];

/** 移動できる HEX への最短経路 */
export interface MoveStep {
  col: number;
  row: number;
  /** ここまでに使う行動力（それまでに予約した分を含む） */
  cost: number;
  /** 1 つ前の HEX（この回の移動の出発地なら null） */
  prev: MoveStep | null;
  /** 敵の ZOC の中（ここに入ると止まり、それ以上は移動できない） */
  zoc: boolean;
}

/** cell に入るのに使う行動力（街道を使わないとき。null は入れない） */
export function cellMoveCost(cell: HexCell): number | null {
  const feature = cell.feature ? FEATURE_DEFS[cell.feature].moveCost : undefined;
  return feature ?? TERRAIN_DEFS[cell.terrain].moveCost;
}

/** from から dir の向きの隣 to に入るのに使う行動力（null は入れない） */
export function enterCost(from: HexCell, dir: number, to: HexCell): number | null {
  const base = cellMoveCost(to);
  if (base === null) return null;
  return hasRoad(from, dir) ? base / 2 : base;
}

export interface MoveOptions {
  /** それまでに予約した移動で使った行動力。合わせて ap 以内のところまで行ける */
  spent?: number;
  /** 敵の ZOC の中からでも動き出せる（ターンの初め） */
  escapeZoc?: boolean;
}

/**
 * unit が from から ap の行動力で移動できる HEX（from を除く）と、そこへの最短経路。
 * キーは HEX のインデックス（row × cols + col）。
 */
export function moveRange(map: HexMap, unit: UnitData, from: Offset, ap: number, { spent = 0, escapeZoc = false }: MoveOptions = {}): Map<number, MoveStep> {
  const { cols } = map.layout;
  const key = (o: Offset) => o.row * cols + o.col;
  const zoc = ZOC_IGNORE.includes(unit.type) ? new Set<number>() : enemyZoc(map, unit);
  // 敵の ZOC の中からは動けない（ターンの初めは除く）
  if (zoc.has(key(from)) && !escapeZoc) return new Map();
  const start: MoveStep = { col: from.col, row: from.row, cost: spent, prev: null, zoc: zoc.has(key(from)) };
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
    // 敵の ZOC に入ったところで止まる（ZOC の中から動き出すときの出発地は除く）
    if (cur.zoc && cur !== start) continue;
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
      const inZoc = zoc.has(nk);
      // ZOC から ZOC へは移れない
      if (cur.zoc && inZoc) continue;
      const prev = best.get(nk);
      if (prev && prev.cost <= cost) continue;
      const step = { col: n.col, row: n.row, cost, prev: cur, zoc: inZoc };
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

/** unit が pos で敵の ZOC の中にいるか（ZOC を気にしない兵種なら常に false） */
export function inEnemyZoc(map: HexMap, unit: UnitData, pos: Offset): boolean {
  return !ZOC_IGNORE.includes(unit.type) && enemyZoc(map, unit).has(pos.row * map.layout.cols + pos.col);
}

/** unit にとっての敵の ZOC（敵ユニットに隣接する HEX。キーは row × cols + col） */
export function enemyZoc(map: HexMap, unit: UnitData): Set<number> {
  const { cols } = map.layout;
  const out = new Set<number>();
  for (const enemy of map.allUnits()) {
    if (enemy.team === unit.team) continue;
    for (const n of map.layout.neighbors(enemy.col, enemy.row)) out.add(n.row * cols + n.col);
  }
  return out;
}

/**
 * pos にいるユニットが包囲されているか。enemies はそのユニットの敵の位置
 * （予約した攻撃の予測では、攻撃する側を攻撃する HEX に置いたもの）。
 */
export function encircled(map: HexMap, pos: Offset, enemies: readonly Offset[]): boolean {
  const { cols } = map.layout;
  const key = (o: Offset) => o.row * cols + o.col;
  const occupied = new Set(enemies.map(key));
  const zoc = new Set<number>();
  for (const e of enemies) for (const n of map.layout.neighbors(e.col, e.row)) zoc.add(key(n));
  const from = map.get(pos.col, pos.row);
  if (!from) return false;
  let adjacent = 0;
  for (let dir = 0; dir < 6; dir++) {
    const n = map.layout.neighborInDir(pos.col, pos.row, dir);
    const k = key(n);
    if (occupied.has(k)) {
      adjacent++;
      continue;
    }
    const to = map.get(n.col, n.row);
    if (to && enterCost(from, dir, to) !== null && !zoc.has(k)) return false;
  }
  return adjacent > 0;
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
