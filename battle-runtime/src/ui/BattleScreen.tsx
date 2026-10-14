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
 * - 退却先の拠点は軍ごとに retreats で渡す（無い軍は退却できない）。退却した・捕虜になったユニットは onRetreat で知らせる。
 * - 殲滅されたユニット（指揮官が捕縛されたか）は onWipeout で知らせる。
 * - 決着すると（どちらかの陣営の全滅・退却、攻撃側の入城。victory.ts）決着のカットインを出し、終わったら画面の中央に
 *   決着のウィンドウ（BattleEndWindow.tsx）を出す。そのボタン（onEnd を渡したときだけ）で使う側に知らせる。
 *   カットインは、プレイヤーの陣営（playerSide）が勝てば CUTIN_TEMPLATES の battle-win、負ければ battle-lose をテンプレートのまま出す
 *   （プレイヤーが戦闘にいないときは battle-win）。決着した後はターン表示を出さない。
 * - ターン表示には、いま行動している軍を出す（防衛側 → 攻撃側の交互）。
 * - 軍は色（赤・青）ではなく勢力の名前で呼ぶ。陣営ごとの勢力は factions で渡す（factions.ts。中の UI には FactionsContext で配る）。
 * - 画面の下に操作の案内・予約の中身・実行した結果のステータス行を出す（notice を渡すとそちらを出す）。
 * - 親の要素いっぱいに広がる。children はその上に重ねる（エディタの道具・ゲームの見出しなど）。
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, CUTIN_TEMPLATES, CutInLayer, ThinFrame, useCutIn, type CutInPlayOptions, type CutInQueue } from 'norden-ui';
import type { MapData } from '@norden/map-runtime/core/mapData';
import { TEAM_DEFS, type TeamId } from '@norden/map-runtime/core/units';
import { BattleApp, type BattlePhase, type StatusFactory } from '../app';
import { demoBarks, type BarkSource } from '../barks';
import type { DeploySide } from '@norden/map-runtime/core/mapData';
import type { TroopFactory } from '../deployment';
import { demoFactions, teamName, type BattleFactions } from '../factions';
import type { RetreatDestinations, RetreatReport } from '../retreat';
import type { WipeoutReport } from '../wipeout';
import type { BattleOutcome } from '../victory';
import ActionMenu from './ActionMenu';
import BattleEndWindow from './BattleEndWindow';
import BattleLogWindow from './BattleLogWindow';
import DeployWindow from './DeployWindow';
import { FactionsContext } from './factionsContext';
import {
  actionStatus,
  battleStartStatus,
  deployStatus,
  endStatus,
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
  /** 軍の番の始め。既定は「（勢力の名前）のターン」と「TURN  1」 */
  turn?: (turn: number, team: TeamId) => CutInPlayOptions;
}

const defaultStartText = (map: MapData): CutInPlayOptions => ({ text: '戦闘開始', subText: map.name });
const defaultTurnText = (factions: BattleFactions, turn: number, team: TeamId): CutInPlayOptions => ({
  text: `${teamName(factions, team)}のターン`,
  subText: `TURN  ${turn}`,
});
/** 決着のカットインのテンプレート。プレイヤーの陣営が負けたら battle-lose、ほかは battle-win */
const endCutIn = (winner: DeploySide, playerSide: DeploySide | null | undefined): string =>
  playerSide && winner !== playerSide ? 'battle-lose' : 'battle-win';

/** CUTIN_TEMPLATES のテンプレートを再生する（options を省略すると文字はテンプレートのまま。無ければすぐに終える） */
function playCutIn(queue: CutInQueue, name: string, options?: CutInPlayOptions): Promise<void> {
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
  /** 攻撃側・防衛側の勢力（軍をその名前で呼ぶ。既定は表示確認用の仮の勢力） */
  factions?: BattleFactions;
  /** 戦闘開始・ターンのカットインの文字（ゲームでは戦場と日付を渡す） */
  cutInTexts?: BattleCutInTexts;
  /** 何を喋るか（ゲームでは騎士の口調・性格から会話データを引くものを渡す。既定は表示確認用の決まったセリフ） */
  barks?: BarkSource;
  /** 軍ごとの退却先の拠点（ゲームでは戦場の拠点に街道でつながる自勢力の拠点）。無い軍は退却できない（既定はどの軍も無い） */
  retreats?: RetreatDestinations;
  /** ユニットが退却した・退却に失敗して捕虜になったとき（この戦闘のすべては BattleApp.retreated にも残る） */
  onRetreat?: (report: RetreatReport) => void;
  /** ユニットが殲滅されたとき（指揮官が捕縛されたかは report.captured。この戦闘のすべては BattleApp.wipedOut にも残る） */
  onWipeout?: (report: WipeoutReport) => void;
  /** 決着のウィンドウのボタンを押したとき（渡さなければボタンを出さない。決着そのものは BattleApp の end でも受け取れる） */
  onEnd?: (outcome: BattleOutcome) => void;
  /** 決着のウィンドウのボタンの文字（既定は「戦闘を終える」） */
  endLabel?: string;
  /** プレイヤーの陣営（決着のカットインの勝利・敗北を決める）。プレイヤーが戦闘にいなければ省略 */
  playerSide?: DeploySide | null;
  /** ステータス行に出す知らせ（マップを読めないときなど）。あれば戦闘の案内の代わりに出す */
  notice?: ReactNode;
  /** BattleApp を作った・破棄した（null）とき。描画の設定を変えるときなどに使う */
  onApp?: (app: BattleApp | null) => void;
  className?: string;
  children?: ReactNode;
}

