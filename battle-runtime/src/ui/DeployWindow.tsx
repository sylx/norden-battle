/**
 * 配備フェーズのウィンドウ（画面の右下、ステータス行の上）。配備している陣営の部隊の一覧と、自動配置・配備完了のボタン。
 *
 * - 部隊をクリックすると選び（もう一度で選ぶのをやめる）、マップの配置地点（軍の色の HEX）をクリックして置く。
 * - 配備した部隊には置いた HEX と、外す（未配備に戻す）ボタンを出す。
 * - 置けるのは 1 つの陣営で 6 部隊まで（MAX_DEPLOY）。上限まで置いたら知らせる。
 * - 「配備完了」は 1 部隊以上置くと押せる。最後の陣営では戦闘を始める。
 * - 枠は norden-ui の ThinFrameWithTitle（細いベゼルと題名の札）。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { Button, ThinFrameWithTitle } from 'norden-ui';
import { TEAM_DEFS, UNIT_DEFS } from '@norden/map-runtime/core/units';
import type { BattleApp } from '../app';
import { SIDE_NAMES } from '../deployment';
import StatusCard from './StatusCard';

export default function DeployWindow({ app }: { app: BattleApp }) {
  const [state, setState] = useState(app.deployState);
  useEffect(() => {
    setState(app.deployState);
    return app.on('deploy', setState);
  }, [app]);
  if (!state) return null;

  const { side, team, troops, placed, picked, limit, more } = state;
  const def = TEAM_DEFS[team];
  const count = placed.size;
  const full = count >= limit;
  return (
    <ThinFrameWithTitle
      title={`配備 — ${def.name}（${SIDE_NAMES[side]}）`}
      className="battle-window deploy-window"
      style={{ '--team': def.color } as CSSProperties}
    >
      <ol className="deploy-list">
        {troops.map((t) => {
          const at = placed.get(t.id);
          return (
            <li
              key={t.id}
              className={`deploy-troop${t.id === picked ? ' picked' : ''}${at ? ' placed' : ''}${!at && full ? ' over' : ''}`}
              onClick={() => app.pickTroop(t.id)}
            >
              <span className="troop-name">
                {UNIT_DEFS[t.type].name}
                {t.status.commander && <span className="commander-mark">軍団長</span>}
              </span>
              <StatusCard status={t.status} className="in-list" />
              <span className="troop-at">{at ? `(${at.col}, ${at.row})` : '未配備'}</span>
              {at && (
                <button
                  type="button"
                  className="troop-remove"
                  title="外す（未配備に戻す）"
                  onClick={(e) => {
                    e.stopPropagation();
                    app.unplaceTroop(t.id);
                  }}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <div className="deploy-foot">
        <span className={`deploy-count${full ? ' full' : ''}`} title={`1 つの陣営が置けるのは ${limit} 部隊まで`}>
          配置 <output>{count}</output> / {limit}
          {full && <small>上限</small>}
        </span>
        <Button size="small" disabled={full || count >= troops.length} onClick={() => app.autoDeploy()}>
          自動配置
        </Button>
        <Button variant="primary" size="small" disabled={count === 0} onClick={() => app.finishDeploy()}>
          {more ? '配備完了' : '配備完了・戦闘開始'}
        </Button>
      </div>
    </ThinFrameWithTitle>
  );
}
