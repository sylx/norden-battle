/**
 * 攻撃の判定（値は仮）。攻撃の定義は attacks.ts、ダメージの計算は damage.ts、士気の増減は morale.ts。
 *
 * - 兵種ごとの射程（minRange〜maxRange、HEX の距離）。弓兵・ライフル兵は 1〜2、魔術師・上級魔術師・砲兵は 2〜3、ほかは 1。
 *   隣接したユニットを攻撃できない兵種（魔術師・上級魔術師・砲兵）は minRange = 2 にする。攻撃の定義に射程があればそちら。
 * - 兵種は使える攻撃の一覧（attacks）を持つ。兵種と攻撃の ID から、省略を埋めた攻撃の定義を引く（resolveAttack）。
 * - 当たる範囲（attacks.ts の Shape）: path・line の攻撃は、隣より遠い HEX は 6 方向の直線上だけを狙える（canAim）。
 *   範囲にいる目標以外のユニット（splashUnits。敵、friendlyFire なら味方も）は巻き添えで、目標を撃ったのと同じ計算（倍率は splashPower）で
 *   反撃は無い（splashResult）。撃ったユニットの士気は目標への攻撃の分だけ増減し、巻き添えでは増減しない。
 *   ライフル兵の通常攻撃と迎撃は path（弾が目標の手前の HEX にいるユニットにも敵・味方を問わず当たる）。
 * - ranged の兵種（弓兵・魔術師・ライフル兵・砲兵）の攻撃は放物線の矢印で出す。ただし直線に飛ぶ攻撃（path・line）は直線の矢印（attackArc）。
 * - magic の兵種（魔術師・上級魔術師）は、指揮官の武力の代わりに知力を使う（ダメージ・士気の増減）。
 *   indirect の攻撃（サンダーフォール・迎撃の自動攻撃）は隣接した相手にも間接攻撃で、反撃を受けない。
 *   魔法の攻撃は、相手の武力による軽減と迎撃の構えの影響を受けない（damage.ts）。
 * - moveAfterAttack の兵種（騎兵）だけ、攻撃の後に移動できる（一撃離脱）。攻撃の直後は敵の ZOC の中からでも動き出せる。
 * - 突撃（騎兵）は隣の相手を攻撃した後、相手を突き抜けて同じ向きの向こうの HEX へ飛び出る（chargeLanding）。
 *   その HEX にユニットがいる・通れない地形・マップの外なら飛び出さない。相手が城・砦（WALLED_FEATURES）の HEX にいれば
 *   突き抜けられない（攻撃はする）。行動力は突撃の分だけで、ZOC は関係ない。
 * - 隣接（距離 1）の相手への攻撃は直接攻撃で、相手も反撃して両軍の兵数が減る。距離 2 以上は一方的に減らす。
 * - 迎撃（app.ts）: 近接ユニットは構えている間、受けるダメージが減って反撃が増える（damage.ts）。
 *   間接（ranged）ユニットは構えている間、射程に入った敵へ 1 回だけ自動で攻撃する（interceptFire。反撃は受けない）。
 *   弓兵・ライフル兵（interceptHalts）に撃たれた敵は、そこで移動を止められ、残りの予約も行動力も失う（騎兵（unhaltable）は除く）。
 * - 包囲（movement.ts の encircled）されている相手へのダメージは増える。
 * - 地形効果（cellDefense。森・砦・城など）のある HEX にいる相手へのダメージは減り、
 *   弓兵・砲兵が相手より高い HEX から攻撃するとダメージが増える（damage.ts）。
 *   砲兵が城・砦（WALLED_FEATURES）にいる相手を攻撃するときは、地形効果が半分になる（damage.ts の terrainDefense）。
 * - 一斉攻撃は直接攻撃の兵種だけで、相手が攻撃する自分のほかの味方（直接攻撃の兵種）とも隣接している（取り囲んでいる）ときにできる。
 *   隣接している味方（volleySupporters）も一緒に攻撃する演出が入り、その数だけダメージが増える（damage.ts）。
 * - 攻撃の後、与えたダメージと反撃で受けたダメージの比で両軍の士気が増減する。
 */
