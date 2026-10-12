/**
 * 戦闘画面。BattleApp（three.js のマップ・ユニット・入力）を置き、その上に UI を重ねる。
 * battle-editor とゲーム本体（nordencult）の戦闘のシーンで共有する。
 *
 * - マップを読み込むと、配備フェーズの前に「戦闘開始」のカットインを出す。その間は配備のウィンドウ・ターン表示を出さない。
 * - 軍の番が変わるたびに（戦闘が始まったときも）、その軍のターンのカットインを出す。
 *   カットインは norden-ui の CutInLayer（テンプレートは CUTIN_TEMPLATES の battle-start・turn）。文字は cutInTexts で差し替える。
 * - 初期配置地点のあるマップは配備フェーズから始まる。その間は戦闘記録・ターン表示の代わりに配備のウィンドウを出す。
 * - 地形の右に、カーソルの下・選択中のユニットの騎士の情報を固定で出す（行動メニューは名前・行動力と項目だけ）。
 * - 地形・騎士・戦闘記録・配備は norden-ui の ThinFrameWithTitle（細いベゼルと題名の札）、行動メニュー・ターン表示は ThinFrame で囲む。
 * - 画面の上の中央に戦況（軍ごとの兵数の合計の比の帯）を出す。
 * - 攻撃・迎撃・鼓舞・殲滅などのとき、ユニットの頭上にセリフの吹き出しを出す（BattleApp・speechBubbles.ts）。何を喋るかは barks で差し替える。
 * - ターン表示には、いま行動している軍を出す（防衛側の赤軍 → 攻撃側の青軍の交互）。
 * - 画面の下に操作の案内・予約の中身・実行した結果のステータス行を出す（notice を渡すとそちらを出す）。
 * - 親の要素いっぱいに広がる。children はその上に重ねる（エディタの道具・ゲームの見出しなど）。
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, CUTIN_TEMPLATES, CutInLayer, ThinFrame, useCutIn, type CutInPlayOptions, type CutInQueue } from 'norden-ui';
import type { MapData } from '@norden/map-runtime/core/mapData';
import { TEAM_DEFS, type TeamId } from '@norden/map-runtime/core/units';
import { BattleApp, type BattlePhase, type StatusFactory } from '../app';
import { demoBarks, type BarkSource } from '../barks';
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

/** カットインの文字（text: メイン、subText: サブ。'' でサブを消す）。省略した項目は既定の文字 */
export interface BattleCutInTexts {
  /** 戦闘開始（配備フェーズの前）。既定は「戦闘開始」とマップの名前 */
  start?: (map: MapData) => CutInPlayOptions;
  /** 軍の番の始め。既定は「赤軍のターン」と「TURN  1」 */
  turn?: (turn: number, team: TeamId) => CutInPlayOptions;
}

const defaultStartText = (map: MapData): CutInPlayOptions => ({ text: '戦闘開始', subText: map.name });
const defaultTurnText = (turn: number, team: TeamId): CutInPlayOptions => ({
  text: `${TEAM_DEFS[team].name}のターン`,
  subText: `TURN  ${turn}`,
});

/** CUTIN_TEMPLATES のテンプレートを再生する（無ければすぐに終える） */
function playCutIn(queue: CutInQueue, name: string, options: CutInPlayOptions): Promise<void> {
  const template = CUTIN_TEMPLATES[name];
  return template ? queue.play(template, options) : Promise.resolve();
}

export interface BattleScreenProps {
  /** 戦場のマップ。変えると読み込み直す（null の間は何も載せない） */
  map: MapData | null;
  /** マップに置いてあるユニットに戦闘中の状態を配る（map を変えたときに使う。既定は表示確認用の仮の値） */
  statuses?: StatusFactory;
  /** 配備フェーズで置く部隊を配る（map に初期配置地点があるときに使う。既定は表示確認用の仮の部隊） */
  troops?: TroopFactory;
  /** 戦闘開始・ターンのカットインの文字（ゲームでは戦場と日付・勢力の名前を渡す） */
  cutInTexts?: BattleCutInTexts;
  /** 何を喋るか（ゲームでは騎士の口調・性格から会話データを引くものを渡す。既定は表示確認用の決まったセリフ） */
  barks?: BarkSource;
  /** ステータス行に出す知らせ（マップを読めないときなど）。あれば戦闘の案内の代わりに出す */
  notice?: ReactNode;
  /** BattleApp を作った・破棄した（null）とき。描画の設定を変えるときなどに使う */
  onApp?: (app: BattleApp | null) => void;
  className?: string;
  children?: ReactNode;
}

export default function BattleScreen({ map, statuses, troops, cutInTexts, barks, notice, onApp, className = '', children }: BattleScreenProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [app, setApp] = useState<BattleApp | null>(null);
  const [status, setStatus] = useState<ReactNode>(IDLE_STATUS);
  const [phase, setPhase] = useState<BattlePhase | null>(null);
  const [turn, setTurn] = useState<{ turn: number; team: TeamId }>({ turn: 1, team: 'red' });
  const cutIn = useCutIn();
  const { queue } = cutIn;
  /** 戦闘開始のカットインを出している（読み込み直すたびに番号を進め、前の読み込みの終わりを無視する） */
  const [intro, setIntro] = useState(false);
  const introId = useRef(0);
  const latest = useRef({ statuses, troops, cutInTexts, onApp });
  latest.current = { statuses, troops, cutInTexts, onApp };

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
      app.on('turn', (turn, team) => {
        setTurn({ turn, team });
        void playCutIn(queue, 'turn', (latest.current.cutInTexts?.turn ?? defaultTurnText)(turn, team));
      }),
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
  }, [queue]);

  useEffect(() => {
    if (!app || !map) return;
    // 前のマップのカットインを捨て、戦闘開始を先に並べる（配備の無いマップは読み込むとすぐ最初のターンのカットインが続く）
    queue.clear();
    const id = ++introId.current;
    setIntro(true);
    void playCutIn(queue, 'battle-start', (latest.current.cutInTexts?.start ?? defaultStartText)(map)).then(() => {
      if (introId.current === id) setIntro(false);
    });
    app.loadMap(map, latest.current.statuses, latest.current.troops);
  }, [app, map, queue]);

  useEffect(() => {
    if (app) app.barks = barks ?? demoBarks;
  }, [app, barks]);

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
          {phase === 'deploy' && !intro && <DeployWindow app={app} />}
          {phase === 'battle' && <BattleLogWindow app={app} />}
          <ActionMenu model={app.menu} />
          {map && phase === 'battle' && !intro && (
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
      <CutInLayer cutIn={cutIn} />
      {children}
    </div>
  );
}
