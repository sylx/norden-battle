/**
 * 街道。
 *
 * データ: HexCell.roads に、道がつながっている方向（0..5）を持つ。
 *   隣の HEX 側にも逆方向（(dir + 3) % 6）が入っている（HexMap 生成時にそろえる）。
 *   マップ外への方向も持てる（マップの端から道が入ってくる表現）。
 *
 * 形状: HEX 内では「辺の中点 → 中心付近 → 別の辺の中点」を 2 次ベジェ曲線でつなぐ。
 *   辺の中点での接線は辺に垂直になるので、隣の HEX の道と滑らかにつながる。
 *   さらに両端を固定したまま横方向に少し揺らして自然な道にする。
 */
import type { Offset, Vec2 } from './hex';
import type { HexCell, HexMap } from './mapData';
import { Noise } from './noise';

/** 道の幅（hexSize 比）。描画・木の除外・建物の配置で共通に使う */
export const ROAD_WIDTH = 0.14;

/** 道を描かない（城壁・柵の内側）人工物 */
const NO_ROAD_FEATURES = new Set(['castle', 'fort']);

/** a → b の方向（隣接していなければ -1） */
export function dirBetween(map: HexMap, a: Offset, b: Offset): number {
  for (let d = 0; d < 6; d++) {
    const n = map.layout.neighborInDir(a.col, a.row, d);
    if (n.col === b.col && n.row === b.row) return d;
  }
  return -1;
}

export function hasRoad(cell: HexCell, dir: number): boolean {
  return !!cell.roads && cell.roads.includes(dir);
}

function setDir(cell: HexCell, dir: number, on: boolean): void {
  const set = new Set(cell.roads ?? []);
  if (on) set.add(dir);
  else set.delete(dir);
  if (set.size === 0) delete cell.roads;
  else cell.roads = [...set].sort((p, q) => p - q);
}

/** 隣り合う 2 HEX の間の道を付け外しする（両側をそろえる） */
export function setRoad(map: HexMap, a: Offset, b: Offset, on: boolean): boolean {
  const d = dirBetween(map, a, b);
  const ca = map.get(a.col, a.row);
  const cb = map.get(b.col, b.row);
  if (d < 0 || !ca || !cb) return false;
  setDir(ca, d, on);
  setDir(cb, (d + 3) % 6, on);
  return true;
}

/** HEX の道をすべて外す */
export function clearRoads(map: HexMap, o: Offset): void {
  const cell = map.get(o.col, o.row);
  if (!cell?.roads) return;
  for (const d of cell.roads) {
    const n = map.layout.neighborInDir(o.col, o.row, d);
    const nc = map.get(n.col, n.row);
    if (nc) setDir(nc, (d + 3) % 6, false);
  }
  delete cell.roads;
}

/** 片側にしか無い道を両側にそろえる */
export function normalizeRoads(map: HexMap): void {
  for (const cell of map.allCells()) {
    for (const d of cell.roads ?? []) {
      const n = map.layout.neighborInDir(cell.col, cell.row, d);
      const nc = map.get(n.col, n.row);
      if (nc) setDir(nc, (d + 3) % 6, true);
    }
  }
}

/**
 * 道の中心線（ワールド XZ の折れ線の集合）。
 * 城・砦の HEX の中は描かない（門までで止まる）。
 */
export function buildRoadPaths(map: HexMap): Vec2[][] {
  const layout = map.layout;
  const noise = new Noise(map.data.seed + 303);
  const { x: ox, z: oz } = map.noiseOffset;
  const s = layout.size;
  const step = 0.03 * s;
  const wobble = 0.09 * s;
  const paths: Vec2[][] = [];

  const curve = (p0: Vec2, p1: Vec2, p2: Vec2): Vec2[] => {
    const approx = Math.hypot(p1.x - p0.x, p1.z - p0.z) + Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n = Math.max(2, Math.ceil(approx / step));
    const pts: Vec2[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      const x = a * p0.x + b * p1.x + c * p2.x;
      const z = a * p0.z + b * p1.z + c * p2.z;
      // 接線に垂直な方向へ揺らす（両端は動かさない）
      const tx = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
      const tz = 2 * (1 - t) * (p1.z - p0.z) + 2 * t * (p2.z - p1.z);
      const tl = Math.hypot(tx, tz) || 1;
      const w = wobble * Math.sin(Math.PI * t) * noise.simplex(((x + ox) / s) * 1.2, ((z + oz) / s) * 1.2);
      pts.push({ x: x - (tz / tl) * w, z: z + (tx / tl) * w });
    }
    return pts;
  };

  for (const cell of map.allCells()) {
    const dirs = cell.roads;
    if (!dirs || dirs.length === 0) continue;
    if (cell.feature && NO_ROAD_FEATURES.has(cell.feature)) continue;
    const c = layout.offsetToWorld(cell.col, cell.row);
    const mids = dirs.map((d) => {
      const n = layout.neighborInDir(cell.col, cell.row, d);
      const w = layout.offsetToWorld(n.col, n.row);
      return { x: (c.x + w.x) / 2, z: (c.z + w.z) / 2 };
    });
    if (mids.length === 2) {
      paths.push(curve(mids[0], c, mids[1]));
    } else {
      // 行き止まり・分岐は中心へ集める
      for (const m of mids) paths.push(curve(m, { x: (m.x + c.x) / 2, z: (m.z + c.z) / 2 }, c));
    }
  }
  return paths;
}

/** 道の中心線への距離を高速に引くための空間インデックス */
export class RoadIndex {
  private readonly cell: number;
  private readonly grid = new Map<string, [Vec2, Vec2][]>();
  readonly paths: Vec2[][];

  constructor(paths: Vec2[][], cellSize = 0.25) {
    this.paths = paths;
    this.cell = cellSize;
    for (const path of paths) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const k = this.key((a.x + b.x) / 2, (a.z + b.z) / 2);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push([a, b]);
      }
    }
  }

  private key(x: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }

  get empty(): boolean {
    return this.grid.size === 0;
  }

  /** (x, z) から最寄りの道までの距離（maxR より遠ければ Infinity） */
  distance(x: number, z: number, maxR: number): number {
    if (this.grid.size === 0) return Infinity;
    const r = Math.ceil(maxR / this.cell) + 1;
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const list = this.grid.get(`${cx + dx},${cz + dz}`);
        if (!list) continue;
        for (const [a, b] of list) best = Math.min(best, segDist(x, z, a, b));
      }
    }
    return best <= maxR ? best : Infinity;
  }
}

function segDist(x: number, z: number, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.min(Math.max(((x - a.x) * vx + (z - a.z) * vz) / l2, 0), 1) : 0;
  return Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
}
