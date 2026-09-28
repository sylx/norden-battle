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

  return { version: 1, name: opt.name ?? `random-${opt.seed}`, seed: opt.seed, grid, cells };
}
