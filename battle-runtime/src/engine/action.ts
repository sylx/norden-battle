/**
 * 予約した行動の実行。攻撃の前の移動 → 攻撃 → 攻撃の後の移動（騎兵）の段階を順に進め、最後に終わり方（迎撃の構え・待機・鼓舞）をする。
 *
 * 段階ごとに関数を分けてあり、BattleApp は演出の拍子（歩き着いた・当たった瞬間）で呼ぶ。描画なしでは runAction で順に呼ぶ。
 *   beginAction → (nextPhase → 段階の処理)* → finishAction → judge（turn.ts）
 * 段階の処理: walk は歩き着いたら commitMove（commit のときだけ）、strike は当たったら resolveStrike・演出の後に afterStrike、
 * intercept は当たったら resolveIntercept・演出の後に afterIntercept、retreat は何もしない（成否は beginAction で決まっている）。
 *
 * - 移動は、迎撃の構えの間接ユニットの射程に入る HEX があれば、そこで区切って迎撃の段階を挟む（区切るのは歩き出すときの盤面で）。
 *   間接ユニットの構えは、敵が歩いて射程に入った HEX でその敵を止めて 1 回だけ自動で攻撃し、構えを解く。
 *   撃たれた敵は壊滅しなければ続きを歩く。ただし弓兵に撃たれた敵（騎兵を除く）はそこで足止めされ、残りの予約を捨てて
 *   行動を終える（行動力は 0 になる）。味方のいる HEX で止められたときは、通ってきた道を空いている HEX まで戻る。
 * - 攻撃の範囲にいる目標以外のユニットにも巻き添えで当たる。目標の手前で当たって壊滅した迎撃の構えのユニットは、それより後の迎撃を撃たない。
 * - 兵数が 0 になった（殲滅された）ユニットは、行動を終える（finishAction）まで盤面に残る（捕縛の「隣接している敵」にも数える）。
 *   殲滅されたユニットの指揮官は、そのとき隣接している敵ユニットの数で捕縛される（相討ちの相手は数えない）。
 * - 乱数は rng から引く。引く順番は演出ありでも描画なしでも同じ。
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { UnitData } from '@norden/map-runtime/core/units';
import { SKILL_DEFS } from '../actions';
import type { AttackId } from '../attacks';
import { attackResult, COMBAT_DEFS, interceptorsAt, mightOf, resolveAttack, splashResult, splashUnits, type AttackResult, type Combatant, type ResolvedAttack } from '../combat';
import { setCondition } from '../conditions';
import { randomRoll } from '../damage';
import { applyMorale, moraleChange } from '../morale';
import { movePath, type MoveStep } from '../movement';
import { adjacentEnemies, retreatFailChance, type RetreatDestination, type RetreatReport } from '../retreat';
import { plowCell, type PlowChange } from '../terrain';
import type { UnitStatus } from '../unitStatus';
import { wipeoutCaptureChance, type WipeoutReport } from '../wipeout';
import { isDone, moveCost, planCost, planned, turnStart, type Plan, type PlannedAttack } from './plan';
import { chance, randInt, type Rng } from './rng';
import { markFallen, rangeBonusAt, removeUnits, retreatDestinations, type BattleState } from './state';

/** 鼓舞で回復する士気（この範囲の整数） */
export const INSPIRE_MIN = 10;
export const INSPIRE_MAX = 20;

/**
 * 予約を実行した後にすること。confirm: なし（決定）、intercept: 迎撃の構えをとる、wait: 待機して行動を終える、
 * inspire: 鼓舞する、retreat: 退却する（予約の無いターンの初めだけ）
 */
export type ActionEnd = 'confirm' | 'intercept' | 'wait' | 'inspire' | 'retreat';

/** 範囲の巻き添えで当たったユニット 1 つ分（敵・味方を問わない。味方に当たったものは「巻き添え」と出す） */
export interface SplashHit {
  unit: UnitData;
  /** 撃ったユニットの味方か（巻き添え） */
  friendly: boolean;
  result: AttackResult;
  /** 当たった後の兵数 */
  left: number;
  destroyed: boolean;
}

