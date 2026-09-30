/**
 * ユニット（HEX に 1 部隊）の定義と、配置に関する補助関数。
 *
 * ユニットは 2D 画像（スプライト）で描く。カメラの角度を固定しているので、
 * 画像はその角度から見下ろした姿で描いておけばよい。左右の向きは画像の反転で表す。
 *
 * 向きはゲームの概念として持たない（データにも保存しない）。見た目のためだけに、
 * 配置から「敵のいる側を向く」ように毎回決める（unitFacings）。
 */
import type { Offset } from './hex';
import type { HexCell, HexMap } from './mapData';
import { TERRAIN_DEFS } from './terrainTypes';

export const UNIT_TYPES = ['infantry', 'archer', 'cavalry', 'mage'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const TEAM_IDS = ['blue', 'red', 'green'] as const;
export type TeamId = (typeof TEAM_IDS)[number];

export type Facing = 'left' | 'right';

export interface UnitData {
  col: number;
  row: number;
  type: UnitType;
  team: TeamId;
}

/**
 * 兵種。画像はリポジトリ直下の assets/units/<id>.png（無ければプレースホルダー）。
 * 置き方は assets/units/README.md を参照。
 */
export interface UnitDef {
  id: UnitType;
  name: string;
}

export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  infantry: { id: 'infantry', name: '歩兵' },
  archer: { id: 'archer', name: '弓兵' },
  cavalry: { id: 'cavalry', name: '騎兵' },
  mage: { id: 'mage', name: '魔術師' },
};

export interface TeamDef {
  id: TeamId;
  name: string;
  color: string;
  /** 敵がいない・敵の左右が決まらないときの向き */
  defaultFacing: Facing;
}

export const TEAM_DEFS: Record<TeamId, TeamDef> = {
  blue: { id: 'blue', name: '青軍', color: '#3a78e0', defaultFacing: 'right' },
  red: { id: 'red', name: '赤軍', color: '#d8402e', defaultFacing: 'left' },
  green: { id: 'green', name: '緑軍', color: '#3fa84a', defaultFacing: 'right' },
};

export function isUnitType(v: unknown): v is UnitType {
  return typeof v === 'string' && (UNIT_TYPES as readonly string[]).includes(v);
}

export function isTeamId(v: unknown): v is TeamId {
  return typeof v === 'string' && (TEAM_IDS as readonly string[]).includes(v);
}

/** 陸か橋の上にだけ置ける */
export function canPlaceUnit(cell: HexCell): boolean {
  return !TERRAIN_DEFS[cell.terrain].isWater || cell.feature === 'bridge';
}

/**
 * 表示確認用に、マップの左右両端へ 2 軍を並べる（既存のユニットは置き換える）。
 * 各軍は端から数列の範囲で置ける HEX を中央寄りから選ぶ。
 */
export function deployDemoUnits(map: HexMap): UnitData[] {
  const { cols, rows } = map.layout;
  const perTeam = Math.min(8, Math.max(2, Math.floor((cols * rows) / 40)));
  const pattern: UnitType[] = ['infantry', 'infantry', 'archer', 'cavalry', 'infantry', 'mage', 'archer', 'cavalry'];
  const units: UnitData[] = [];
  const deploy = (team: TeamId, colsFromEdge: number[]) => {
    const cands: Offset[] = [];
    for (const col of colsFromEdge) {
      for (let row = 0; row < rows; row++) {
        const cell = map.get(col, row);
        if (cell && canPlaceUnit(cell)) cands.push({ col, row });
      }
    }
    // 中央の行に近い順、同じなら前線（内側の列）から
    const mid = (rows - 1) / 2;
    cands.sort((a, b) => Math.abs(a.row - mid) - Math.abs(b.row - mid) || colsFromEdge.indexOf(b.col) - colsFromEdge.indexOf(a.col));
    cands.slice(0, perTeam).forEach((o, i) => units.push({ ...o, type: pattern[i % pattern.length], team }));
  };
  const depth = Math.max(1, Math.min(3, Math.floor(cols / 6)));
  const left = Array.from({ length: depth }, (_, i) => 1 + i).filter((c) => c < cols);
  const right = Array.from({ length: depth }, (_, i) => cols - 2 - i).filter((c) => c >= 0 && !left.includes(c));
  deploy('blue', left);
  deploy('red', right);
  return units;
}

/** 左右の差がこれ（hexSize 比）未満なら「左右が決まらない」とみなす */
const FACING_DEAD_ZONE = 0.25;

/**
 * 各ユニットの画像の向きを配置から決める（見た目専用）。
 * 1. 一番近い敵が左右どちらにいるか（等距離なら左右の差が大きいほう）
 * 2. 真上・真下で決まらなければ、敵全体の重心の側
 * 3. それでも決まらない（敵がいない）ときは軍ごとの既定の向き
 */
export function unitFacings(map: HexMap): Map<UnitData, Facing> {
  const layout = map.layout;
  const dead = FACING_DEAD_ZONE * layout.size;
  const units = [...map.allUnits()];
  const pos = units.map((u) => layout.offsetToWorld(u.col, u.row));
  const out = new Map<UnitData, Facing>();
  const side = (dx: number): Facing | null => (dx > dead ? 'right' : dx < -dead ? 'left' : null);

  units.forEach((u, i) => {
    const p = pos[i];
    let nearD = Infinity;
    let nearDx = 0;
    let sumDx = 0;
    let enemies = 0;
    units.forEach((e, j) => {
      if (e.team === u.team) return;
      const dx = pos[j].x - p.x;
      const d = Math.hypot(dx, pos[j].z - p.z);
      sumDx += dx;
      enemies++;
      if (d < nearD - 1e-6 || (d < nearD + 1e-6 && Math.abs(dx) > Math.abs(nearDx))) {
        nearD = Math.min(nearD, d);
        nearDx = dx;
      }
    });
    const facing = (enemies > 0 && (side(nearDx) ?? side(sumDx / enemies))) || TEAM_DEFS[u.team].defaultFacing;
    out.set(u, facing);
  });
  return out;
}
