/**
 * テスト用のランダム HEX マップ生成。
 * 地形生成の見た目確認用なので、ゲームバランス的な配慮はしていない。
 */
import { HexLayout, axialDistance, type Axial, type Orientation } from './hex';
import type { HexCell, MapData } from './mapData';
import { Noise, mulberry32 } from './noise';
import type { TerrainId } from './terrainTypes';

export interface RandomMapOptions {
  name?: string;
  seed: number;
  cols: number;
  rows: number;
  orientation: Orientation;
  hexSize?: number;
}

export function generateRandomMap(opt: RandomMapOptions): MapData {
  const grid = { orientation: opt.orientation, cols: opt.cols, rows: opt.rows, hexSize: opt.hexSize ?? 1 };
  const layout = new HexLayout(grid);
  const rand = mulberry32(opt.seed * 7919 + 17);
  const noise = new Noise(opt.seed + 7);
  const { cols, rows } = grid;
  const idx = (c: number, r: number) => r * cols + c;

  // 標高・湿度の元になるノイズ（右上ほど高い）
  const elev = new Float32Array(cols * rows);
  const moist = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const w = layout.offsetToWorld(c, r);
      const gx = c / (cols - 1);
      const gz = 1 - r / (rows - 1);
      elev[idx(c, r)] = 0.5 + 0.5 * noise.fbm(w.x * 0.11, w.z * 0.11, 4) + 0.45 * (gx * 0.6 + gz * 0.4) - 0.25;
      moist[idx(c, r)] = 0.5 + 0.5 * noise.fbm(w.x * 0.16 + 40, w.z * 0.16 - 20, 3);
    }
  }

  // 川: 左端から右端へ、低い方を選びながら進む
  const river = new Set<number>();
  {
    let col = 0;
    let row = Math.floor(rows * (0.3 + rand() * 0.4));
    river.add(idx(col, row));
    let guard = 0;
    while (col < cols - 1 && guard++ < cols * 4) {
      const cur = layout.offsetToWorld(col, row);
      const cand = layout
        .neighbors(col, row)
        .filter((n) => layout.offsetToWorld(n.col, n.row).x > cur.x + 1e-6 && !river.has(idx(n.col, n.row)));
      if (cand.length === 0) break;
      let best = cand[0];
      let bestScore = Infinity;
      for (const n of cand) {
        const edgePenalty = n.row < 2 || n.row > rows - 3 ? 0.5 : 0;
        const score = elev[idx(n.col, n.row)] + rand() * 0.35 + edgePenalty;
        if (score < bestScore) {
          bestScore = score;
          best = n;
        }
      }
      col = best.col;
      row = best.row;
      river.add(idx(col, row));
    }
  }

  // 川からの HEX 距離
  const riverAxial: Axial[] = [...river].map((k) => layout.offsetToAxial(k % cols, Math.floor(k / cols)));
  const riverDist = (c: number, r: number) => {
    const a = layout.offsetToAxial(c, r);
    let d = Infinity;
    for (const ra of riverAxial) d = Math.min(d, axialDistance(a, ra));
    return d;
  };

  // 湖（低い場所に 1 つ、あれば）
  const lake = new Set<number>();
  if (rand() < 0.7) {
    let best = -1;
    let bestE = Infinity;
    for (let r = 2; r < rows - 2; r++) {
      for (let c = 2; c < cols - 2; c++) {
        if (riverDist(c, r) < 4) continue;
        if (elev[idx(c, r)] < bestE) {
          bestE = elev[idx(c, r)];
          best = idx(c, r);
        }
      }
    }
    if (best >= 0) {
      const c = best % cols;
      const r = Math.floor(best / cols);
      lake.add(best);
      for (const n of layout.neighbors(c, r)) if (rand() < 0.6) lake.add(idx(n.col, n.row));
    }
  }

  const cells: HexCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = idx(c, r);
      let terrain: TerrainId;
      let elevation: number;
      if (river.has(k)) {
        terrain = 'water';
        elevation = 0;
      } else if (lake.has(k)) {
        const isCenter = layout.neighbors(c, r).every((n) => lake.has(idx(n.col, n.row)));
        terrain = isCenter ? 'deep_water' : 'water';
        elevation = 0;
      } else {
        const e = elev[k];
        const m = moist[k];
        const d = riverDist(c, r);
        // 川から離れるほど高くなれる（谷地形）
        elevation = Math.max(0, Math.min(Math.round(e * 6 - 2), 6, d - 1));
        if (elevation >= 4) terrain = 'mountain';
        else if (elevation === 3) terrain = m > 0.55 ? 'forest' : e > 0.95 ? 'mountain' : 'hills';
        else if (elevation === 2) terrain = m > 0.6 ? 'forest' : m < 0.4 ? 'hills' : rand() < 0.3 ? 'hills' : 'plains';
        else if (m > 0.66 && elevation === 0 && d <= 2) terrain = 'swamp';
        else if (m > 0.56) terrain = 'forest';
        else if (m < 0.3) terrain = 'wasteland';
        else terrain = 'plains';
      }
      cells.push({ col: c, row: r, terrain, elevation });
    }
  }

  placeFeatures(layout, cells, opt.seed);
  return { version: 1, name: opt.name ?? `random-${opt.seed}`, seed: opt.seed, grid, cells };
}

