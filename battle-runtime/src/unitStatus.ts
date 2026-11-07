/**
 * 戦闘中のユニットの状態（兵士数・士気・行動力・指揮官）。マップのデータには保存しない。
 * ゲームから渡されないときは、表示確認用の仮の値を配る（demoStatuses・deployment.ts の demoTroops）。
 */
import { UNIT_DEFS, type UnitData, type UnitType } from '@norden/map-runtime/core/units';
import type { SkillId } from './actions';
import type { AttackId, SpellId } from './attacks';
import type { Condition } from './conditions';

export interface UnitStatus {
  soldiers: number;
  /** 戦闘が始まったときの兵数（兵数のゲージの満タン） */
  initialSoldiers: number;
  /** 0..MAX_MORALE */
  morale: number;
  /** 残り行動力（0..maxAp） */
  ap: number;
  maxAp: number;
  /** 部隊を率いる騎士の名前（部隊は「{name}隊」と呼ぶ。無ければ勢力の名前と兵種で呼ぶ） */
  name?: string;
  /** 指揮官の顔をゲームの画像から切り出すときの指定（ゲームの騎士の顔。無ければ顔を出さない） */
  portrait?: Portrait;
  /** 指揮官のスキル */
  skills: SkillId[];
  /** 指揮官の統率・武力・知力（0..100。ダメージ・士気の増減に効く。damage.ts・morale.ts）。魔術師は武力の代わりに知力を使う */
  leadership: number;
  strength: number;
  intelligence: number;
  /** このターンに移動したか（移動も攻撃もしていなければ敵の ZOC の中からでも動き出せる） */
  moved: boolean;
  /** このターンに攻撃したか（攻撃は 1 ターンに 1 回） */
  attacked: boolean;
  /** 攻撃した後にまだ移動していないか（突撃で飛び出たのは攻撃のうち）。騎兵はこの間だけ敵の ZOC から動き出せる */
  justAttacked: boolean;
  /** 迎撃の構えで待機しているか（次に行動するか、間接ユニットが自動で攻撃するまで） */
  intercepting: boolean;
  /** その陣営の軍団長（軍を率いる騎士）の部隊か */
  commander?: boolean;
  /** 捕縛されない部隊か（傭兵。退却は失敗せず、殲滅されても指揮官は捕まらない） */
  uncapturable?: boolean;
  /** クールタイム中の攻撃と、あと何回の自分の番で使えるようになるか（attacks.ts の cooldown。conditions.ts の tickCooldowns） */
  cooldowns: Partial<Record<AttackId, number>>;
  /** 付いている状態（conditions.ts） */
  conditions: Condition[];
  /** 持たせた魔法（magic の兵種だけが使える。行動メニューの攻撃に兵種の攻撃の後に並ぶ） */
  spells: SpellId[];
  /** 人の兵ではない部隊（ドラゴンなど。兵数を HP と呼ぶ。兵種から決まる） */
  monster?: boolean;
  /** 士気が減らない（ブレイン。兵種から決まる） */
  steadfast?: boolean;
  /** 退却できない（ブレイン。強制退却でも退かず戦場に残る。兵種から決まる） */
  noRetreat?: boolean;
  /** 番の初めに城の HEX の中かそのとなりにいたか（攻撃側はこのときだけ城の HEX に入れる。入城の決まり。BattleApp が番の初めに決める） */
  atCastle?: boolean;
}

/** 兵種で決まる性質（士気が減らない・退却できない） */
const TRAITS: Partial<Record<UnitType, Pick<UnitStatus, 'steadfast' | 'noRetreat'>>> = {
  brain: { steadfast: true, noRetreat: true },
};

/** 兵種で決まる状態の項目（HP と呼ぶか・士気が減らないか・退却できないか） */
function typeTraits(type: UnitType): Pick<UnitStatus, 'monster' | 'steadfast' | 'noRetreat'> {
  return { ...(UNIT_DEFS[type].monster && { monster: true }), ...TRAITS[type] };
}

/** 指揮官の顔を切り出す画像と範囲（大きさはどれも画像の px） */
export interface Portrait {
  url: string;
  /** 画像全体の大きさ */
  width: number;
  height: number;
  /** 顔の範囲（この範囲を顔の円に収める） */
  rect: { x: number; y: number; width: number; height: number };
}

/** ゲームから渡す部隊の、戦闘に入る前の値（troopStatus で戦闘中の状態にする） */
export interface TroopInit {
  /** 戦闘に入るときの兵数（これが兵数のゲージの満タンになる） */
  soldiers: number;
  /** 0..MAX_MORALE */
  morale: number;
  /** 指揮官の統率・武力・知力（0..100） */
  leadership: number;
  strength: number;
  intelligence: number;
  /** 部隊を率いる騎士の名前 */
  name?: string;
  /** 指揮官の顔をゲームの画像から切り出すときの指定（騎士の顔） */
  portrait?: Portrait;
  skills?: SkillId[];
  /** その陣営の軍団長の部隊か */
  commander?: boolean;
  /** 捕縛されない部隊か */
  uncapturable?: boolean;
  /** 持たせる魔法（magic の兵種だけが使える） */
  spells?: readonly SpellId[];
}

