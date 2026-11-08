/**
 * 攻撃の定義（値は仮）。行動メニューの攻撃と、迎撃の構えの間接ユニットが通りかかった敵へ自動でする攻撃（interceptFire）。
 *
 * - 兵種（combat.ts の COMBAT_DEFS）は使える攻撃の一覧（attacks）を持ち、行動メニューの「攻撃」はその順に並ぶ。
 * - 省略した値は兵種から埋める（combat.ts の resolveAttack）: 射程は兵種の射程、通常攻撃と迎撃の当たる範囲は兵種の形（normal。ライフル兵は path）、
 *   魔法かどうかは兵種の magic、演出は兵種の通常攻撃の演出。
 * - 狙い方（aim）: unit は敵ユニットを狙う、cell は地点（空いた HEX も）を狙う、self は狙わない（自分が中心）。
 *   いま画面で選べるのは unit だけ（cell・self は、それを使う攻撃を足すときに BattleApp につなぐ）。
 * - 当たる範囲（shape）にいる目標以外のユニット（巻き添え）は、目標と同じ計算（倍率は splashPower）で、反撃は無く、撃った側の士気は増減しない。
 *   範囲の味方に当たるのは friendlyFire の攻撃だけ。
 * - クールタイム（cooldown）: 使った次の自分の番から、この回数の番は使えない（UnitStatus.cooldowns）。
 * - inflicts: 当たったユニットに確率で状態（conditions.ts）を付ける。
 */
import type { ConditionId } from './conditions';

/** 攻撃の ID（行動メニューの行動の ID にもなる。interceptFire は迎撃の自動攻撃で、メニューには出ない） */
export const ATTACK_IDS = [
  'attack',
  'volley',
  'charge',
  'rampage',
  'thunderfall',
  'claw',
  'breath',
  'smash',
  'maul',
  'beam',
  'flameLance',
  'chainLightning',
  'frostNova',
  'earthSpike',
  'meteorFall',
  'interceptFire',
] as const;
export type AttackId = (typeof ATTACK_IDS)[number];
/** 行動メニューに出る攻撃 */
export type MenuAttackId = Exclude<AttackId, 'interceptFire'>;

/**
 * 部隊に持たせる魔法（UnitStatus.spells。magic の兵種だけが使える。ゲームでは魔導書の装備から渡す）。
 * サンダーフォールは魔術師・上級魔術師が必ず持つので含めない
 */
export const SPELL_IDS = ['flameLance', 'chainLightning', 'frostNova', 'earthSpike', 'meteorFall'] as const satisfies readonly MenuAttackId[];
export type SpellId = (typeof SPELL_IDS)[number];

/**
 * 攻撃の演出の種類。slash: 光の剣で斬る（歩兵の通常攻撃）、lance: 光るランスで貫く（騎兵の通常攻撃・突撃）、
 * arrows: 光の矢の雨（弓兵の通常攻撃）、thunder: 頭上に落ちる雷（魔術師のサンダーフォール）、
 * bullets: まっすぐ飛ぶ光の弾（ライフル兵の通常攻撃）、shell: 放物線で飛ぶ大きな光の弾（砲兵の通常攻撃）、
 * claw: 3 本の爪の跡（ドラゴンのクロウ）、breath: 範囲の端まで吹く炎（ドラゴンのブレス）、flame: 細く速い炎の槍（フレイムランス）、
 * whirl: 周りをなぎ払う斬撃（乱撃）、smash: 地面を揺らす衝撃（ゴーレム・ベヒーモスの殴り）、beam: 溜めて放つ光線と爆発（ベヒーモス）、
 * chain: 跳ねていく雷（チェインライトニング）、frost: 氷の結晶（フロストノヴァ）、spike: 地面から突き出る岩（アーススパイク）、
 * meteor: 空から落ちる光の柱と爆発（メテオフォール）
 */
export type StrikeFxKind =
  | 'slash'
  | 'lance'
  | 'arrows'
  | 'thunder'
  | 'bullets'
  | 'shell'
  | 'claw'
  | 'breath'
  | 'flame'
  | 'whirl'
  | 'smash'
  | 'beam'
  | 'chain'
  | 'frost'
  | 'spike'
  | 'meteor';