import { axialDistance, type Offset } from '@norden/map-runtime/core/hex';
import { FEATURE_DEFS } from '@norden/map-runtime/core/features';
import type { HexCell, HexMap } from '@norden/map-runtime/core/mapData';
import { dirBetween } from '@norden/map-runtime/core/roads';
import { TERRAIN_DEFS } from '@norden/map-runtime/core/terrainTypes';
import type { UnitData, UnitType } from '@norden/map-runtime/core/units';
import type { ActionId } from './actions';
import { ATTACK_DEFS, isAttackId, type AttackDef, type AttackId, type Inflict, type MenuAttackId, type Shape, type StrikeFxKind } from './attacks';
import { calcCounter, calcDamage, highGroundLevels, terrainDefense, type Fighter, type Hit } from './damage';
import { moraleChange, type MoraleChange } from './morale';
import { encircled, enterCost } from './movement';
import type { UnitStatus } from './unitStatus';

export interface CombatDef {
  minRange: number;
  maxRange: number;
  /** 遠隔攻撃の兵種（矢印を放物線で出す。直線に飛ぶ攻撃は直線） */
  ranged: boolean;
  /** 攻撃の後に移動できる */
  moveAfterAttack?: boolean;
  /** 指揮官の武力の代わりに知力を使い、攻撃が魔法になる */
  magic?: boolean;
  /** 迎撃の自動攻撃で、撃った相手の移動をそこで止めて行動を終わらせる（弓兵・ライフル兵） */
  interceptHalts?: boolean;
  /** interceptHalts の迎撃を受けても止まらない（騎兵） */
  unhaltable?: boolean;
  /** 使える攻撃（行動メニューの「攻撃」に、この順に並ぶ） */
  attacks: readonly MenuAttackId[];
  /** 通常攻撃と迎撃の当たる範囲（省略: 目標だけ）。ライフル兵は path で、範囲の味方にも当たる */
  normal?: { shape: Shape; friendlyFire?: boolean };
  /** 攻撃の演出（攻撃の定義に fx が無ければこれ） */
  fx: StrikeFxKind;
}

export const COMBAT_DEFS: Record<UnitType, CombatDef> = {
  infantry: { minRange: 1, maxRange: 1, ranged: false, attacks: ['attack', 'volley'], fx: 'slash' },
  archer: { minRange: 1, maxRange: 2, ranged: true, interceptHalts: true, attacks: ['attack'], fx: 'arrows' },
  cavalry: { minRange: 1, maxRange: 1, ranged: false, moveAfterAttack: true, unhaltable: true, attacks: ['attack', 'volley', 'charge'], fx: 'lance' },
  mage: { minRange: 2, maxRange: 3, ranged: true, magic: true, attacks: ['thunderfall'], fx: 'thunder' },
  rifleman: {
    minRange: 1,
    maxRange: 2,
    ranged: true,
    interceptHalts: true,
    attacks: ['attack'],
    normal: { shape: { kind: 'path' }, friendlyFire: true },
    fx: 'bullets',
  },
  artillery: { minRange: 2, maxRange: 3, ranged: true, attacks: ['attack'], fx: 'shell' },
  landsknecht: { minRange: 1, maxRange: 1, ranged: false, attacks: ['attack', 'volley'], fx: 'slash' },
  // 上級魔術師（M007 の段階 0 では魔術師と同じ。使える魔法の違いは段階 2 以降）
  wizard: { minRange: 2, maxRange: 3, ranged: true, magic: true, attacks: ['thunderfall'], fx: 'thunder' },
};

