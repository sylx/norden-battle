/**
 * CPU の 1 手読み。部隊の行動の候補（移動先 × 攻撃 × 狙う HEX、移動だけ、その場で待機、迎撃の構え・鼓舞・退却）を並べて点数を付け、
 * 一番いいものを選ぶ。考える要素は CpuFeatures で切れる（切ると段階 1 の考え方）。
 *
 * - 攻撃の点数（attackScore）: 予測（attackForecast の期待値）から、与えるダメージ − 受ける反撃、殲滅・壊滅の見込み、士気の差、巻き添え。
 *   兵数は兵種の力で重みを付け（worth.ts）、軍団長の部隊は重く見る（狙う・守る）。
 *   allAttacks: 地点を狙う攻撃（メテオ・アーススパイク）・自分が中心の攻撃（乱撃）も候補にし、範囲の味方の巻き添え（壊滅させるならさらに引く）、
 *   状態異常（凍結・混乱で相手の番を止める）、耕す（敵のいる HEX の守りを下げる・城壁を崩す）を点数にする。
 *   クールタイムのある攻撃は、クールタイムの番の数だけ得る点数を割り引く（いま撃つか取っておくか）
 * - 位置の点数（positionScore）: 敵への近さ（射程のある兵種は射程の端）、攻撃側は防衛拠点への近さ・防衛側は拠点の周り、地形の守り、
 *   次の敵の番に攻撃される見込み（danger: 受けそうなダメージ。danger.ts。切ると攻撃できる敵の数。threat.ts）。
 *   danger: 移動の途中で迎撃の構えの間接ユニットに撃たれる見込み（足止めされるなら、そこで行動が終わるものとして数える）
 * - 構え（stances）: 移動の後に迎撃の構え（間接の兵種は射程に入ってきそうな敵を撃つ見込み、近接の兵種は受けるダメージが減る分）・
 *   鼓舞（上がる士気の分）。軍団長でない部隊は、兵が減って、どこへ動いても殲滅されそうで、殲滅できる相手もおらず、
 *   軍が数で勝っていなければ退却する
 * - 軍の作戦（strategy。strategy.ts）: 攻撃側は防衛拠点で行動を終えれば入城して勝つ。防衛側は拠点の守りの部隊を拠点に置き、
 *   拠点の隣の敵を重く狙い、拠点が危なければ塞ぐ。軍団長は前に出しすぎない。弱った相手に狙いを集める。負けを認めるなら軍団長が退却する
 * - 兵力の比: 受けるダメージと危険の重みに「敵の兵力 ÷ 味方の兵力」を掛け、敵に近づく重みにはその逆数を掛ける
 *   （数で勝る側は損を気にせず押し込んで残りを狩り、劣る側は慎重になる。どちらも待ち続けて決着しないのを避ける）
 * - 膠着: 戦況が動かない番が続いたら（urgency。player.ts が数える）、慎重さを下げて敵に近づく重みを上げる
 * - 往復しない: 攻撃せずに、前の自分の番の初めにいた HEX へ戻る手は減点する
 * - 移動だけの手は待機（か構え・鼓舞）で行動を終える（同じ番に何度も動き回らない）。攻撃の後に動ける騎兵は、攻撃を実行した後にもう一度決める
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { HexCell } from '@norden/map-runtime/core/mapData';
import type { UnitData } from '@norden/map-runtime/core/units';
import { buildActionMenu, SKILL_DEFS, type ActionId, type MenuEntry } from '../actions';
import { ATTACK_DEFS, type MenuAttackId } from '../attacks';
import {
  attackForecast,
  attackResult,
  attacksOf,
  canAim,
  cellDefense,
  chargeLanding,
  COMBAT_DEFS,
  hexDistance,
  mainTargetAt,
  mightOf,
  resolveAttack,
  splashUnits,
  type Combatant,
  type ResolvedAttack,
} from '../combat';
import { hasCondition } from '../conditions';
import { basicAttack } from '../damage';
import { SIDE_TEAM } from '../deployment';
import { INSPIRE_MAX, INSPIRE_MIN, type ActionEnd } from '../engine/action';
import { addLeg, aimCells, menuContext, moveCells, newPlan, rejectReason, setAttack } from '../engine/plan';
import type { Decision } from '../engine/sim';
import { castleLocked, rangeBonusAt, retreatDestinations, strongholdLocked, type BattleState } from '../engine/state';
import { moraleChange } from '../morale';
import type { MoveStep } from '../movement';
import type { RetreatDestination } from '../retreat';
import { plowPreview, PLOWED_TERRAIN } from '../terrain';
import { MAX_MORALE, type UnitStatus } from '../unitStatus';
import { dangerAt, dangerContext, walkIntercepts, type DangerContext } from './danger';
import { atStronghold, forcesOf, strongholdUrgent, type TeamPlan } from './strategy';
import { cellKey, enemyReach, threatMap, type Reach } from './threat';
import { featuresOf, type CpuFeatures, type CpuOptions } from './types';
import {
  CONCEDE_RATIO,
  CONCEDE_STALL,
  CONCEDE_STALL_RATIO,
  GUARD_RADIUS,
  LETHAL_SHARE,
  MAX_CAUTION,
  MAX_URGENCY,
  MIN_CAUTION,
  RETREAT_SOLDIERS,
  STALL_APPROACH,
  STALL_CAUTION,
  WEIGHTS as W,
} from './weights';
import { worth } from './worth';

export { worth } from './worth';

/** 行動の候補 */
export interface Candidate {
  score: number;
  /** 移動先（その場なら null） */
  step: MoveStep | null;
  /** 攻撃（しなければ null） */
  attack: { id: MenuAttackId; at: Offset } | null;
  end: ActionEnd;
  /** 退却先（退却のとき） */
  to?: RetreatDestination;
  /** 相手を殲滅する見込みか */
  kills?: boolean;
}

