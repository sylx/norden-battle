/**
 * 1 HEX 内の兵の並び（隊形）。three.js 非依存。
 * HEX の中心を原点、部隊の正面を +Z とした (x, z)。長さは hexSize = 1 の単位。
 */
import { UNITS } from './units';

export interface FormationSlot {
  x: number;
  z: number;
  /** 向きの揺れ（ラジアン） */
  yaw: number;
}

export interface FormationOptions {
  /** 横の間隔（既定は兵士の身長の 1.2 倍） */
  dx?: number;
  /** 縦の間隔（既定は兵士の身長の 1.35 倍） */
  dz?: number;
  /** 位置の揺れ（間隔に対する割合） */
  jitter?: number;
  seed?: number;
}

/** 横隊。1 列は最大 4 人（13 人以上なら 5 人）、最後の列は中央に寄せる */
export function squadFormation(count: number, opts: FormationOptions = {}): FormationSlot[] {
  const dx = opts.dx ?? UNITS.soldierHeight * 1.2;
  const dz = opts.dz ?? UNITS.soldierHeight * 1.35;
  const jitter = opts.jitter ?? 0.12;
  const seed = opts.seed ?? 1;
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const cols = n <= 4 ? n : n <= 12 ? 4 : 5;
  const rows = Math.ceil(n / cols);
  const out: FormationSlot[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const col = i - row * cols;
    const h = (k: number) => hash(seed, i, k) * 2 - 1;
    out.push({
      x: (col - (inRow - 1) / 2) * dx + h(1) * dx * jitter,
      // 先頭の列が前（+Z）
      z: ((rows - 1) / 2 - row) * dz + h(2) * dz * jitter,
      yaw: h(3) * 0.1,
    });
  }
  return out;
}

function hash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
