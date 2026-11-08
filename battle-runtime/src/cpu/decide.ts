/**
 * CPU の 1 手読み。部隊の行動の候補（移動先 × 攻撃 × 目標、移動だけ、その場で待機）を並べて点数を付け、一番いいものを選ぶ。
 *
 * - 攻撃の点数: 予測（attackForecast の期待値）から、与えるダメージ − 受ける反撃、殲滅・壊滅の見込み、士気の差、巻き添え。
 *   兵数は兵種の力（UNIT_POWER）で重みを付け、軍団長の部隊は重く見る（狙う・守る）
 * - 位置の点数: 敵への近さ（射程のある兵種は射程の端）、攻撃側は防衛拠点への近さ・防衛側は拠点の周り、
 *   次の敵の番に攻撃されそうな度合い（threat.ts）、地形の守り
 * - 兵力の比: 受けるダメージと脅威の重みに「敵の兵力 ÷ 味方の兵力」を掛け、敵に近づく重みにはその逆数を掛ける
 *   （数で勝る側は損を気にせず押し込んで残りを狩り、劣る側は慎重になる。どちらも待ち続けて決着しないのを避ける）
 * - 膠着: 戦況が動かない番が続いたら（urgency。player.ts が数える）、慎重さを下げて敵に近づく重みを上げる
 * - 往復しない: 攻撃せずに、前の自分の番の初めにいた HEX へ戻る手は減点する（敵の動きで脅威が変わるたびに半歩ずつ出入りしない）
 * - 移動だけの手は待機で行動を終える（同じ番に何度も動き回らない）。攻撃の後に動ける騎兵は、攻撃を実行した後にもう一度決める
 *
 * 段階 1 では、敵ユニットを狙う攻撃（aim: 'unit'）と移動・待機だけを考える。範囲攻撃・地点を狙う魔法・迎撃の構え・鼓舞・退却は段階 2。
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { UnitData } from '@norden/map-runtime/core/units';
import { buildActionMenu } from '../actions';
import { ATTACK_DEFS, type MenuAttackId } from '../attacks';
import { attackForecast, attacksOf, cellDefense, chargeLanding, COMBAT_DEFS, hexDistance, resolveAttack, splashUnits, type Combatant } from '../combat';
import { UNIT_POWER } from '../damage';
import { SIDE_TEAM } from '../deployment';
import type { ActionEnd } from '../engine/action';
import { addLeg, aimCells, menuContext, moveCells, newPlan, rejectReason, setAttack } from '../engine/plan';
import type { Decision } from '../engine/sim';
import { castleLocked, strongholdLocked, type BattleState } from '../engine/state';
import type { MoveStep } from '../movement';
import type { UnitStatus } from '../unitStatus';
import { cellKey, threatMap } from './threat';
import type { CpuOptions } from './types';
import { COMMANDER_WORTH, GUARD_RADIUS, MAX_CAUTION, MAX_URGENCY, MIN_CAUTION, STALL_APPROACH, STALL_CAUTION, WEIGHTS as W } from './weights';

/** 行動の候補 */
export interface Candidate {
  score: number;
  /** 移動先（その場なら null） */
  step: MoveStep | null;
  /** 攻撃（しなければ null） */
  attack: { id: MenuAttackId; at: Offset } | null;
  end: ActionEnd;
}

/** 1 回の decide で使う、盤面から求めておくもの */
interface Context {
  state: BattleState;
  unit: UnitData;
  status: UnitStatus;
  enemies: UnitData[];
  threat: Map<number, number>;
  /** 敵の兵力 ÷ 味方の兵力（兵数 × 兵の重さの合計。受けるダメージ・脅威の重みに掛ける）。膠着すると下がる */
  caution: number;
  /** 敵に近づく重み（膠着すると上がる） */
  approach: number;
}

/** 兵 1 人の重さ（兵種の力。軍団長の部隊は COMMANDER_WORTH 倍） */
export function worth(unit: UnitData, status: UnitStatus): number {
  const p = UNIT_POWER[unit.type];
  return ((p.attack + p.defense) / 2) * (status.commander ? COMMANDER_WORTH : 1);
}

/** 盤面のほかに、軍の様子から決めること */
export interface Mood {
  /** 戦況が動いていない番の数（0 なら動いている） */
  urgency: number;
  /** 部隊ごとの、前の自分の番の初めにいた HEX */
  previous?: ReadonlyMap<UnitData, Offset>;
}

/** unit の次の行動を決める（行動できなければ null） */
export function decide(state: BattleState, unit: UnitData, _options: CpuOptions, mood: Mood = { urgency: 0 }): Decision | null {
  const best = candidates(state, unit, mood).reduce<Candidate | null>((a, c) => (!a || c.score > a.score ? c : a), null);
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
  return { plan, end: c.end };
}