/** 1 回の decide で使う、盤面から求めておくもの */
export interface Context {
  state: BattleState;
  unit: UnitData;
  status: UnitStatus;
  features: CpuFeatures;
  enemies: UnitData[];
  /** 段階 1 の脅威（HEX ごとの、攻撃できる敵の数。danger を見るときは null） */
  threat: Map<number, number> | null;
  /** 敵ごとの、次の番に届く範囲（danger・stances を見ないときは null） */
  reach: Map<UnitData, Reach> | null;
  /** 受けそうなダメージの見積もり（danger を見ないときは null） */
  danger: DangerContext | null;
  /** 敵の兵力 ÷ 味方の兵力（兵数 × 兵の重さの合計。受けるダメージ・危険の重みに掛ける）。膠着すると下がる */
  caution: number;
  /** 敵に近づく重み（膠着すると上がる） */
  approach: number;
  /** 軍の作戦（strategy を見ないときは null） */
  team: TeamPlan | null;
  /** 防衛側で、拠点が空いていて隣に攻撃側のユニットがいる（拠点を塞ぐ） */
  urgent: boolean;
  /** 戦況が動いていない番の数（MAX_URGENCY まで） */
  urgency: number;
}

/** 盤面のほかに、軍の様子から決めること */
export interface Mood {
  /** 戦況が動いていない番の数（0 なら動いている） */
  urgency: number;
  /** 部隊ごとの、前の自分の番の初めにいた HEX */
  previous?: ReadonlyMap<UnitData, Offset>;
  /** 軍の作戦（番の初めに立てる。strategy.ts） */
  team?: TeamPlan;
}

/** 候補を並べた結果 */
interface Evaluation {
  ctx: Context;
  list: Candidate[];
  /** 行動メニュー（ターンの初めの予約で） */
  menu: MenuEntry[];
  /** 動ける HEX（その場も）のうち、受けそうなダメージが一番少ないもの（danger を見ないときは 0） */
  minDanger: number;
}

/** unit の次の行動を決める（行動できなければ null） */
export function decide(state: BattleState, unit: UnitData, options: CpuOptions, mood: Mood = { urgency: 0 }): Decision | null {
  const ev = evaluate(state, unit, mood, featuresOf(options));
  if (!ev) return null;
  const retreat = retreatChoice(ev, mood);
  if (retreat) return toDecision(state, unit, retreat);
  const best = ev.list.reduce<Candidate | null>((a, c) => (!a || c.score > a.score ? c : a), null);
  return best ? toDecision(state, unit, best) : null;
}

