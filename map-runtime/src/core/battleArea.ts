/**
 * 街道マップ（戦略マップの街道 A–B の両端の都市を描いた大きなマップ）から、
 * 侵攻方向ごとの戦闘の範囲を切り出す。範囲は防衛する都市の ID で引く（A→B の侵攻なら battleAreas[B]）。
 */
import type { Offset } from './hex';
import { BATTLE_AREA_SIZE, DEPLOY_SIDES, HexMap, isAlignedOrigin, type BattleDeployment, type MapData } from './mapData';

export { BATTLE_AREA_SIZE, isAlignedOrigin };

/** 範囲の左上を、マップに収まり偶奇の条件を満たす位置に寄せる（エディタでの配置用） */
export function snapBattleArea(data: Pick<MapData, 'grid'>, o: Offset): Offset {
  const { grid } = data;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(max, 0));
  let col = clamp(Math.round(o.col), grid.cols - BATTLE_AREA_SIZE.cols);
  let row = clamp(Math.round(o.row), grid.rows - BATTLE_AREA_SIZE.rows);
  // 偶数へ（はみ出すなら 1 つ戻す）
  if (grid.orientation === 'flat' && col % 2 !== 0) col += col + 1 <= grid.cols - BATTLE_AREA_SIZE.cols ? 1 : -1;
  if (grid.orientation === 'pointy' && row % 2 !== 0) row += row + 1 <= grid.rows - BATTLE_AREA_SIZE.rows ? 1 : -1;
  return { col, row };
}

/** マップが範囲の大きさ以上あるか（範囲を置けるか） */
export function canHoldBattleArea(data: Pick<MapData, 'grid'>): boolean {
  return data.grid.cols >= BATTLE_AREA_SIZE.cols && data.grid.rows >= BATTLE_AREA_SIZE.rows;
}

/**
 * 範囲を切り出した新しいマップ。HEX・人工物・街道・ユニットを新しい座標に移す。
 * 範囲の外へ向かう街道の方向は残る。origin（元のマップでの位置）を付けるので、
 * 地形のノイズなどは元の座標で引かれ、元のマップと同じ見た目になる（範囲の縁は外の HEX が無い分だけ変わる）。
 */
export function cropMap(data: MapData, area: Offset, size: { cols: number; rows: number } = BATTLE_AREA_SIZE): MapData {
  const { grid } = data;
  if (!isAlignedOrigin(grid, area))
    throw new Error(`切り出しの左上の${grid.orientation === 'flat' ? '列' : '行'}は偶数にしてください: (${area.col}, ${area.row})`);
  if (area.col < 0 || area.row < 0 || area.col + size.cols > grid.cols || area.row + size.rows > grid.rows)
    throw new Error(`切り出す範囲 (${area.col}, ${area.row}) ${size.cols}×${size.rows} がマップに収まりません`);
  // 片側にしか書かれていない街道も両側にそろえてから切る
  const full = new HexMap(data).toJSON();
  const inside = (o: Offset) =>
    o.col >= area.col && o.row >= area.row && o.col < area.col + size.cols && o.row < area.row + size.rows;
  const move = <T extends Offset>(o: T): T => ({ ...o, col: o.col - area.col, row: o.row - area.row });
  const units = (full.units ?? []).filter(inside).map(move);
  return {
    version: 1,
    name: data.name,
    seed: data.seed,
    grid: { ...grid, cols: size.cols, rows: size.rows },
    origin: { col: (data.origin?.col ?? 0) + area.col, row: (data.origin?.row ?? 0) + area.row },
    cells: full.cells.filter(inside).map(move),
    ...(units.length > 0 ? { units } : {}),
  };
}

/**
 * 防衛する都市 city の範囲（battleAreas[city]）を切り出したマップ。
 * 初期配置地点（deployments[city]）のうち範囲の中のものを、切り出したマップの座標で deploy に付ける。
 * 範囲が無ければ例外。
 */
export function cropBattleArea(data: MapData, city: string): MapData {
  const area = data.battleAreas?.[city];
  if (!area) throw new Error(`${city} の範囲（battleAreas.${city}）がありません`);
  const out = cropMap(data, area);
  const src = data.deployments?.[city];
  if (!src) return out;
  const deploy: BattleDeployment = { attacker: [], defender: [] };
  for (const side of DEPLOY_SIDES) {
    for (const o of src[side]) {
      const col = o.col - area.col;
      const row = o.row - area.row;
      if (col >= 0 && row >= 0 && col < BATTLE_AREA_SIZE.cols && row < BATTLE_AREA_SIZE.rows) deploy[side].push({ col, row });
    }
  }
  return { ...out, deploy };
}
