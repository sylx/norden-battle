/**
 * HEX マップ → プロシージャル地形の生成（three.js 非依存の純粋な計算部分）。
 *
 * 考え方:
 *   1. 各サンプル点で「近傍 7 HEX の重み」を求める。
 *      重みは HEX 中心からの距離に対するカーネル K(d/内接半径) で、
 *        - blendStart 以内 … その HEX だけの値（台地になる）
 *        - blendStart〜blendEnd … 隣の HEX と滑らかに混ざる
 *      辺の中点では 2 HEX が 1:1、頂点では 3 HEX が 1:1:1 になるので境界は連続。
 *   2. サンプル座標をドメインワープしてから重みを取るので、
 *      地形の境目は HEX の直線ではなく有機的な形になる（HEX グリッド自体は規則的なまま）。
 *   3. 標高レベルと地形ごとのオフセット・色を重みで混ぜて高さと色を作る（高さにノイズは乗せない）。
 */
import type { HexMap } from './mapData';
import { Noise, hash2, lerp, smoothstep } from './noise';
import { ROAD_WIDTH, type RoadIndex } from './roads';
import { TERRAIN_DEFS, TERRAIN_IDS, TERRAIN_INDEX, type RGB } from './terrainTypes';

export interface TerrainParams {
  /** ワールド 1 単位あたりの頂点数 */
  resolution: number;
  /** マップ外周に余分に生成する幅（HEX 数） */
  margin: number;
  /** 標高 1 レベルあたりの高さ（hexSize 比） */
  levelHeight: number;
  /** カーネルの平坦部の終わり（内接半径比） */
  blendStart: number;
  /** カーネルの減衰の終わり（内接半径比, 1.2〜2.2） */
  blendEnd: number;
  /** ドメインワープ量（hexSize 比） */
  warpAmp: number;
  /** ドメインワープの周波数（1/hexSize） */
  warpFreq: number;
  /** 水面の高さ（hexSize 比） */
  waterLevel: number;
  /** 雪線の高さ（hexSize 比） */
  snowLine: number;
  /** 色の混ぜ方の鋭さ（1 = 高さと同じ、大きいほど境界がくっきり） */
  colorSharpness: number;
  /** 木の密度倍率 */
  treeDensity: number;
  /** 木の配置候補点の間隔（hexSize 比） */
  treeSpacing: number;
}

export const DEFAULT_TERRAIN_PARAMS: TerrainParams = {
  resolution: 10,
  margin: 2,
  levelHeight: 0.32,
  blendStart: 0.55,
  blendEnd: 1.7,
  warpAmp: 0.28,
  warpFreq: 0.9,
  waterLevel: -0.12,
  snowLine: 2.1,
  colorSharpness: 2.5,
  treeDensity: 1,
  treeSpacing: 0.2,
};

export const TreeKind = { Conifer: 0, Broadleaf: 1, Bush: 2 } as const;
export type TreeKind = (typeof TreeKind)[keyof typeof TreeKind];

export interface TreeInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
  kind: TreeKind;
  /** 色のばらつき 0..1 */
  tint: number;
  /** 形状バリエーション選択用 0..1 */
  variant: number;
}

export interface TerrainData {
  nx: number;
  nz: number;
  minX: number;
  minZ: number;
  step: number;
  heights: Float32Array;
  normals: Float32Array;
  /** sRGB 0..1 */
  colors: Float32Array;
  waterLevel: number;
  stats: { ms: number };
}

const NT = TERRAIN_IDS.length;
const MAX_K = 7;

interface CellProps {
  base: number;
  terrain: number;
}

export class TerrainField {
  readonly map: HexMap;
  readonly p: TerrainParams;
  readonly noise: Noise;
  private readonly warpNoise: Noise;
  private readonly colorNoise: Noise;
  private readonly s: number;
  private readonly cellProps: CellProps[];

  // sample() の作業領域
  private readonly kIdx = new Int32Array(MAX_K);
  private readonly kW = new Float32Array(MAX_K);
  readonly terrainWeights = new Float32Array(NT);
  readonly colorWeights = new Float32Array(NT);

  constructor(map: HexMap, params: TerrainParams) {
    this.map = map;
    this.p = params;
    this.s = map.layout.size;
    const seed = map.data.seed;
    this.noise = new Noise(seed);
    this.warpNoise = new Noise(seed + 101);
    this.colorNoise = new Noise(seed + 202);

    const s = this.s;
    this.cellProps = map.allCells().map((c) => {
      const def = TERRAIN_DEFS[c.terrain];
      return {
        base: (c.elevation * params.levelHeight + def.baseOffset) * s,
        terrain: TERRAIN_INDEX[c.terrain],
      };
    });
  }