/** 候補を Decision（予約と終わり方）にする */
export function toDecision(state: BattleState, unit: UnitData, c: Candidate): Decision | null {
  const plan = newPlan(state, unit);
  if (!plan) return null;
  if (c.step) addLeg(plan, c.step);
  if (c.attack) {
    const def = ATTACK_DEFS[c.attack.id];
    setAttack(state, plan, { id: c.attack.id, name: def.name, cost: def.cost }, resolveAttack(unit.type, c.attack.id), c.attack.at);
  }
  return { plan, end: c.end, ...(c.to && { to: c.to }) };
}

/** unit の行動の候補と点数（行動できなければ空） */
export function candidates(state: BattleState, unit: UnitData, mood: Mood = { urgency: 0 }, features: CpuFeatures = featuresOf({ difficulty: 'normal' })): Candidate[] {
  return evaluate(state, unit, mood, features)?.list ?? [];
}

/** menu で id の行動を選べるか（1 階層目の行動か、2 階層目の選べる行動） */
function allows(menu: readonly MenuEntry[], id: ActionId): boolean {
  return menu.some((e) => e.enabled && (e.action?.id === id || !!e.children?.some((c) => c.id === id && !c.reason)));
}

function evaluate(state: BattleState, unit: UnitData, mood: Mood, features: CpuFeatures): Evaluation | null {
  const status = state.statuses.get(unit);
  const plan0 = newPlan(state, unit);
  if (!status || !plan0) return null;
  const menu = buildActionMenu(menuContext(state, plan0));
  const urgency = Math.min(mood.urgency, MAX_URGENCY);
  const reach = features.danger || features.stances ? enemyReach(state, unit.team) : null;
  const ctx: Context = {
    state,
    unit,
    status,
    features,
    enemies: state.map.allUnits().filter((u) => u.team !== unit.team),
    threat: features.danger ? null : threatMap(state, unit.team),
    reach,
    danger: features.danger && reach ? dangerContext(state, unit, status, reach) : null,
    caution: forceRatio(state, unit) * STALL_CAUTION ** urgency,
    approach: W.approach * (1 + STALL_APPROACH * urgency),
    team: features.strategy ? (mood.team ?? null) : null,
    urgent: features.strategy && strongholdUrgent(state, unit.team, unit),
    urgency,
  };
  const out: Candidate[] = [];
  const steps: (MoveStep | null)[] = [null, ...(allows(menu, 'move') ? moveCells(state, plan0).values() : [])];
  const attacks = status.attacked ? [] : attacksOf(unit.type, status).filter((id) => !status.cooldowns[id]);
  const canWait = allows(menu, 'wait');
  const stances = features.stances;
  const canIntercept = stances && allows(menu, 'intercept');
  const inspire = stances && status.skills.includes('inspire') ? inspireValue(ctx, 0) : 0;
  const inspireCost = SKILL_DEFS.inspire.cost;
  const capture = features.strategy && unit.team === SIDE_TEAM.attacker;
  let minDanger = Infinity;
  for (const step of steps) {
    let pos: Offset = step ?? unit;
    const ap = status.ap - (step?.cost ?? 0);
    // 攻撃せずに、前の番の初めにいた HEX へ戻る
    const back = mood.previous?.get(unit);
    const backtrack = step && back && back.col === pos.col && back.row === pos.row && (back.col !== unit.col || back.row !== unit.row) ? W.backtrack : 0;
    // 移動の途中で迎撃の構えの間接ユニットに撃たれる（足止めされたら、そこで行動が終わる）
    let walk = 0;
    if (step && ctx.danger) {
      const w = walkIntercepts(state, unit, status, step);
      walk = lossScore(ctx, w.damage, W.interceptTaken);
      if (w.haltAt) {
        pos = w.haltAt;
        const score = positionScore(ctx, pos) - walk - backtrack + (capture && atStronghold(state, pos) ? W.capture : 0);
        if (canWait) out.push({ score, step, attack: null, end: 'wait' });
        continue;
      }
    }
    if (ctx.danger) minDanger = Math.min(minDanger, dangerAt(ctx.danger, pos));
    const here = positionScore(ctx, pos);
    for (const id of attacks) {
      const attack = resolveAttack(unit.type, id);
      // 段階 1 は敵ユニットを狙う攻撃だけ
      if ((!features.allAttacks && attack.aim !== 'unit') || ap < attack.cost) continue;
      const plan = newPlan(state, unit)!;
      if (step) addLeg(plan, step);
      for (const at of aimCells(state, plan, attack)) {
        const target = mainTargetAt(state.map, unit, at, id);
        if (attack.aim === 'unit' && (!target || target.team === unit.team)) continue;
        if (target && rejectReason(state, plan, attack, target)) continue;
        if (attack.aim === 'cell' && !target && !worthAiming(ctx, pos, at, attack)) continue;
        const landing = attack.special === 'charge' && target ? chargeLanding(state.map, pos, target, castleLocked(unit, status), strongholdLocked(state, unit, status)) : null;
        const a = attackScore(ctx, pos, at, id, target);
        if (a.score === -Infinity) continue;
        const end = landing ?? pos;
        const score = a.score + (landing ? positionScore(ctx, landing) : here) - walk;
        // 攻撃側が防衛拠点で攻撃したら、待機して行動を終える（入城）
        if (capture && atStronghold(state, end) && canWait) out.push({ score: score + W.capture, step, attack: { id, at }, end: 'wait', kills: a.kills });
        else out.push({ score, step, attack: { id, at }, end: 'confirm', kills: a.kills });
        // 攻撃の後に鼓舞（攻撃で上がる士気の分を除いて）
        const lift = inspire > 0 && ap - attack.cost >= inspireCost ? inspireValue(ctx, a.morale) : 0;
        if (lift > 0) out.push({ score: score + lift, step, attack: { id, at }, end: 'inspire', kills: a.kills });
      }
    }
    // 動くだけ・その場で待機（行動を終える）・迎撃の構え・鼓舞
    const stay = here - walk - backtrack;
    if (canWait) out.push({ score: stay + (capture && atStronghold(state, pos) ? W.capture : 0), step, attack: null, end: 'wait' });
    if (canIntercept && ap >= 2) {
      // 膠着しているなら、敵は寄ってこないので構えの見込みは下がる
      // 攻撃側は攻めないと勝てないので、構えを軽く見る
      const v = interceptValue(ctx, pos) * STALL_CAUTION ** ctx.urgency * (unit.team === SIDE_TEAM.attacker ? W.attackerStance : 1);
      if (v > 0) out.push({ score: stay + v + (capture && atStronghold(state, pos) ? W.capture : 0), step, attack: null, end: 'intercept' });
    }
    if (inspire > 0 && ap >= inspireCost) out.push({ score: stay + inspire, step, attack: null, end: 'inspire' });
  }
  return { ctx, list: out, menu, minDanger: ctx.danger ? minDanger : 0 };
}

