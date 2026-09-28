/**
 * 地形タイプ定義。
 * 見た目（色・起伏）の生成パラメータと、エディタ表示用の情報を持つ。
 * ゲーム的な値（移動コスト・防御補正など）は将来ここに追加する想定。
 */

export const TERRAIN_IDS = [
  'deep_water',
  'water',
  'plains',
  'forest',
  'hills',
  'mountain',
  'swamp',
  'wasteland',
] as const;

export type TerrainId = (typeof TERRAIN_IDS)[number];

export type RGB = readonly [number, number, number];

export interface TerrainDef {
  id: TerrainId;
  /** 表示名 */
  name: string;
  /** 地表色（sRGB 0..1）。ノイズで color と color2 の間を揺らす */
  color: RGB;
  color2: RGB;
  /** 標高レベルによる高さに加算するオフセット（水域は負） */
  baseOffset: number;
  /** 木の密度（0..1、配置候補点あたりの確率） */
  treeDensity: number;
  /** 低木・茂みの密度（木が置かれなかった候補点での確率） */
  bushDensity: number;
  isWater: boolean;
  /** エディタのオーバーレイ表示色 */
  overlay: string;
}

const rgb = (hex: number): RGB => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

export const TERRAIN_DEFS: Record<TerrainId, TerrainDef> = {
  deep_water: {
    id: 'deep_water',
    name: '深い水域',
    color: rgb(0x1d3a4a),
    color2: rgb(0x24485a),
    baseOffset: -0.9,
    treeDensity: 0,
    bushDensity: 0,
    isWater: true,
    overlay: '#1f4fa8',
  },
  water: {
    id: 'water',
    name: '川・浅瀬',
    color: rgb(0x3b5a4e),
    color2: rgb(0x4a6a55),
    baseOffset: -0.45,
    treeDensity: 0,
    bushDensity: 0,
    isWater: true,
    overlay: '#3f8fe0',
  },
  plains: {
    id: 'plains',
    name: '草原',
    color: rgb(0x7f9a3c),
    color2: rgb(0x9aae4a),
    baseOffset: 0,
    treeDensity: 0,
    bushDensity: 0,
    isWater: false,
    overlay: '#a6d65a',
  },
  forest: {
    id: 'forest',
    name: '森',
    color: rgb(0x3f5a24),
    color2: rgb(0x55702c),
    baseOffset: 0.02,
    treeDensity: 0.85,
    bushDensity: 0.45,
    isWater: false,
    overlay: '#2f7a2f',
  },
  hills: {
    id: 'hills',
    name: '丘陵',
    color: rgb(0x8a8f45),
    color2: rgb(0x9c8e55),
    baseOffset: 0.12,
    treeDensity: 0,
    bushDensity: 0,
    isWater: false,
    overlay: '#c9a94a',
  },
  mountain: {
    id: 'mountain',
    name: '山岳',
    color: rgb(0x7c7466),
    color2: rgb(0x938a7a),
    baseOffset: 0.3,
    treeDensity: 0,
    bushDensity: 0,
    isWater: false,
    overlay: '#8a6a4a',
  },
  swamp: {
    id: 'swamp',
    name: '湿地',
    color: rgb(0x4d5a36),
    color2: rgb(0x5f6a3e),
    baseOffset: -0.07,
    treeDensity: 0,
    bushDensity: 0,
    isWater: false,
    overlay: '#5a7a6a',
  },
  wasteland: {
    id: 'wasteland',
    name: '荒地',
    color: rgb(0xa08a5c),
    color2: rgb(0xb49c6a),
    baseOffset: 0.02,
    treeDensity: 0,
    bushDensity: 0,
    isWater: false,
    overlay: '#d8b878',
  },
};

export const TERRAIN_INDEX: Record<TerrainId, number> = Object.fromEntries(
  TERRAIN_IDS.map((id, i) => [id, i]),
) as Record<TerrainId, number>;

export function isTerrainId(v: unknown): v is TerrainId {
  return typeof v === 'string' && (TERRAIN_IDS as readonly string[]).includes(v);
}
