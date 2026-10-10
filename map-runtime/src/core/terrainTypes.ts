/**
 * 地形タイプ定義。
 * 見た目（色・起伏）の生成パラメータと、エディタ表示用の情報、ゲーム的な値（移動コストなど）を持つ。
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
  'desert',
  'snow',
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
  /** HEX に入るのに使う行動力（null は通れない）。街道沿いに入るときは半分 */
  moveCost: number | null;
  /** 地形効果: その HEX にいるユニットが受けるダメージを減らす割合（0..1） */
  defense: number;
  /** エディタのオーバーレイ表示色 */
  overlay: string;
}

const rgb = (hex: number): RGB => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

export const TERRAIN_DEFS: Record<TerrainId, TerrainDef> = {
  deep_water: {
    id: 'deep_water',
    name: '深い水域',
    color: rgb(0x2e3f45),
    color2: rgb(0x364a4f),
    baseOffset: -0.9,
    treeDensity: 0,
    bushDensity: 0,
    isWater: true,
    moveCost: null,
    defense: 0,
    overlay: '#1f4fa8',
  },
  water: {
    id: 'water',
    name: '川・浅瀬',
    color: rgb(0x4a5a52),
    color2: rgb(0x56665a),
    baseOffset: -0.45,
    treeDensity: 0,
    bushDensity: 0,
    isWater: true,
    moveCost: 4,
    defense: 0,
    overlay: '#3f8fe0',
  },
  plains: {
    id: 'plains',
    name: '草原',
    color: rgb(0x868c62),
    color2: rgb(0x9a9c6e),
    baseOffset: 0,
    treeDensity: 0,
    bushDensity: 0,
    isWater: false,
    moveCost: 1,
    defense: 0,
    overlay: '#a6d65a',
  },
  forest: {
    id: 'forest',
    name: '森',
    color: rgb(0x4d5638),
    color2: rgb(0x5d6543),
    baseOffset: 0.02,
    treeDensity: 0.85,
    bushDensity: 0.45,
    isWater: false,
    moveCost: 2,
    defense: 0.2,
    overlay: '#2f7a2f',
  },
  hills: {
    id: 'hills',
    name: '丘陵',
    color: rgb(0x908b64),
    color2: rgb(0x9e906d),
    baseOffset: 0.12,
    treeDensity: 0,
    bushDensity: 0,
    isWater: false,
    moveCost: 2,
    defense: 0,
    overlay: '#c9a94a',
  },
  mountain: {
    id: 'mountain',
    name: '山岳',
    color: rgb(0x7e776c),
    color2: rgb(0x918a7f),
    baseOffset: 0.3,
    treeDensity: 0,
    bushDensity: 0,
    isWater: false,
    moveCost: 3,
    defense: 0,
    overlay: '#8a6a4a',
  },
  swamp: {
    id: 'swamp',
    name: '湿地',
    color: rgb(0x555843),
    color2: rgb(0x63644a),
    baseOffset: -0.07,
    treeDensity: 0,
    bushDensity: 0,
    isWater: false,
    moveCost: 3,
    defense: 0,
    overlay: '#5a7a6a',
  },
  wasteland: {
    id: 'wasteland',
    name: '荒地',
    color: rgb(0xa08f70),
    color2: rgb(0xb09f80),
    baseOffset: 0.02,
    treeDensity: 0,
    bushDensity: 0,
    isWater: false,
    moveCost: 2,
    defense: 0,
    overlay: '#d8b878',
  },
  desert: {
    id: 'desert',
    name: '砂漠',
    color: rgb(0xc9ad78),
    color2: rgb(0xd6bc89),
    baseOffset: 0.01,
    treeDensity: 0,
    bushDensity: 0.02,
    isWater: false,
    moveCost: 2,
    defense: 0,
    overlay: '#f0d27a',
  },
  snow: {
    id: 'snow',
    name: '雪原',
    color: rgb(0xd9dcdc),
    color2: rgb(0xe6e8e6),
    baseOffset: 0.02,
    treeDensity: 0,
    bushDensity: 0,
    isWater: false,
    moveCost: 2,
    defense: 0,
    overlay: '#eef4fa',
  },
};

export const TERRAIN_INDEX: Record<TerrainId, number> = Object.fromEntries(
  TERRAIN_IDS.map((id, i) => [id, i]),
) as Record<TerrainId, number>;

export function isTerrainId(v: unknown): v is TerrainId {
  return typeof v === 'string' && (TERRAIN_IDS as readonly string[]).includes(v);
}