/**
 * 退却するか（するなら退却の候補）。負けを認めた軍の軍団長（どこへ動いても殲滅されそうなとき）、または、軍団長でない部隊で、兵が減って（RETREAT_SOLDIERS）、
 * どこへ動いても次の敵の番に殲滅されそうで、殲滅できる相手もおらず、軍が数で勝っていないとき
 */
function retreatChoice(ev: Evaluation, mood: Mood): Candidate | null {
  const { ctx, menu, list } = ev;
  const { state, unit, status, features } = ctx;
  if (!allows(menu, 'retreat')) return null;
  const to = retreatDestinations(state, unit)[0];
  if (!to) return null;
  const retreat: Candidate = { score: 0, step: null, attack: null, end: 'retreat', to };
  // 負けを認める: 数で大きく劣り、軍団長の部隊がどこへ動いても次の敵の番に殲滅されそうなら（捕縛を避ける）。
  // 殲滅されそうでなくても、数で劣ったまま戦況が CONCEDE_STALL 番動かなければ認める（逃げ回って決着しないのを避ける）
  const ratio = (features.strategy && status.commander && mood.team?.concede) || 0;
  if (ratio >= CONCEDE_RATIO && (!features.danger || ev.minDanger >= status.soldiers * LETHAL_SHARE)) return retreat;
  if (ratio >= CONCEDE_STALL_RATIO && mood.urgency >= CONCEDE_STALL) return retreat;
  if (!features.stances || !features.danger || status.commander) return null;
  if (status.soldiers > status.initialSoldiers * RETREAT_SOLDIERS) return null;
  if (list.some((c) => c.kills)) return null;
  if (ev.minDanger < status.soldiers * LETHAL_SHARE) return null;
  const f = forcesOf(state, unit.team, false);
  return f.foe >= f.own ? retreat : null;
}

