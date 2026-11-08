/**
 * 描画なしで戦闘を回す（CPU の番のスキップ・対戦シミュレータ・テスト）。
 *
 * 打ち手（Player）は、いまの番の軍の 1 部隊について「次に何をするか」（予約と終わり方）を返す関数。返した行動を実行したら、
 * 盤面が変わるので、同じ部隊でも次の行動はそのつど決め直す（移動してから攻撃する、など）。何もしないなら null。
 * 段階 1 の CPU の decide もこの形にする。
 *
 * 乱数は、ルールの乱数（rng）と打ち手の乱数（playerRng）を分けて渡す。打ち手を変えてもルールの乱数の並びがずれないように。
 */
import type { TeamId, UnitData } from '@norden/map-runtime/core/units';
import { buildActionMenu, type MenuAction } from '../actions';
import { hexDistance, isAttack, resolveAttack } from '../combat';
import type { RetreatDestination } from '../retreat';
import type { BattleOutcome } from '../victory';
import { runAction, type ActionEnd } from './action';
import { addLeg, aimCells, isDone, menuContext, moveCells, newPlan, rejectReason, setAttack, type Plan } from './plan';
import { pick, type Rng } from './rng';
import { locked, retreatDestinations, type BattleState } from './state';
import { confusedPlan, confusedUnits, endTeamTurn, facilityTarget, fireFacility, firingFacilities, judge, nextRoutUnit, passTurn, startBattle, type JudgeResult } from './turn';

/** 打ち手が選んだ 1 回分の行動（予約と終わり方。退却なら退却先） */
export interface Decision {
  plan: Plan;
  end: ActionEnd;
  to?: RetreatDestination;
}

/** いまの番の軍の unit の次の行動を決める（何もしないなら null） */
export type Player = (state: BattleState, unit: UnitData, rng: Rng) => Decision | null;

/** 強制退却で、unit の退却先を選ぶ（既定は最初の拠点） */
export type RoutChooser = (state: BattleState, unit: UnitData) => RetreatDestination;

export interface SimOptions {
  /** 軍ごとの打ち手（いない軍は何もしない） */
  players: Partial<Record<TeamId, Player>>;
  /** ルールの乱数 */
  rng: Rng;
  /** 打ち手の乱数 */
  playerRng: Rng;
  /** このターンを終えても決着しなければ止める（既定 30） */
  maxTurns?: number;
  /** 強制退却の退却先（既定は最初の拠点） */
  rout?: RoutChooser;
}

export interface SimResult {
  /** 決着（ターンの上限で止まったら null） */
  outcome: BattleOutcome | null;
  /** 決着した・止まったターン */
  turn: number;
  /** 打ち手が実行した行動の数 */
  actions: number;
}

/** 1 部隊が 1 つの番に続けて行動できる回数の上限（打ち手が同じことを繰り返して止まらないときの安全弁） */
const MAX_ACTIONS_PER_UNIT = 12;

const firstDestination: RoutChooser = (state, unit) => retreatDestinations(state, unit)[0];

/** 配備を終えた state で戦闘を始めて、決着するかターンの上限まで回す */
export function runBattle(state: BattleState, options: SimOptions): SimResult {
  const maxTurns = options.maxTurns ?? 30;
  let actions = 0;
  startBattle(state);
  while (!state.outcome && state.turn <= maxTurns) {
    actions += runTeamTurn(state, options);
    if (!state.outcome) runTurnEnd(state, options);
  }
  return { outcome: state.outcome, turn: state.turn > maxTurns ? maxTurns : state.turn, actions };
}

/** いまの番の軍の部隊を、打ち手に順に（上の行から）行動させる。実行した行動の数 */
export function runTeamTurn(state: BattleState, options: SimOptions): number {
  const player = options.players[state.activeTeam];
  if (!player) return 0;
  const count = new Map<UnitData, number>();
  const passed = new Set<UnitData>();
  let actions = 0;
  while (!state.outcome) {
    const unit = state.map
      .allUnits()
      .filter((u) => u.team === state.activeTeam && !passed.has(u) && !locked(state.statuses.get(u)) && !isDone(state, u))
      .sort((a, b) => a.row - b.row || a.col - b.col)[0];
    if (!unit) break;
    const d = player(state, unit, options.playerRng);
    const done = d && runAction(state, d.plan, d.end, d.to, options.rng);
    if (!done) {
      passed.add(unit);
      continue;
    }
    actions++;
    const n = (count.get(unit) ?? 0) + 1;
    count.set(unit, n);
    if (n >= MAX_ACTIONS_PER_UNIT) passed.add(unit);
    settle(state, judge(state, done.finished.ended), options);
  }
  return actions;
}

