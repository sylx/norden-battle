// 戦闘画面（React）
export { default as BattleScreen } from './ui/BattleScreen';
export type { BattleCutInTexts, BattleScreenProps } from './ui/BattleScreen';
export type { AttackLogEntry } from './ui/BattleLogWindow';

// 戦闘画面の本体（three.js のマップ・ユニット・入力）
export { BattleApp, TURN_ORDER } from './app';
export type { BattleEvents, BattlePhase, ExecuteReport, InterceptReport, Plan, PlannedAttack, StatusFactory } from './app';
export type { ActionMenuModel, MenuFrame, MenuState, RetreatMenu } from './menuModel';

// 配備フェーズ
export { demoTroops, MAX_DEPLOY, SIDE_NAMES, SIDE_TEAM } from './deployment';
export type { DeployState, Troop, TroopFactory } from './deployment';

// ユニットの戦闘中の状態
export { demoStatus, demoStatuses, MAX_MORALE } from './unitStatus';
export type { UnitStatus } from './unitStatus';
export type { ActionId, MenuAction, MenuChild, SkillId } from './actions';

// 退却（退却先の拠点は軍ごとに使う側が渡し、結果は RetreatReport で受け取る）
export { adjacentEnemies, RETREAT_FAIL_CHANCE, retreatFailChance } from './retreat';
export type { RetreatDestination, RetreatDestinations, RetreatReport } from './retreat';

// 殲滅されたときの指揮官の捕縛（結果は WipeoutReport で受け取る）
export { WIPEOUT_CAPTURE_CHANCE, wipeoutCaptureChance } from './wipeout';
export type { WipeoutReport } from './wipeout';

// 勝敗（決着は BattleScreen の onEnd・BattleApp の end で受け取る）
export { BATTLE_END_REASON_NAMES, judgeBattle } from './victory';
export type { BattleEndReason, BattleOutcome } from './victory';

// セリフ（何を喋るか。ゲームではセリフのデータから引く BarkSource を lineBarks で作って渡す）
export { BARK_CHANCE, BARK_SITUATION_NAMES, BARK_SITUATIONS, BARK_TONE, demoBarks, EXCHANGE_CHANCE, lineBarks, lineSituationId } from './barks';
export type { BarkSituation, BarkSource, BarkSpeaker, BarkTone, ExchangeLine, LineSituation } from './barks';
