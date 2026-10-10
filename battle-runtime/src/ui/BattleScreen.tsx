/**
 * 戦闘画面。BattleApp（three.js のマップ・ユニット・入力）を置き、その上に UI を重ねる。
 * battle-editor とゲーム本体（nordencult）の戦闘のシーンで共有する。
 *
 * - 地形・戦闘記録は norden-ui の ThinFrameWithTitle（細いベゼルと題名の札）、行動メニュー・ターン表示は ThinFrame で囲む。
 * - 画面の下に操作の案内・予約の中身・実行した結果のステータス行を出す（notice を渡すとそちらを出す）。
 * - 親の要素いっぱいに広がる。children はその上に重ねる（エディタの道具・ゲームの見出しなど）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, ThinFrame } from 'norden-ui';
import type { MapData } from '@norden/map-runtime/core/mapData';
import { BattleApp, type StatusFactory } from '../app';
import ActionMenu from './ActionMenu';
import BattleLogWindow from './BattleLogWindow';
import { actionStatus, executeStatus, IDLE_STATUS, LOADED_STATUS, planStatus, rejectStatus, turnStatus } from './statusText';
import TerrainWindow from './TerrainWindow';
import './battle.css';

export interface BattleScreenProps {
  /** 戦場のマップ。変えると読み込み直す（null の間は何も載せない） */
  map: MapData | null;
  /** マップのユニットに戦闘中の状態を配る（map を変えたときに使う。既定は表示確認用の仮の値） */
  statuses?: StatusFactory;
  /** ステータス行に出す知らせ（マップを読めないときなど）。あれば戦闘の案内の代わりに出す */
  notice?: ReactNode;
  /** BattleApp を作った・破棄した（null）とき。描画の設定を変えるときなどに使う */
  onApp?: (app: BattleApp | null) => void;
  className?: string;
  children?: ReactNode;
}

export default function BattleScreen({ map, statuses, notice, onApp, className = '', children }: BattleScreenProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [app, setApp] = useState<BattleApp | null>(null);
  const [status, setStatus] = useState<ReactNode>(IDLE_STATUS);
  const [turn, setTurn] = useState(1);
  const latest = useRef({ statuses, onApp });
  latest.current = { statuses, onApp };

  useEffect(() => {
    const app = new BattleApp(viewportRef.current!);
    setApp(app);
    latest.current.onApp?.(app);
    const offs = [
      app.on('load', () => setStatus(LOADED_STATUS)),
      app.on('turn', setTurn),
      app.on('action', (u, a) => setStatus(actionStatus(u, a))),
      app.on('planChange', (plan) => setStatus(planStatus(plan))),
      app.on('targetCancel', () => setStatus(IDLE_STATUS)),
      app.on('targetReject', (reason) => setStatus(rejectStatus(reason))),
      app.on('execute', (report) => setStatus(executeStatus(report))),
    ];
    return () => {
      for (const off of offs) off();
      latest.current.onApp?.(null);
      setApp(null);
      app.dispose();
    };
  }, []);

  useEffect(() => {
    if (app && map) app.loadMap(map, latest.current.statuses);
  }, [app, map]);

  const endTurn = () => {
    if (app?.endTurn()) setStatus(turnStatus(app.turn));
  };

  return (
    <div className={`battle-screen ${className}`}>
      <div ref={viewportRef} className="battle-viewport" />
      {app && (
        <>
          <TerrainWindow app={app} />
          <BattleLogWindow app={app} />
          <ActionMenu model={app.menu} />
          {map && (
            <div className="battle-turn-bar">
              <ThinFrame />
              <span className="turn">
                ターン <output>{turn}</output>
              </span>
              <Button variant="primary" size="small" onClick={endTurn}>
                ターン終了
              </Button>
            </div>
          )}
        </>
      )}
      <div className="battle-status" role="status">
        {notice ?? status}
      </div>
      {children}
    </div>
  );
}