/** 当たる範囲 */
export type Shape =
  /** 目標だけ */
  | { kind: 'single' }
  /** 自分から目標までの直線上（目標の手前も）。隣より遠い目標は 6 方向の直線上だけ狙える（ライフル兵） */
  | { kind: 'path' }
  /** 自分から目標の向きへ length HEX（目標の先も）。直線上だけ狙える（ブレス・フレイムランス） */
  | { kind: 'line'; length: number }
  /** 狙った HEX とその周り radius HEX（光線・アーススパイク・メテオ） */
  | { kind: 'burst'; radius: number }
  /** 自分の周り radius HEX（自分は除く。aim: 'self'。乱撃） */
  | { kind: 'around'; radius: number }
  /** 目標から近くのユニットへ跳ぶ（チェインライトニング。跳び方は段階 3 で決める。いまは目標だけ） */
  | { kind: 'chain'; jumps: number };

/** 当たったユニットに付く状態 */
export interface Inflict {
  condition: ConditionId;
  /** 付く確率（0..1） */
  chance: number;
  /** 続くターン数（付いたユニットの軍の番の数） */
  turns: number;
}

export interface AttackDef {
  id: AttackId;
  name: string;
  /** 消費する行動力（迎撃の自動攻撃は 0） */
  cost: number;
  /** 兵種の攻撃力に掛ける倍率 */
  power: number;
  /** unit: 敵ユニットを狙う / cell: 地点を狙う / self: 狙わない（自分が中心） */
  aim: 'unit' | 'cell' | 'self';
  /** 射程（省略: 兵種の射程） */
  range?: { min: number; max: number };
  /** 当たる範囲（省略: 通常攻撃・迎撃は兵種の形、ほかは single） */
  shape?: Shape;
  /** 目標以外に当たったときの倍率（省略: power） */
  splashPower?: number;
  /** 範囲の味方にも当たる（省略: 通常攻撃・迎撃は兵種の形に従う、ほかは当たらない） */
  friendlyFire?: boolean;
  /** 隣でも反撃を受けない */
  indirect?: boolean;
  /** 魔法か（省略: 兵種の magic）。知力を使い、相手の武力の軽減と迎撃の構えの影響を受けない */
  magic?: boolean;
  /** 使った次の自分の番から、この回数の番は使えない */
  cooldown?: number;
  inflicts?: readonly Inflict[];
  /** 演出（省略: 兵種の通常攻撃の演出） */
  fx?: StrikeFxKind;
  /** 特別な処理。volley: 相手を取り囲む味方が加わる（一斉攻撃）、charge: 相手を突き抜けて向こうへ飛び出る（突撃） */
  special?: 'volley' | 'charge';
}

