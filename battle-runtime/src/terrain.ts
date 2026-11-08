/**
 * 戦闘中の地形変化（マップの HexCell を書き換える。書き換えた後は MapView を描き直す）。
 *
 * 耕す（アーススパイク。AttackDef.plows）: 狙った HEX を荒地にする。
 * - 川・浅瀬・深い水域（と、その上の橋）は耕せない。
 * - 街道は壊れる（その HEX の道と、隣の HEX からその HEX へ来ている道を外す）。
 * - 城・砦の HEX は城・砦のまま、城壁・木柵が崩れる（HexCell.breached）。崩れた HEX は
 *   - 地形効果が瓦礫の値になる（combat.ts の cellDefense。BREACHED_DEFENSE）。砲兵の攻城の割引も効かない
 *   - 突撃で突き抜けられる（城・砦の守りが無い）
 *   - 城なら入城の決まりに縛られず、外から入れる（movement.ts の entersCastle）。そこから城の中を進める（突破口）。
 *     拠点の決まり（拠点の前で一度番を終える）はそのまま
 * - 村は村のまま地面だけ荒地になる。
 * - 柵・土塁（M007-33）はまだ無い。できたら、ここで壊す。
 */
import { WALLED_FEATURE_IDS, type FeatureId } from '@norden/map-runtime/core/features';
import type { Offset } from '@norden/map-runtime/core/hex';
import type { HexCell, HexMap } from '@norden/map-runtime/core/mapData';
import { clearRoads } from '@norden/map-runtime/core/roads';
import { TERRAIN_DEFS, type TerrainId } from '@norden/map-runtime/core/terrainTypes';

/** 耕した HEX の地形 */
export const PLOWED_TERRAIN: TerrainId = 'wasteland';

/** 耕したときの変化（変わらなかったものは false） */
export interface PlowChange {
  at: Offset;
  /** 耕す前の地形（地形が変わらなければ null） */
  from: TerrainId | null;
  /** 街道が壊れたか */
  road: boolean;
  /** 城壁・木柵が崩れた城・砦（崩れなければ null） */
  breach: FeatureId | null;
}

/** cell を耕せるか（水域でない） */
export function canPlow(cell: HexCell | undefined): cell is HexCell {
  return !!cell && !TERRAIN_DEFS[cell.terrain].isWater;
}

/** at を耕したときに何が変わるか（何も変わらなければ null。マップは書き換えない） */
export function plowPreview(map: HexMap, at: Offset): PlowChange | null {
  const cell = map.get(at.col, at.row);
  if (!canPlow(cell)) return null;
  const change: PlowChange = {
    at: { col: at.col, row: at.row },
    from: cell.terrain === PLOWED_TERRAIN ? null : cell.terrain,
    road: !!cell.roads?.length,
    breach: cell.feature && WALLED_FEATURE_IDS.includes(cell.feature) && !cell.breached ? cell.feature : null,
  };
  return change.from || change.road || change.breach ? change : null;
}

/** at を耕す（マップを書き換える）。何も変わらなければ null */
export function plowCell(map: HexMap, at: Offset): PlowChange | null {
  const change = plowPreview(map, at);
  if (!change) return null;
  const cell = map.get(at.col, at.row)!;
  if (change.from) map.setTerrain(at.col, at.row, PLOWED_TERRAIN);
  if (change.road) clearRoads(map, at);
  if (change.breach) cell.breached = true;
  return change;
}

/** 耕したときの変化の説明（戦闘記録。例: 「草原が荒地に・街道が崩れた・城壁が崩れた」） */
export function plowText(change: PlowChange): string {
  const parts: string[] = [];
  if (change.from) parts.push(`${TERRAIN_DEFS[change.from].name}が${TERRAIN_DEFS[PLOWED_TERRAIN].name}に`);
  if (change.road) parts.push('街道が崩れた');
  if (change.breach) parts.push(change.breach === 'castle' ? '城壁が崩れた' : '木柵が倒れた');
  return parts.join('・');
}
