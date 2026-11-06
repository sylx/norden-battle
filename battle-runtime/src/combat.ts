/**
 * 攻撃の判定（値は仮）。ダメージの計算は damage.ts、士気の増減は morale.ts。
 *
 * - 兵種ごとの射程（minRange〜maxRange、HEX の距離）。弓兵・ライフル兵は 1〜2、魔術師・上級魔術師・砲兵は 2〜3、ほかは 1。
 *   隣接したユニットを攻撃できない兵種（魔術師・上級魔術師・砲兵）は minRange = 2 にする。
 *   pierce の兵種（ライフル兵）は、隣より遠い HEX は 6 方向の直線上だけを撃てる（inRange）。撃つと弾が目標の手前の HEX にいる
 *   ユニットにも敵・味方を問わず当たる（piercedUnits。目標を撃ったのと同じ計算で、反撃は無い。迎撃の自動攻撃も同じ）。
 *   撃ったユニットの士気は目標への攻撃の分だけ増減し、巻き添えでは増減しない。
 * - ranged の兵種（弓兵・魔術師・ライフル兵・砲兵）の攻撃は放物線の矢印で出す。ただし pierce の兵種（ライフル兵）は、弾がまっすぐ飛んで
 *   手前の HEX にも当たるので直線の矢印で出す（attackArc）。
 * - magic の兵種（魔術師・上級魔術師）は、指揮官の武力の代わりに知力を使う（ダメージ・士気の増減）。
 *   攻撃（サンダーフォール）は隣接した相手にも間接攻撃で、反撃を受けない（INDIRECT_KINDS）。
 *   魔術師の攻撃は魔法で、相手の武力による軽減と迎撃の構えの影響を受けない（damage.ts）。
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
import { ATTACK_POWER, calcCounter, calcDamage, highGroundLevels, terrainDefense, type AttackKind, type Fighter } from './damage';
import { moraleChange, type MoraleChange } from './morale';
import { encircled, enterCost } from './movement';
import type { UnitStatus } from './unitStatus';

export interface CombatDef {
  minRange: number;
  maxRange: number;
  /** 遠隔攻撃の兵種（矢印を放物線で出す。pierce の兵種は直線） */
  ranged: boolean;
  /** 攻撃の後に移動できる */
  moveAfterAttack?: boolean;
  /** 指揮官の武力の代わりに知力を使う */
  magic?: boolean;
  /** 迎撃の自動攻撃で、撃った相手の移動をそこで止めて行動を終わらせる（弓兵・ライフル兵） */
  interceptHalts?: boolean;
  /** interceptHalts の迎撃を受けても止まらない（騎兵） */
  unhaltable?: boolean;
  /** 隣より遠い目標は直線上だけを撃てて、目標の手前の HEX にいるユニットにも（敵・味方を問わず）当たる（ライフル兵） */
  pierce?: boolean;
}

export const COMBAT_DEFS: Record<UnitType, CombatDef> = {
  infantry: { minRange: 1, maxRange: 1, ranged: false },
  archer: { minRange: 1, maxRange: 2, ranged: true, interceptHalts: true },
  cavalry: { minRange: 1, maxRange: 1, ranged: false, moveAfterAttack: true, unhaltable: true },
  mage: { minRange: 2, maxRange: 3, ranged: true, magic: true },
  rifleman: { minRange: 1, maxRange: 2, ranged: true, interceptHalts: true, pierce: true },
  artillery: { minRange: 2, maxRange: 3, ranged: true },
  landsknecht: { minRange: 1, maxRange: 1, ranged: false },
  // 上級魔術師（M007 の段階 0 では魔術師と同じ。使える魔法の違いは段階 2 以降）
  wizard: { minRange: 2, maxRange: 3, ranged: true, magic: true },
};

/** type の兵種の攻撃の矢印を放物線で出すか（遠隔攻撃の兵種。弾がまっすぐ飛ぶ pierce の兵種は直線） */
export function attackArc(type: UnitType): boolean {
  const def = COMBAT_DEFS[type];
  return def.ranged && !def.pierce;
}

/** 隣接した相手へでも間接攻撃になる（反撃を受けない）攻撃の種類 */
const INDIRECT_KINDS: readonly AttackKind[] = ['interceptFire', 'thunderfall'];

/** type の兵種を率いる指揮官の、ダメージ・士気の増減に使う力: 武力（magic の兵種は知力） */
export function mightFor(type: UnitType, commander: Pick<UnitStatus, 'strength' | 'intelligence'>): number {
  return COMBAT_DEFS[type].magic ? commander.intelligence : commander.strength;
}

/** 指揮官の武力（magic の兵種は知力）。ダメージ・士気の増減に使う */
export function mightOf(unit: UnitData, status: UnitStatus): number {
  return mightFor(unit.type, status);
}

export function isAttack(id: ActionId): boolean {
  return id in ATTACK_POWER;
}

export function hexDistance(map: HexMap, a: Offset, b: Offset): number {
  const l = map.layout;
  return axialDistance(l.offsetToAxial(a.col, a.row), l.offsetToAxial(b.col, b.row));
}