/** 予約した攻撃の結果 */
export interface AttackReport extends PlannedAttack {
  /** 目標への攻撃の結果（目標が無ければ null） */
  result: AttackResult | null;
  targetDestroyed: boolean;
  unitDestroyed: boolean;
  /** 攻撃の後の兵数（自分・相手） */
  unitLeft: number;
  targetLeft: number;
  /** 範囲の巻き添えで当たったユニット（ライフル兵の弾が目標の手前で当たったものなど。当たらなければ空） */
  splash: SplashHit[];
  /** 狙った HEX を耕して変わったもの（耕す攻撃でなければ・何も変わらなければ null。terrain.ts） */
  plowed: PlowChange | null;
}

/** 迎撃の自動攻撃 1 回分 */
export interface InterceptReport {
  /** 攻撃した（迎撃の構えの）ユニット */
  unit: UnitData;
  result: AttackResult;
  /** 攻撃を受けた後の、移動していたユニットの兵数 */
  targetLeft: number;
  /** 予約した攻撃の後の移動で受けたか */
  afterAttack: boolean;
  /** この迎撃で足止めされたか（同じ HEX で続けて撃たれたときは最後の 1 回） */
  halted: boolean;
  /** 範囲の巻き添えで当たったユニット（ライフル兵の弾が撃たれたユニットの手前で当たったものなど。当たらなければ空） */
  splash: SplashHit[];
}

/** 決定で実行した結果 */
export interface ExecuteReport {
  unit: UnitData;
  from: Offset;
  /** 移動で使った行動力（移動しなければ 0） */
  moveCost: number;
  /** 使った行動力の合計 */
  cost: number;
  attack?: AttackReport;
  /** 移動の途中で受けた、迎撃の構えの間接ユニットからの自動攻撃（受けた順） */
  intercepts: InterceptReport[];
  /** 迎撃の自動攻撃で壊滅したか（そこで実行を打ち切る） */
  lost: boolean;
  /** 弓兵の迎撃で足止めされたか（そこで移動をやめ、残りの予約を捨てて行動を終える） */
  halted: boolean;
  /** 迎撃の構えをとったか（迎撃コマンド） */
  intercept: boolean;
  /** 待機して行動を終えたか（待機コマンド） */
  wait: boolean;
  /** 鼓舞で回復した士気（鼓舞しなかったら無い） */
  inspire?: number;
  /** 退却の結果（退却しなかったら無い） */
  retreat?: RetreatReport;
  /** 殲滅されたユニット（自分・相手。指揮官が捕縛されたか） */
  wipeouts: WipeoutReport[];
}

/**
 * 実行の 1 段階。
 * - walk: path に沿って歩く。commit なら着いた HEX へ移動を確定する（迎撃で止まった途中の HEX では確定しない）
 * - strike: 予約した攻撃をする
 * - intercept: shooter（迎撃の構えの間接ユニット）が、at まで歩いてきたユニットを攻撃する。
 *   route はこの移動で at まで通ってきた HEX（足止めされて味方のいる HEX から戻るときに使う）
 * - retreat: 退却する
 */
export type ActionPhase =
  | { kind: 'walk'; path: Offset[]; commit: boolean }
  | { kind: 'strike' }
  | { kind: 'intercept'; shooter: UnitData; at: Offset; route: Offset[] }
  | { kind: 'retreat' };

/** 実行中の行動 */
export interface ActionRun {
  plan: Plan;
  report: ExecuteReport;
  end: ActionEnd;
  /** これから行う段階 */
  phases: ActionPhase[];
}

/**
 * 予約を実行し始める（行えなければ null）。決定（confirm）は予約が無ければ行えない。強制退却の間は退却しか行えない。
 * 退却（retreat）は予約の無いターンの初めだけで、to へ退却する（成否はここで引く）。強制退却はいつでも退却する。
 * 行動したら迎撃の構えは解ける。
 */
