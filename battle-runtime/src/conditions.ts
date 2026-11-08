/**
 * ユニットに付く状態（状態異常）。
 *
 * - 状態は UnitStatus.conditions に、残りのターン数と一緒に持つ。攻撃の inflicts（attacks.ts）で確率で付く。
 *   同じ状態が付いていれば、長いほうの残りターンにする。
 * - 付いたユニットの軍の番が終わるときに残りのターンを 1 減らし、0 で消す（tickConditions）。
 * - 情報札に印（mark）、部隊のウィンドウに名前と残りターン数を出す。
 * - 効果（app.ts の startTeamTurn）: 凍結はその番に一切行動できない（迎撃の構えも解ける）。
 *   混乱は操作できず、番の初めにランダムな HEX へ勝手に移動して行動を終える。
 */
import type { UnitStatus } from './unitStatus';

export const CONDITION_IDS = ['confusion', 'freeze'] as const;
export type ConditionId = (typeof CONDITION_IDS)[number];

export interface ConditionDef {
  id: ConditionId;
  name: string;
  /** 情報札に出す 1 文字の印 */
  mark: string;
  /** 印の色 */
  color: string;
}

export const CONDITION_DEFS: Record<ConditionId, ConditionDef> = {
  confusion: { id: 'confusion', name: '混乱', mark: '混', color: '#c070e0' },
  freeze: { id: 'freeze', name: '凍結', mark: '凍', color: '#70c8f0' },
};

/** 付いている状態と残りのターン数 */
export interface Condition {
  id: ConditionId;
  turns: number;
}

/** status に id の状態を turns ターン付ける（付いていれば長いほうにする。turns が 0 以下なら外す） */
export function setCondition(status: UnitStatus, id: ConditionId, turns: number): void {
  const i = status.conditions.findIndex((c) => c.id === id);
  if (turns <= 0) {
    if (i >= 0) status.conditions.splice(i, 1);
    return;
  }
  if (i >= 0) status.conditions[i] = { id, turns: Math.max(status.conditions[i].turns, turns) };
  else status.conditions.push({ id, turns });
  // 凍結すると迎撃の構えは解ける
  if (id === 'freeze') status.intercepting = false;
}

/** status に id の状態が付いているか */
export function hasCondition(status: Pick<UnitStatus, 'conditions'>, id: ConditionId): boolean {
  return status.conditions.some((c) => c.id === id);
}

/** 軍の番が終わるときに、残りのターンを 1 減らして 0 のものを消す */
export function tickConditions(status: UnitStatus): void {
  status.conditions = status.conditions.map((c) => ({ ...c, turns: c.turns - 1 })).filter((c) => c.turns > 0);
}

/** 軍の番が始まるときに、クールタイムを 1 減らして 0 のものを消す */
export function tickCooldowns(status: UnitStatus): void {
  for (const [id, n] of Object.entries(status.cooldowns) as [keyof UnitStatus['cooldowns'], number][]) {
    if (n <= 1) delete status.cooldowns[id];
    else status.cooldowns[id] = n - 1;
  }
}