  private cellIndexClamped(col: number, row: number): number {
    const { cols, rows } = this.map.layout;
    const c = Math.min(Math.max(col, 0), cols - 1);
    const r = Math.min(Math.max(row, 0), rows - 1);
    return r * cols + c;
  }

  /**
   * (x, z) の高さを返し、terrainWeights / colorWeights を更新する。
   */
  sample(x: number, z: number): number {
    const p = this.p;
    const s = this.s;
    const layout = this.map.layout;

    // ドメインワープ
    const wf = p.warpFreq / s;
    const wa = p.warpAmp * s;
    const wx = x + wa * this.warpNoise.fbm(x * wf, z * wf, 3);
    const wz = z + wa * this.warpNoise.fbm(x * wf + 57.1, z * wf - 31.7, 3);

    // 近傍 7 HEX の重み
    const a0 = layout.worldToAxial(wx, wz);
    const ri = layout.inradius;
    const bStart = p.blendStart;
    // 7 HEX で足りるのは bEnd < 2.3 まで
    const bEnd = Math.min(Math.max(p.blendEnd, bStart + 0.05, 1.2), 2.2);
    let n = 0;
    let wsum = 0;
    for (let i = 0; i < MAX_K; i++) {
      const q = i === 0 ? a0.q : a0.q + DQ[i - 1];
      const r = i === 0 ? a0.r : a0.r + DR[i - 1];
      const c = layout.axialToWorld(q, r);
      const d = Math.hypot(wx - c.x, wz - c.z) / ri;
      const w = 1 - smoothstep(bStart, bEnd, d);
      if (w <= 0) continue;
      const o = layout.axialToOffset(q, r);
      this.kIdx[n] = this.cellIndexClamped(o.col, o.row);
      this.kW[n] = w;
      wsum += w;
      n++;
    }

    let base = 0;
    this.terrainWeights.fill(0);
    this.colorWeights.fill(0);
    let csum = 0;
    for (let i = 0; i < n; i++) {
      const w = this.kW[i] / wsum;
      const cp = this.cellProps[this.kIdx[i]];
      base += w * cp.base;
      this.terrainWeights[cp.terrain] += w;
      const cw = Math.pow(w, p.colorSharpness);
      this.colorWeights[cp.terrain] += cw;
      csum += cw;
    }
    for (let t = 0; t < NT; t++) this.colorWeights[t] /= csum;

    return base;
  }

  /** colorWeights を使って地表の基本色を求める（sRGB） */
  baseColor(x: number, z: number, out: number[]): void {
    const s = this.s;
    const v = 0.5 + 0.5 * this.colorNoise.fbm((x / s) * 1.4, (z / s) * 1.4, 3);
    out[0] = out[1] = out[2] = 0;
    for (let t = 0; t < NT; t++) {
      const w = this.colorWeights[t];
      if (w <= 1e-4) continue;
      const def = TERRAIN_DEFS[TERRAIN_IDS[t]];
      out[0] += w * lerp(def.color[0], def.color2[0], v);
      out[1] += w * lerp(def.color[1], def.color2[1], v);
      out[2] += w * lerp(def.color[2], def.color2[2], v);
    }
    // 大きなスケールの明度ムラ
    const m = 0.9 + 0.2 * (0.5 + 0.5 * this.colorNoise.fbm((x / s) * 0.25 + 91, (z / s) * 0.25, 2));
    out[0] *= m;
    out[1] *= m;
    out[2] *= m;
  }
}

// 軸座標の 6 方向
const DQ = [1, 1, 0, -1, -1, 0];
const DR = [0, -1, -1, 0, 1, 1];

const CLEARANCE_OFFSETS = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const ROCK: RGB = [0.47, 0.45, 0.41];
const SNOW: RGB = [0.88, 0.87, 0.84];
const SHORE: RGB = [0.56, 0.53, 0.43];
const BED: RGB = [0.24, 0.27, 0.25];

function mix3(out: number[], c: RGB, t: number): void {
  out[0] = lerp(out[0], c[0], t);
  out[1] = lerp(out[1], c[1], t);
  out[2] = lerp(out[2], c[2], t);
}