/** 省略を兵種から埋めた攻撃の定義（resolveAttack） */
export interface ResolvedAttack extends Pick<AttackDef, 'id' | 'name' | 'cost' | 'power' | 'aim' | 'special'> {
  range: { min: number; max: number };
  shape: Shape;
  splashPower: number;
  friendlyFire: boolean;
  indirect: boolean;
  magic: boolean;
  cooldown: number;
  inflicts: readonly Inflict[];
  fx: StrikeFxKind;
}

const SINGLE: Shape = { kind: 'single' };

/** type の兵種が id の攻撃をするときの定義（省略した射程・範囲・魔法・演出を兵種から埋める） */
export function resolveAttack(type: UnitType, id: AttackId): ResolvedAttack {
  const def = ATTACK_DEFS[id];
  const c = COMBAT_DEFS[type];
  // 兵種の形は通常攻撃と迎撃だけに効く
  const normal = id === 'attack' || id === 'interceptFire' ? c.normal : undefined;
  return {
    id,
    name: def.name,
    cost: def.cost,
    power: def.power,
    aim: def.aim,
    ...(def.special && { special: def.special }),
    range: def.range ?? { min: c.minRange, max: c.maxRange },
    shape: def.shape ?? normal?.shape ?? SINGLE,
    splashPower: def.splashPower ?? def.power,
    friendlyFire: def.friendlyFire ?? normal?.friendlyFire ?? false,
    indirect: !!def.indirect,
    magic: def.magic ?? !!c.magic,
    cooldown: def.cooldown ?? 0,
    inflicts: def.inflicts ?? [],
    fx: def.fx ?? c.fx,
  };
}

/** type の兵種の id の攻撃の矢印を放物線で出すか（遠隔攻撃の兵種。直線に飛ぶ攻撃は直線） */
export function attackArc(type: UnitType, id: AttackId): boolean {
  const kind = resolveAttack(type, id).shape.kind;
  return COMBAT_DEFS[type].ranged && kind !== 'path' && kind !== 'line';
}

/** type の兵種を率いる指揮官の、ダメージ・士気の増減に使う力: 武力（magic の兵種は知力） */
export function mightFor(type: UnitType, commander: Pick<UnitStatus, 'strength' | 'intelligence'>): number {
  return COMBAT_DEFS[type].magic ? commander.intelligence : commander.strength;
}

/** 指揮官の武力（magic の兵種は知力）。ダメージ・士気の増減に使う */
export function mightOf(unit: UnitData, status: UnitStatus): number {
  return mightFor(unit.type, status);
}

/** 行動メニューの攻撃か */
export function isAttack(id: ActionId): id is MenuAttackId {
  return isAttackId(id);
}

export function hexDistance(map: HexMap, a: Offset, b: Offset): number {
  const l = map.layout;
  return axialDistance(l.offsetToAxial(a.col, a.row), l.offsetToAxial(b.col, b.row));
}

/** type の兵種が id の攻撃で from から to を狙えるか（射程の中か。path・line の攻撃は、隣より遠い HEX は直線上だけ。self は自分の HEX だけ） */
export function canAim(map: HexMap, type: UnitType, id: AttackId, from: Offset, to: Offset): boolean {
  const a = resolveAttack(type, id);
  if (a.aim === 'self') return from.col === to.col && from.row === to.row;
  const d = hexDistance(map, from, to);
  if (d < a.range.min || d > a.range.max) return false;
  const straight = a.shape.kind === 'path' || a.shape.kind === 'line';
  return !straight || d <= 1 || cellsBetween(map, from, to) !== null;
}

/** type の兵種が通常攻撃（迎撃も同じ射程・形）で from から to を撃てるか */
export function inRange(map: HexMap, type: UnitType, from: Offset, to: Offset): boolean {
  return canAim(map, type, 'attack', from, to);
}

/** from から to への 6 方向の直線上で、間にある HEX（隣なら空。直線上でなければ null） */
function cellsBetween(map: HexMap, from: Offset, to: Offset): Offset[] | null {
  const l = map.layout;
  const a = l.offsetToAxial(from.col, from.row);
  const b = l.offsetToAxial(to.col, to.row);
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  if (dq !== 0 && dr !== 0 && dq + dr !== 0) return null;
  const d = axialDistance(a, b);
  const out: Offset[] = [];
  for (let k = 1; k < d; k++) out.push(l.axialToOffset(a.q + (dq * k) / d, a.r + (dr * k) / d));
  return out;
}