/**
 * 人工物の自動配置（城 1・砦 1・村 3・橋 2 程度）。
 * 地形とは別の乱数列を使うので、人工物のロジックを変えても地形は変わらない。
 */
function placeFeatures(layout: HexLayout, cells: HexCell[], seed: number): void {
  const rand = mulberry32(seed * 104729 + 3);
  const { cols, rows } = layout;
  const at = (c: number, r: number) => (layout.inBounds(c, r) ? cells[r * cols + c] : undefined);
  const isLand = (cell: HexCell | undefined) => !!cell && cell.terrain !== 'water' && cell.terrain !== 'deep_water';
  const buildable = (cell: HexCell | undefined) =>
    isLand(cell) && cell!.terrain !== 'mountain' && cell!.terrain !== 'swamp' && !cell!.feature;
  const placed: HexCell[] = [];
  const dist = (a: HexCell, b: HexCell) =>
    axialDistance(layout.offsetToAxial(a.col, a.row), layout.offsetToAxial(b.col, b.row));
  const farFrom = (cell: HexCell, d: number) => placed.every((p) => dist(p, cell) >= d);
  const best = (score: (c: HexCell) => number) => {
    let out: HexCell | undefined;
    let bs = -Infinity;
    for (const c of cells) {
      const v = score(c);
      if (v > bs) {
        bs = v;
        out = c;
      }
    }
    return bs > -Infinity ? out : undefined;
  };
  const inner = (c: HexCell) => c.col >= 1 && c.row >= 1 && c.col < cols - 1 && c.row < rows - 1;

  // 城: 右上寄りの高台。隣接 HEX と合わせて 2〜3 HEX
  const castle = best((c) =>
    buildable(c) && inner(c) && c.elevation >= 1 ? c.elevation * 0.4 + c.col / cols + (1 - c.row / rows) + rand() * 0.6 : -Infinity,
  );
  if (castle) {
    const group = [castle];
    for (const n of layout.neighbors(castle.col, castle.row)) {
      const nc = at(n.col, n.row);
      if (group.length < 3 && buildable(nc) && Math.abs(nc!.elevation - castle.elevation) <= 1 && rand() < 0.7) group.push(nc!);
    }
    for (const c of group) {
      c.feature = 'castle';
      if (c.terrain === 'forest') c.terrain = 'plains';
      placed.push(c);
    }
  }

  // 橋: 両岸が陸になる川の HEX。互いに離す
  const bridgeAxes = (c: HexCell) => {
    const out: number[] = [];
    for (let axis = 0; axis < 3; axis++) {
      const a = layout.neighborInDir(c.col, c.row, axis);
      const b = layout.neighborInDir(c.col, c.row, axis + 3);
      if (isLand(at(a.col, a.row)) && isLand(at(b.col, b.row))) out.push(axis);
    }
    return out;
  };
  for (let i = 0; i < 2; i++) {
    const b = best((c) =>
      c.terrain === 'water' && !c.feature && bridgeAxes(c).length > 0 && farFrom(c, 5) && inner(c) ? rand() : -Infinity,
    );
    if (!b) break;
    b.feature = 'bridge';
    placed.push(b);
  }

  // 村: 川や橋に近い平地
  for (let i = 0; i < 3; i++) {
    const v = best((c) =>
      buildable(c) && c.elevation <= 2 && (c.terrain === 'plains' || c.terrain === 'wasteland') && farFrom(c, 3)
        ? rand() + (placed.some((p) => p.feature === 'bridge' && dist(p, c) <= 2) ? 0.8 : 0)
        : -Infinity,
    );
    if (!v) break;
    v.feature = 'village';
    placed.push(v);
  }

  // 砦: 城から離れた丘
  const fort = best((c) =>
    buildable(c) && inner(c) && farFrom(c, 4) ? (c.terrain === 'hills' ? 1 : 0) + c.elevation * 0.2 + rand() * 0.5 : -Infinity,
  );
  if (fort) {
    fort.feature = 'fort';
    if (fort.terrain === 'forest') fort.terrain = 'plains';
  }

  placeRoads(layout, cells, rand);
}

