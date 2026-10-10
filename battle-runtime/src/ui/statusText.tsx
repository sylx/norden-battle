/**
 * 画面の下のステータス行に出す案内（操作の説明・予約の中身・実行した結果）。
 */
import type { ReactNode } from 'react';
import { TEAM_DEFS, UNIT_DEFS, type UnitData } from '@norden/map-runtime/core/units';
import type { MenuAction } from '../actions';
import { BattleApp, type ExecuteReport, type Plan } from '../app';
import { isAttack } from '../combat';

export const IDLE_STATUS = 'クリック: ユニットを選択 / Esc: 予約を 1 つ戻す・選択を外す';
const BACK = 'Esc・範囲外クリック: メニューに戻る';

export const LOADED_STATUS = `左ドラッグ: 移動 / ホイール: ズーム / ${IDLE_STATUS}`;

export function Err({ children }: { children: ReactNode }) {
  return <span className="err">{children}</span>;
}

const unitLabel = (u: UnitData) => `${teamUnit(u)} (${u.col}, ${u.row})`;
const teamUnit = (u: UnitData) => `${TEAM_DEFS[u.team].name} ${UNIT_DEFS[u.type].name}`;

/** 行動メニューで行動を選んだとき */
export function actionStatus(u: UnitData, a: MenuAction): string {
  if (a.id === 'move') return `${unitLabel(u)}: 移動先を選んでください（青い HEX。橙の斜線は敵の ZOC で、入るとそれ以上動けない）/ ${BACK}`;
  if (a.id === 'volley') return `${unitLabel(u)}: ${a.name}の相手を選んでください（金の斜線: ほかの味方とも接している敵）/ ${BACK}`;
  if (isAttack(a.id)) return `${unitLabel(u)}: ${a.name}の相手を選んでください（赤い HEX）/ ${BACK}`;
  // 移動・攻撃以外の処理はまだ無いので、選んだものを知らせるだけ
  return `${unitLabel(u)}: 「${a.name}」を選択${a.cost !== undefined ? `（行動力 ${a.cost}）` : ''}— 未実装`;
}

/** 予約が増えた・減ったとき。攻撃の前の移動 → 攻撃 → 攻撃の後の移動（騎兵）の順に並べる */
export function planStatus(plan: Plan): string {
  const split = plan.attack?.afterLeg ?? plan.legs.length;
  const moves = (legs: typeof plan.legs) => {
    const last = legs.at(-1);
    return last && `(${last.col}, ${last.row}) まで移動（${legs.length} 回）`;
  };
  const parts = [
    moves(plan.legs.slice(0, split)),
    plan.attack &&
      `${unitLabel(plan.attack.target)} に${plan.attack.action.name}` +
        (plan.attack.landing ? `（(${plan.attack.landing.col}, ${plan.attack.landing.row}) へ突破）` : plan.attack.action.id === 'charge' ? '（突破できない）' : ''),
    moves(plan.legs.slice(split)),
  ].filter(Boolean);
  return parts.length > 0
    ? `${unitLabel(plan.unit)}: ${parts.join(' → ')} を予約（行動力 ${BattleApp.planCost(plan)}）/ 決定: 実行 / 取消: すべて取り消す / Esc: 1 つ戻す`
    : `${unitLabel(plan.unit)}: 予約を取り消しました / ${IDLE_STATUS}`;
}

/** 選べない攻撃の相手を選んだとき */
export function rejectStatus(reason: string): ReactNode {
  return (
    <>
      <Err>{reason}</Err> — ほかの味方とも接している敵（金の斜線）を選んでください / {BACK}
    </>
  );
}

export function turnStatus(turn: number): string {
  return `ターン ${turn} — 全ユニットの行動力が回復しました / ${IDLE_STATUS}`;
}

/** 決定で予約を実行し終えたとき */
export function executeStatus({ unit, from, moveCost, attack, intercepts, lost, halted, intercept }: ExecuteReport): string {
  const parts: string[] = [];
  if (moveCost > 0) parts.push(`(${from.col}, ${from.row}) から移動（行動力 ${moveCost}）`);
  // 移動の途中で受けた迎撃（攻撃の前の移動・後の移動）
  const interceptParts = (afterAttack: boolean) => {
    for (const i of intercepts) {
      if (i.afterAttack === afterAttack) parts.push(`${teamUnit(i.unit)}の迎撃: -${i.result.damage}${i.targetLeft <= 0 ? '（壊滅）' : ''}`);
    }
  };
  interceptParts(false);
  if (attack) {
    const { result } = attack;
    parts.push(
      `${teamUnit(attack.target)}に${attack.action.name}: ` +
        `敵 -${result.damage}${attack.targetDestroyed ? '（壊滅）' : ''}${result.encircled ? '（包囲）' : ''}` +
        (result.direct ? ` / 反撃 -${result.counter}${attack.unitDestroyed ? '（壊滅）' : ''}` : '') +
        (attack.landing && !attack.unitDestroyed ? ` → (${attack.landing.col}, ${attack.landing.row}) へ突破` : ''),
    );
  }
  interceptParts(true);
  if (halted && !lost) parts.push(`(${unit.col}, ${unit.row}) で足止めされた（行動終了）`);
  else if (intercept && !lost) parts.push('迎撃の構えで待機（行動終了）');
  return `${unitLabel(unit)}: ${parts.join(' → ')}`;
}