/** 番を終える: 混乱したユニットを動かし、番を終えた軍の入城を調べ、施設が撃ち、次の軍の番にする（決着したらそこでやめる） */
export function runTurnEnd(state: BattleState, options: Pick<SimOptions, 'rng' | 'rout'>): void {
  const { rng } = options;
  for (const unit of confusedUnits(state)) {
    if (state.outcome) return;
    if (!state.map.allUnits().includes(unit)) continue;
    const plan = confusedPlan(state, unit, rng);
    const done = plan && runAction(state, plan, 'wait', undefined, rng);
    if (done) settle(state, judge(state, done.finished.ended), options);
  }
  if (state.outcome) return;
  settle(state, endTeamTurn(state), options);
  if (state.outcome) return;
  const firing = firingFacilities(state);
  for (const kind of firing?.kinds ?? []) {
    const target = facilityTarget(state, kind, firing!.side, rng);
    if (!target) continue;
    if (fireFacility(state, kind, firing!.side, target, rng).wipeout) settle(state, judge(state), options);
    if (state.outcome) return;
  }
  passTurn(state);
}

/** 決着を調べた結果が強制退却なら、負けた陣営の残りの部隊を順に退却させて戦闘を終える */
export function settle(state: BattleState, result: JudgeResult, options: Pick<SimOptions, 'rng' | 'rout'>): void {
  if (result.kind !== 'routStart' && result.kind !== 'rout') return;
  const choose = options.rout ?? firstDestination;
  for (let unit = nextRoutUnit(state); unit; unit = nextRoutUnit(state)) {
    const plan = newPlan(state, unit);
    if (plan) runAction(state, plan, 'retreat', choose(state, unit), options.rng);
  }
}

/**
 * ランダムに行動する仮の打ち手（M008 の段階 0。描画なしで回せることを確かめるため）。
 * 行動メニューで選べるもの（攻撃・移動・迎撃・待機・鼓舞・退却）から 1 つを、攻撃を多めに選ぶ。移動は多くの場合、いちばん近い敵へ寄る
 */
export const randomPlayer: Player = (state, unit, rng) => {
  const plan = newPlan(state, unit);
  if (!plan) return null;
  const menu = buildActionMenu(menuContext(state, plan));
  const choices: { weight: number; make: () => Decision | null }[] = [];
  for (const entry of menu) {
    if (!entry.enabled) continue;
    const actions: MenuAction[] = entry.children ? entry.children.filter((c) => !c.reason) : entry.action ? [entry.action] : [];
    for (const action of actions) {
      const id = action.id;
      if (isAttack(id)) choices.push({ weight: 6, make: () => randomAttack(state, plan, action, rng) });
      else if (id === 'move') choices.push({ weight: 3, make: () => randomMove(state, plan, rng) });
      else if (id === 'intercept' || id === 'wait') choices.push({ weight: 1, make: () => ({ plan, end: id }) });
      else if (id === 'skill:inspire') choices.push({ weight: 1, make: () => ({ plan, end: 'inspire' }) });
      else if (id === 'retreat') {
        const to = retreatDestinations(state, unit)[0];
        if (to) choices.push({ weight: 0.05, make: () => ({ plan, end: 'retreat', to }) });
      }
    }
  }
  const total = choices.reduce((sum, c) => sum + c.weight, 0);
  let r = rng.next() * total;
  for (const c of choices) {
    r -= c.weight;
    if (r < 0) return c.make();
  }
  return null;
};

function randomAttack(state: BattleState, plan: Plan, action: MenuAction, rng: Rng): Decision | null {
  if (!isAttack(action.id)) return null;
  const attack = resolveAttack(plan.unit.type, action.id);
  const cells = aimCells(state, plan, attack).filter((o) => {
    const target = state.map.unitAt(o.col, o.row);
    return !target || !rejectReason(state, plan, attack, target);
  });
  if (cells.length === 0) return null;
  setAttack(state, plan, action, attack, pick(rng, cells));
  return { plan, end: 'confirm' };
}

function randomMove(state: BattleState, plan: Plan, rng: Rng): Decision | null {
  const steps = [...moveCells(state, plan).values()];
  if (steps.length === 0) return null;
  const enemies = state.map.allUnits().filter((u) => u.team !== plan.unit.team);
  const near = (o: { col: number; row: number }) => Math.min(...enemies.map((e) => hexDistance(state.map, o, e)));
  const step = enemies.length > 0 && rng.next() < 0.7 ? steps.reduce((a, b) => (near(b) < near(a) ? b : a)) : pick(rng, steps);
  addLeg(plan, step);
  return { plan, end: 'confirm' };
}