/** center から radius HEX 以内のマップの中の HEX（center を含む） */
function cellsWithin(map: HexMap, center: Offset, radius: number): Offset[] {
  const out: Offset[] = [];
  for (let row = 0; row < map.layout.rows; row++) {
    for (let col = 0; col < map.layout.cols; col++) if (hexDistance(map, center, { col, row }) <= radius) out.push({ col, row });
  }
  return out;
}

/**
 * from から aimed を狙ったときに当たる範囲の HEX（マップの中だけ。from は含まない）。
 * path は目標までの手前の HEX と目標、line は目標の向きへ length HEX（直線上でなければ目標だけ）
 */
export function areaCells(map: HexMap, from: Offset, aimed: Offset, shape: Shape): Offset[] {
  const l = map.layout;
  const notFrom = (o: Offset) => o.col !== from.col || o.row !== from.row;
  switch (shape.kind) {
    case 'path':
      return [...(cellsBetween(map, from, aimed) ?? []), aimed];
    case 'line': {
      const a = l.offsetToAxial(from.col, from.row);
      const b = l.offsetToAxial(aimed.col, aimed.row);
      const d = axialDistance(a, b);
      if (d === 0 || cellsBetween(map, from, aimed) === null) return [aimed];
      const out: Offset[] = [];
      for (let k = 1; k <= shape.length; k++) out.push(l.axialToOffset(a.q + ((b.q - a.q) * k) / d, a.r + ((b.r - a.r) * k) / d));
      return out.filter((o) => l.inBounds(o.col, o.row));
    }
    case 'burst':
      return cellsWithin(map, aimed, shape.radius).filter(notFrom);
    case 'around':
      return cellsWithin(map, from, shape.radius).filter(notFrom);
    case 'single':
    case 'chain':
      return [aimed];
  }
}

/**
 * unit が from から aimed を id の攻撃で狙ったときの巻き添え（範囲にいる目標以外のユニット。撃つユニットと目標 main は除く。
 * 味方は friendlyFire の攻撃のときだけ）。範囲の順（path は手前から）
 */
export function splashUnits(map: HexMap, unit: UnitData, from: Offset, main: UnitData | null, aimed: Offset, id: AttackId): UnitData[] {
  const a = resolveAttack(unit.type, id);
  return areaCells(map, from, aimed, a.shape).flatMap((o) => {
    const u = map.unitAt(o.col, o.row);
    if (!u || u === unit || u === main || (u.team === unit.team && !a.friendlyFire)) return [];
    return [u];
  });
}

/** unit が pos から攻撃できる敵ユニット（id の攻撃。省略すれば兵種のどれかの攻撃で） */
export function attackTargets(map: HexMap, unit: UnitData, pos: Offset, id?: AttackId): UnitData[] {
  const ids = id ? [id] : COMBAT_DEFS[unit.type].attacks;
  return map.allUnits().filter((u) => u.team !== unit.team && ids.some((i) => canAim(map, unit.type, i, pos, u)));
}

/** unit が pos から攻撃で狙える HEX（相手がいるかどうかに関わらない。id の攻撃。省略すれば兵種のどれかの攻撃で） */
export function attackRange(map: HexMap, unit: UnitData, pos: Offset, id?: AttackId): Offset[] {
  const ids = id ? [id] : COMBAT_DEFS[unit.type].attacks;
  const out: Offset[] = [];
  for (let row = 0; row < map.layout.rows; row++) {
    for (let col = 0; col < map.layout.cols; col++) {
      if (ids.some((i) => canAim(map, unit.type, i, pos, { col, row }))) out.push({ col, row });
    }
  }
  return out;
}