export function beginAction(state: BattleState, plan: Plan, end: ActionEnd, to: RetreatDestination | undefined, rng: Rng): ActionRun | null {
  if (end === 'confirm' && !planned(plan)) return null;
  // 強制退却の間は退却しかしない
  if (state.rout && end !== 'retreat') return null;
  if (end === 'retreat' && (!to || (!state.rout && (!turnStart(plan) || plan.status.ap < plan.status.maxAp)))) return null;
  const report: ExecuteReport = {
    unit: plan.unit,
    from: { col: plan.unit.col, row: plan.unit.row },
    moveCost: moveCost(plan),
    cost: planCost(plan) + (end === 'inspire' ? SKILL_DEFS.inspire.cost : 0),
    intercepts: [],
    wipeouts: [],
    lost: false,
    halted: false,
    intercept: end === 'intercept',
    wait: end === 'wait',
  };
  plan.status.intercepting = false;
  const split = plan.attack?.afterLeg ?? plan.legs.length;
  const walk = (legs: MoveStep[]): ActionPhase => ({ kind: 'walk', path: legs.length > 0 ? movePath(legs) : [], commit: true });
  const phases: ActionPhase[] = [walk(plan.legs.slice(0, split)), ...(plan.attack ? [{ kind: 'strike' as const }, walk(plan.legs.slice(split))] : [])];
  if (end === 'retreat' && to) {
    const enemies = adjacentEnemies(state.map, plan.unit).length;
    const failChance = retreatFailChance(enemies, plan.status.uncapturable);
    report.retreat = {
      unit: plan.unit,
      troopId: state.troopIds.get(plan.unit) ?? null,
      status: plan.status,
      turn: state.turn,
      to,
      enemies,
      failChance,
      captured: chance(rng, failChance),
      forced: !!state.rout,
    };
    phases.splice(0, phases.length, { kind: 'retreat' });
  }
  return { plan, report, end, phases };
}

/** nextPhase の結果。committed は飛ばした段階で移動を確定したか（絵を作り直す） */
export interface NextPhase {
  phase: ActionPhase | null;
  committed: boolean;
}

/**
 * 実行の次の段階を取り出す（歩かない移動は確定だけして飛ばす。壊滅した迎撃の構えのユニットの迎撃は飛ばす）。段階が無くなったら null。
 * 移動は、迎撃の構えの間接ユニットの射程に入る HEX があれば、そこで区切って迎撃の段階を挟む。
 */
export function nextPhase(state: BattleState, run: ActionRun): NextPhase {
  let committed = false;
  let phase = run.phases.shift();
  while ((phase?.kind === 'walk' && phase.path.length < 2) || (phase?.kind === 'intercept' && !((state.statuses.get(phase.shooter)?.soldiers ?? 0) > 0))) {
    if (phase.kind === 'walk' && phase.commit && phase.path.length > 0) {
      commitMove(state, run, phase.path[0]);
      committed = true;
    }
    phase = run.phases.shift();
  }
  if (!phase) return { phase: null, committed };
  if (phase.kind !== 'walk') return { phase, committed };
  const { path } = phase;
  for (let i = 1; i < path.length; i++) {
    const shooters = interceptorsAt(state.map, state.statuses, run.plan.unit, path[i], (u) => rangeBonusAt(state, u, u));
    if (shooters.length === 0) continue;
    run.phases.unshift(
      ...shooters.map((shooter): ActionPhase => ({ kind: 'intercept', shooter, at: path[i], route: path.slice(0, i + 1) })),
      { kind: 'walk', path: path.slice(i), commit: phase.commit },
    );
    phase = { kind: 'walk', path: path.slice(0, i + 1), commit: false };
    break;
  }
  return { phase, committed };
}

/** 移動を確定する（ユニットを to へ動かす。動けなければそのまま） */
export function commitMove(state: BattleState, run: ActionRun, to: Offset): void {
  const { plan } = run;
  if (state.map.moveUnit(plan.unit, to.col, to.row)) {
    plan.status.moved = true;
    plan.status.justAttacked = false;
  }
}

/** 迎撃の自動攻撃（ランダム係数を引く）を兵数・士気に反映し、迎撃の構えを解く。殲滅・状態異常・巻き添えも */
export function resolveIntercept(state: BattleState, run: ActionRun, phase: Extract<ActionPhase, { kind: 'intercept' }>, rng: Rng): InterceptReport {
  const { plan, report } = run;
  const ss = state.statuses.get(phase.shooter)!;
  const result = attackResult(
    state.map,
    { unit: phase.shooter, status: ss, pos: phase.shooter },
    { unit: plan.unit, status: plan.status, pos: phase.at },
    'interceptFire',
    { damage: randomRoll(rng), counter: 0 },
  );
  plan.status.soldiers -= result.damage;
  applyMorale(plan.status, result.morale.defender);
  applyMorale(ss, result.morale.attacker);
  ss.intercepting = false;
  report.lost = plan.status.soldiers <= 0;
  // 移動していたユニットは、撃たれた HEX（at）で殲滅される
  if (report.lost) wipeOut(state, report, plan.unit, plan.status, phase.at, phase.shooter, [], rng);
  else inflict(plan.status, resolveAttack(phase.shooter.type, 'interceptFire'), rng);
  const splash = applySplash(state, report, { unit: phase.shooter, status: ss, pos: phase.shooter }, plan.unit, phase.at, 'interceptFire', rng);
  const r: InterceptReport = { unit: phase.shooter, result, targetLeft: Math.max(0, plan.status.soldiers), afterAttack: !!report.attack, halted: false, splash };
  report.intercepts.push(r);
  return r;
}