export default function BattleScreen({
  map,
  statuses,
  troops,
  factions = demoFactions,
  cutInTexts,
  barks,
  retreats,
  onRetreat,
  onWipeout,
  onEnd,
  endLabel = '戦闘を終える',
  playerSide = null,
  notice,
  onApp,
  className = '',
  children,
}: BattleScreenProps) {
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
  /** 戦闘の決着（まだなら null）と、決着のカットインを終えて決着のウィンドウを出しているか */
  const [outcome, setOutcome] = useState<BattleOutcome | null>(null);
  const [endShown, setEndShown] = useState(false);
  const latest = useRef({ statuses, troops, factions, cutInTexts, onRetreat, onWipeout, onApp, playerSide });
  latest.current = { statuses, troops, factions, cutInTexts, onRetreat, onWipeout, onApp, playerSide };

  useEffect(() => {
    const app = new BattleApp(viewportRef.current!);
    setApp(app);
    latest.current.onApp?.(app);
    const offs = [
      app.on('load', () => {
        setStatus(LOADED_STATUS);
        setOutcome(null);
        setEndShown(false);
      }),
      app.on('phase', (p) => {
        setPhase(p);
        if (p === 'battle') setStatus(battleStartStatus(latest.current.factions, app.activeTeam));
      }),
      app.on('deploy', (state) => setStatus(deployStatus(latest.current.factions, state))),
      app.on('turn', (turn, team) => {
        setTurn({ turn, team });
        const { cutInTexts, factions } = latest.current;
        void playCutIn(queue, 'turn', cutInTexts?.turn ? cutInTexts.turn(turn, team) : defaultTurnText(factions, turn, team));
      }),
      app.on('select', (unit) => {
        if (unit && unit === app.inspected) setStatus(inspectStatus(latest.current.factions, unit));
      }),
      app.on('action', (u, a) => setStatus(actionStatus(latest.current.factions, u, a))),
      app.on('planChange', (plan) => setStatus(planStatus(latest.current.factions, plan))),
      app.on('targetCancel', () => setStatus(IDLE_STATUS)),
      app.on('targetReject', (reason) => setStatus(rejectStatus(reason))),
      app.on('execute', (report) => setStatus(executeStatus(latest.current.factions, report))),
      app.on('retreat', (report) => latest.current.onRetreat?.(report)),
      app.on('wipeout', (report) => latest.current.onWipeout?.(report)),
      app.on('end', (o) => {
        setOutcome(o);
        setStatus(endStatus(latest.current.factions, o));
        // 読み込み直したら（outcome が変わったら）前の決着のウィンドウは出さない
        void playCutIn(queue, endCutIn(o.winner, latest.current.playerSide)).then(() => {
          if (app.outcome === o) setEndShown(true);
        });
      }),
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

  useEffect(() => {
    if (app) app.retreats = retreats ?? {};
  }, [app, retreats]);

  const endTurn = () => {
    if (app?.endTurn()) setStatus(turnStatus(factions, app.turn, app.activeTeam));
  };

  return (
    <FactionsContext.Provider value={factions}>
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
            {map && phase === 'battle' && !intro && !outcome && (
              <div className="battle-turn-bar" style={{ '--team': TEAM_DEFS[turn.team].color } as CSSProperties}>
                <ThinFrame />
                <span className="turn">
                  ターン <output>{turn.turn}</output>
                </span>
                <span className="turn-team">{teamName(factions, turn.team)}の番</span>
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
        {app && outcome && endShown && <BattleEndWindow outcome={outcome} label={endLabel} onEnd={onEnd && (() => onEnd(outcome))} />}
        {children}
      </div>
    </FactionsContext.Provider>
  );
}