/** unit の軍から見た、敵の兵力 ÷ 味方の兵力（MIN_CAUTION〜MAX_CAUTION） */
export function forceRatio(state: BattleState, unit: UnitData): number {
  const { own, foe } = forcesOf(state, unit.team);
  return Math.min(MAX_CAUTION, Math.max(MIN_CAUTION, own > 0 ? foe / own : MAX_CAUTION));
}

/** 兵を damage 失うことの点数（兵の重さ × weight × 慎重さ。壊滅するならさらに引く） */
function lossScore(ctx: Context, damage: number, weight: number): number {
  const { unit, status } = ctx;
  if (damage <= 0) return 0;
  let loss = Math.min(damage, status.soldiers) * worth(unit, status) * weight * ctx.caution;
  if (damage >= status.soldiers) loss += W.die + (status.commander ? W.dieCommander : 0);
  return loss;
}

/** 地点を狙う攻撃で、敵のいない HEX を狙う意味があるか（範囲に誰かいる、または耕して何か変わる） */
function worthAiming(ctx: Context, pos: Offset, at: Offset, attack: ResolvedAttack): boolean {
  const map = ctx.state.map;
  if (attack.plows && plowPreview(map, at)) return true;
  return splashUnits(map, ctx.unit, pos, null, at, attack.id).some((u) => u.team !== ctx.unit.team);
}

/** pos から at（目標は target。無ければ null）を id の攻撃で撃ったときの点数（予測の期待値から）と、相手を殲滅する見込みか */
export function attackScore(ctx: Context, pos: Offset, at: Offset, id: MenuAttackId, target: UnitData | null): { score: number; kills: boolean; morale: number } {
  const { state, unit, status, features } = ctx;
  const map = state.map;
  const def = resolveAttack(unit.type, id);
  const ts = target ? state.statuses.get(target) : undefined;
  const none = { score: -Infinity, kills: false, morale: 0 };
  if (target && !ts) return none;
  const attacker: Combatant = { unit, status, pos };
  const splash = splashUnits(map, unit, pos, target, at, id).flatMap((u): Combatant[] => {
    const s = state.statuses.get(u);
    return s ? [{ unit: u, status: s, pos: u }] : [];
  });
  const f = attackForecast(map, attacker, target && ts ? { unit: target, status: ts, pos: target } : null, id, splash);
  const e = f.expected;
  let score = 0;
  let kills = false;
  /** 自分の士気の増減 */
  let morale = e?.morale.attacker ?? 0;
  /** 敵に与えるダメージの合計（目標の無い攻撃の士気） */
  let dealtToEnemies = 0;
  if (target && ts) {
    if (!e) return none;
    const vt = worth(target, ts);
    const vs = worth(unit, status);
    const dealt = Math.min(e.damage, ts.soldiers);
    dealtToEnemies += dealt;
    score += dealt * vt - Math.min(e.counter, status.soldiers) * vs * W.taken * ctx.caution;
    if (e.damage >= ts.soldiers) {
      score += W.kill + (ts.commander ? W.killCommander : 0);
      kills = true;
    } else if (ts.commander) score += dealt * vt * W.commanderTarget;
    if (e.counter >= status.soldiers) score -= W.die + (status.commander ? W.dieCommander : 0);
    score += (e.morale.attacker - e.morale.defender) * W.morale;
    if (features.strategy) {
      // 弱った相手に狙いを集める・防衛拠点の隣の敵（次の番に入城できる）を討つ
      score += dealt * vt * W.focus * (1 - ts.soldiers / Math.max(1, ts.initialSoldiers));
      const hold = state.stronghold;
      if (hold && unit.team === SIDE_TEAM.defender && hexDistance(map, target, hold) <= 1) {
        score += dealt * vt * W.holdThreat;
        if (kills && ctx.urgent) score += W.block / 2;
      }
    }
    if (features.allAttacks && !kills) score += inflictValue(def, target, ts);
  }
  for (const s of f.splash) {
    const su = state.statuses.get(s.unit);
    if (!su) continue;
    const avg = Math.min((s.damage[0] + s.damage[1]) / 2, su.soldiers);
    const v = avg * worth(s.unit, su);
    if (s.unit.team === unit.team) {
      score -= v * W.friendlyFire;
      if (features.allAttacks && avg >= su.soldiers) score -= W.die + (su.commander ? W.dieCommander : 0);
      continue;
    }
    score += v;
    dealtToEnemies += avg;
    if (!features.allAttacks) continue;
    if (avg >= su.soldiers) {
      score += W.kill + (su.commander ? W.killCommander : 0);
      kills = true;
    } else score += inflictValue(def, s.unit, su);
  }
  if (features.allAttacks) {
    // 目標の無い攻撃（乱撃・敵のいない地点）は、敵に与えたダメージの合計で士気が上がる
    if (!e) {
      morale = moraleChange(dealtToEnemies, 0, mightOf(unit, status), 50).attacker;
      score += morale * W.morale;
    }
    if (def.plows) score += plowValue(ctx, at);
    // クールタイム: 使うと何番か撃てなくなるので、得る点数を割り引く
    if (def.cooldown > 0 && score > 0) score *= Math.max(0, 1 - W.cooldownReserve * def.cooldown);
  }
  return { score, kills, morale };
}

