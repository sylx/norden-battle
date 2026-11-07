/**
 * 攻撃による士気の増減（値は仮）。与えたダメージに対する、反撃で受けたダメージの比（受けた ÷ 与えた）で決まる。
 *
 * - 比が LOSING_RATIO 以下（与えたダメージの方がずっと多い）:
 *   攻撃した側 +WIN_GAIN〜0、攻撃された側 −WIN_LOSS〜0（比が 0 で最大、LOSING_RATIO で 0）。
 * - 比が LOSING_RATIO より大きい（反撃で受けたダメージが与えたダメージの 75% より多い）:
 *   攻撃した側 0〜−LOSE_LOSS（比が 1 以上で最大）、攻撃された側は変わらない。
 * - 武力（魔術師は知力）の高い指揮官は、自分の士気が上がる量と、相手の士気が下がる量を増やす
 *   （武力 STRONG_FROM で 0、100 で +STRENGTH_BONUS の割合）。
 * - 一斉攻撃では、攻撃された側の士気の減り方が加わった味方 1 隊ごとに VOLLEY_MORALE ずつ増える（1 隊で 2 倍、2 隊で 3 倍）。
 */
import { MAX_MORALE, type UnitStatus } from './unitStatus';

/** 優勢・劣勢の境目の比（反撃で受けた ÷ 与えた）。反撃の割合（damage.ts の COUNTER_RATE）を上げたら合わせて上げる */
export const LOSING_RATIO = 0.75;
const WIN_GAIN = 10;
const WIN_LOSS = 5;
const LOSE_LOSS = 10;
export const STRONG_FROM = 60;
const STRENGTH_BONUS = 0.5;
/** 一斉攻撃に加わった味方 1 隊あたりの、攻撃された側の士気の減り方の増え方 */
const VOLLEY_MORALE = 1;

/** 一斉攻撃に supporters 隊加わったときの、攻撃された側の士気の減り方の倍率 */
export function volleyMoraleRate(supporters: number): number {
  return 1 + supporters * VOLLEY_MORALE;
}

/** 攻撃した側・攻撃された側の士気の増減 */
export interface MoraleChange {
  attacker: number;
  defender: number;
}

/** 武力による士気の増減の倍率 */
function strengthBonus(strength: number): number {
  return 1 + (Math.max(0, strength - STRONG_FROM) / (100 - STRONG_FROM)) * STRENGTH_BONUS;
}

/** 士気の増減の内訳（battle-editor のダメージ計算機で出す） */
export interface MoraleBreakdown extends MoraleChange {
  /** 反撃で受けたダメージ ÷ 与えたダメージ（与えていなければ Infinity。どちらも 0 なら 0） */
  ratio: number;
  /** 比が LOSING_RATIO 以下（攻撃した側の優勢）か。どちらも 0 なら null（増減なし） */
  winning: boolean | null;
  /** 増減の強さ（0..1。優勢は比 0 で 1、劣勢は比 1 以上で 1） */
  scale: number;
  /** 武力（魔術師は知力）による倍率（優勢は攻撃した側の、劣勢は攻撃された側の指揮官） */
  bonus: number;
  /** 一斉攻撃による、攻撃された側の士気の減り方の倍率（一斉攻撃でなければ 1） */
  volley: number;
  /** 強さ 1・武力の倍率 1 のときの増減 */
  max: MoraleChange;
}

/**
 * dealt を与えて taken の反撃を受けたときの士気の増減の内訳。strength はそれぞれの指揮官の武力（魔術師は知力）。
 * supporters は一斉攻撃に加わった味方の数（一斉攻撃でなければ 0）
 */
export function moraleBreakdown(dealt: number, taken: number, attackerStrength: number, defenderStrength: number, supporters = 0): MoraleBreakdown {
  const volley = volleyMoraleRate(supporters);
  if (dealt <= 0 && taken <= 0) return { attacker: 0, defender: 0, ratio: 0, winning: null, scale: 0, bonus: 1, volley, max: { attacker: 0, defender: 0 } };
  const ratio = dealt > 0 ? taken / dealt : Infinity;
  if (ratio <= LOSING_RATIO) {
    const t = 1 - ratio / LOSING_RATIO;
    const bonus = strengthBonus(attackerStrength);
    return {
      attacker: round(WIN_GAIN * t * bonus),
      defender: round(-WIN_LOSS * t * bonus * volley),
      ratio,
      winning: true,
      scale: t,
      bonus,
      volley,
      max: { attacker: WIN_GAIN, defender: -WIN_LOSS },
    };
  }
  const t = Math.min(1, (ratio - LOSING_RATIO) / (1 - LOSING_RATIO));
  const bonus = strengthBonus(defenderStrength);
  return { attacker: round(-LOSE_LOSS * t * bonus), defender: 0, ratio, winning: false, scale: t, bonus, volley, max: { attacker: -LOSE_LOSS, defender: 0 } };
}

/** dealt を与えて taken の反撃を受けたときの士気の増減（moraleBreakdown の増減だけ） */
export function moraleChange(dealt: number, taken: number, attackerStrength: number, defenderStrength: number, supporters = 0): MoraleChange {
  const { attacker, defender } = moraleBreakdown(dealt, taken, attackerStrength, defenderStrength, supporters);
  return { attacker, defender };
}

/** 士気を delta だけ増減する（0〜MAX_MORALE）。士気が減らない部隊（steadfast。ドラゴン・ゴーレム・ベヒーモス・ブレイン）は減らさない */
export function applyMorale(status: UnitStatus, delta: number): void {
  // 士気が減らない部隊（ブレイン）
  if (delta < 0 && status.steadfast) return;
  status.morale = Math.min(MAX_MORALE, Math.max(0, status.morale + delta));
}

/** 四捨五入（−0 は 0 にする） */
function round(v: number): number {
  return Math.round(v) || 0;
}