export const ATTACK_DEFS: Record<AttackId, AttackDef> = {
  attack: { id: 'attack', name: '通常攻撃', cost: 2, power: 0.8, aim: 'unit' },
  // 直接攻撃の兵種だけ（間接の弓兵・魔術師・ライフル兵・砲兵はできない）
  volley: { id: 'volley', name: '一斉攻撃', cost: 4, power: 0.8, aim: 'unit', special: 'volley' },
  charge: { id: 'charge', name: '突撃', cost: 3, power: 0.7, aim: 'unit', special: 'charge' },
  // ランツクネヒト。狙わずに自分の周りの敵・味方すべてを斬る（反撃は受けない）
  rampage: {
    id: 'rampage',
    name: '乱撃',
    cost: 4,
    power: 0.8,
    aim: 'self',
    shape: { kind: 'around', radius: 1 },
    friendlyFire: true,
    indirect: true,
    cooldown: 1,
    fx: 'whirl',
  },
  // 魔術師の攻撃（間接攻撃。魔法の名前はいずれ指揮官の属性で変えるかもしれない）
  thunderfall: { id: 'thunderfall', name: 'サンダーフォール', cost: 4, power: 1.0, aim: 'unit', indirect: true },
  // ドラゴン。クロウは直接攻撃。ブレスは目標の向きへ直線 3 HEX を焼く（味方にも当たる。反撃は受けない）
  claw: { id: 'claw', name: 'クロウ', cost: 2, power: 0.8, aim: 'unit', fx: 'claw' },
  breath: {
    id: 'breath',
    name: 'ブレス',
    cost: 4,
    power: 1.0,
    aim: 'unit',
    range: { min: 1, max: 3 },
    shape: { kind: 'line', length: 3 },
    friendlyFire: true,
    indirect: true,
    cooldown: 1,
    fx: 'breath',
  },
  // ゴーレムの鉄拳・ベヒーモスの蹂躙（直接攻撃）
  smash: { id: 'smash', name: '鉄拳', cost: 2, power: 0.9, aim: 'unit', fx: 'smash' },
  maul: { id: 'maul', name: '蹂躙', cost: 2, power: 1.0, aim: 'unit', fx: 'smash' },
  // ベヒーモスの終末の光（光線）。目標に大ダメージ、周り 1 HEX にも当たる（味方にも）
  beam: {
    id: 'beam',
    name: '終末の光',
    cost: 3,
    power: 0.8,
    aim: 'unit',
    range: { min: 2, max: 3 },
    shape: { kind: 'burst', radius: 1 },
    splashPower: 0.6,
    friendlyFire: true,
    indirect: true,
    cooldown: 3,
    fx: 'beam',
  },
  // 魔法（部隊に持たせる）。フレイムランスはブレスの 2 HEX 版
  flameLance: {
    id: 'flameLance',
    name: 'フレイムランス',
    cost: 4,
    power: 1.2,
    aim: 'unit',
    range: { min: 1, max: 2 },
    shape: { kind: 'line', length: 2 },
    friendlyFire: true,
    indirect: true,
    cooldown: 1,
    fx: 'flame',
  },
  // サンダーフォールの強化版。目標から隣り合う敵へ跳ぶ（敵だけ）。当たった敵は感電することがある
  chainLightning: {
    id: 'chainLightning',
    name: 'チェインライトニング',
    cost: 4,
    power: 1.1,
    aim: 'unit',
    shape: { kind: 'chain', jumps: 2 },
    splashPower: 0.35,
    indirect: true,
    cooldown: 2,
    inflicts: [{ condition: 'shock', chance: 0.5, turns: 1 }],
    fx: 'chain',
  },
  // 近くの敵 1 体を凍らせる（ダメージは小さい）
  frostNova: {
    id: 'frostNova',
    name: 'フロストノヴァ',
    cost: 4,
    power: 0.5,
    aim: 'unit',
    range: { min: 1, max: 2 },
    indirect: true,
    cooldown: 2,
    inflicts: [{ condition: 'freeze', chance: 0.7, turns: 1 }],
    fx: 'frost',
  },
  // 地点の周り 1 HEX から岩を突き出す（味方にも当たる）
  earthSpike: {
    id: 'earthSpike',
    name: 'アーススパイク',
    cost: 4,
    power: 0.9,
    aim: 'cell',
    range: { min: 2, max: 3 },
    shape: { kind: 'burst', radius: 1 },
    friendlyFire: true,
    indirect: true,
    cooldown: 1,
    fx: 'spike',
  },
  // 遠くの地点の周り 1 HEX に大ダメージ（味方にも当たる）
  meteorFall: {
    id: 'meteorFall',
    name: 'メテオフォール',
    cost: 4,
    power: 1.8,
    aim: 'cell',
    range: { min: 1, max: 5 },
    shape: { kind: 'burst', radius: 1 },
    friendlyFire: true,
    indirect: true,
    cooldown: 3,
    fx: 'meteor',
  },
  interceptFire: { id: 'interceptFire', name: '迎撃', cost: 0, power: 0.5, aim: 'unit', indirect: true },
};

export function isSpellId(id: string): id is SpellId {
  return (SPELL_IDS as readonly string[]).includes(id);
}

export function isAttackId(id: string): id is AttackId {
  return (ATTACK_IDS as readonly string[]).includes(id);
}