/** unit の行動の候補と点数（行動できなければ空） */
export function candidates(state: BattleState, unit: UnitData, mood: Mood = { urgency: 0 }): Candidate[] {
  const status = state.statuses.get(unit);
  const plan0 = newPlan(state, unit);
  if (!status || !plan0) return [];
  const menu = buildActionMenu(menuContext(state, plan0));
  const enabled = (id: string) => menu.some((e) => e.enabled && e.action?.id === id);
  const ctx: Context = {
    state,
    unit,
    status,
    enemies: state.map.allUnits().filter((u) => u.team !== unit.team),
    threat: threatMap(state, unit.team),
    caution: forceRatio(state, unit) * STALL_CAUTION ** Math.min(mood.urgency, MAX_URGENCY),
    approach: W.approach * (1 + STALL_APPROACH * Math.min(mood.urgency, MAX_URGENCY)),
  };
  const out: Candidate[] = [];
  const steps: (MoveStep | null)[] = [null, ...(enabled('move') ? moveCells(state, plan0).values() : [])];
  const attacks = status.attacked ? [] : attacksOf(unit.type, status).filter((id) => !status.cooldowns[id]);
  for (const step of steps) {
    const pos: Offset = step ?? unit;
    const ap = status.ap - (step?.cost ?? 0);
    // 攻撃せずに、前の番の初めにいた HEX へ戻る
    const back = mood.previous?.get(unit);
    const backtrack = step && back && back.col === pos.col && back.row === pos.row && (back.col !== unit.col || back.row !== unit.row) ? W.backtrack : 0;
    for (const id of attacks) {
      const attack = resolveAttack(unit.type, id);
      // 段階 1: 敵ユニットを狙う攻撃だけ
      if (attack.aim !== 'unit' || ap < attack.cost) continue;
      const plan = newPlan(state, unit)!;
      if (step) addLeg(plan, step);
      for (const at of aimCells(state, plan, attack)) {
        const target = state.map.unitAt(at.col, at.row);
        if (!target || target.team === unit.team || rejectReason(state, plan, attack, target)) continue;
        const landing = attack.special === 'charge' ? chargeLanding(state.map, pos, target, castleLocked(unit, status), strongholdLocked(state, unit, status)) : null;
        const score = attackScore(ctx, pos, target, id) + positionScore(ctx, landing ?? pos);
        out.push({ score, step, attack: { id, at }, end: 'confirm' });
      }
    }
    // 動くだけ・その場で待機（行動を終える）
    if (enabled('wait')) out.push({ score: positionScore(ctx, pos) - backtrack, step, attack: null, end: 'wait' });
  }
  return out;
}

/** unit の軍から見た、敵の兵力 ÷ 味方の兵力（MIN_CAUTION〜MAX_CAUTION） */
export function forceRatio(state: BattleState, unit: UnitData): number {
  let own = 0;
  let foe = 0;
  for (const [u, s] of state.statuses) {
    const f = s.soldiers * worth(u, s);
    if (u.team === unit.team) own += f;
    else foe += f;
  }
  return Math.min(MAX_CAUTION, Math.max(MIN_CAUTION, own > 0 ? foe / own : MAX_CAUTION));
}

/** pos から target を id で攻撃したときの点数（予測の期待値から） */
export function attackScore(ctx: Context, pos: Offset, target: UnitData, id: MenuAttackId): number {
  const { state, unit, status } = ctx;
  const ts = state.statuses.get(target);
  if (!ts) return -Infinity;
  const attacker: Combatant = { unit, status, pos };
  const splash = splashUnits(state.map, unit, pos, target, target, id).flatMap((u): Combatant[] => {
    const s = state.statuses.get(u);
    return s ? [{ unit: u, status: s, pos: u }] : [];
  });
  const f = attackForecast(state.map, attacker, { unit: target, status: ts, pos: target }, id, splash);
  const e = f.expected;
  if (!e) return -Infinity;
  const vt = worth(target, ts);
  const vs = worth(unit, status);
  const dealt = Math.min(e.damage, ts.soldiers);
  let score = dealt * vt - Math.min(e.counter, status.soldiers) * vs * W.taken * ctx.caution;
  if (e.damage >= ts.soldiers) score += W.kill + (ts.commander ? W.killCommander : 0);
  else if (ts.commander) score += dealt * vt * W.commanderTarget;
  if (e.counter >= status.soldiers) score -= W.die + (status.commander ? W.dieCommander : 0);
  score += (e.morale.attacker - e.morale.defender) * W.morale;
  for (const s of f.splash) {
    const su = state.statuses.get(s.unit);
    if (!su) continue;
    const avg = Math.min((s.damage[0] + s.damage[1]) / 2, su.soldiers) * worth(s.unit, su);
    score += s.unit.team === unit.team ? -avg * W.friendlyFire : avg;
  }
  return score;
}

/** unit が行動を終えて pos にいるときの点数 */
export function positionScore(ctx: Context, pos: Offset): number {
  const { state, unit, status, enemies, threat } = ctx;
  const map = state.map;
  const def = COMBAT_DEFS[unit.type];
  let score = 0;
  if (enemies.length > 0) {
    const nearest = Math.min(...enemies.map((e) => hexDistance(map, pos, e)));
    const approach = ctx.approach / ctx.caution;
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
    else score -= Math.max(0, d - GUARD_RADIUS) * W.guard;
  }
  const t = threat.get(cellKey(state, pos)) ?? 0;
  score -= t * (def.ranged ? W.threatRanged : W.threat) * (status.commander ? W.threatCommander : 1) * ctx.caution;
  const cell = map.get(pos.col, pos.row);
  if (cell) score += cellDefense(cell) * W.terrain;
  return score;
}
