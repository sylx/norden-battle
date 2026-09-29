/**
 * アセットの寸法の基準。長さの単位は map-editor と同じ（hexSize = 1、HEX の中心から頂点まで）。
 *
 * map-editor の手続き生成の建物は、戸口の高さ 0.045・壁の高さ 0.065〜0.1 ほど。
 * 等身大の人なら身長 0.04 前後になるが、兵士は現実の縮尺より見た目を優先し、
 * 1 HEX に 1 部隊（十数体）が並んで読める大きさまで大きくする（等身大の約 9 倍）。
 * そのため建物は兵士より小さくなる。建物の大きさは作り直すときに合わせる。
 */
export const UNITS = {
  /** 等身大の人の身長（建物の戸口に合う大きさ） */
  humanHeight: 0.04,
  /** 部隊の兵士の身長（デフォルメ後） */
  soldierHeight: 0.35,
  /** 村の家の高さ（屋根の頂上まで） */
  houseHeight: 0.16,
  /** 城壁の高さ（map-editor の WALL_H） */
  castleWallHeight: 0.2,
  /** 城の塔の高さ（map-editor の TOWER_H） */
  towerHeight: 0.3,
  /** 木の高さ */
  treeHeight: 0.22,
} as const;

/** 寸法を合わせるときに選べるプリセット */
export const HEIGHT_PRESETS: { label: string; height: number }[] = [
  { label: '兵士（デフォルメ）', height: UNITS.soldierHeight },
  { label: '人（等身大）', height: UNITS.humanHeight },
  { label: '村の家', height: UNITS.houseHeight },
  { label: '城壁', height: UNITS.castleWallHeight },
  { label: '塔', height: UNITS.towerHeight },
  { label: '木', height: UNITS.treeHeight },
];