/** 攻撃が当たった victim に状態異常（凍結・混乱）が付く見込みの点数（相手の番を止める分。もう付いていれば数えない） */
function inflictValue(def: ResolvedAttack, victim: UnitData, vs: UnitStatus): number {
  let v = 0;
  for (const { condition, chance, turns } of def.inflicts) {
    if (hasCondition(vs, condition)) continue;
    const power = basicAttack({ type: victim.type, soldiers: vs.soldiers, morale: vs.morale, leadership: vs.leadership, strength: mightOf(victim, vs) });
    v += chance * Math.min(turns, 2) * power * W.disable;
  }
  return v;
}

/** at を耕す点数（敵のいる HEX の守りを下げる・城壁を崩す。防衛側が自分の城壁を崩すなら引く） */
function plowValue(ctx: Context, at: Offset): number {
  const { state, unit } = ctx;
  const map = state.map;
  const cell = map.get(at.col, at.row);
  const change = plowPreview(map, at);
  if (!cell || !change) return 0;
  const after: HexCell = { ...cell, terrain: change.from ? PLOWED_TERRAIN : cell.terrain, breached: change.breach ? true : cell.breached };
  const lowered = cellDefense(cell) - cellDefense(after);
  let v = 0;
  const occupant = map.unitAt(at.col, at.row);
  const os = occupant && state.statuses.get(occupant);
  if (occupant && os && os.soldiers > 0) v += (occupant.team === unit.team ? -1 : 1) * lowered * os.soldiers * worth(occupant, os) * W.plowEnemy;
  if (change.breach) v += unit.team === SIDE_TEAM.defender ? -W.breach * 2 : W.breach;
  return v;
}

/** 鼓舞の点数（上がる士気の見込み × 自分の基本攻撃力）。before は鼓舞の前に増減する士気（攻撃の後なら、その攻撃の分） */
function inspireValue(ctx: Context, before: number): number {
  const { unit, status } = ctx;
  const gain = Math.min((INSPIRE_MIN + INSPIRE_MAX) / 2, MAX_MORALE - Math.min(MAX_MORALE, status.morale + before));
  if (gain <= 0) return 0;
  return gain * basicAttack({ type: unit.type, soldiers: status.soldiers, morale: status.morale, leadership: status.leadership, strength: mightOf(unit, status) }) * W.inspire;
}

/**
 * pos で迎撃の構えをとる点数。間接の兵種: 次の敵の番に射程へ入ってきそうな敵に撃つ見込みのダメージ（一番効く相手 1 つ。
 * 弓兵・ライフル兵は前に出る敵を止める分も）。近接の兵種: 危険の点数のうち構えで減らせる分（受けるダメージが減り、反撃が増える）
 */
