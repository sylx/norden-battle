/**
 * ダメージの計算（値は仮）。攻撃 1 回で相手の兵数をどれだけ減らすか。マップには関わらない（包囲かどうかは呼ぶ側で決める）。
 *
 *   兵の力   = 兵数 × DAMAGE_RATE × 兵種の攻撃力 × 攻撃の種類の倍率 ÷ 相手の兵種の防御力（兵数が多いほど大きい）
 *   統率     = (1 + (統率 − 50) × LEADERSHIP_ATTACK) × (1 − (相手の統率 − 50) × LEADERSHIP_GUARD)
 *   武力     = 武力 × STRENGTH_ATTACK − 相手の武力 × STRENGTH_GUARD（兵数に関わらず一定のダメージ・軽減）
 *   士気     = 1 + (士気 − 50) × MORALE_RATE（50 より高ければ増え、低ければ減る）
 *   包囲     = 相手が包囲されていれば ENCIRCLED_RATE
 *   ランダム = 1 + roll × RANDOM_SPREAD（roll は −1〜1）
 *
 *   ダメージ = (兵の力 × 統率 + 武力) × 士気 × 包囲 × ランダム（0〜相手の兵数）
 *
 * 反撃は、攻撃された側が攻撃した側へ通常攻撃をしたときのダメージ × COUNTER_RATE。
 */
import type { UnitType } from '@norden/map-runtime/core/units';
import type { ActionId } from './actions';
import type { UnitStatus } from './unitStatus';

/** 兵種ごとの攻撃力・防御力（倍率） */
export const UNIT_POWER: Record<UnitType, { attack: number; defense: number }> = {
  infantry: { attack: 1.0, defense: 1.0 },
  archer: { attack: 0.9, defense: 0.7 },
  cavalry: { attack: 1.2, defense: 0.9 },
  mage: { attack: 1.3, defense: 0.6 },
};

/** 攻撃の種類ごとの、兵種の攻撃力に掛ける倍率。ここにある行動が攻撃 */
export const ATTACK_POWER: Partial<Record<ActionId, number>> = {
  attack: 0.8,
  volley: 1.0,
  charge: 0.8,
};

/** 兵数に対する、与えるダメージの割合 */
const DAMAGE_RATE = 0.12;
/** 統率 1 あたりのダメージの増減（50 が基準。自分は増やし、相手は減らす） */
const LEADERSHIP_ATTACK = 0.005;
const LEADERSHIP_GUARD = 0.004;
/** 武力 1 あたりの、兵数に関わらない一定のダメージと、その軽減 */
const STRENGTH_ATTACK = 0.5;
const STRENGTH_GUARD = 0.3;
/** 士気 1 あたりのダメージの増減（50 が基準） */
const MORALE_RATE = 0.004;
/** 包囲された相手へのダメージの倍率 */
const ENCIRCLED_RATE = 1.2;
/** ランダムの幅（± の割合） */
export const RANDOM_SPREAD = 0.2;
/** 反撃の、通常攻撃のダメージに対する割合 */
const COUNTER_RATE = 0.1;

/** ダメージの計算に使う、ユニットの状態 */
export interface Fighter extends Pick<UnitStatus, 'soldiers' | 'morale' | 'leadership' | 'strength'> {
  type: UnitType;
  /** 包囲されているか */
  encircled: boolean;
}

/** −1〜1 の乱数（ランダム係数の roll） */
export function randomRoll(): number {
  return Math.random() * 2 - 1;
}

/** att が def を action で攻撃したときのダメージ */
export function calcDamage(att: Fighter, def: Fighter, action: ActionId, roll: number): number {
  if (att.soldiers <= 0 || def.soldiers <= 0) return 0;
  const kind = ATTACK_POWER[action] ?? 1;
  const troops = (att.soldiers * DAMAGE_RATE * UNIT_POWER[att.type].attack * kind) / UNIT_POWER[def.type].defense;
  const leadership =
    Math.max(0, 1 + (att.leadership - 50) * LEADERSHIP_ATTACK) * Math.max(0, 1 - (def.leadership - 50) * LEADERSHIP_GUARD);
  const strength = att.strength * STRENGTH_ATTACK - def.strength * STRENGTH_GUARD;
  const morale = 1 + (att.morale - 50) * MORALE_RATE;
  const encircled = def.encircled ? ENCIRCLED_RATE : 1;
  const random = 1 + roll * RANDOM_SPREAD;
  const raw = Math.max(0, troops * leadership + strength) * morale * encircled * random;
  return Math.min(def.soldiers, Math.round(raw));
}

/** att に攻撃された def（兵数は攻撃を受けた後）の反撃で、att が受けるダメージ */
export function calcCounter(att: Fighter, def: Fighter, roll: number): number {
  if (att.soldiers <= 0 || def.soldiers <= 0) return 0;
  return Math.min(att.soldiers, Math.round(calcDamage(def, att, 'attack', roll) * COUNTER_RATE));
}
