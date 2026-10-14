/**
 * 決着のウィンドウ（画面の中央。決着のカットインの後に出す）。勝った陣営・決着の理由・ターンと、戦闘を終えるボタン。
 *
 * - ボタンは使う側が onEnd を渡したときだけ出す（ゲームは戦後処理へ、battle-editor はマップを読み込み直す）。
 * - 枠は norden-ui の ThinFrameWithTitle（細いベゼルと題名の札）。
 */
import type { CSSProperties } from 'react';
import { Button, ThinFrameWithTitle } from 'norden-ui';
import { TEAM_DEFS } from '@norden/map-runtime/core/units';
import { SIDE_NAMES, SIDE_TEAM } from '../deployment';
import { useTeamName } from './factionsContext';
import { BATTLE_END_REASON_NAMES, type BattleOutcome } from '../victory';

export default function BattleEndWindow({ outcome, label, onEnd }: { outcome: BattleOutcome; label: string; onEnd?: () => void }) {
  const { winner, reason, turn, unit } = outcome;
  const def = TEAM_DEFS[SIDE_TEAM[winner]];
  const teamName = useTeamName();
  return (
    <ThinFrameWithTitle title="決着" className="battle-window battle-end-window" style={{ '--team': def.color } as CSSProperties}>
      <p className="end-winner">
        {teamName(def.id)}（{SIDE_NAMES[winner]}）の勝利
      </p>
      <dl>
        <div className="row">
          <dt>決着</dt>
          <dd>
            {BATTLE_END_REASON_NAMES[reason]}
            {unit && `（(${unit.col}, ${unit.row})）`}
          </dd>
        </div>
        <div className="row">
          <dt>ターン</dt>
          <dd>{turn}</dd>
        </div>
      </dl>
      {onEnd && (
        <div className="end-foot">
          <Button variant="primary" size="small" onClick={onEnd}>
            {label}
          </Button>
        </div>
      )}
    </ThinFrameWithTitle>
  );
}
