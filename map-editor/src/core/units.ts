/**
 * ユニット（HEX に 1 部隊）の定義と、配置に関する補助関数。
 *
 * ユニットは 2D 画像（スプライト）で描く。カメラの角度を固定しているので、
 * 画像はその角度から見下ろした姿で描いておけばよい。左右の向きは画像の反転で表す。
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
  /** 画像の向き。省略時は right */
  facing?: Facing;
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
}

export const TEAM_DEFS: Record<TeamId, TeamDef> = {
  blue: { id: 'blue', name: '青軍', color: '#3a78e0' },
  red: { id: 'red', name: '赤軍', color: '#d8402e' },
  green: { id: 'green', name: '緑軍', color: '#3fa84a' },
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
  const deploy = (team: TeamId, colsFromEdge: number[], facing: Facing) => {
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
    cands.slice(0, perTeam).forEach((o, i) => units.push({ ...o, type: pattern[i % pattern.length], team, facing }));
  };
  const depth = Math.max(1, Math.min(3, Math.floor(cols / 6)));
  const left = Array.from({ length: depth }, (_, i) => 1 + i).filter((c) => c < cols);
  const right = Array.from({ length: depth }, (_, i) => cols - 2 - i).filter((c) => c >= 0 && !left.includes(c));
  deploy('blue', left, 'right');
  deploy('red', right, 'left');
  return units;
}