export function generateTerrain(map: HexMap, params: TerrainParams): TerrainData {
  const t0 = performance.now();
  const field = new TerrainField(map, params);
  const s = map.layout.size;
  const b = map.layout.worldBounds();
  const margin = params.margin * s * 1.5;
  const minX = b.minX - margin;
  const minZ = b.minZ - margin;
  const step = 1 / params.resolution;
  const nx = Math.ceil((b.maxX + margin - minX) / step) + 1;
  const nz = Math.ceil((b.maxZ + margin - minZ) / step) + 1;
  const N = nx * nz;
  const waterLevel = params.waterLevel * s;

  const heights = new Float32Array(N);
  const colors = new Float32Array(N * 3);
  const normals = new Float32Array(N * 3);
  const waterW = new Float32Array(N);

  // 1) 高さと基本色
  const col = [0, 0, 0];
  const WATER = TERRAIN_INDEX.water;
  const DEEP = TERRAIN_INDEX.deep_water;
  for (let j = 0; j < nz; j++) {
    const z = minZ + j * step;
    for (let i = 0; i < nx; i++) {
      const x = minX + i * step;
      const k = j * nx + i;
      heights[k] = field.sample(x, z);
      field.baseColor(x, z, col);
      colors[k * 3] = col[0];
      colors[k * 3 + 1] = col[1];
      colors[k * 3 + 2] = col[2];
      waterW[k] = field.terrainWeights[WATER] + field.terrainWeights[DEEP];
    }
  }

  // 2) 法線
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const hl = heights[j * nx + Math.max(i - 1, 0)];
      const hr = heights[j * nx + Math.min(i + 1, nx - 1)];
      const hu = heights[Math.max(j - 1, 0) * nx + i];
      const hd = heights[Math.min(j + 1, nz - 1) * nx + i];
      const dx = (hr - hl) / (2 * step);
      const dz = (hd - hu) / (2 * step);
      const len = Math.hypot(dx, 1, dz);
      const k = (j * nx + i) * 3;
      normals[k] = -dx / len;
      normals[k + 1] = 1 / len;
      normals[k + 2] = -dz / len;
    }
  }

  // 3) 斜面・雪・水際の色
  for (let j = 0; j < nz; j++) {
    const z = minZ + j * step;
    for (let i = 0; i < nx; i++) {
      const x = minX + i * step;
      const k = j * nx + i;
      const h = heights[k];
      col[0] = colors[k * 3];
      col[1] = colors[k * 3 + 1];
      col[2] = colors[k * 3 + 2];
      const ny = normals[k * 3 + 1];
      const nv = field.noise.simplex((x / s) * 3.1, (z / s) * 3.1);

      const slope = 1 - ny;
      const rock = smoothstep(0.16, 0.38, slope + nv * 0.05) * (1 - waterW[k]);
      mix3(col, ROCK, rock);

      const snow = smoothstep(params.snowLine * s, (params.snowLine + 0.35) * s, h + nv * 0.15 * s) * smoothstep(0.55, 0.8, ny);
      mix3(col, SNOW, snow);

      if (h > waterLevel) {
        const shore = 1 - smoothstep(waterLevel + 0.02 * s, waterLevel + 0.1 * s, h + nv * 0.02 * s);
        mix3(col, SHORE, shore * 0.7);
      } else {
        mix3(col, BED, smoothstep(waterLevel, waterLevel - 0.35 * s, h));
      }

      colors[k * 3] = col[0];
      colors[k * 3 + 1] = col[1];
      colors[k * 3 + 2] = col[2];
    }
  }

  const data: TerrainData = {
    nx,
    nz,
    minX,
    minZ,
    step,
    heights,
    normals,
    colors,
    waterLevel,
    stats: { ms: 0 },
  };
  data.stats.ms = performance.now() - t0;
  return data;
}

/** 木を生やさない人工物（HEX を覆う建物群） */
const TREELESS_FEATURES = new Set(['village', 'fort', 'castle']);

/**
 * 木・低木の配置。人工物の配置だけが変わったときは地形を作り直さずこれだけ呼べばよい。
 */
