/**
 * BattleScreen に渡された勢力を、その中の UI（ウィンドウ・パネル）に配る。
 */
import { createContext, useContext } from 'react';
import type { TeamId, UnitData } from '@norden/map-runtime/core/units';
import { demoFactions, teamName, unitName, type BattleFactions } from '../factions';

export const FactionsContext = createContext<BattleFactions>(demoFactions);

/** 軍を勢力の名前で呼ぶ関数 */
export function useTeamName(): (team: TeamId) => string {
  const factions = useContext(FactionsContext);
  return (team) => teamName(factions, team);
}

/** 部隊を呼ぶ関数（leader は部隊を率いる騎士の名前） */
export function useUnitName(): (unit: UnitData, leader?: string) => string {
  const factions = useContext(FactionsContext);
  return (unit, leader) => unitName(factions, unit, leader);
}