/** 迎撃の演出の後。壊滅したらそこで打ち切る。弓兵に撃たれたら（騎兵を除く）そこで足止め */
export function afterIntercept(state: BattleState, run: ActionRun, phase: Extract<ActionPhase, { kind: 'intercept' }>): void {
  if (run.report.lost) run.phases = [];
  else if (COMBAT_DEFS[phase.shooter.type].interceptHalts && !COMBAT_DEFS[run.plan.unit.type].unhaltable) halt(state, run, phase);
}

/**
 * 迎撃で足止めする。同じ HEX で続けて撃つ迎撃だけを残して、残りの移動・攻撃を捨て、止まった HEX へ移動を確定する。
 * 止まった HEX に味方がいるときは、通ってきた道を空いている HEX まで戻る。
 */
function halt(state: BattleState, run: ActionRun, phase: Extract<ActionPhase, { kind: 'intercept' }>): void {
  const map = state.map;
  const unit = run.plan.unit;
  run.report.halted = true;
  // 足止めは最後に撃った迎撃の記録に付ける
  for (const r of run.report.intercepts) r.halted = false;
  run.report.intercepts.at(-1)!.halted = true;
  const rest: ActionPhase[] = [];
  for (const p of run.phases) {
    if (p.kind !== 'intercept' || p.at.col !== phase.at.col || p.at.row !== phase.at.row) break;
    rest.push(p);
  }
  const { route } = phase;
  let j = route.length - 1;
  while (j >= 0) {
    const other = map.unitAt(route[j].col, route[j].row);
    if (!other || other === unit) break;
    j--;
  }
  // 通ってきた道がすべて味方で埋まっていたら（前の迎撃で止まった HEX から歩き出したときなど）、確定している HEX まで戻る
  const back = j >= 0 ? route.slice(j).reverse() : [...route].reverse().concat({ col: unit.col, row: unit.row });
  run.phases = [...rest, { kind: 'walk', path: back, commit: true }];
}

/**
 * 予約した攻撃の結果（ランダム係数を引く）を兵数・士気に反映する。攻撃済み・クールタイム・状態異常・殲滅と捕縛・巻き添え・
 * 耕す・目標の無い攻撃の士気も
 */
