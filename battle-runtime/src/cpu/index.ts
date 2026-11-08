/**
 * CPU の思考。three.js を読み込まない（対戦シミュレータからも使う。'@norden/battle-runtime/cpu'）。
 */
export { attackScore, candidates, decide, forceRatio, positionScore, toDecision, worth } from './decide';
export type { Candidate, Context, Mood } from './decide';
export { dangerAt, dangerContext, walkIntercepts } from './danger';
export type { DangerContext, WalkIntercepts } from './danger';
export { deployTroops } from './deploy';
export { cpuPlayer, orderUnits } from './player';
export { chooseGarrison, forcesOf, planTeam } from './strategy';
export type { Forces, TeamPlan } from './strategy';
export { enemyReach, threatMap } from './threat';
export type { Reach } from './threat';
export { BASIC_FEATURES, DIFFICULTIES, DIFFICULTY_NAMES, featuresOf, FULL_FEATURES } from './types';
export type { CpuFeatures, CpuOptions, Difficulty } from './types';
export { COMMANDER_WORTH, CONCEDE_LEFT, CONCEDE_RATIO, CONCEDE_STALL, CONCEDE_STALL_RATIO, GUARD_RADIUS, LETHAL_SHARE, MAX_CAUTION, MAX_URGENCY, MIN_CAUTION, RETREAT_SOLDIERS, STALL_APPROACH, STALL_CAUTION, WEIGHTS } from './weights';
