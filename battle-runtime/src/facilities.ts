/**
 * 拠点の施設（値は仮）。陣営ごとに持つ（ゲームでは都市の施設から、battle-editor では道具で渡す。BattleScreen の facilities）。
 *
 * 撃つ施設（その陣営の番の終わりに、間隔のターンごとに撃つ。app.ts の endTurn → 撃ち終えてから次の軍の番）:
 * - 要塞砲: 拠点（MapData.stronghold）から FORTRESS_CANNON_RANGE HEX 以内の敵（城の HEX にいる敵は除く）をランダムに 1 つ、拠点から撃つ（砲兵と同じ演出）。
 * - ガンシップ: 全域の敵をランダムに 1 つ、上空から光の弾を連射して撃つ。
 * 撃つ施設のダメージは、仮の部隊（FACILITY_SHOOTERS）が撃ったものとして計算する（反撃は無い）。
 *
 * いるだけで効く施設（城の HEX にいるその陣営のユニットに効く。rangeBonus）:
 * - バリスタ: 弓兵の射程が 1 伸びる。
 * - 魔導台: 魔術師・上級魔術師の射程が 1 伸び、番の初めにクールタイムがさらに 1 減る。
 */
import type { UnitType } from '@norden/map-runtime/core/units';
import type { UnitPower } from './damage';

/** 陣営の施設 */
export interface BattleFacilities {
  /** 要塞砲。interval ターンごとに撃つ（1 なら毎ターン） */
  fortressCannon?: { interval: number };
  /** ガンシップ。interval ターンごとに撃つ */
  gunship?: { interval: number };
  /** バリスタ（城の弓兵の射程 +1） */
  ballista?: boolean;
  /** 魔導台（城の魔術師の射程 +1・クールタイムがさらに減る） */
  magicTower?: boolean;
}

/** 陣営ごとの施設 */
export type SideFacilities = Partial<Record<'attacker' | 'defender', BattleFacilities>>;

/** 撃つ施設 */
export type FiringFacility = 'fortressCannon' | 'gunship';

export const FACILITY_NAMES: Record<keyof BattleFacilities, string> = {
  fortressCannon: '要塞砲',
  gunship: 'ガンシップ',
  ballista: 'バリスタ',
  magicTower: '魔導台',
};

/** 要塞砲の射程（拠点からの HEX の距離） */
export const FORTRESS_CANNON_RANGE = 5;
/** 間隔の既定（ターン） */
export const DEFAULT_INTERVALS: Record<FiringFacility, number> = { fortressCannon: 1, gunship: 3 };

/** 撃つ施設のダメージを計算する仮の部隊と、攻撃の倍率 */
export const FACILITY_SHOOTERS: Record<FiringFacility, { power: UnitPower; hit: number }> = {
  fortressCannon: { power: { type: 'artillery', soldiers: 300, morale: 50, leadership: 50, strength: 50 }, hit: 0.8 },
  gunship: { power: { type: 'rifleman', soldiers: 400, morale: 50, leadership: 50, strength: 50 }, hit: 0.8 },
};

/** interval ターンごとに撃つ施設が、turn に撃つか（1 なら毎ターン、3 なら 3・6・9…ターン目） */
export function firesOn(turn: number, interval: number): boolean {
  return interval <= 1 || turn % interval === 0;
}

/** 施設で、城の HEX にいる type の兵種の射程が伸びる量 */
export function rangeBonus(facilities: BattleFacilities | undefined, type: UnitType, magic: boolean): number {
  if (!facilities) return 0;
  return (facilities.ballista && type === 'archer') || (facilities.magicTower && magic) ? 1 : 0;
}