/** ゲームから渡された部隊の値を、戦闘に入るときの状態にする（行動力は兵種の満タン） */
export function troopStatus(type: UnitType, init: TroopInit): UnitStatus {
  return {
    soldiers: init.soldiers,
    initialSoldiers: init.soldiers,
    morale: Math.min(MAX_MORALE, Math.max(0, init.morale)),
    ap: MAX_AP[type],
    maxAp: MAX_AP[type],
    ...(init.name && { name: init.name }),
    ...(init.portrait && { portrait: init.portrait }),
    skills: init.skills ?? [],
    leadership: init.leadership,
    strength: init.strength,
    intelligence: init.intelligence,
    moved: false,
    attacked: false,
    justAttacked: false,
    intercepting: false,
    commander: init.commander ?? false,
    ...(init.uncapturable && { uncapturable: true }),
    cooldowns: {},
    conditions: [],
    spells: [...(init.spells ?? [])],
    ...typeTraits(type),
  };
}

export const MAX_MORALE = 100;

/** 兵種ごとの最大行動力（仮） */
const MAX_AP: Record<UnitType, number> = {
  infantry: 4,
  archer: 4,
  cavalry: 6,
  mage: 4,
  rifleman: 4,
  artillery: 3,
  landsknecht: 4,
  wizard: 4,
  dragon: 4,
  golem: 3,
  behemoth: 3,
  brain: 2,
};

/** 表示確認用の仮の部隊の、兵種ごとの兵数の目安（実際の兵数はこれをばらつかせる） */
const MAX_SOLDIERS: Record<UnitType, number> = {
  infantry: 1000,
  archer: 800,
  cavalry: 600,
  mage: 400,
  rifleman: 600,
  artillery: 300,
  landsknecht: 800,
  wizard: 400,
  dragon: 600,
  golem: 800,
  behemoth: 1200,
  brain: 1000,
};

/** 表示確認用の指揮官ごとのスキル（仮） */
const DEMO_SKILLS: SkillId[][] = [
  ['inspire'],
  ['betray'],
  [],
  ['fireAttack', 'ambush'],
  ['betray', 'inspire'],
  [],
  ['ambush'],
  ['fireAttack'],
  ['inspire', 'ambush', 'betray'],
];

/** 表示確認用の指揮官ごとの統率・武力・知力（仮） */
const DEMO_ABILITIES: [leadership: number, strength: number, intelligence: number][] = [
  [82, 64, 71],
  [58, 77, 48],
  [45, 40, 92],
  [70, 88, 35],
  [90, 52, 80],
  [36, 72, 55],
  [64, 58, 66],
  [52, 94, 30],
  [76, 70, 84],
];

/** 表示確認用の指揮官の数（demoStatus の commander は 0..DEMO_COMMANDERS-1） */
export const DEMO_COMMANDERS = DEMO_ABILITIES.length;

/** 表示確認用の仮の状態。兵士数・士気は HEX の位置から決まるばらつき、行動力は満タン、指揮官は軍ごとに順に割り当てる（軍の最初のユニットが軍団長） */
export function demoStatuses(units: readonly UnitData[]): Map<UnitData, UnitStatus> {
  const out = new Map<UnitData, UnitStatus>();
  const perTeam = new Map<string, number>();
  const sorted = [...units].sort((a, b) => a.team.localeCompare(b.team) || a.row - b.row || a.col - b.col);
  let teamOffset = 0;
  for (const u of sorted) {
    if (!perTeam.has(u.team)) {
      perTeam.set(u.team, 0);
      // 軍ごとに指揮官の割り当ての開始位置をずらす（少人数どうしで同じ指揮官が並ばないように）
      teamOffset = (perTeam.size - 1) * 4;
    }
    const i = perTeam.get(u.team)!;
    perTeam.set(u.team, i + 1);
    out.set(u, { ...demoStatus(u.type, (teamOffset + i) % DEMO_COMMANDERS, hash(u.col, u.row, 1), hash(u.col, u.row, 2)), commander: i === 0 });
  }
  return out;
}

/** 表示確認用の仮の状態 1 つ分。指揮官の能力・スキルは commander 番目の仮の指揮官、兵士数・士気は 0..1 の r1・r2 でばらつかせ（兵数のゲージは満タン）、行動力は満タン */
export function demoStatus(type: UnitType, commander: number, r1: number, r2: number): UnitStatus {
  const soldiers = Math.round((MAX_SOLDIERS[type] * (0.3 + 0.7 * r1)) / 10) * 10;
  return {
    initialSoldiers: soldiers,
    soldiers,
    morale: Math.round(20 + 80 * r2),
    ap: MAX_AP[type],
    maxAp: MAX_AP[type],
    skills: DEMO_SKILLS[commander] ?? [],
    leadership: DEMO_ABILITIES[commander]?.[0] ?? 50,
    strength: DEMO_ABILITIES[commander]?.[1] ?? 50,
    intelligence: DEMO_ABILITIES[commander]?.[2] ?? 50,
    moved: false,
    attacked: false,
    justAttacked: false,
    intercepting: false,
    cooldowns: {},
    conditions: [],
    spells: [],
    ...typeTraits(type),
  };
}

/** 0..1 の決まった乱数 */
export function hash(col: number, row: number, salt: number): number {
  let h = Math.imul(col * 374761393 + row * 668265263 + salt * 2147483647, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
