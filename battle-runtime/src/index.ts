// 戦闘画面（React）
export { default as BattleScreen } from './ui/BattleScreen';
export type { BattleCutInTexts, BattleScreenProps } from './ui/BattleScreen';
export type { AttackLogEntry } from './ui/BattleLogWindow';

// 戦闘画面の本体（three.js のマップ・ユニット・入力）
export { BattleApp, TURN_ORDER } from './app';
export type { BattleEvents, BattlePhase, ExecuteReport, InterceptReport, Plan, PlannedAttack, StatusFactory } from './app';
export type { ActionMenuModel, MenuFrame, MenuState } from './menuModel';

// 配備フェーズ
export { demoTroops, MAX_DEPLOY, SIDE_NAMES, SIDE_TEAM } from './deployment';
export type { DeployState, Troop, TroopFactory } from './deployment';

// ユニットの戦闘中の状態
export { demoStatus, demoStatuses, MAX_MORALE } from './unitStatus';
export type { UnitStatus } from './unitStatus';
export type { ActionId, MenuAction, SkillId } from './actions';