export function placeVegetation(map: HexMap, data: TerrainData, params: TerrainParams, roads?: RoadIndex): TreeInstance[] {
  const trees: TreeInstance[] = [];
  if (params.treeDensity <= 0) return trees;
  const field = new TerrainField(map, params);
  const layout = map.layout;
  // 建物・城壁に木が被らないよう、HEX の少し外側まで除外する
  const clearance = 0.14 * layout.size;
  // 道の端から木の幹まで少し空ける
  const roadClear = (ROAD_WIDTH / 2 + 0.065) * layout.size;
  const blocked = (x: number, z: number) => {
    if (roads && roads.distance(x, z, roadClear) < roadClear) return true;
    for (const [dx, dz] of CLEARANCE_OFFSETS) {
      const o = layout.worldToOffset(x + dx * clearance, z + dz * clearance);
      const f = map.get(o.col, o.row)?.feature;
      if (f && TREELESS_FEATURES.has(f)) return true;
    }
    return false;
  };
  const s = field.map.layout.size;
  const sp = Math.max(params.treeSpacing, 0.05) * s;
  const x0 = data.minX;
  const z0 = data.minZ;
  const x1 = data.minX + (data.nx - 1) * data.step;
  const z1 = data.minZ + (data.nz - 1) * data.step;
  const cols = Math.floor((x1 - x0) / sp);
  const rows = Math.floor((z1 - z0) / sp);
  const seed = field.map.data.seed;
  const hm = new Heightmap(data);
  const MOUNTAIN = TERRAIN_INDEX.mountain;
  const FOREST = TERRAIN_INDEX.forest;
  const n = [0, 0, 0];

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = x0 + (i + 0.1 + 0.8 * hash2(i, j, seed)) * sp;
      const z = z0 + (j + 0.1 + 0.8 * hash2(i, j, seed + 1)) * sp;
      field.sample(x, z);
      // 地表色と同じ鋭い重みを使い、森の木が森の地面の外へはみ出さないようにする
      const cw = field.colorWeights;
      let prob = 0;
      for (let t = 0; t < NT; t++) prob += cw[t] * TERRAIN_DEFS[TERRAIN_IDS[t]].treeDensity;
      // 森の縁をまだらにする
      prob *= params.treeDensity * (0.75 + 0.5 * field.noise.simplex((x / s) * 1.7 + 300, (z / s) * 1.7));
      let bushProb = 0;
      for (let t = 0; t < NT; t++) bushProb += cw[t] * TERRAIN_DEFS[TERRAIN_IDS[t]].bushDensity;
      bushProb *= params.treeDensity;

      const roll = hash2(i, j, seed + 2);
      let kind: TreeKind;
      if (roll < prob) kind = TreeKind.Conifer; // 種類は後で決める
      else if (roll < prob + bushProb * (1 - prob)) kind = TreeKind.Bush;
      else continue;
      if (blocked(x, z)) continue;

      const y = hm.heightAt(x, z);
      if (y < data.waterLevel + 0.04 * s) continue;
      hm.normalAt(x, z, n);
      if (n[1] < (kind === TreeKind.Bush ? 0.7 : 0.8)) continue;
      if (y > (params.snowLine - 0.1) * s) continue;

      const forestW = cw[FOREST];
      let scale = 0.75 + 0.5 * hash2(i, j, seed + 3);
      if (kind !== TreeKind.Bush) {
        const mountainW = field.terrainWeights[MOUNTAIN];
        const coniferBias = 0.35 + mountainW * 0.6 + 0.3 * field.noise.simplex((x / s) * 0.6, (z / s) * 0.6 + 50);
        kind = hash2(i, j, seed + 5) < coniferBias ? TreeKind.Conifer : TreeKind.Broadleaf;
        // 森の奥ほど大きく、縁や草原の孤立木は小さめ
        scale *= 0.8 + 0.3 * forestW;
      }
      trees.push({
        x,
        y,
        z,
        scale: s * scale,
        rot: hash2(i, j, seed + 4) * Math.PI * 2,
        kind,
        tint: hash2(i, j, seed + 6),
        variant: hash2(i, j, seed + 7),
      });
    }
  }
  return trees;
}

/** 生成済み高さマップへの問い合わせ（ユニット配置などにも使う） */
export class Heightmap {
  constructor(private readonly d: TerrainData) {}

  heightAt(x: number, z: number): number {
    const { nx, nz, minX, minZ, step, heights } = this.d;
    const fx = Math.min(Math.max((x - minX) / step, 0), nx - 1.0001);
    const fz = Math.min(Math.max((z - minZ) / step, 0), nz - 1.0001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const k = j * nx + i;
    const h0 = lerp(heights[k], heights[k + 1], tx);
    const h1 = lerp(heights[k + nx], heights[k + nx + 1], tx);
    return lerp(h0, h1, tz);
  }

  normalAt(x: number, z: number, out: number[]): void {
    const e = this.d.step;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    const len = Math.hypot(dx, 1, dz);
    out[0] = -dx / len;
    out[1] = 1 / len;
    out[2] = -dz / len;
  }
}