/** 城・砦の人工物（突撃で突き抜けられない。そこにいる相手を攻撃しても飛び出さない。砲兵に攻撃されると地形効果が半分になる） */
const WALLED_FEATURES: ReadonlySet<string> = new Set(['castle', 'fort']);

/** pos から隣の target へ突撃したときに飛び出る HEX（飛び出せなければ null。target が城・砦なら必ず null） */
export function chargeLanding(map: HexMap, pos: Offset, target: Offset): Offset | null {
  const dir = dirBetween(map, pos, target);
  if (dir < 0) return null;
  const n = map.layout.neighborInDir(target.col, target.row, dir);
  const from = map.get(target.col, target.row);
  const to = map.get(n.col, n.row);
  if (!from || !to || (from.feature && WALLED_FEATURES.has(from.feature))) return null;
  if (map.unitAt(n.col, n.row) || enterCost(from, dir, to) === null) return null;
  return n;
}

/** 攻撃の当事者 */
export interface Combatant {
  unit: UnitData;
  status: UnitStatus;
  /** 攻撃のときにいる HEX（予約した移動先・移動の途中など。マップ上の位置と違うことがある） */
  pos: Offset;
}

export interface AttackResult {
  /** 相手の兵数の減少 */
  damage: number;
  /** 反撃による自分の兵数の減少（直接攻撃でなければ 0） */
  counter: number;
  /** 隣接した相手への直接攻撃か（反撃を受ける。迎撃の自動攻撃は除く） */
  direct: boolean;
  /** 相手が包囲されているか（ダメージが増える） */
  encircled: boolean;
  /** 相手のいる HEX の地形効果（受けるダメージを減らす割合。なければ 0。砲兵が城・砦を攻撃するときは減らした値） */
  defense: number;
  /** 高所から攻撃してダメージが増えた標高レベルの差（増えなければ 0） */
  highGround: number;
  /** 一斉攻撃に加わった味方の数（一斉攻撃でなければ 0） */
  supporters: number;
  /** 士気の増減 */
  morale: MoraleChange;
}

/** ランダム係数（−1〜1）。攻撃のダメージと反撃のダメージで別々に振る */
export interface AttackRolls {
  damage: number;
  counter: number;
}

/**
 * attacker が defender を id の攻撃で攻撃したときの結果。
 * 包囲・地形は両者をそれぞれの pos に置いて判定する（予約中・移動の途中はまだそこにいないため）。
 * splash なら範囲の巻き添えで、倍率は splashPower、隣接していても反撃を受けない。
 */
export function attackResult(map: HexMap, attacker: Combatant, defender: Combatant, id: AttackId, rolls: AttackRolls, splash = false): AttackResult {
  const a = resolveAttack(attacker.unit.type, id);
  const volley = a.special === 'volley';
  const supporters = volley ? volleySupporters(map, attacker.unit, defender.pos).length : 0;
  const att = { ...fighter(map, attacker, encircledAt(map, attacker, defender)), supporters };
  const def = fighter(map, defender, encircledAt(map, defender, attacker));
  const direct = !splash && !a.indirect && hexDistance(map, attacker.pos, defender.pos) <= 1;
  const hit: Hit = { power: splash ? a.splashPower : a.power, magic: a.magic, volley };
  const damage = calcDamage(att, def, hit, rolls.damage);
  const counter = direct ? calcCounter(att, { ...def, soldiers: def.soldiers - damage }, rolls.counter) : 0;
  return {
    damage,
    counter,
    direct,
    encircled: def.encircled,
    defense: terrainDefense(att, def),
    highGround: highGroundLevels(att, def),
    supporters,
    morale: moraleChange(damage, counter, att.strength, def.strength),
  };
}

/**
 * 範囲の巻き添えで victim に当たったときの結果（目標を撃ったのと同じ計算で倍率は splashPower、反撃は無い。roll はランダム係数）。
 * 撃ったユニットの士気は目標への攻撃で増減するので、巻き添えでは増減しない（morale.attacker は 0）
 */
