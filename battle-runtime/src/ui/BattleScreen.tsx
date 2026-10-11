/**
 * 戦闘画面。BattleApp（three.js のマップ・ユニット・入力）を置き、その上に UI を重ねる。
 * battle-editor とゲーム本体（nordencult）の戦闘のシーンで共有する。
 *
 * - 初期配置地点のあるマップは配備フェーズから始まる。その間は戦闘記録・ターン表示の代わりに配備のウィンドウを出す。
 * - 地形の右に、カーソルの下・選択中のユニットの騎士の情報を固定で出す（行動メニューは名前・行動力と項目だけ）。
 * - 地形・騎士・戦闘記録・配備は norden-ui の ThinFrameWithTitle（細いベゼルと題名の札）、行動メニュー・ターン表示は ThinFrame で囲む。
 * - 画面の上の中央に戦況（軍ごとの兵数の合計の比の帯）を出す。
 * - ターン表示には、いま行動している軍を出す（防衛側の赤軍 → 攻撃側の青軍の交互）。
 * - 画面の下に操作の案内・予約の中身・実行した結果のステータス行を出す（notice を渡すとそちらを出す）。
 * - 親の要素いっぱいに広がる。children はその上に重ねる（エディタの道具・ゲームの見出しなど）。
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, ThinFrame } from 'norden-ui';
import type { MapData } from '@norden/map-runtime/core/mapData';
import { TEAM_DEFS, type TeamId } from '@norden/map-runtime/core/units';
import { BattleApp, type BattlePhase, type StatusFactory } from '../app';
import type { TroopFactory } from '../deployment';
import ActionMenu from './ActionMenu';
import BattleLogWindow from './BattleLogWindow';
import DeployWindow from './DeployWindow';
import {
  actionStatus,
  battleStartStatus,
  deployStatus,
  executeStatus,
  IDLE_STATUS,
  inspectStatus,
  LOADED_STATUS,
  planStatus,
  rejectStatus,
  turnStatus,
} from './statusText';
import SituationPanel from './SituationPanel';
import TerrainWindow from './TerrainWindow';
import UnitInfoWindow from './UnitInfoWindow';
import './battle.css';

export interface BattleScreenProps {
  /** 戦場のマップ。変えると読み込み直す（null の間は何も載せない） */
  map: MapData | null;
  /** マップに置いてあるユニットに戦闘中の状態を配る（map を変えたときに使う。既定は表示確認用の仮の値） */
  statuses?: StatusFactory;
  /** 配備フェーズで置く部隊を配る（map に初期配置地点があるときに使う。既定は表示確認用の仮の部隊） */
  troops?: TroopFactory;
  /** ステータス行に出す知らせ（マップを読めないときなど）。あれば戦闘の案内の代わりに出す */
  notice?: ReactNode;
  /** BattleApp を作った・破棄した（null）とき。描画の設定を変えるときなどに使う */
  onApp?: (app: BattleApp | null) => void;
  className?: string;
  children?: ReactNode;
}

export default function BattleScreen({ map, statuses, troops, notice, onApp, className = '', children }: BattleScreenProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [app, setApp] = useState<BattleApp | null>(null);
  const [status, setStatus] = useState<ReactNode>(IDLE_STATUS);
  const [phase, setPhase] = useState<BattlePhase | null>(null);
  const [turn, setTurn] = useState<{ turn: number; team: TeamId }>({ turn: 1, team: 'red' });
  const latest = useRef({ statuses, troops, onApp });
  latest.current = { statuses, troops, onApp };

  useEffect(() => {
    const app = new BattleApp(viewportRef.current!);
    setApp(app);
    latest.current.onApp?.(app);
    const offs = [
      app.on('load', () => setStatus(LOADED_STATUS)),
      app.on('phase', (p) => {
        setPhase(p);
        if (p === 'battle') setStatus(battleStartStatus(app.activeTeam));
      }),
      app.on('deploy', (state) => setStatus(deployStatus(state))),
      app.on('turn', (turn, team) => setTurn({ turn, team })),
      app.on('select', (unit) => {
        if (unit && unit === app.inspected) setStatus(inspectStatus(unit));
      }),
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
    if (app && map) app.loadMap(map, latest.current.statuses, latest.current.troops);
  }, [app, map]);

  const endTurn = () => {
    if (app?.endTurn()) setStatus(turnStatus(app.turn, app.activeTeam));
  };

  return (
    <div className={`battle-screen ${className}`}>
      <div ref={viewportRef} className="battle-viewport" />
      {app && (
        <>
          {map && <SituationPanel app={app} />}
          <TerrainWindow app={app} />
          <UnitInfoWindow app={app} />
          {phase === 'deploy' && <DeployWindow app={app} />}
          {phase === 'battle' && <BattleLogWindow app={app} />}
          <ActionMenu model={app.menu} />
          {map && phase === 'battle' && (
            <div className="battle-turn-bar" style={{ '--team': TEAM_DEFS[turn.team].color } as CSSProperties}>
              <ThinFrame />
              <span className="turn">
                ターン <output>{turn.turn}</output>
              </span>
              <span className="turn-team">{TEAM_DEFS[turn.team].name}の番</span>
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
