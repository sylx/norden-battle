// 戦闘画面（React）
export { default as BattleScreen } from './ui/BattleScreen';
export type { BattleScreenProps } from './ui/BattleScreen';
export type { AttackLogEntry } from './ui/BattleLogWindow';

// 戦闘画面の本体（three.js のマップ・ユニット・入力）
export { BattleApp } from './app';
export type { BattleEvents, ExecuteReport, InterceptReport, Plan, PlannedAttack, StatusFactory } from './app';
export type { ActionMenuModel, MenuFrame, MenuState } from './menuModel';

// ユニットの戦闘中の状態
export { demoStatuses, MAX_MORALE } from './unitStatus';
export type { UnitStatus } from './unitStatus';
export type { ActionId, MenuAction, SkillId } from './actions';
