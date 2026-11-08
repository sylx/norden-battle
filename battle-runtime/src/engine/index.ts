/**
 * 戦闘のルールで状態を書き換える処理（engine）。three.js・React・DOM を読み込まないので、Node（対戦シミュレータ・テスト）からも使える。
 * `@norden/battle-runtime/engine` で読み込む。
 */
export { chance, mathRng, pick, randInt, roll, seededRng } from './rng';
export type { Rng } from './rng';
export {
  castleLocked,
  createBattleState,
  facilitiesOf,
  leaderOf,
  locked,
  markFallen,
  nextTeam,
  rangeBonusAt,
  removeUnits,
  retreatDestinations,
  sideOf,
  strongholdLocked,
  TURN_ORDER,
} from './state';
export type { BattleSetup, BattleState, RoutState } from './state';
export {
  addLeg,
  aimCells,
  attackIsLast,
  attackPos,
  isDone,
  menuContext,
  moveCells,
  moveCost,
  moveOptions,
  newPlan,
  NOT_SURROUNDED,
  planCost,
  planned,
  planPos,
  rejectReason,
  setAttack,
  turnStart,
  undoPlan,
} from './plan';
export type { Plan, PlannedAttack } from './plan';
export { afterIntercept, afterStrike, beginAction, commitMove, finishAction, INSPIRE_MAX, INSPIRE_MIN, nextPhase, resolveIntercept, resolveStrike, runAction, wipeOut } from './action';
export type { ActionEnd, ActionPhase, ActionRun, AttackReport, ExecuteReport, FinishedAction, InterceptReport, NextPhase, SplashHit } from './action';
export {
  confusedPlan,
  confusedUnits,
  endBattle,
  endTeamTurn,
  facilityTarget,
  facilityTargets,
  fireFacility,
  firingFacilities,
  judge,
  nextRoutUnit,
  passTurn,
  startBattle,
  startTeamTurn,
} from './turn';
export type { FacilityReport, JudgeResult } from './turn';
export { randomPlayer, runBattle, runTeamTurn, runTurnEnd, settle } from './sim';
export type { Decision, Player, RoutChooser, SimOptions, SimResult } from './sim';