export function resolveStrike(state: BattleState, run: ActionRun, rng: Rng): AttackReport {
  const map = state.map;
  const { plan, report } = run;
  const attack = plan.attack!;
  const target = attack.target;
  const ts = target ? (state.statuses.get(target) ?? null) : null;
  const rolls = { damage: randomRoll(rng), counter: randomRoll(rng) };
  const def = resolveAttack(plan.unit.type, attack.id);
  const attacker = { unit: plan.unit, status: plan.status, pos: plan.unit };
  const result = target && ts ? attackResult(map, attacker, { unit: target, status: ts, pos: target }, attack.id, rolls) : null;
  if (result && ts) {
    ts.soldiers -= result.damage;
    plan.status.soldiers -= result.counter;
    applyMorale(ts, result.morale.defender);
    applyMorale(plan.status, result.morale.attacker);
  }
  plan.status.attacked = true;
  plan.status.justAttacked = true;
  // クールタイム: 使った次の自分の番から cooldown 回の番は使えない（番が始まるたびに減らすので 1 多く入れる）
  if (def.cooldown > 0) plan.status.cooldowns[attack.id] = def.cooldown + 1;
  if (ts && ts.soldiers > 0) inflict(ts, def, rng);
  const r: AttackReport = {
    ...attack,
    result,
    targetDestroyed: !!ts && ts.soldiers <= 0,
    unitDestroyed: plan.status.soldiers <= 0,
    unitLeft: Math.max(0, plan.status.soldiers),
    targetLeft: ts ? Math.max(0, ts.soldiers) : 0,
    splash: [],
    plowed: null,
  };
  report.attack = r;

  // 殲滅されたユニットの指揮官の捕縛（相討ちなら、相手は隣接する敵に数えない）
  const both = r.targetDestroyed && r.unitDestroyed;
  if (target && ts && r.targetDestroyed) wipeOut(state, report, target, ts, target, plan.unit, both ? [plan.unit] : [], rng);
  if (target && r.unitDestroyed) wipeOut(state, report, plan.unit, plan.status, plan.unit, target, both ? [target] : [], rng);
  r.splash = applySplash(state, report, attacker, target, attack.at, attack.id, rng);
  // 耕す攻撃（アーススパイク）は、ダメージを与えた後に狙った HEX を荒地にする
  if (def.plows) r.plowed = plowCell(map, attack.at);
  // 目標の無い攻撃（乱撃・敵のいない地点）は、敵に与えたダメージの合計で士気が上がる
  if (!result) {
    const dealt = r.splash.filter((h) => !h.friendly).reduce((sum, h) => sum + h.result.damage, 0);
    applyMorale(plan.status, moraleChange(dealt, 0, mightOf(plan.unit, plan.status), 50).attacker);
  }
  return r;
}

/** 攻撃の演出の後。攻撃で壊滅したら飛び出し・続きの移動はしない。突撃で飛び出せるなら、飛び出た HEX へ移動を確定する */
export function afterStrike(state: BattleState, run: ActionRun): void {
  const { plan, report } = run;
  const landing = plan.attack?.landing;
  if (report.attack?.unitDestroyed) run.phases = [];
  else if (landing && state.map.moveUnit(plan.unit, landing.col, landing.row)) plan.status.moved = true;
}

/** finishAction の結果 */
export interface FinishedAction {
  /** 戦場から除いたユニット（殲滅・退却） */
  removed: UnitData[];
  /** 行動したユニットが壊滅・退却して戦場からいなくなったか */
  gone: boolean;
  /** 行動を終えたユニット（もう行動できなくなった。防衛拠点にいる攻撃側のユニットなら入城。judge に渡す） */
  ended: UnitData[];
}

/**
 * 実行を終える。行動力を使い、終わり方のこと（迎撃の構え・待機・鼓舞）をして、兵数が 0 になったユニット・退却したユニットを
 * 戦場から除き、退却と殲滅を記録して、軍団長の部隊がいなくなったらその陣営の負けにする（決着は judge で調べる）
 */
export function finishAction(state: BattleState, run: ActionRun, rng: Rng): FinishedAction {
  const { plan, report, end } = run;
  const lost = report.lost || !!report.attack?.unitDestroyed;
  // 壊滅したか、退却して戦場からいなくなったか
  const gone = lost || !!report.retreat;
  plan.status.ap -= report.cost;
  // 待機したら、残りの行動力を捨てて行動を終える
  if (end === 'wait') plan.status.ap = 0;
  // 鼓舞: 自分の士気を回復する（壊滅・足止めされたらしない）
  if (end === 'inspire' && !lost && !report.halted) {
    const before = plan.status.morale;
    applyMorale(plan.status, randInt(rng, INSPIRE_MIN, INSPIRE_MAX));
    report.inspire = plan.status.morale - before;
  }
  // 迎撃の構えをとったら、残りの行動力に関わらず行動を終える
  if (report.intercept && !lost && !report.halted) {
    plan.status.intercepting = true;
    plan.status.ap = 0;
  }
  // 弓兵の迎撃で足止めされたら行動を終える
  if (report.halted) plan.status.ap = 0;
  const splash = [...(report.attack?.splash ?? []), ...report.intercepts.flatMap((i) => i.splash)];
  const removed = [report.attack?.targetDestroyed && report.attack.target, gone && report.unit, ...splash.map((h) => h.destroyed && h.unit)].filter(
    (u): u is UnitData => !!u,
  );
  removeUnits(state, removed);
  // 軍団長の部隊がいなくなったら、その陣営の負け（強制退却で退却したときは、もう決着している）
  if (report.retreat) {
    state.retreated.push(report.retreat);
    if (!report.retreat.forced) markFallen(state, report.retreat.unit, report.retreat.status, 'commanderRetreat');
  }
  for (const w of report.wipeouts) {
    state.wipedOut.push(w);
    markFallen(state, w.unit, w.status, 'commander');
  }
  // もう行動できなくなった（行動済みの印が付いた）ら、そのユニットは行動を終えた
  const ended = !gone && isDone(state, report.unit) ? [report.unit] : [];
  return { removed, gone, ended };
}

