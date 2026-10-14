/**
 * 戦闘に加わる勢力（陣営ごと）。画面では軍を色（赤・青）ではなく勢力の名前で呼ぶ。
 *
 * - ゲームは攻撃側・防衛側の勢力を BattleScreen の factions で渡す。渡さないとき（battle-editor）は表示確認用の仮の勢力（demoFactions）。
 * - 攻撃側・防衛側のどちらでもない軍（green）は勢力を持たないので、OTHER_FACTION_NAME で呼ぶ。
 */
import type { DeploySide } from '@norden/map-runtime/core/mapData';
import type { TeamId } from '@norden/map-runtime/core/units';
import { SIDE_TEAM } from './deployment';

export interface BattleFaction {
  /** 勢力の名前（ヴァルハルト家など） */
  name: string;
}

/** 陣営ごとの勢力 */
export type BattleFactions = Record<DeploySide, BattleFaction>;

/** 表示確認用の仮の勢力 */
export const demoFactions: BattleFactions = {
  attacker: { name: 'ヴァルハルト家' },
  defender: { name: 'ノルディス家' },
};

/** 攻撃側・防衛側のどちらでもない軍の呼び名 */
export const OTHER_FACTION_NAME = '第三勢力';

/** 軍（team）を呼ぶ名前（その陣営の勢力の名前） */
export function teamName(factions: BattleFactions, team: TeamId): string {
  if (team === SIDE_TEAM.attacker) return factions.attacker.name;
  if (team === SIDE_TEAM.defender) return factions.defender.name;
  return OTHER_FACTION_NAME;
}