export function splashResult(map: HexMap, attacker: Combatant, victim: Combatant, id: AttackId, roll: number): AttackResult {
  const result = attackResult(map, attacker, victim, id, { damage: roll, counter: 0 }, true);
  return { ...result, morale: { ...result.morale, attacker: 0 } };
}

/** 攻撃の結果の予測（ランダム係数が真ん中のときの結果と、ダメージ・反撃の幅。splash は巻き添えのユニットへのダメージの幅） */
export interface AttackForecast {
  expected: AttackResult;
  damage: [min: number, max: number];
  counter: [min: number, max: number];
  splash: { unit: UnitData; damage: [min: number, max: number] }[];
}

/** splash は範囲の巻き添えのユニット（splashUnits） */
export function attackForecast(map: HexMap, attacker: Combatant, defender: Combatant, id: AttackId, splash: readonly Combatant[] = []): AttackForecast {
  const at = (damage: number, counter: number) => attackResult(map, attacker, defender, id, { damage, counter });
  // 与えるダメージが少ないほど相手の兵が残って反撃が増える
  const low = at(-1, 1);
  const high = at(1, -1);
  return {
    expected: at(0, 0),
    damage: [low.damage, high.damage],
    counter: [high.counter, low.counter],
    splash: splash.map((v) => ({ unit: v.unit, damage: [splashResult(map, attacker, v, id, -1).damage, splashResult(map, attacker, v, id, 1).damage] })),
  };
}

function fighter(map: HexMap, { unit, status, pos }: Combatant, encircled: boolean): Fighter {
  const { soldiers, morale, leadership } = status;
  const guarding = status.intercepting && !COMBAT_DEFS[unit.type].ranged;
  const cell = map.get(pos.col, pos.row);
  return {
    type: unit.type,
    soldiers,
    morale,
    leadership,
    strength: mightOf(unit, status),
    encircled,
    guarding,
    supporters: 0,
    defense: cell ? cellDefense(cell) : 0,
    walled: !!cell?.feature && WALLED_FEATURES.has(cell.feature),
    elevation: cell?.elevation ?? 0,
  };
}

/** cell にいるユニットが受けるダメージを減らす割合（地形効果）。人工物があればその値、なければ地形の値 */
export function cellDefense(cell: HexCell): number {
  const feature = cell.feature ? FEATURE_DEFS[cell.feature].defense : undefined;
  return feature ?? TERRAIN_DEFS[cell.terrain].defense;
}

/**
 * target を一斉攻撃するときに加わる味方（target に隣接している、attacker 以外の attacker の味方）。
 * 一斉攻撃ができる兵種（直接攻撃の兵種。間接の弓兵・魔術師は除く）だけが加わる
 */
export function volleySupporters(map: HexMap, attacker: UnitData, target: Offset): UnitData[] {
  return map
    .allUnits()
    .filter((u) => u.team === attacker.team && u !== attacker && !COMBAT_DEFS[u.type].ranged && hexDistance(map, u, target) === 1);
}

/** who が who.pos で包囲されているか（other は other.pos にいるとして判定する） */
function encircledAt(map: HexMap, who: Combatant, other: Combatant): boolean {
  const enemies = map
    .allUnits()
    .filter((u) => u.team !== who.unit.team)
    .map((u) => (u === other.unit ? other.pos : u));
  return encircled(map, who.pos, enemies);
}

/** 迎撃の構えの間接ユニットのうち、mover が pos に入ったときに射程に入るもの */
export function interceptorsAt(map: HexMap, statuses: ReadonlyMap<UnitData, UnitStatus>, mover: UnitData, pos: Offset): UnitData[] {
  return map.allUnits().filter((u) => {
    if (u.team === mover.team || !COMBAT_DEFS[u.type].ranged || !statuses.get(u)?.intercepting) return false;
    return canAim(map, u.type, 'interceptFire', u, pos);
  });
}
