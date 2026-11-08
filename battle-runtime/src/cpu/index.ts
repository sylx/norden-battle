/**
 * CPU の思考。three.js を読み込まない（対戦シミュレータからも使う。'@norden/battle-runtime/cpu'）。
 */
export { attackScore, candidates, decide, forceRatio, positionScore, toDecision, worth } from './decide';
export type { Candidate, Mood } from './decide';
export { cpuPlayer, orderUnits } from './player';
export { threatMap } from './threat';
export { DIFFICULTIES, DIFFICULTY_NAMES } from './types';
export type { CpuOptions, Difficulty } from './types';
export { COMMANDER_WORTH, GUARD_RADIUS, MAX_CAUTION, MAX_URGENCY, MIN_CAUTION, STALL_APPROACH, STALL_CAUTION, WEIGHTS } from './weights';