/** type の兵種が from から to を撃てるか（射程の中か。pierce の兵種は、隣より遠い HEX は直線上だけ） */
export function inRange(map: HexMap, type: UnitType, from: Offset, to: Offset): boolean {
  const { minRange, maxRange, pierce } = COMBAT_DEFS[type];
  const d = hexDistance(map, from, to);
  if (d < minRange || d > maxRange) return false;
  return !pierce || d <= 1 || cellsBetween(map, from, to) !== null;
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

/**
 * pierce の兵種の unit が from から target（to にいる）を撃ったときに、目標の手前で弾が当たるユニット
 * （敵・味方を問わない。撃つユニットと目標は除く）。pierce でない兵種は空
 */
export function piercedUnits(map: HexMap, unit: UnitData, from: Offset, target: UnitData, to: Offset): UnitData[] {
  if (!COMBAT_DEFS[unit.type].pierce) return [];
  return (cellsBetween(map, from, to) ?? []).flatMap((o) => {
    const u = map.unitAt(o.col, o.row);
    return u && u !== unit && u !== target ? [u] : [];
  });
}

/** unit が pos から攻撃できる敵ユニット */
export function attackTargets(map: HexMap, unit: UnitData, pos: Offset): UnitData[] {
  return map.allUnits().filter((u) => u.team !== unit.team && inRange(map, unit.type, pos, u));
}

/** unit が pos から攻撃できる範囲の HEX（相手がいるかどうかに関わらない） */
export function attackRange(map: HexMap, unit: UnitData, pos: Offset): Offset[] {
  const out: Offset[] = [];
  for (let row = 0; row < map.layout.rows; row++) {
    for (let col = 0; col < map.layout.cols; col++) {
      if (inRange(map, unit.type, pos, { col, row })) out.push({ col, row });
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
 * attacker が defender を kind で攻撃したときの結果。
 * 包囲・地形は両者をそれぞれの pos に置いて判定する（予約中・移動の途中はまだそこにいないため）。
 * indirect なら隣接していても反撃を受けない（pierce の弾が目標の手前で当たったとき）。
 */
export function attackResult(map: HexMap, attacker: Combatant, defender: Combatant, kind: AttackKind, rolls: AttackRolls, indirect = false): AttackResult {
  const supporters = kind === 'volley' ? volleySupporters(map, attacker.unit, defender.pos).length : 0;
  const att = { ...fighter(map, attacker, encircledAt(map, attacker, defender)), supporters };
  const def = fighter(map, defender, encircledAt(map, defender, attacker));
  const direct = !indirect && !INDIRECT_KINDS.includes(kind) && hexDistance(map, attacker.pos, defender.pos) <= 1;
  const damage = calcDamage(att, def, kind, rolls.damage);
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
 * pierce の弾が目標の手前で victim に当たったときの結果（目標を撃ったのと同じ計算で、反撃は無い。roll はランダム係数）。
 * 撃ったユニットの士気は目標への攻撃で増減するので、巻き添えでは増減しない（morale.attacker は 0）
 */
export function pierceResult(map: HexMap, attacker: Combatant, victim: Combatant, kind: AttackKind, roll: number): AttackResult {
  const result = attackResult(map, attacker, victim, kind, { damage: roll, counter: 0 }, true);
  return { ...result, morale: { ...result.morale, attacker: 0 } };
}

/** 攻撃の結果の予測（ランダム係数が真ん中のときの結果と、ダメージ・反撃の幅。pierced は目標の手前で弾が当たるユニットへのダメージの幅） */
export interface AttackForecast {
  expected: AttackResult;
  damage: [min: number, max: number];
  counter: [min: number, max: number];
  pierced: { unit: UnitData; damage: [min: number, max: number] }[];
}

/** pierced は目標の手前で弾が当たるユニット（piercedUnits） */
export function attackForecast(map: HexMap, attacker: Combatant, defender: Combatant, kind: AttackKind, pierced: readonly Combatant[] = []): AttackForecast {
  const at = (damage: number, counter: number) => attackResult(map, attacker, defender, kind, { damage, counter });
  // 与えるダメージが少ないほど相手の兵が残って反撃が増える
  const low = at(-1, 1);
  const high = at(1, -1);
  return {
    expected: at(0, 0),
    damage: [low.damage, high.damage],
    counter: [high.counter, low.counter],
    pierced: pierced.map((v) => ({ unit: v.unit, damage: [pierceResult(map, attacker, v, kind, -1).damage, pierceResult(map, attacker, v, kind, 1).damage] })),
  };
}

function fighter(map: HexMap, { unit, status, pos }: Combatant, encircled: boolean): Fighter {
  const { soldiers, morale, leadership } = status;
  const guarding = status.intercepting && !COMBAT_DEFS[unit.type].ranged;
  const magic = !!COMBAT_DEFS[unit.type].magic;
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
    magic,
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
    return inRange(map, u.type, u, pos);
  });
}
