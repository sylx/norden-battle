/**
 * 攻撃による士気の増減（値は仮）。与えたダメージに対する、反撃で受けたダメージの比（受けた ÷ 与えた）で決まる。
 *
 * - 比が LOSING_RATIO 以下（与えたダメージの方がずっと多い）:
 *   攻撃した側 +WIN_GAIN〜0、攻撃された側 −WIN_LOSS〜0（比が 0 で最大、LOSING_RATIO で 0）。
 * - 比が LOSING_RATIO より大きい（反撃で受けたダメージが与えたダメージの 3 割より多い）:
 *   攻撃した側 0〜−LOSE_LOSS（比が 1 以上で最大）、攻撃された側は変わらない。
 * - 武力の高い指揮官は、自分の士気が上がる量と、相手の士気が下がる量を増やす
 *   （武力 STRONG_FROM で 0、100 で +STRENGTH_BONUS の割合）。
 */
import { MAX_MORALE, type UnitStatus } from './unitStatus';

const LOSING_RATIO = 0.3;
const WIN_GAIN = 10;
const WIN_LOSS = 5;
const LOSE_LOSS = 10;
const STRONG_FROM = 60;
const STRENGTH_BONUS = 0.5;

/** 攻撃した側・攻撃された側の士気の増減 */
export interface MoraleChange {
  attacker: number;
  defender: number;
}

/** 武力による士気の増減の倍率 */
function strengthBonus(strength: number): number {
  return 1 + (Math.max(0, strength - STRONG_FROM) / (100 - STRONG_FROM)) * STRENGTH_BONUS;
}

/** dealt を与えて taken の反撃を受けたときの士気の増減。strength はそれぞれの指揮官の武力 */
export function moraleChange(dealt: number, taken: number, attackerStrength: number, defenderStrength: number): MoraleChange {
  if (dealt <= 0 && taken <= 0) return { attacker: 0, defender: 0 };
  const ratio = dealt > 0 ? taken / dealt : Infinity;
  if (ratio <= LOSING_RATIO) {
    const t = 1 - ratio / LOSING_RATIO;
    return {
      attacker: round(WIN_GAIN * t * strengthBonus(attackerStrength)),
      defender: round(-WIN_LOSS * t * strengthBonus(attackerStrength)),
    };
  }
  const t = Math.min(1, (ratio - LOSING_RATIO) / (1 - LOSING_RATIO));
  return { attacker: round(-LOSE_LOSS * t * strengthBonus(defenderStrength)), defender: 0 };
}

/** 士気を delta だけ増減する（0〜MAX_MORALE） */
export function applyMorale(status: UnitStatus, delta: number): void {
  status.morale = Math.min(MAX_MORALE, Math.max(0, status.morale + delta));
}

/** 四捨五入（−0 は 0 にする） */
function round(v: number): number {
  return Math.round(v) || 0;
}