function interceptValue(ctx: Context, pos: Offset): number {
  const { state, unit, status } = ctx;
  const map = state.map;
  const def = COMBAT_DEFS[unit.type];
  if (!def.ranged) return ctx.danger ? dangerPenalty(ctx, pos, false) * W.guardStance : 0;
  if (!ctx.reach) return 0;
  const cols = map.layout.cols;
  const bonus = rangeBonusAt(state, unit, pos);
  let best = 0;
  for (const [enemy, r] of ctx.reach) {
    const es = state.statuses.get(enemy);
    if (!es) continue;
    const here = cellKey(state, enemy);
    let enters = false;
    for (const k of r.moves) {
      if (k === here) continue;
      if (canAim(map, unit.type, 'interceptFire', pos, { col: k % cols, row: Math.floor(k / cols) }, bonus)) {
        enters = true;
        break;
      }
    }
    if (!enters) continue;
    const res = attackResult(map, { unit, status, pos }, { unit: enemy, status: es, pos: enemy }, 'interceptFire', { damage: 0, counter: 0 });
    let v = Math.min(res.damage, es.soldiers) * worth(enemy, es) * W.interceptFire;
    if (def.interceptHalts && !COMBAT_DEFS[enemy.type].unhaltable && !COMBAT_DEFS[enemy.type].ranged) v += W.interceptHalt;
    best = Math.max(best, v);
  }
  return best;
}

/** unit が行動を終えて pos にいるときの点数 */
export function positionScore(ctx: Context, pos: Offset): number {
  const { state, unit, status, enemies } = ctx;
  const map = state.map;
  const def = COMBAT_DEFS[unit.type];
  let score = 0;
  if (enemies.length > 0) {
    const nearest = Math.min(...enemies.map((e) => hexDistance(map, pos, e)));
    const approach = (ctx.approach / ctx.caution) * (ctx.team && status.commander ? W.commanderApproach : 1);
    if (def.ranged) {
      score -= Math.abs(nearest - def.maxRange) * approach;
      if (nearest < def.minRange) score -= W.tooClose;
    } else {
      score -= Math.max(0, nearest - 1) * approach;
    }
  }
  const hold = state.stronghold;
  if (hold) {
    const d = hexDistance(map, pos, hold);
    if (unit.team === SIDE_TEAM.attacker) score -= d * W.objective;
    else if (ctx.team?.garrison === unit) score -= d * W.garrison;
    // 数で勝っているなら拠点を離れて敵を討ちに出る（慎重さが 1 より小さいほど、拠点の周りに留まる重みを下げる）
    else score -= Math.max(0, d - GUARD_RADIUS) * W.guard * (ctx.team ? Math.min(1, ctx.caution) : 1);
    if (ctx.urgent && d === 0) score += W.block;
  }
  if (ctx.danger) score -= dangerPenalty(ctx, pos);
  else {
    const t = ctx.threat?.get(cellKey(state, pos)) ?? 0;
    score -= t * (def.ranged ? W.threatRanged : W.threat) * (status.commander ? W.threatCommander : 1) * ctx.caution;
  }
  const cell = map.get(pos.col, pos.row);
  if (cell) score += cellDefense(cell) * W.terrain;
  return score;
}

/** pos で番を終えたときの危険の点数（受けそうなダメージ × 兵の重さ × 兵種の重み × 慎重さ。lethal なら、殲滅されそうなときにさらに引く） */
function dangerPenalty(ctx: Context, pos: Offset, lethal = true): number {
  const { unit, status } = ctx;
  const d = dangerAt(ctx.danger!, pos);
  if (d <= 0) return 0;
  const w = (COMBAT_DEFS[unit.type].ranged ? W.dangerRanged : W.danger) * (status.commander ? W.dangerCommander : 1);
  let p = Math.min(d, status.soldiers) * worth(unit, status) * w * ctx.caution;
  // 殲滅されそうな HEX も、膠着が続けば避けなくなる（軍団長どうしがにらみ合って決着しないのを避ける）
  if (lethal && d >= status.soldiers * LETHAL_SHARE) p += (W.lethal + (status.commander ? W.dieCommander / 2 : 0)) * STALL_CAUTION ** ctx.urgency;
  return p;
}