const ROAD_COST: Record<string, number> = {
  plains: 1,
  wasteland: 1.2,
  hills: 2,
  forest: 2.5,
  swamp: 4,
  mountain: 9,
};

/**
 * 街道: 城を起点に、砦・村を「すでに引いた道」までの最安経路でつなぐ。
 * さらにマップの左端から右端へ抜ける街道を 1 本通す。
 * 川は橋の HEX でだけ、まっすぐ渡れる。
 */
function placeRoads(layout: HexLayout, cells: HexCell[], rand: () => number): void {
  const { cols, rows } = layout;
  const N = cols * rows;
  const idx = (c: number, r: number) => r * cols + c;
  const cellOf = (k: number) => cells[k];

  const link = (a: number, b: number, dir: number) => {
    const add = (c: HexCell, d: number) => {
      const set = new Set(c.roads ?? []);
      set.add(d);
      c.roads = [...set].sort((p, q) => p - q);
    };
    add(cells[a], dir);
    add(cells[b], (dir + 3) % 6);
  };

  /** start から targets のどれかまでの経路（HEX index の列）。見つからなければ null */
  const route = (start: number, isTarget: (k: number) => boolean): { path: number[]; dirs: number[] } | null => {
    // 状態 = HEX × 進入方向（0..5, 6 = 出発点）。橋の上では直進しかできない
    const S = N * 7;
    const dist = new Float64Array(S).fill(Infinity);
    const prev = new Int32Array(S).fill(-1);
    const open: [number, number][] = [];
    const push = (st: number, d: number) => {
      open.push([d, st]);
      let i = open.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (open[p][0] <= open[i][0]) break;
        [open[p], open[i]] = [open[i], open[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = open[0];
      const last = open.pop()!;
      if (open.length > 0) {
        open[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < open.length && open[l][0] < open[m][0]) m = l;
          if (r < open.length && open[r][0] < open[m][0]) m = r;
          if (m === i) break;
          [open[m], open[i]] = [open[i], open[m]];
          i = m;
        }
      }
      return top;
    };
    const s0 = start * 7 + 6;
    dist[s0] = 0;
    push(s0, 0);
    while (open.length > 0) {
      const [d, st] = pop();
      if (d > dist[st]) continue;
      const k = Math.floor(st / 7);
      const din = st % 7;
      if (k !== start && isTarget(k)) {
        const path: number[] = [];
        const dirs: number[] = [];
        let cur = st;
        while (cur >= 0) {
          path.push(Math.floor(cur / 7));
          if (cur % 7 !== 6) dirs.push(cur % 7);
          cur = prev[cur];
        }
        return { path: path.reverse(), dirs: dirs.reverse() };
      }
      const c = cellOf(k);
      for (let dout = 0; dout < 6; dout++) {
        if (c.feature === 'bridge' && din !== 6 && dout !== din) continue;
        const o = layout.neighborInDir(c.col, c.row, dout);
        if (!layout.inBounds(o.col, o.row)) continue;
        const nk = idx(o.col, o.row);
        const nc = cellOf(nk);
        const target = isTarget(nk);
        let cost: number;
        if (nc.feature === 'castle' || nc.feature === 'fort') {
          if (!target) continue;
          cost = 1;
        } else if (nc.terrain === 'water' || nc.terrain === 'deep_water') {
          if (nc.feature !== 'bridge') continue;
          cost = 1.5;
        } else {
          cost = ROAD_COST[nc.terrain] ?? 1;
        }
        cost += Math.abs(nc.elevation - c.elevation) * 1.5;
        if (nc.roads) cost *= 0.3; // 既存の道を使い回す
        cost *= 0.9 + rand() * 0.2;
        const ns = nk * 7 + dout;
        if (d + cost < dist[ns]) {
          dist[ns] = d + cost;
          prev[ns] = st;
          push(ns, d + cost);
        }
      }
    }
    return null;
  };

  const apply = (r: { path: number[]; dirs: number[] }) => {
    for (let i = 0; i < r.dirs.length; i++) link(r.path[i], r.path[i + 1], r.dirs[i]);
  };

  // 城・砦は門が 1 つなので、後から来る道のつなぎ先にはしない
  const walled = (k: number) => cellOf(k).feature === 'castle' || cellOf(k).feature === 'fort';
  const onRoad = (k: number) => !!cellOf(k).roads && !walled(k);
  const castle = cells.findIndex((c) => c.feature === 'castle');
  const nodes = cells
    .map((c, k) => ({ c, k }))
    .filter(({ c }) => c.feature === 'village' || c.feature === 'fort')
    .map(({ k }) => k);

  let first = castle >= 0;
  for (const k of nodes) {
    // 最初の 1 本だけ城へ（門を 1 つにするため）。以降は既存の道へつなぐ
    const r = first ? route(k, (t) => cellOf(t).feature === 'castle') : route(k, onRoad);
    if (!r) continue;
    apply(r);
    first = false;
  }

  // 左端から右端へ抜ける街道
  const edgeCell = (col: number) => {
    let best = -1;
    let bs = Infinity;
    for (let r = 1; r < rows - 1; r++) {
      const c = cellOf(idx(col, r));
      if (c.terrain === 'water' || c.terrain === 'deep_water' || c.feature) continue;
      const v = Math.abs(r - rows / 2) * 0.3 + (ROAD_COST[c.terrain] ?? 1) + rand();
      if (v < bs) {
        bs = v;
        best = idx(col, r);
      }
    }
    return best;
  };
  const west = edgeCell(0);
  const east = edgeCell(cols - 1);
  if (west >= 0 && east >= 0) {
    const r = route(west, (t) => t === east || (onRoad(t) && t % cols > cols / 2));
    if (r) {
      apply(r);
      const last = r.path[r.path.length - 1];
      if (last !== east) {
        const r2 = route(east, onRoad);
        if (r2) apply(r2);
      }
      // マップの外へ抜ける方向を付ける
      for (const k of [west, east]) {
        const c = cellOf(k);
        for (let d = 0; d < 6; d++) {
          const o = layout.neighborInDir(c.col, c.row, d);
          const w0 = layout.offsetToWorld(c.col, c.row);
          const w1 = layout.offsetToWorld(o.col, o.row);
          const outward = k === west ? w1.x < w0.x - 1e-6 : w1.x > w0.x + 1e-6;
          if (!layout.inBounds(o.col, o.row) && outward && Math.abs(w1.z - w0.z) < layout.size) {
            c.roads = [...new Set([...(c.roads ?? []), d])].sort((p, q) => p - q);
            break;
          }
        }
      }
    }
  }
}
