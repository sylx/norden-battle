/**
 * ダメージの計算（値は仮）。攻撃 1 回で相手の兵数をどれだけ減らすか。マップには関わらない（包囲かどうかは呼ぶ側で決める）。
 *
 *   兵の力   = 兵数 × DAMAGE_RATE × 兵種の攻撃力 × 攻撃の種類の倍率 ÷ 相手の兵種の防御力（兵数が多いほど大きい）
 *   統率     = (1 + (統率 − 50) × LEADERSHIP_ATTACK) × (1 − (相手の統率 − 50) × LEADERSHIP_GUARD)
 *   武力     = 武力 × STRENGTH_ATTACK − 相手の武力 × STRENGTH_GUARD（兵数に関わらず一定のダメージ・軽減。魔術師は武力の代わりに知力）
 *   士気     = 1 + (士気 − 50) × MORALE_RATE（50 より高ければ増え、低ければ減る）
 *   包囲     = 相手が包囲されていれば ENCIRCLED_RATE
 *   地形     = 1 − 相手のいる HEX の地形効果（森 20%・砦 30%・城 50% など。人工物があればその値）
 *   高所     = 弓兵が相手より高い HEX にいれば 1 + 標高レベルの差 × HIGH_GROUND_RATE
 *   ランダム = 1 + roll × RANDOM_SPREAD（roll は −1〜1）
 *
 *   迎撃     = 相手が迎撃の構えの近接ユニットなら INTERCEPT_GUARD
 *   一斉攻撃 = 一斉攻撃なら VOLLEY_RATE[加わる味方の数]（多いほど 1 隊あたりの増え方も大きくなる）
 *
 *   ダメージ = (兵の力 × 統率 + 武力) × 士気 × 包囲 × 地形 × 高所 × 迎撃 × 一斉攻撃 × ランダム（0〜相手の兵数）
 *
 * 魔法（魔術師の攻撃。サンダーフォール・迎撃の自動攻撃）は、相手の武力による軽減と、相手の迎撃の構えの影響を受けない。
 * 魔術師の反撃は通常攻撃として計算するので魔法ではない。
 *
 * 反撃は、攻撃された側が攻撃した側へ通常攻撃をしたときのダメージ × COUNTER_RATE
 * （攻撃された側が迎撃の構えの近接ユニットなら、さらに × INTERCEPT_COUNTER）。
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

/** 攻撃の種類。行動メニューの攻撃と、迎撃の構えの間接ユニットが通りかかった敵へ自動でする攻撃（interceptFire） */
export type AttackKind = ActionId | 'interceptFire';

/** 攻撃の種類ごとの、兵種の攻撃力に掛ける倍率。ここにある行動が攻撃 */
export const ATTACK_POWER: Partial<Record<AttackKind, number>> = {
  attack: 0.8,
  volley: 0.8,
  charge: 0.8,
  thunderfall: 1.0,
  interceptFire: 0.5,
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
/** 高所の兵種が相手より高い HEX から攻撃したときの、標高レベルの差 1 あたりのダメージの増え方 */
const HIGH_GROUND_RATE = 0.1;
/** 高所からの攻撃でダメージが増える兵種 */
const HIGH_GROUND_TYPES: readonly UnitType[] = ['archer'];
/** ランダムの幅（± の割合） */
export const RANDOM_SPREAD = 0.2;
/** 反撃の、通常攻撃のダメージに対する割合 */
const COUNTER_RATE = 0.1;
/** 迎撃の構えの近接ユニットが受けるダメージと、返す反撃の倍率 */
const INTERCEPT_GUARD = 0.5;
const INTERCEPT_COUNTER = 1.5;
/**
 * 一斉攻撃のダメージの倍率。添え字は加わる味方の数（相手の周りの 6 HEX のうち自分の分を除いて最大 5）。
 * 加わる隊が多いほど 1 隊あたりの増え方も大きくする
 */
const VOLLEY_RATE = [1, 1.3, 1.7, 2.2, 2.8, 3.5];

/** ダメージの計算に使う、ユニットの状態（strength は武力。魔術師は知力を入れる） */
export interface Fighter extends Pick<UnitStatus, 'soldiers' | 'morale' | 'leadership' | 'strength'> {
  type: UnitType;
  /** 包囲されているか */
  encircled: boolean;
  /** 迎撃の構えの近接ユニットか（受けるダメージが減り、反撃が増える） */
  guarding: boolean;
  /** 一斉攻撃に加わる味方の数（一斉攻撃のときだけ効く） */
  supporters: number;
  /** 攻撃が魔法になる兵種か（魔術師。反撃を除く） */
  magic: boolean;
  /** いる HEX の地形効果（受けるダメージを減らす割合） */
  defense: number;
  /** いる HEX の標高レベル */
  elevation: number;
}

/** 味方が supporters 隊加わったときの一斉攻撃のダメージの倍率 */
export function volleyRate(supporters: number): number {
  return VOLLEY_RATE[Math.min(supporters, VOLLEY_RATE.length - 1)];
}

/** att が def より高い HEX にいてダメージが増える標高レベルの差（増えなければ 0） */
export function highGroundLevels(att: Fighter, def: Fighter): number {
  return HIGH_GROUND_TYPES.includes(att.type) ? Math.max(0, att.elevation - def.elevation) : 0;
}

/** 標高レベルの差が levels のときの高所からの攻撃のダメージの倍率 */
export function highGroundRate(levels: number): number {
  return 1 + levels * HIGH_GROUND_RATE;
}

/** −1〜1 の乱数（ランダム係数の roll） */
export function randomRoll(): number {
  return Math.random() * 2 - 1;
}

/** att が def を action で攻撃したときのダメージ */
export function calcDamage(att: Fighter, def: Fighter, action: AttackKind, roll: number): number {
  if (att.soldiers <= 0 || def.soldiers <= 0) return 0;
  const kind = ATTACK_POWER[action] ?? 1;
  // 反撃は通常攻撃として計算する（calcCounter）ので魔法ではない
  const magic = att.magic && action !== 'attack';
  const troops = (att.soldiers * DAMAGE_RATE * UNIT_POWER[att.type].attack * kind) / UNIT_POWER[def.type].defense;
  const leadership =
    Math.max(0, 1 + (att.leadership - 50) * LEADERSHIP_ATTACK) * Math.max(0, 1 - (def.leadership - 50) * LEADERSHIP_GUARD);
  const strength = att.strength * STRENGTH_ATTACK - (magic ? 0 : def.strength * STRENGTH_GUARD);
  const morale = 1 + (att.morale - 50) * MORALE_RATE;
  const encircled = def.encircled ? ENCIRCLED_RATE : 1;
  const terrain = 1 - def.defense;
  const highGround = highGroundRate(highGroundLevels(att, def));
  const guard = def.guarding && !magic ? INTERCEPT_GUARD : 1;
  const volley = action === 'volley' ? volleyRate(att.supporters) : 1;
  const random = 1 + roll * RANDOM_SPREAD;
  const raw = Math.max(0, troops * leadership + strength) * morale * encircled * terrain * highGround * guard * volley * random;
  return Math.min(def.soldiers, Math.round(raw));
}

/** att に攻撃された def（兵数は攻撃を受けた後）の反撃で、att が受けるダメージ */
export function calcCounter(att: Fighter, def: Fighter, roll: number): number {
  if (att.soldiers <= 0 || def.soldiers <= 0) return 0;
  const rate = COUNTER_RATE * (def.guarding ? INTERCEPT_COUNTER : 1);
  return Math.min(att.soldiers, Math.round(calcDamage(def, att, 'attack', roll) * rate));
}
