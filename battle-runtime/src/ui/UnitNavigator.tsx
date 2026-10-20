/**
 * 未行動の部隊のナビゲーション（画面の右上、騎士のウィンドウの下）。
 *
 * - 「前の部隊」「次の部隊」で、いまの番の軍の未行動（行動済みの E の印が付いていない）ユニットを順に選ぶ（BattleApp.selectPending）。
 *   選んだユニットへカメラが動く。
 * - 真ん中に、未行動のユニットの数 / その軍のユニットの数を出す。
 * - 戦闘中だけ出す（配備フェーズ・決着の後・強制退却の間は出さない）。枠は norden-ui の ThinFrame。
 */
import { useEffect, useState } from 'react';
import { Button, ThinFrame } from 'norden-ui';
import type { BattleApp } from '../app';

export default function UnitNavigator({ app }: { app: BattleApp }) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const offs = [
      app.on('load', bump),
      app.on('phase', bump),
      app.on('select', bump),
      app.on('execute', bump),
      app.on('turn', bump),
      app.on('allDone', bump),
      app.on('rout', bump),
      app.on('end', bump),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [app]);

  const total = app.teamUnits().length;
  if (total === 0) return null;
  const pending = app.pendingUnits().length;
  return (
    <div className="unit-nav" role="group" aria-label="未行動の部隊">
      <ThinFrame />
      <Button size="small" disabled={pending === 0} onClick={() => app.selectPending(-1)}>
        ◀ 前の部隊
      </Button>
      <span className="unit-nav-count" title="未行動の部隊 / 全部隊">
        <output>{pending}</output> / {total}
      </span>
      <Button size="small" disabled={pending === 0} onClick={() => app.selectPending(1)}>
        次の部隊 ▶
      </Button>
    </div>
  );
}
