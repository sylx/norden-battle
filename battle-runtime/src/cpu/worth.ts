/**
 * 兵 1 人の重さ（CPU が兵数を点数にするときに掛ける）。
 */
import type { UnitData } from '@norden/map-runtime/core/units';
import { UNIT_POWER } from '../damage';
import type { UnitStatus } from '../unitStatus';
import { COMMANDER_WORTH } from './weights';

/** 兵 1 人の重さ（兵種の力。軍団長の部隊は COMMANDER_WORTH 倍） */
export function worth(unit: UnitData, status: UnitStatus): number {
  return power(unit, status) * (status.commander ? COMMANDER_WORTH : 1);
}

/** 兵 1 人の力（兵種の攻撃力と防御力の平均。軍団長の重さを入れない） */
export function power(unit: Pick<UnitData, 'type'>, _status?: UnitStatus): number {
  const p = UNIT_POWER[unit.type];
  return (p.attack + p.defense) / 2;
}
