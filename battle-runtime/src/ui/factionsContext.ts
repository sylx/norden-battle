/**
 * BattleScreen に渡された勢力を、その中の UI（ウィンドウ・パネル）に配る。
 */
import { createContext, useContext } from 'react';
import type { TeamId } from '@norden/map-runtime/core/units';
import { demoFactions, teamName, type BattleFactions } from '../factions';

export const FactionsContext = createContext<BattleFactions>(demoFactions);

/** 軍を勢力の名前で呼ぶ関数 */
export function useTeamName(): (team: TeamId) => string {
  const factions = useContext(FactionsContext);
  return (team) => teamName(factions, team);
}
