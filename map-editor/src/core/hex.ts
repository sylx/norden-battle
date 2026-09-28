/**
 * HEX 座標系ユーティリティ。
 *
 * - マップデータはオフセット座標 (col, row) で保持する（矩形マップを扱いやすいため）。
 *   - flat-top  : odd-q（奇数列が半マス下にずれる）
 *   - pointy-top: odd-r（奇数行が半マス右にずれる）
 * - 計算は軸座標 (q, r) で行う。
 * - ワールド座標は XZ 平面（Y が上）。hex(0,0) の中心がワールド原点。row が増えると +Z（手前）へ進む。
 *
 * 参考: https://www.redblobgames.com/grids/hexagons/
 */

export type Orientation = 'flat' | 'pointy';

export interface GridSpec {
  orientation: Orientation;
  cols: number;
  rows: number;
  /** HEX の外接円半径（中心→頂点）。ワールド単位。 */
  hexSize: number;
}

export interface Axial {
  q: number;
  r: number;
}

export interface Offset {
  col: number;
  row: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

const SQRT3 = Math.sqrt(3);

const AXIAL_DIRS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function axialRound(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

export function axialDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export class HexLayout {
  readonly spec: GridSpec;
  readonly size: number;
  /** 内接円半径（中心→辺の中点） */
  readonly inradius: number;
  readonly flat: boolean;

  constructor(spec: GridSpec) {
    this.spec = spec;
    this.size = spec.hexSize;
    this.inradius = (spec.hexSize * SQRT3) / 2;
    this.flat = spec.orientation === 'flat';
  }

  get cols(): number {
    return this.spec.cols;
  }

  get rows(): number {
    return this.spec.rows;
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.spec.cols && row < this.spec.rows;
  }

  offsetToAxial(col: number, row: number): Axial {
    if (this.flat) return { q: col, r: row - (col - (col & 1)) / 2 };
    return { q: col - (row - (row & 1)) / 2, r: row };
  }

  axialToOffset(q: number, r: number): Offset {
    if (this.flat) return { col: q, row: r + (q - (q & 1)) / 2 };
    return { col: q + (r - (r & 1)) / 2, row: r };
  }

  axialToWorld(q: number, r: number): Vec2 {
    const s = this.size;
    if (this.flat) return { x: s * 1.5 * q, z: s * SQRT3 * (r + q / 2) };
    return { x: s * SQRT3 * (q + r / 2), z: s * 1.5 * r };
  }

  offsetToWorld(col: number, row: number): Vec2 {
    const a = this.offsetToAxial(col, row);
    return this.axialToWorld(a.q, a.r);
  }

  worldToAxial(x: number, z: number): Axial {
    const s = this.size;
    if (this.flat) return axialRound(((2 / 3) * x) / s, ((-1 / 3) * x + (SQRT3 / 3) * z) / s);
    return axialRound(((SQRT3 / 3) * x - (1 / 3) * z) / s, ((2 / 3) * z) / s);
  }

  worldToOffset(x: number, z: number): Offset {
    const a = this.worldToAxial(x, z);
    return this.axialToOffset(a.q, a.r);
  }

  /** 軸座標の 6 近傍 */
  axialNeighbors(q: number, r: number): Axial[] {
    return AXIAL_DIRS.map((d) => ({ q: q + d.q, r: r + d.r }));
  }

  /** オフセット座標の近傍のうちマップ内のもの */
  neighbors(col: number, row: number): Offset[] {
    const a = this.offsetToAxial(col, row);
    return this.axialNeighbors(a.q, a.r)
      .map((n) => this.axialToOffset(n.q, n.r))
      .filter((o) => this.inBounds(o.col, o.row));
  }

  /** 方向 dir（0..5）の隣の HEX。範囲外でもそのまま返す。反対方向は (dir + 3) % 6 */
  neighborInDir(col: number, row: number, dir: number): Offset {
    const a = this.offsetToAxial(col, row);
    const d = AXIAL_DIRS[dir];
    return this.axialToOffset(a.q + d.q, a.r + d.r);
  }

  /** 方向 dir 側の辺の両端（ワールド座標） */
  edgeEndpoints(col: number, row: number, dir: number): [Vec2, Vec2] {
    const a = this.offsetToAxial(col, row);
    const d = AXIAL_DIRS[dir];
    const c = this.axialToWorld(a.q, a.r);
    const n = this.axialToWorld(a.q + d.q, a.r + d.r);
    const mx = (c.x + n.x) / 2;
    const mz = (c.z + n.z) / 2;
    const len = Math.hypot(n.x - c.x, n.z - c.z);
    const px = (-(n.z - c.z) / len) * (this.size / 2);
    const pz = ((n.x - c.x) / len) * (this.size / 2);
    return [
      { x: mx + px, z: mz + pz },
      { x: mx - px, z: mz - pz },
    ];
  }

  /** HEX の 6 頂点（ワールド座標） */
  corners(col: number, row: number): Vec2[] {
    const c = this.offsetToWorld(col, row);
    const start = this.flat ? 0 : 30;
    const out: Vec2[] = [];
    for (let i = 0; i < 6; i++) {
      const a = ((start + 60 * i) * Math.PI) / 180;
      out.push({ x: c.x + this.size * Math.cos(a), z: c.z + this.size * Math.sin(a) });
    }
    return out;
  }

  /** マップ全 HEX を覆うワールド座標の範囲 */
  worldBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const { cols, rows } = this.spec;
    // 外周だけ見れば十分
    const edge: Offset[] = [];
    for (let c = 0; c < cols; c++) edge.push({ col: c, row: 0 }, { col: c, row: rows - 1 });
    for (let r = 0; r < rows; r++) edge.push({ col: 0, row: r }, { col: cols - 1, row: r });
    for (const o of edge) {
      for (const p of this.corners(o.col, o.row)) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
    }
    return { minX, maxX, minZ, maxZ };
  }
}
