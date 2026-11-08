/**
 * three.js・React・DOM を読み込まない、戦闘のルールの口（'@norden/battle-runtime/rules'）。
 * 部隊の状態・配備・攻撃の定義・勢力など、描画なしで戦闘を組むときに使うもの（対戦シミュレータ・battle-editor の編成）。
 * 戦闘を進める処理は '@norden/battle-runtime/engine'、CPU の思考は '@norden/battle-runtime/cpu'。
 */
export { ATTACK_DEFS, ATTACK_IDS, SPELL_IDS } from './attacks';
export type { AttackId, MenuAttackId, SpellId } from './attacks';
export type { SkillId } from './actions';
export { demoTroops, Deployment, MAX_DEPLOY, SIDE_NAMES, SIDE_TEAM } from './deployment';
export type { DeployState, Troop, TroopFactory } from './deployment';
export { demoFactions, teamName, unitName } from './factions';
export type { BattleFaction, BattleFactions } from './factions';
export { demoStatus, demoStatuses, MAX_MORALE, troopStatus, typeTraits } from './unitStatus';
export type { Portrait, TroopInit, UnitStatus } from './unitStatus';
export type { SideFacilities } from './facilities';
export type { RetreatDestinations } from './retreat';
export { BATTLE_END_REASON_NAMES } from './victory';
export type { BattleEndReason, BattleOutcome } from './victory';