/**
 * unit が pos で by に殲滅された。そのとき隣接している敵ユニット（exclude の同時に殲滅されたものを除く）の数で、
 * 指揮官が捕縛されるか（されなければ軍の最初の退却先へ落ち延びる）を決めて report に記録する
 */
export function wipeOut(
  state: BattleState,
  report: Pick<ExecuteReport, 'wipeouts'>,
  unit: UnitData,
  status: UnitStatus,
  pos: Offset,
  by: UnitData | null,
  exclude: readonly UnitData[],
  rng: Rng,
): WipeoutReport {
  const enemies = adjacentEnemies(state.map, unit, pos).filter((u) => !exclude.includes(u)).length;
  const captureChance = wipeoutCaptureChance(enemies, status.uncapturable);
  const w: WipeoutReport = {
    unit,
    troopId: state.troopIds.get(unit) ?? null,
    status,
    turn: state.turn,
    by,
    enemies,
    captureChance,
    captured: chance(rng, captureChance),
    to: null,
  };
  if (!w.captured) w.to = retreatDestinations(state, unit)[0] ?? null;
  report.wipeouts.push(w);
  return w;
}

/**
 * 目標（at にいる target）を id の攻撃で撃ったときの範囲の巻き添え（ライフル兵の弾が目標の手前の HEX にいるユニットに当たったものなど）の
 * 結果（ランダム係数を引く）を、兵数・士気に反映する。撃ったユニットの士気は増減しない（目標への攻撃の分だけ）
 */
function applySplash(state: BattleState, report: ExecuteReport, shooter: Combatant, target: UnitData | null, at: Offset, id: AttackId, rng: Rng): SplashHit[] {
  const map = state.map;
  const attack = resolveAttack(shooter.unit.type, id);
  return splashUnits(map, shooter.unit, shooter.pos, target, at, id).flatMap((unit): SplashHit[] => {
    const status = state.statuses.get(unit);
    if (!status || status.soldiers <= 0) return [];
    const result = splashResult(map, shooter, { unit, status, pos: unit }, id, randomRoll(rng));
    status.soldiers -= result.damage;
    applyMorale(status, result.morale.defender);
    const destroyed = status.soldiers <= 0;
    if (!destroyed) inflict(status, attack, rng);
    if (destroyed) wipeOut(state, report, unit, status, unit, shooter.unit, [], rng);
    return [{ unit, friendly: unit.team === shooter.unit.team, result, left: Math.max(0, status.soldiers), destroyed }];
  });
}

/** 攻撃が当たったユニット（status）に、攻撃の inflicts の状態をそれぞれの確率で付ける */
function inflict(status: UnitStatus, attack: ResolvedAttack, rng: Rng): void {
  for (const { condition, chance: p, turns } of attack.inflicts) if (chance(rng, p)) setCondition(status, condition, turns);
}

/**
 * 描画なしで予約を最後まで実行する（行えなければ null）。決着は調べない（turn.ts の judge で調べる。runAction の後に呼ぶ）
 */
export function runAction(state: BattleState, plan: Plan, end: ActionEnd, to: RetreatDestination | undefined, rng: Rng): { report: ExecuteReport; finished: FinishedAction } | null {
  const run = beginAction(state, plan, end, to, rng);
  if (!run) return null;
  for (let next = nextPhase(state, run).phase; next; next = nextPhase(state, run).phase) {
    if (next.kind === 'walk') {
      if (next.commit) commitMove(state, run, next.path[next.path.length - 1]);
    } else if (next.kind === 'strike') {
      resolveStrike(state, run, rng);
      afterStrike(state, run);
    } else if (next.kind === 'intercept') {
      resolveIntercept(state, run, next, rng);
      afterIntercept(state, run, next);
    }
  }
  return { report: run.report, finished: finishAction(state, run, rng) };
}
