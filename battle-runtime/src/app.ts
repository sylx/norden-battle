/**
 * 戦闘画面。マップの描画は map-editor と同じ MapView を使い、パラメータは map-editor の初期値のまま。
 * 戦闘の UI・演出はここに積み上げていく。
 *
 * 行動は予約してから「決定」でまとめて実行する:
 * ユニットを選択 → 行動メニュー → 移動 → 移動先を選ぶ → 移動先でメニュー → … → 攻撃 → 相手を選ぶ → 決定。
 * - 移動は何回かに分けて予約でき、予約したルートは地面に矢印で出す。
 * - 攻撃は 1 ターンに 1 回で、予約した移動先から射程内の敵を選ぶ（射程内の HEX を薄い赤、相手のいる HEX を濃い赤で塗る）。相手へ赤い矢印を出す（遠隔攻撃は放物線）。
 *   一斉攻撃は、ほかの味方とも隣接している敵（金の斜線）しか選べない。ほかの敵を選ぶと「包囲していません」でやり直し。
 *   相手に隣接している味方からも細い赤い矢印を出し、実行するとその味方も一緒に踏み込んで攻撃する。
 *   攻撃を予約した後は移動できない。騎兵だけは攻撃の後にも移動を予約できる（一撃離脱。攻撃の直後は敵の ZOC の中からでも
 *   動き出せるが、ZOC から ZOC へは移れない）。
 * - 突撃（騎兵）は相手を突き抜けて向こうの HEX へ飛び出る。飛び出る先は予約のときに決め、矢印もそこまで伸ばす。
 * - 決定でユニットがルートに沿って歩き、攻撃し、（騎兵なら）続きを歩く（その間は操作を受け付けない）。
 *   攻撃の演出: カメラが両者へ寄り（cameraFocus.ts）、攻撃して、カメラが元へ戻る。
 *   歩兵の通常攻撃は踏み込んで光の剣で斬る（slashFx.ts）。騎兵の通常攻撃・突撃は光るランスで貫く（lanceFx.ts）。
 *   弓兵の通常攻撃は無数の光の矢を放物線で降らせる（arrowFx.ts）。弓兵の迎撃も同じ演出で、弓兵と撃たれるユニットへ寄る。
 *   魔術師のサンダーフォールは相手の頭上に雷を落とす（thunderFx.ts）。魔術師の迎撃も同じ演出。
 *   一斉攻撃は、加わる味方も含めた全員へ寄り、それぞれの兵種の演出（斬撃・ランス）を少しずつずらして出す。
 *   突撃で駆け抜けるときは、飛び出る先の HEX まで画面に収める。
 *   兵数が 0 になったユニットは消える。
 * - 迎撃（騎兵はできない）は選んだらすぐに実行する。予約した移動があればそこまで歩き、迎撃の構えで待機して行動を終える（行動力は 0 になる）。
 *   構えは次にそのユニットが行動するまで続く（ターンをまたいでも続く）。
 *   近接ユニットの構えは、受けるダメージを減らして反撃を増やす（damage.ts）。
 *   間接ユニットの構えは、敵が歩いて射程に入った HEX でその敵を止めて 1 回だけ自動で攻撃し、構えを解く。
 *   撃たれた敵は壊滅しなければ続きを歩く。ただし弓兵に撃たれた敵（騎兵を除く）はそこで足止めされ、残りの予約を捨てて
 *   行動を終える（行動力は 0 になる）。味方のいる HEX で止められたときは、通ってきた道を空いている HEX まで戻る。
 *
 * 戦闘画面に入った直後は配備フェーズ（deployment.ts）。マップに初期配置地点（deploy）があれば、防衛側 → 攻撃側の順に
 * 部隊を選んで配置地点に置く。初期配置地点が無いマップは、マップに置いてあるユニットのまま戦闘を始める。
 *
 * ターンは軍ごとの交互（防衛側の red → 攻撃側の blue。TURN_ORDER）。いまの番の軍のユニットだけを選んで行動させられる。
 * 相手方のユニットは暗くし、クリックするとそのユニットが次の番に動ける範囲（青）と攻撃できる範囲（赤）を出す（inspect）。
 * いまの番の軍で、もう移動・攻撃・迎撃のどれもできないユニットは行動済みとして、絵を暗くして右上に E の印を付ける。
 * ターン終了で次の軍の番になり、その軍の全ユニットの行動力が最大まで戻る（全軍が 1 回ずつ行動したらターンの数が進む）。
 * 敵の ZOC の中のユニットは、その番にまだ移動も攻撃もしていなければ動き出せる。
 *
 * 勝敗（victory.ts）: 行動を実行し終えるたびと軍の番を終えるときに調べる。どちらかの陣営の部隊がすべて殲滅・退却するか、攻撃側のユニットが
 * 防衛拠点（マップの stronghold。地面を金色に塗る）で行動を終える（もう行動できなくなる・拠点にいるまま番を終える。入城）と決着し、
 * 戦闘を終える（end のイベント。outcome に残す）。
 * 決着した後はユニットを選べず、ターンも終えられない。
 *
 * - 待機は選んだらすぐに実行する。予約した行動があれば実行してから、残りの行動力を捨てて行動を終える（行動力は 0 になる）。
 * - 鼓舞（指揮官のスキル。行動力 2）は選んだらすぐに実行する。予約した行動があれば実行してから、自分の士気を 10〜20 回復する。
 *   予約した行動の途中で壊滅・足止めされたときは鼓舞しない。
 * - 退却（ターンの初めだけ。行動力は使わない）は、選ぶと行動メニューに退却先の拠点（retreats。軍ごとに使う側が渡す）の一覧を出し、
 *   拠点を選ぶとすぐに実行する。退却先の無い軍のユニットは選べない。隣接している敵ユニットの数で決まる確率で失敗し（retreat.ts）、
 *   失敗すると捕虜になる。成功したユニットは敵から離れる向きへ下がりながら消え、失敗したユニットは下がりかけたところで止められて消える。
 *   結果は retreat のイベントで知らせ、retreated に残す（捕虜をどう扱うかは使う側が決める）。
 * - 兵数が 0 になった（殲滅された）ユニットの指揮官は、そのとき隣接している敵ユニットの数で決まる確率で捕縛される（wipeout.ts）。
 *   捕縛されなければ落ち延びる。結果は wipeout のイベントで知らせ、wipedOut に残す。
 *
 * セリフ（barks.ts。吹き出しは speechBubbles.ts）:
 * - 攻撃: カメラが寄ったところで攻撃するユニットが確率で喋り、読み終えてから攻撃する。
 *   一斉攻撃は、確率で攻撃するユニットと加わる味方の掛け合いになる（掛け合いが無ければ攻撃のつぶやき）。
 * - 迎撃: 迎撃の構えの間接ユニットが、射程に入った敵を自動で攻撃する前に喋る（構えをとったときは喋らない）。
 * - 鼓舞: 士気を回復したときに喋る。退却: 退却先の拠点を選んで退却し始めるときに喋る（読み終えてから下がる）。
 * - 殲滅: 兵数が 0 になったユニットが喋り、続いて討ち取ったユニットが確率で喋る。読み終えるまでカメラを寄せたままにする。
 *
 * メニューの「取消」で予約をすべて取り消す。
 * Esc: 移動先・攻撃の相手を選ぶのをやめる → 2 階層目を閉じる → 予約を 1 つ戻す → 選択を外す（配備フェーズでは部隊を選ぶのをやめる）。
 */
import * as THREE from 'three';
import type { Offset } from '@norden/map-runtime/core/hex';
import { Polyline, smoothPath } from '@norden/map-runtime/core/polyline';
import { DEPLOY_SIDES, HexMap, type DeploySide, type HexCell, type MapData } from '@norden/map-runtime/core/mapData';
import { TEAM_DEFS, type Facing, type TeamId, type UnitData } from '@norden/map-runtime/core/units';
import { MapView } from '@norden/map-runtime/render/mapView';
import { SceneContext } from '@norden/map-runtime/render/scene';
import type { RangeCell } from '@norden/map-runtime/render/hexOverlay';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { canAct, minAttackCost, SKILL_DEFS, type ActionId, type MenuAction, type MenuContext } from './actions';
import { BARK_CHANCE, BARK_TONE, demoBarks, EXCHANGE_CHANCE, type BarkSituation, type BarkSource, type BarkSpeaker } from './barks';
import {
  attackForecast,
  attackRange,
  attackResult,
  attackTargets,
  chargeLanding,
  COMBAT_DEFS,
  hexDistance,
  interceptorsAt,
  isAttack,
  volleySupporters,
  type AttackForecast,
  type AttackResult,
} from './combat';
import { ARROW_HIT_SEC, ARROW_RELEASE_SEC, ArrowEffects } from './arrowFx';
import { CameraFocus, type FocusTiming } from './cameraFocus';
import { randomRoll } from './damage';
import { demoTroops, Deployment, SIDE_TEAM, type DeployState, type TroopFactory } from './deployment';
import { InterceptEffects } from './interceptFx';
import { LANCE_HIT_SEC, LanceEffects } from './lanceFx';
import { applyMorale } from './morale';
import { ActionMenuModel } from './menuModel';
import { adjacentEnemies, retreatFailChance, type RetreatDestination, type RetreatDestinations, type RetreatReport } from './retreat';
import { wipeoutCaptureChance, type WipeoutReport } from './wipeout';
import { inEnemyZoc, movePath, moveRange, type MoveOptions, type MoveStep } from './movement';
import { Popups } from './popups';
import { SLASH_HIT_SEC, SlashEffects } from './slashFx';
import { SpeechBubbles } from './speechBubbles';
import { THUNDER_HIT_SEC, ThunderEffects } from './thunderFx';
import { UnitTags } from './unitTags';
import { demoStatuses, type UnitStatus } from './unitStatus';
import { judgeBattle, sideUnits, type BattleOutcome } from './victory';

/** 移動できる HEX の色と、そのうち敵の ZOC で止まる HEX の印の色 */
const MOVE_RANGE_COLOR = 0x4aa8ff;
const MOVE_ZOC_COLOR = 0xff8a3a;
/** 攻撃できる相手の HEX の色と、一斉攻撃でそのうち選べる（味方と取り囲んだ）相手の印の色 */
const ATTACK_RANGE_COLOR = 0xff4a3a;
const VOLLEY_MARK_COLOR = 0xffd060;
/** 一斉攻撃で、ほかの味方と取り囲んでいない相手を選んだときの知らせ */
const NOT_SURROUNDED = '包囲していません';
/** 移動のアニメーションの速さ（1 秒に進む HEX 数）と、最短の時間（秒） */
const WALK_HEX_PER_SEC = 3.5;
const WALK_MIN_SEC = 0.3;
/** 歩くときの上下の弾み（hexSize 比）と、1 HEX あたりの歩数 */
const WALK_BOB = 0.035;
const WALK_STEPS_PER_HEX = 2;
/** 攻撃のアニメーションの時間（秒）。半分の時点で当たる */
const STRIKE_SEC = 0.6;
/** 直接攻撃で相手へ踏み込む量（相手までの距離比） */
const STRIKE_LUNGE = 0.3;
/** 突撃で相手を突き抜けて飛び出るときのアニメーションの時間（秒）。相手を通り過ぎる時点（半分）で当たる */
const CHARGE_SEC = 0.8;
/** 当たったユニットの揺れ（hexSize 比） */
const HIT_SHAKE = 0.05;
/** 遠隔攻撃でその場で跳ねる高さ（hexSize 比） */
const RANGED_HOP = 0.05;
/** 攻撃の演出で、カメラが両者へ寄る時間、攻撃した後に寄ったままにする時間、元へ戻る時間（秒） */
const FX_ZOOM_IN_SEC = 0.45;
const FX_HOLD_SEC = 0.45;
const FX_ZOOM_OUT_SEC = 0.5;
/**
 * 攻撃の演出のときの攻撃のアニメーションの時間（秒。半分の時点で当たる）。
 * 斬撃（歩兵）、ランスで踏み込んで貫く（騎兵の通常攻撃）、ランスを構えて駆け抜ける（突撃）、矢を射て届くまで（弓兵）、
 * 雷を落とす（魔術師）
 */
const SLASH_STRIKE_SEC = 0.7;
const LANCE_STRIKE_SEC = 0.7;
const LANCE_CHARGE_SEC = 1.0;
const ARROW_STRIKE_SEC = 1.5;
const THUNDER_STRIKE_SEC = 1.0;
/** 鼓舞で回復する士気（この範囲の整数） */
const INSPIRE_MIN = 10;
const INSPIRE_MAX = 20;
/** 魔術師が雷を呼んで跳ねる時間（秒。雷が落ちる時点で終わる） */
const THUNDER_CAST_SEC = 0.35;
/** 攻撃・迎撃の前のセリフを、カメラが寄り始めてから出すまでの時間（秒） */
const BARK_BEFORE_SEC = 0.25;
/** 殲滅されたときの言葉を、当たってから出すまでの時間（秒） */
const BARK_AFTER_HIT_SEC = 0.3;
/** 退却のアニメーションの時間（秒。セリフを読み終えてから）と、その間に下がる距離（HEX 数） */
const RETREAT_SEC = 1.2;
const RETREAT_HEX = 0.6;
/** 退却に失敗したユニットが止められる時点（退却のアニメーションの 0〜1） */
const RETREAT_CAPTURE_T = 0.35;
/** 防衛拠点の HEX の地面の色 */
const STRONGHOLD_COLOR = 0xf0c030;

/**
 * 攻撃の演出の種類。slash: 光の剣で斬る（歩兵の通常攻撃）、lance: 光るランスで貫く（騎兵の通常攻撃・突撃）、
 * arrows: 光の矢の雨（弓兵の通常攻撃）、thunder: 頭上に落ちる雷（魔術師のサンダーフォール）
 */
type StrikeFxKind = 'slash' | 'lance' | 'arrows' | 'thunder';

/** 一斉攻撃で、加わるユニットごとにエフェクトをずらす時間（秒） */
const VOLLEY_FX_STAGGER_SEC = 0.06;

/** 攻撃の演出の種類ごとの、エフェクトを出してから当たるまでの時間（秒）と、当たったときのカメラの揺れ（hexSize 比） */
const STRIKE_FX: Record<StrikeFxKind, { hitSec: number; cameraShake: number }> = {
  slash: { hitSec: SLASH_HIT_SEC, cameraShake: 0.04 },
  lance: { hitSec: LANCE_HIT_SEC, cameraShake: 0.06 },
  arrows: { hitSec: ARROW_HIT_SEC, cameraShake: 0.03 },
  thunder: { hitSec: THUNDER_HIT_SEC, cameraShake: 0.08 },
};

/** 軍が行動する順（防衛側が先）。部隊のいない軍は飛ばす */
export const TURN_ORDER: readonly TeamId[] = [SIDE_TEAM.defender, SIDE_TEAM.attacker, 'green'];

/** deploy: 配備フェーズ、battle: 戦闘 */
export type BattlePhase = 'deploy' | 'battle';

/** 予約した攻撃 */
export interface PlannedAttack {
  action: MenuAction;
  target: UnitData;
  /** 何回目の移動の後に攻撃するか（legs のうち、これより前が攻撃前の移動、以降が攻撃後の移動） */
  afterLeg: number;
  /** 突撃で飛び出る HEX（突撃でない・飛び出せないなら null） */
  landing: Offset | null;
}

/** 選択中のユニットの予約 */
export interface Plan {
  unit: UnitData;
  status: UnitStatus;
  /** 予約した移動（各回の到着地。cost はそこまでに予約した行動の合計） */
  legs: MoveStep[];
  /** 予約した攻撃 */
  attack: PlannedAttack | null;
}

/** 決定で実行した結果 */
export interface ExecuteReport {
  unit: UnitData;
  from: Offset;
  /** 移動で使った行動力（移動しなければ 0） */
  moveCost: number;
  /** 使った行動力の合計 */
  cost: number;
  attack?: PlannedAttack & {
    result: AttackResult;
    targetDestroyed: boolean;
    unitDestroyed: boolean;
    /** 攻撃の後の兵数（自分・相手） */
    unitLeft: number;
    targetLeft: number;
  };
  /** 移動の途中で受けた、迎撃の構えの間接ユニットからの自動攻撃（受けた順） */
  intercepts: InterceptReport[];
  /** 迎撃の自動攻撃で壊滅したか（そこで実行を打ち切る） */
  lost: boolean;
  /** 弓兵の迎撃で足止めされたか（そこで移動をやめ、残りの予約を捨てて行動を終える） */
  halted: boolean;
  /** 迎撃の構えをとったか（迎撃コマンド） */
  intercept: boolean;
  /** 待機して行動を終えたか（待機コマンド） */
  wait: boolean;
  /** 鼓舞で回復した士気（鼓舞しなかったら無い） */
  inspire?: number;
  /** 退却の結果（退却しなかったら無い） */
  retreat?: RetreatReport;
  /** 殲滅されたユニット（自分・相手。指揮官が捕縛されたか） */
  wipeouts: WipeoutReport[];
}

/**
 * 予約を実行した後にすること。confirm: なし（決定）、intercept: 迎撃の構えをとる、wait: 待機して行動を終える、
 * inspire: 鼓舞する、retreat: 退却する（予約の無いターンの初めだけ）
 */
type ExecuteEnd = 'confirm' | 'intercept' | 'wait' | 'inspire' | 'retreat';

/** 迎撃の自動攻撃 1 回分 */
export interface InterceptReport {
  /** 攻撃した（迎撃の構えの）ユニット */
  unit: UnitData;
  result: AttackResult;
  /** 攻撃を受けた後の、移動していたユニットの兵数 */
  targetLeft: number;
  /** 予約した攻撃の後の移動で受けたか */
  afterAttack: boolean;
  /** この迎撃で足止めされたか（同じ HEX で続けて撃たれたときは最後の 1 回） */
  halted: boolean;
}

/** BattleApp が知らせること（on で受け取る）。値は受け取る関数の引数 */
export interface BattleEvents {
  /** マップを読み込んだとき */
  load: [];
  /** 配備フェーズ・戦闘が始まったとき */
  phase: [phase: BattlePhase];
  /** 配備の様子が変わったとき（配備する陣営が変わった・部隊を置いた・選んだ） */
  deploy: [state: DeployState];
  /** カーソルの HEX が変わったとき */
  hover: [cell: HexCell | null];
  /** 行動メニューで行動を選んだとき（決定・取消を除く） */
  action: [unit: UnitData, action: MenuAction];
  /** 予約が増えた・減ったとき */
  planChange: [plan: Plan];
  /** 移動先・攻撃の相手を選ぶ状態をやめたとき */
  targetCancel: [];
  /** 選べない攻撃の相手を選んだとき（選び直しになる） */
  targetReject: [reason: string];
  /** ユニットを選択した・相手方のユニットを調べたとき（外したときは null） */
  select: [unit: UnitData | null];
  /** 行動する軍が変わったとき（戦闘が始まったときも） */
  turn: [turn: number, team: TeamId];
  /** 決定で予約を実行し終えたとき（退却も。そのときは retreat の後） */
  execute: [report: ExecuteReport];
  /** ユニットが退却した・退却に失敗して捕虜になったとき（ユニットはもうマップにいない） */
  retreat: [report: RetreatReport];
  /** ユニットが殲滅されたとき（ユニットはもうマップにいない。指揮官が捕縛されたかは report.captured） */
  wipeout: [report: WipeoutReport];
  /** 戦闘が決着したとき（execute の後） */
  end: [outcome: BattleOutcome];
  /** ユニットがセリフを言うと決まったとき（掛け合いの 2 行目からなど、吹き出しを出すのは遅れることがある） */
  bark: [unit: UnitData, situation: BarkSituation | 'exchange', text: string];
}

/** マップのユニットに戦闘中の状態を配る（既定は表示確認用の仮の値） */
export type StatusFactory = (units: readonly UnitData[]) => Map<UnitData, UnitStatus>;

/** 移動先・攻撃の相手を選んでいる状態 */
type Targeting =
  | { kind: 'move'; cells: Map<number, MoveStep> }
  | { kind: 'attack'; action: MenuAction; cells: Map<number, UnitData> };

/**
 * 実行の 1 段階。
 * - walk: path に沿って歩く。commit なら着いた HEX へ移動を確定する（迎撃で止まった途中の HEX では確定しない）
 * - strike: 予約した攻撃をする
 * - intercept: shooter（迎撃の構えの間接ユニット）が、at まで歩いてきたユニットを攻撃する。
 *   route はこの移動で at まで通ってきた HEX（足止めされて味方のいる HEX から戻るときに使う）
 * - retreat: 退却する。away は下がる向き（ワールドの xz の単位ベクトル）、lead はセリフを読み終えて下がり始めるまでの秒数
 */
type Phase =
  | { kind: 'walk'; path: Offset[]; commit: boolean }
  | { kind: 'strike' }
  | { kind: 'intercept'; shooter: UnitData; at: Offset; route: Offset[] }
  | { kind: 'retreat'; away: { x: number; z: number }; lead: number };

/** 決定した予約の実行（アニメーション）。phases を順に進める */
interface Execution {
  plan: Plan;
  report: ExecuteReport;
  /** 予約を実行した後にすること */
  end: ExecuteEnd;
  /** これから行う段階 */
  phases: Phase[];
  phase: Phase;
  start: number;
  /** 秒 */
  duration: number;
  line: Polyline | null;
  facing: Facing | undefined;
  /** 攻撃が当たった（兵数を減らした）か */
  hit: boolean;
  /** 一斉攻撃で一緒に攻撃する味方（strike の段階を始めるときに決める） */
  supporters: UnitData[];
  /** strike の段階の演出（カメラを寄せる）。演出の無い攻撃は null */
  fx: StrikeFx | null;
}

/** 実行中の攻撃の演出 */
interface StrikeFx {
  /** 攻撃するユニット（迎撃では迎撃したユニット）の演出の種類 */
  kind: StrikeFxKind;
  /** 攻撃のアニメーションの時間（秒。カメラが寄る・戻る時間を除く） */
  strikeSec: number;
  /** カメラが寄り始めてから攻撃のアニメーションを始めるまでの時間（秒）。前のセリフがあれば読み終えるまで延ばす */
  lead: number;
  /** エフェクトを出すユニットごとの演出（先頭が攻撃するユニット。一斉攻撃は加わる味方の分も続く） */
  shots: FxShot[];
}

interface FxShot {
  unit: UnitData;
  kind: StrikeFxKind;
  /** 当たりの時点に対するずれ（秒） */
  offset: number;
  /** エフェクトを出したか */
  spawned: boolean;
}

export class BattleApp {
  readonly ctx: SceneContext;
  readonly view: MapView;
  /** ユニットの頭上の情報札（顔・兵士数・士気） */
  readonly tags: UnitTags;
  /** 選択中のユニットの行動メニュー（中身と位置。描画は ui/ActionMenu.tsx） */
  readonly menu = new ActionMenuModel();
  /** 兵数の減少などを頭上に出す */
  readonly popups: Popups;
  /** 迎撃の構えのユニットの足元の光の輪 */
  readonly interceptFx = new InterceptEffects();
  /** 光の剣の斬撃（歩兵の通常攻撃） */
  readonly slashFx = new SlashEffects();
  /** 光るランスの突き（騎兵の通常攻撃・突撃） */
  readonly lanceFx = new LanceEffects();
  /** 光の矢の雨（弓兵の通常攻撃） */
  readonly arrowFx = new ArrowEffects();
  /** 頭上に落ちる雷（魔術師のサンダーフォール） */
  readonly thunderFx = new ThunderEffects();
  /** 攻撃の演出でカメラを寄せる */
  readonly cameraFocus: CameraFocus;
  /** セリフの吹き出し */
  readonly bubbles: SpeechBubbles;
  /** 何を喋るか（ゲームでは会話データから引くものを渡す） */
  barks: BarkSource = demoBarks;
  /** 確率に関係なく、喋る場面では必ず喋る（表示確認用） */
  alwaysBark = false;
  /** 戦闘中のユニットの状態 */
  statuses = new Map<UnitData, UnitStatus>();
  /** 選択中のユニットの HEX */
  selected: Offset | null = null;
  hovered: Offset | null = null;
  /** 選択中のユニットの予約（選択していなければ null） */
  plan: Plan | null = null;
  /** 調べている相手方のユニット（動ける範囲・攻撃できる範囲を出している。いなければ null） */
  inspected: UnitData | null = null;
  /** いまの番の軍の、行動済み（もう移動・攻撃・迎撃のどれもできない）ユニット */
  readonly done = new Set<UnitData>();
  /** 何ターン目か（1 から。全軍が 1 回ずつ行動したら進む） */
  turn = 1;
  /** いま行動している軍 */
  activeTeam: TeamId = TURN_ORDER[0];
  /** 配備フェーズの間の配備（戦闘が始まったら null） */
  deployment: Deployment | null = null;
  /** 軍ごとの退却先の拠点（無い軍は退却できない） */
  retreats: RetreatDestinations = {};
  /** この戦闘で退却した・退却に失敗して捕虜になったユニット（順に。マップを読み込むと空にする） */
  readonly retreated: RetreatReport[] = [];
  /** この戦闘で殲滅されたユニット（順に。マップを読み込むと空にする） */
  readonly wipedOut: WipeoutReport[] = [];
  /** 配備したユニットの部隊の ID（戦闘が始まったときに配備から写す） */
  private troopIds = new Map<UnitData, string>();
  /** 防衛拠点の HEX（マップの stronghold。無ければ入城では決着しない） */
  stronghold: Offset | null = null;
  /** 戦闘の決着（まだなら null） */
  outcome: BattleOutcome | null = null;
  /** 全滅で負けにする陣営（戦闘が始まったときに部隊のいた陣営） */
  private judged = new Set<DeploySide>();

  private readonly listeners = new Map<keyof BattleEvents, Set<(...args: never[]) => void>>();
  private readonly container: HTMLElement;
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || this.exec || this.outcome) return;
    if (this.deployment) this.pickTroop(null);
    else if (this.targeting) this.cancelTargeting();
    else if (this.menu.closeRetreat()) this.emit('targetCancel');
    else if (this.menu.closeSub()) return;
    else if (this.plan && BattleApp.planned(this.plan)) this.undo();
    else this.setSelected(null);
  };
  private targeting: Targeting | null = null;
  private exec: Execution | null = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private pointerDirty = false;
  private downPos: { x: number; y: number } | null = null;

  /** container にキャンバス・情報札・頭上の数字を置く（行動メニューやウィンドウは置かない。ui/BattleScreen.tsx） */
  constructor(container: HTMLElement) {
    this.container = container;
    this.ctx = new SceneContext(container);
    this.view = new MapView(this.ctx);
    this.tags = new UnitTags(container);
    this.popups = new Popups(container);
    this.bubbles = new SpeechBubbles(container);
    this.cameraFocus = new CameraFocus(this.ctx);
    this.ctx.overlay.add(this.interceptFx.group, this.slashFx.group, this.lanceFx.group, this.arrowFx.group, this.thunderFx.group);
    this.menu.onAction = (unit, action) => {
      if (action.id === 'confirm') return this.execute('confirm');
      if (action.id === 'intercept') return this.execute('intercept');
      if (action.id === 'wait') return this.execute('wait');
      if (action.id === 'skill:inspire') return this.execute('inspire');
      if (action.id === 'cancel') return this.clearPlan();
      if (action.id === 'retreat') this.openRetreat(unit);
      else if (action.id === 'move') this.startMove();
      else if (isAttack(action.id)) this.startAttack(action);
      this.emit('action', unit, action);
    };
    this.menu.onRetreat = (_unit, to) => this.execute('retreat', to);
    const el = this.ctx.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.setPointer(e));
    el.addEventListener('pointerleave', () => this.setHover(null));
    el.addEventListener('pointerdown', (e) => {
      this.downPos = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !this.downPos) return;
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      this.downPos = null;
      if (moved > 4 || this.exec) return; // ドラッグ（パン）・実行中はクリック扱いしない
      this.setPointer(e);
      this.click(this.pick());
    });
    window.addEventListener('keydown', this.onKeyDown);
    this.ctx.renderer.setAnimationLoop(() => this.frame());
  }

  /** type のことを fn で受け取る。戻り値で受け取るのをやめる */
  on<K extends keyof BattleEvents>(type: K, fn: (...args: BattleEvents[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    const f = fn as (...args: never[]) => void;
    set.add(f);
    return () => set.delete(f);
  }

  private emit<K extends keyof BattleEvents>(type: K, ...args: BattleEvents[K]): void {
    for (const fn of this.listeners.get(type) ?? []) (fn as (...args: BattleEvents[K]) => void)(...args);
  }

  /** 描画を止め、キャンバス・情報札などを取り除いて GPU の資源を手放す（画面を離れるとき） */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.ctx.renderer.setAnimationLoop(null);
    this.listeners.clear();
    this.exec = null;
    this.menu.open(null);
    this.popups.dispose();
    this.bubbles.dispose();
    this.tags.dispose();
    this.interceptFx.dispose();
    this.view.dispose();
    this.ctx.dispose();
  }

  get map(): HexMap | null {
    return this.view.map;
  }

  /**
   * マップを読み込む。マップに置いてあるユニットの戦闘中の状態は makeStatuses で配る。
   * 初期配置地点（deploy）があれば、makeTroops で配った部隊を置く配備フェーズから始める
   */
  loadMap(data: MapData, makeStatuses: StatusFactory = demoStatuses, makeTroops: TroopFactory = demoTroops): void {
    const map = new HexMap(data);
    this.exec = null;
    this.popups.clear();
    this.bubbles.clear();
    this.slashFx.clear();
    this.lanceFx.clear();
    this.arrowFx.clear();
    this.thunderFx.clear();
    this.cameraFocus.stop();
    this.statuses = makeStatuses(map.allUnits());
    this.retreated.length = 0;
    this.wipedOut.length = 0;
    this.troopIds = new Map();
    this.outcome = null;
    this.judged = new Set();
    this.stronghold = data.stronghold ?? null;
    const troops = data.deploy ? makeTroops(data.deploy) : [];
    this.deployment = data.deploy ? new Deployment(map, data.deploy, troops, this.statuses) : null;
    if (!this.deployment?.side) this.deployment = null;
    this.tags.setStatuses(this.statuses);
    this.view.setMap(map);
    this.paintStronghold();
    this.setSelected(null);
    this.turn = 1;
    this.activeTeam = TURN_ORDER[0];
    this.emit('load');
    if (this.deployment) {
      this.emit('phase', 'deploy');
      this.deployChanged();
    } else {
      this.startBattle();
    }
  }

  /** 部隊のウィンドウに出すユニット（カーソルの下 → 選択中 → 調べている相手方の順。どれも無ければ null） */
  infoUnit(): UnitData | null {
    const map = this.map;
    const hovered = this.hovered && map?.unitAt(this.hovered.col, this.hovered.row);
    return hovered ?? this.plan?.unit ?? this.inspected;
  }

  /** 配備の様子（配備フェーズでなければ null） */
  get deployState(): DeployState | null {
    return this.deployment?.state() ?? null;
  }

  /** 配備フェーズで部隊を選ぶ（null・選んでいる部隊で選ぶのをやめる） */
  pickTroop(id: string | null): void {
    this.deployment?.pick(id);
    this.deployChanged();
  }

  /** 配備フェーズで、配備した部隊を外す */
  unplaceTroop(id: string): void {
    this.deployment?.unplace(id);
    this.deployChanged();
  }

  /** 配備フェーズで、未配備の部隊を空いている配置地点へ順に置く */
  autoDeploy(): void {
    this.deployment?.auto();
    this.deployChanged();
  }

  /** 配備を終えて次の陣営の配備へ進む。最後の陣営なら戦闘を始める。進めたら true（1 部隊も置いていなければ false） */
  finishDeploy(): boolean {
    const d = this.deployment;
    if (!d?.finish()) return false;
    if (d.side) this.deployChanged();
    else this.startBattle();
    return true;
  }

  /** 配備した部隊を描き直し、配置地点を塗って、選んでいる部隊を強調する */
  private deployChanged(): void {
    const d = this.deployment;
    const state = d?.state();
    if (!d || !state) return;
    this.tags.setStatuses(this.statuses);
    this.view.rebuildUnits();
    this.view.setRange(d.slots(), TEAM_DEFS[state.team].color);
    this.view.setFocus(d.pickedAt());
    this.refreshMarks();
    this.emit('deploy', state);
  }

  /** 配備を終えて戦闘を始める（最初の軍の番にする） */
  private startBattle(): void {
    if (this.deployment) this.troopIds = this.deployment.troopIds();
    this.deployment = null;
    this.view.setRange(null);
    this.setSelected(null);
    this.turn = 1;
    this.judged = new Set(DEPLOY_SIDES.filter((side) => sideUnits(this.map!, side).length > 0));
    this.activeTeam = this.nextTeam(null);
    this.refreshTeam(this.activeTeam);
    this.refreshMarks();
    this.emit('phase', 'battle');
    this.emit('turn', this.turn, this.activeTeam);
  }

  /**
   * いまの軍の番を終えて次の軍の番にする。選択と予約を捨て、次の軍の全ユニットの行動力を最大まで戻して
   * 移動済み・攻撃済みを消す。全軍が 1 回ずつ行動したらターンの数を進める（実行中・配備フェーズは何もしない）
   */
  endTurn(): boolean {
    if (this.exec || !this.map || this.deployment || this.outcome) return false;
    this.setSelected(null);
    // 番を終えると、その軍のユニットは行動を終える（防衛拠点にいれば入城）
    this.judge(this.map.allUnits().filter((u) => u.team === this.activeTeam));
    if (this.outcome) return false;
    const next = this.nextTeam(this.activeTeam);
    if (TURN_ORDER.indexOf(next) <= TURN_ORDER.indexOf(this.activeTeam)) this.turn++;
    this.activeTeam = next;
    this.refreshTeam(next);
    this.refreshMarks();
    this.emit('turn', this.turn, this.activeTeam);
    return true;
  }

  /** TURN_ORDER で after の次の、部隊のいる軍（after = null なら最初の軍。どの軍にも部隊がいなければ after のまま） */
  private nextTeam(after: TeamId | null): TeamId {
    const teams = new Set(this.map?.allUnits().map((u) => u.team));
    const start = after === null ? -1 : TURN_ORDER.indexOf(after);
    for (let i = 1; i <= TURN_ORDER.length; i++) {
      const team = TURN_ORDER[(start + i) % TURN_ORDER.length];
      if (teams.has(team)) return team;
    }
    return after ?? TURN_ORDER[0];
  }

  /**
   * 行動済みのユニット（done）を数え直して絵の右上に E の印を付け、行動済みのユニットと相手方のユニット
   * （配備フェーズでは配備していない陣営のユニット）の絵を暗くする（情報札は暗くしない）
   */
  private refreshMarks(): void {
    const map = this.map;
    const team = this.deployState?.team ?? this.activeTeam;
    this.done.clear();
    if (map && !this.deployment) {
      for (const [unit, status] of this.statuses) {
        if (unit.team !== team) continue;
        if (!canAct(this.menuContext({ unit, status, legs: [], attack: null }))) this.done.add(unit);
      }
    }
    this.view.units.setDimmed((u) => u.team !== team || this.done.has(u));
    this.tags.setMarks(this.done);
  }

  /** team の全ユニットの行動力を最大まで戻し、移動済み・攻撃済みを消す（番の初め） */
  private refreshTeam(team: TeamId): void {
    for (const [unit, status] of this.statuses) {
      if (unit.team !== team) continue;
      status.ap = status.maxAp;
      status.moved = false;
      status.attacked = false;
      status.justAttacked = false;
    }
  }

  /** 移動先を選ぶ状態のとき、o へ移動するときの最短経路（移動できなければ null） */
  moveStepAt(o: Offset | null): MoveStep | null {
    if (!o || this.targeting?.kind !== 'move' || !this.map) return null;
    return this.targeting.cells.get(o.row * this.map.layout.cols + o.col) ?? null;
  }

  /**
   * 攻撃の相手を選ぶ状態のとき、o のユニットを攻撃したときの結果の予測（攻撃できなければ null）。
   * 範囲内でも選べない相手（一斉攻撃で取り囲んでいない）なら、その理由
   */
  attackPreviewAt(o: Offset | null): AttackForecast | { rejected: string } | null {
    const map = this.map;
    const plan = this.plan;
    if (!o || this.targeting?.kind !== 'attack' || !map || !plan) return null;
    const target = this.targeting.cells.get(o.row * map.layout.cols + o.col);
    const ts = target && this.statuses.get(target);
    if (!target || !ts) return null;
    const reason = this.rejectReason(this.targeting.action, target);
    if (reason) return { rejected: reason };
    const attacker = { unit: plan.unit, status: plan.status, pos: BattleApp.planPos(plan) };
    return attackForecast(map, attacker, { unit: target, status: ts, pos: target }, this.targeting.action.id);
  }

  /** action で target を攻撃できない理由（できれば null）。一斉攻撃は、ほかの味方とも隣接している相手しか選べない */
  private rejectReason(action: MenuAction, target: UnitData): string | null {
    if (action.id !== 'volley') return null;
    return volleySupporters(this.map!, this.plan!.unit, target).length > 0 ? null : NOT_SURROUNDED;
  }

  static planned(plan: Plan): boolean {
    return plan.legs.length > 0 || !!plan.attack;
  }

  /** 攻撃が予約の最後か（攻撃の後の移動が無いか） */
  static attackIsLast(plan: Plan): boolean {
    return !!plan.attack && plan.attack.afterLeg === plan.legs.length;
  }

  /** 予約した行動（移動・攻撃）で使う行動力。移動の cost はそれまでの予約を含む合計なので、最後の予約から求まる */
  static planCost(plan: Plan): number {
    return (plan.legs.at(-1)?.cost ?? 0) + (BattleApp.attackIsLast(plan) ? (plan.attack!.action.cost ?? 0) : 0);
  }

  /** 予約した移動で使う行動力 */
  static moveCost(plan: Plan): number {
    return BattleApp.planCost(plan) - (plan.attack?.action.cost ?? 0);
  }

  /** ターンの初めか（まだ移動も攻撃もしておらず、予約も無い） */
  static turnStart(plan: Plan): boolean {
    return !plan.status.moved && !plan.status.attacked && !BattleApp.planned(plan);
  }

  /**
   * 続きの移動を探すときの条件。ターンの初めは敵の ZOC から動き出せる。
   * 騎兵（moveAfterAttack）は攻撃の直後（予約した攻撃の後、または実行した攻撃の後にまだ移動していない）も動き出せる（一撃離脱）。
   */
  static moveOptions(plan: Plan): MoveOptions {
    const afterAttack =
      !!COMBAT_DEFS[plan.unit.type].moveAfterAttack && (BattleApp.attackIsLast(plan) || (plan.status.justAttacked && !BattleApp.planned(plan)));
    return { spent: BattleApp.planCost(plan), escapeZoc: BattleApp.turnStart(plan) || afterAttack };
  }

  /** 攻撃する HEX（攻撃の前の移動の先） */
  static attackPos(plan: Plan): Offset {
    const i = plan.attack?.afterLeg ?? plan.legs.length;
    return i > 0 ? plan.legs[i - 1] : plan.unit;
  }

  /** 予約した行動の後にいる HEX（最後の移動先、突撃で飛び出る先。予約が無ければユニットのいる HEX） */
  static planPos(plan: Plan): Offset {
    if (BattleApp.attackIsLast(plan) && plan.attack!.landing) return plan.attack!.landing;
    return plan.legs.at(-1) ?? plan.unit;
  }

  private click(o: Offset | null): void {
    if (this.outcome) return;
    if (this.deployment) {
      this.deployment.click(o);
      return this.deployChanged();
    }
    const map = this.map;
    // 選べるのは、いま行動している軍のユニットだけ
    const unit = (o && map?.unitAt(o.col, o.row)) || null;
    const own = unit?.team === this.activeTeam ? unit : null;
    const isSelf = !!unit && unit === this.plan?.unit;
    const t = this.targeting;
    if (t && map) {
      const key = o ? o.row * map.layout.cols + o.col : -1;
      if (t.kind === 'move' && t.cells.has(key)) this.addLeg(t.cells.get(key)!);
      else if (t.kind === 'attack' && t.cells.has(key)) {
        const target = t.cells.get(key)!;
        const reason = this.rejectReason(t.action, target);
        if (reason) this.emit('targetReject', reason);
        else this.setAttack(t.action, target);
      }
      // ほかの味方は選び直し、それ以外（範囲外・自分・敵）はメニューに戻る
      else if (own && !isSelf) this.setSelected(o);
      else this.cancelTargeting();
      return;
    }
    // 選択中のユニットをもう一度クリックしたときはそのまま（予約を捨てない）
    if (isSelf) return;
    // 味方のいる HEX ならそのユニットを選択し、相手方なら動ける範囲・攻撃できる範囲を出す。ユニットのいない HEX なら選択を外す
    if (unit && !own) return this.inspect(unit);
    this.setSelected(own ? o : null);
  }

  /** 相手方のユニットを調べる（選択を外し、そのユニットを強調して、動ける範囲・攻撃できる範囲を出す）。もう一度で外す */
  private inspect(unit: UnitData): void {
    const again = this.inspected === unit;
    this.setSelected(null);
    if (again) return;
    this.inspected = unit;
    this.view.setFocus(unit);
    this.view.setRange(this.threatRange(unit), MOVE_RANGE_COLOR, MOVE_ZOC_COLOR, ATTACK_RANGE_COLOR);
    this.emit('select', unit);
  }

  /**
   * unit が次の番に（最大の行動力で）動ける HEX と、そこから攻撃できる HEX。
   * 動ける HEX は青（敵の ZOC で止まる HEX は印付き）、その外の攻撃できる HEX は赤（alt）。
   * 攻撃は、動いた後に残る行動力でいちばん軽い攻撃ができる HEX からだけ数える
   */
  private threatRange(unit: UnitData): RangeCell[] {
    const map = this.map!;
    const status = this.statuses.get(unit);
    if (!status) return [];
    const cols = map.layout.cols;
    const ap = status.maxAp;
    const moves = moveRange(map, unit, unit, ap, { escapeZoc: true });
    const out = new Map<number, RangeCell>();
    for (const [k, step] of moves) out.set(k, { col: step.col, row: step.row, mark: step.zoc });
    const cost = minAttackCost(unit.type);
    if (cost === null) return [...out.values()];
    const self = unit.row * cols + unit.col;
    const froms = [{ pos: unit as Offset, spent: 0 }, ...[...moves.values()].map((step) => ({ pos: step as Offset, spent: step.cost }))];
    for (const { pos, spent } of froms) {
      if (ap - spent < cost) continue;
      for (const o of attackRange(map, unit, pos)) {
        const k = o.row * cols + o.col;
        if (k !== self && !out.has(k)) out.set(k, { ...o, alt: true });
      }
    }
    return [...out.values()];
  }

  /** unit の軍の退却先の拠点 */
  retreatDestinations(unit: UnitData): readonly RetreatDestination[] {
    return this.retreats[unit.team] ?? [];
  }

  /** 行動メニューに退却先の拠点の一覧と、退却に失敗する確率を出す */
  private openRetreat(unit: UnitData): void {
    const destinations = this.retreatDestinations(unit);
    if (!this.map || destinations.length === 0) return;
    const enemies = adjacentEnemies(this.map, unit).length;
    this.menu.openRetreat({ destinations, enemies, failChance: retreatFailChance(enemies) });
  }

  /** 移動できる HEX を出して、移動先を選ぶ状態にする */
  private startMove(): void {
    const map = this.map;
    const plan = this.plan;
    if (!map || !plan) return;
    const cells = moveRange(map, plan.unit, BattleApp.planPos(plan), plan.status.ap, BattleApp.moveOptions(plan));
    this.targeting = { kind: 'move', cells };
    const range = [...cells.values()].map((s) => ({ col: s.col, row: s.row, mark: s.zoc }));
    this.view.setRange(range, MOVE_RANGE_COLOR, MOVE_ZOC_COLOR);
    this.menu.suspended = true;
    this.setHover(this.hovered);
  }

  /** 攻撃できる相手の HEX を出して、相手を選ぶ状態にする */
  private startAttack(action: MenuAction): void {
    const map = this.map;
    const plan = this.plan;
    if (!map || !plan) return;
    const cols = map.layout.cols;
    const pos = BattleApp.planPos(plan);
    const cells = new Map(attackTargets(map, plan.unit, pos).map((u) => [u.row * cols + u.col, u]));
    this.targeting = { kind: 'attack', action, cells };
    // 射程内の HEX を薄く塗り、相手のいる HEX は濃く塗る。一斉攻撃は、選べる（ほかの味方と取り囲んだ）相手に印を付ける
    const range = attackRange(map, plan.unit, pos).map((o) => {
      const u = cells.get(o.row * cols + o.col);
      return u ? { ...o, mark: action.id === 'volley' && !this.rejectReason(action, u) } : { ...o, weak: true };
    });
    this.view.setRange(range, ATTACK_RANGE_COLOR, VOLLEY_MARK_COLOR);
    this.menu.suspended = true;
    this.setHover(this.hovered);
  }

  /** 移動先・攻撃の相手を選ぶ状態をやめてメニューに戻る */
  private cancelTargeting(): void {
    if (!this.targeting) return;
    this.endTargeting();
    this.emit('targetCancel');
  }

  private endTargeting(): void {
    this.targeting = null;
    this.view.setRange(null);
    this.menu.suspended = false;
    this.setHover(this.hovered);
  }

  /** 移動を 1 回分予約して、移動先でメニューを開き直す */
  private addLeg(step: MoveStep): void {
    this.plan!.legs.push(step);
    this.endTargeting();
    this.planChanged();
  }

  /** 攻撃を予約する */
  private setAttack(action: MenuAction, target: UnitData): void {
    const plan = this.plan!;
    const pos = BattleApp.planPos(plan);
    const landing = action.id === 'charge' ? chargeLanding(this.map!, pos, target) : null;
    plan.attack = { action, target, afterLeg: plan.legs.length, landing };
    this.endTargeting();
    this.planChanged();
  }

  /** 予約をすべて取り消す（ユニットのいる HEX でメニューを開き直す） */
  private clearPlan(): void {
    this.plan!.legs = [];
    this.plan!.attack = null;
    this.planChanged();
  }

  /** 最後の予約を取り消す */
  private undo(): void {
    const plan = this.plan!;
    if (BattleApp.attackIsLast(plan)) plan.attack = null;
    else plan.legs.pop();
    this.planChanged();
  }

  private planChanged(): void {
    const plan = this.plan!;
    // 攻撃の前と後の移動は別の矢印にする（突撃の後は飛び出た先から歩き出すので、1 本につなぐと相手を横切ってしまう）
    const split = plan.attack?.afterLeg ?? plan.legs.length;
    const path = (legs: MoveStep[]) => (legs.length > 0 ? movePath(legs) : null);
    this.view.setPath(path(plan.legs.slice(0, split)), path(plan.legs.slice(split)));
    this.showAttackArrow(plan);
    this.openMenu();
    this.emit('planChange', plan);
  }

  /** 攻撃の矢印。一斉攻撃は、加わる味方からも細い矢印を出す */
  private showAttackArrow(plan: Plan | null): void {
    if (!plan?.attack) {
      this.view.setSupportAttacks([], null);
      return this.view.setAttack(null, null);
    }
    const { action, target, landing } = plan.attack;
    this.view.setAttack(BattleApp.attackPos(plan), target, COMBAT_DEFS[plan.unit.type].ranged, landing);
    this.view.setSupportAttacks(action.id === 'volley' ? volleySupporters(this.map!, plan.unit, target) : [], target);
  }

  /**
   * 予約を実行する。攻撃の前の移動 → 攻撃 → 攻撃の後の移動（騎兵）の順に進め、最後に end のこと（迎撃の構え・待機・鼓舞）をする。
   * 決定（confirm）は予約が無ければ何もしない。迎撃は攻撃を予約していないときだけ選べる。
   * 退却（retreat）は予約の無いターンの初めだけで、to へ退却する（成否はここで決める）。
   */
  private execute(end: ExecuteEnd, to?: RetreatDestination): void {
    const map = this.map;
    const plan = this.plan;
    if (!map || !plan || (end === 'confirm' && !BattleApp.planned(plan))) return;
    if (end === 'retreat' && (!to || !BattleApp.turnStart(plan) || plan.status.ap < plan.status.maxAp)) return;
    const report: ExecuteReport = {
      unit: plan.unit,
      from: { col: plan.unit.col, row: plan.unit.row },
      moveCost: BattleApp.moveCost(plan),
      cost: BattleApp.planCost(plan) + (end === 'inspire' ? SKILL_DEFS.inspire.cost : 0),
      intercepts: [],
      wipeouts: [],
      lost: false,
      halted: false,
      intercept: end === 'intercept',
      wait: end === 'wait',
    };
    // 行動したら迎撃の構えは解ける
    plan.status.intercepting = false;
    const split = plan.attack?.afterLeg ?? plan.legs.length;
    const walk = (legs: MoveStep[]): Phase => ({ kind: 'walk', path: legs.length > 0 ? movePath(legs) : [], commit: true });
    const phases: Phase[] = [walk(plan.legs.slice(0, split)), ...(plan.attack ? [{ kind: 'strike' as const }, walk(plan.legs.slice(split))] : [])];
    if (end === 'retreat' && to) {
      const enemies = adjacentEnemies(map, plan.unit).length;
      const failChance = retreatFailChance(enemies);
      report.retreat = {
        unit: plan.unit,
        troopId: this.troopIds.get(plan.unit) ?? null,
        status: plan.status,
        turn: this.turn,
        to,
        enemies,
        failChance,
        captured: Math.random() < failChance,
      };
      phases.splice(0, phases.length, { kind: 'retreat', away: this.awayFromEnemies(plan.unit), lead: 0 });
      // 去っていくユニットに選択の光を残さない
      this.view.setFocus(null);
    }
    this.menu.open(null);
    this.exec = { plan, report, end, phases, phase: phases[0], start: 0, duration: 0, line: null, facing: undefined, hit: false, supporters: [], fx: null };
    this.nextPhase();
  }

  /**
   * 実行の次の段階へ進む（歩かない移動は確定だけして飛ばす）。段階が無くなったら終える。
   * 移動は、迎撃の構えの間接ユニットの射程に入る HEX があれば、そこで区切って迎撃の段階を挟む。
   */
  private nextPhase(): void {
    const exec = this.exec!;
    const map = this.map!;
    let phase = exec.phases.shift();
    while (phase?.kind === 'walk' && phase.path.length < 2) {
      if (phase.commit && phase.path.length > 0) this.commitWalk(exec, phase.path[0]);
      phase = exec.phases.shift();
    }
    if (!phase) {
      this.exec = null;
      return this.finish(exec.plan, exec.report, exec.end);
    }
    exec.start = performance.now();
    exec.hit = false;
    exec.fx = null;
    if (phase.kind === 'retreat') {
      // 退却のセリフを読み終えてから下がる
      exec.phase = phase;
      phase.lead = this.bark('retreat', exec.plan.unit, null);
      exec.duration = phase.lead + RETREAT_SEC;
      return;
    }
    if (phase.kind !== 'walk') {
      exec.phase = phase;
      const attack = exec.plan.attack;
      exec.supporters = phase.kind === 'strike' && attack?.action.id === 'volley' ? volleySupporters(map, exec.plan.unit, attack.target) : [];
      const kind = phase.kind === 'strike' ? BattleApp.strikeFx(exec.plan.unit, attack!.action.id) : BattleApp.interceptFx(phase.shooter);
      // 攻撃・迎撃の前のセリフ（演出のある攻撃は、カメラが寄ったまま読み終えるのを待ってから攻撃する）
      const talk = phase.kind === 'strike' ? this.strikeTalk(exec) : this.bark('intercept', phase.shooter, exec.plan.unit, BARK_BEFORE_SEC);
      if (kind) {
        const strikeSec = { slash: SLASH_STRIKE_SEC, lance: attack?.landing ? LANCE_CHARGE_SEC : LANCE_STRIKE_SEC, arrows: ARROW_STRIKE_SEC, thunder: THUNDER_STRIKE_SEC }[kind];
        // 一斉攻撃は、加わる味方もそれぞれの兵種の演出を、当たりの時点を中心に少しずつずらして出す
        const units = phase.kind === 'strike' ? [exec.plan.unit, ...exec.supporters] : [phase.shooter];
        const shots = units.flatMap((unit, i): FxShot[] => {
          const k = i === 0 ? kind : BattleApp.strikeFx(unit, 'volley');
          return k ? [{ unit, kind: k, offset: (i - (units.length - 1) / 2) * VOLLEY_FX_STAGGER_SEC, spawned: false }] : [];
        });
        const lead = Math.max(FX_ZOOM_IN_SEC, talk);
        exec.fx = { kind, strikeSec, shots, lead };
        exec.duration = lead + strikeSec + FX_HOLD_SEC + FX_ZOOM_OUT_SEC;
        const timing = { in: FX_ZOOM_IN_SEC, hold: lead - FX_ZOOM_IN_SEC + strikeSec + FX_HOLD_SEC, out: FX_ZOOM_OUT_SEC };
        if (phase.kind === 'strike') this.focusOn([exec.plan.unit, attack!.target, ...exec.supporters], attack!.landing, timing);
        else this.focusOn([phase.shooter, exec.plan.unit], null, timing);
      } else {
        exec.duration = phase.kind === 'strike' && attack!.landing ? CHARGE_SEC : STRIKE_SEC;
      }
      return;
    }
    const { path } = phase;
    for (let i = 1; i < path.length; i++) {
      const shooters = interceptorsAt(map, this.statuses, exec.plan.unit, path[i]);
      if (shooters.length === 0) continue;
      exec.phases.unshift(
        ...shooters.map((shooter): Phase => ({ kind: 'intercept', shooter, at: path[i], route: path.slice(0, i + 1) })),
        { kind: 'walk', path: path.slice(i), commit: phase.commit },
      );
      phase = { kind: 'walk', path: path.slice(0, i + 1), commit: false };
      break;
    }
    exec.phase = phase;
    exec.line = new Polyline(smoothPath(phase.path.map((o) => map.layout.offsetToWorld(o.col, o.row))));
    const hexStep = map.layout.size * Math.sqrt(3);
    exec.duration = Math.max(exec.line.length / hexStep / WALK_HEX_PER_SEC, WALK_MIN_SEC);
    exec.facing = undefined;
  }

  /** 移動のアニメーションを進める。着いたら移動を確定して次の段階へ */
  private stepWalk(exec: Execution, phase: Extract<Phase, { kind: 'walk' }>, now: number): void {
    const map = this.map!;
    const s = map.layout.size;
    const line = exec.line!;
    const t = Math.min((now - exec.start) / 1000 / exec.duration, 1);
    // 歩き出しと止まるところだけゆっくり
    const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    const d = line.length * (0.35 * e + 0.65 * t);
    const p = line.at(d);
    // 向きは左右に動いているときだけ変える（真上・真下へ進むときはそのまま）
    if (p.tx > 0.2) exec.facing = 'right';
    else if (p.tx < -0.2) exec.facing = 'left';
    const steps = (d / (s * Math.sqrt(3))) * WALK_STEPS_PER_HEX;
    const bob = Math.abs(Math.sin(steps * Math.PI)) * WALK_BOB * s * Math.min(1, (1 - t) * 8);
    const foot = new THREE.Vector3(p.x, this.view.groundAt(p.x, p.z) + bob, p.z);
    this.view.units.moveTo(exec.plan.unit, foot, exec.facing);
    if (t < 1) return;

    if (phase.commit) this.commitWalk(exec, phase.path[phase.path.length - 1]);
    this.nextPhase();
  }

  /** 移動を確定する（ユニットを to へ動かす） */
  private commitWalk(exec: Execution, to: Offset): void {
    const { plan } = exec;
    if (this.map!.moveUnit(plan.unit, to.col, to.row)) {
      plan.status.moved = true;
      plan.status.justAttacked = false;
    }
    this.view.rebuildUnits();
  }

  /**
   * 迎撃のアニメーションを進める。迎撃したユニットはその場で跳ね、半分の時点で当てて兵数を減らす。
   * 弓兵・魔術師の迎撃は攻撃と同じ演出（カメラを寄せて光の矢を降らせる・雷を落とす）
   */
  private stepIntercept(exec: Execution, phase: Extract<Phase, { kind: 'intercept' }>, now: number): void {
    const map = this.map!;
    const s = map.layout.size;
    const elapsed = (now - exec.start) / 1000;
    const fx = exec.fx;
    const t = BattleApp.strikeT(exec, elapsed);
    const a = map.layout.offsetToWorld(phase.shooter.col, phase.shooter.row);
    const b = map.layout.offsetToWorld(phase.at.col, phase.at.row);
    const facing: Facing = b.x >= a.x ? 'right' : 'left';
    const hop = (fx ? fxMotion(fx, t) : strikeCurve(t)) * RANGED_HOP * s;
    this.view.units.moveTo(phase.shooter, new THREE.Vector3(a.x, this.view.groundAt(a.x, a.z) + hop, a.z), facing);
    if (fx) this.spawnFxOnTime(fx, elapsed, exec.plan.unit, phase.at);
    if (t >= 0.5 && !exec.hit) {
      exec.hit = true;
      this.applyIntercept(exec, phase);
      if (fx) this.fxShake(fx);
      if (exec.report.lost) this.holdForTalk(exec, this.lossTalk([[exec.plan.unit, phase.shooter]]));
    }
    if (exec.hit) {
      const shake = Math.sin(t * 60) * HIT_SHAKE * s * (1 - t) * 2;
      this.view.units.moveTo(exec.plan.unit, new THREE.Vector3(b.x + shake, this.view.groundAt(b.x, b.z), b.z));
    }
    if (elapsed < exec.duration) return;
    // 壊滅したらそこで打ち切る。弓兵に撃たれたら（騎兵を除く）そこで足止め
    if (exec.report.lost) exec.phases = [];
    else if (COMBAT_DEFS[phase.shooter.type].interceptHalts && !COMBAT_DEFS[exec.plan.unit.type].unhaltable) this.halt(exec, phase);
    this.nextPhase();
  }

  /**
   * 迎撃で足止めする。同じ HEX で続けて撃つ迎撃だけを残して、残りの移動・攻撃を捨て、止まった HEX へ移動を確定する。
   * 止まった HEX に味方がいるときは、通ってきた道を空いている HEX まで戻る。
   */
  private halt(exec: Execution, phase: Extract<Phase, { kind: 'intercept' }>): void {
    const map = this.map!;
    const unit = exec.plan.unit;
    exec.report.halted = true;
    // 足止めは最後に撃った迎撃の記録に付ける
    for (const r of exec.report.intercepts) r.halted = false;
    exec.report.intercepts.at(-1)!.halted = true;
    const rest: Phase[] = [];
    for (const p of exec.phases) {
      if (p.kind !== 'intercept' || p.at.col !== phase.at.col || p.at.row !== phase.at.row) break;
      rest.push(p);
    }
    const { route } = phase;
    let j = route.length - 1;
    while (j >= 0) {
      const other = map.unitAt(route[j].col, route[j].row);
      if (!other || other === unit) break;
      j--;
    }
    // 通ってきた道がすべて味方で埋まっていたら（前の迎撃で止まった HEX から歩き出したときなど）、確定している HEX まで戻る
    const back = j >= 0 ? route.slice(j).reverse() : [...route].reverse().concat({ col: unit.col, row: unit.row });
    exec.phases = [...rest, { kind: 'walk', path: back, commit: true }];
  }

  /** 迎撃の自動攻撃（ランダム係数を振る）を兵数・士気に反映し、迎撃の構えを解く */
  private applyIntercept(exec: Execution, phase: Extract<Phase, { kind: 'intercept' }>): void {
    const { plan, report } = exec;
    const ss = this.statuses.get(phase.shooter)!;
    const result = attackResult(
      this.map!,
      { unit: phase.shooter, status: ss, pos: phase.shooter },
      { unit: plan.unit, status: plan.status, pos: phase.at },
      'interceptFire',
      { damage: randomRoll(), counter: 0 },
    );
    plan.status.soldiers -= result.damage;
    applyMorale(plan.status, result.morale.defender);
    applyMorale(ss, result.morale.attacker);
    ss.intercepting = false;
    report.lost = plan.status.soldiers <= 0;
    report.intercepts.push({ unit: phase.shooter, result, targetLeft: Math.max(0, plan.status.soldiers), afterAttack: !!report.attack, halted: false });
    // 移動していたユニットは、撃たれた HEX（at）で殲滅される
    const w = report.lost ? this.wipeOut(report, plan.unit, plan.status, phase.at, phase.shooter, []) : null;
    const p = this.view.units.placements().find((x) => x.unit === plan.unit);
    if (p) this.popups.show(p, `迎撃 -${result.damage}${wipeoutLabel(w)}`, 'damage');
  }

  /**
   * 退却のアニメーションを進める。セリフを読み終えたら敵から離れる向きへ歩いて下がりながら消える。
   * 退却に失敗したユニットは、下がりかけたところ（RETREAT_CAPTURE_T）で止められて揺れ、最後に消える
   */
  private stepRetreat(exec: Execution, phase: Extract<Phase, { kind: 'retreat' }>, now: number): void {
    const map = this.map!;
    const s = map.layout.size;
    const unit = exec.plan.unit;
    const { captured } = exec.report.retreat!;
    const elapsed = (now - exec.start) / 1000;
    const t = THREE.MathUtils.clamp((elapsed - phase.lead) / RETREAT_SEC, 0, 1);
    const stop = captured ? RETREAT_CAPTURE_T : 1;
    const k = Math.min(t, stop);
    const hexes = k * RETREAT_HEX;
    const d = hexes * s * Math.sqrt(3);
    const a = map.layout.offsetToWorld(unit.col, unit.row);
    const bob = t < stop ? Math.abs(Math.sin(hexes * WALK_STEPS_PER_HEX * Math.PI)) * WALK_BOB * s : 0;
    const shake = captured && t >= stop ? Math.sin(t * 60) * HIT_SHAKE * s * Math.max(0, 1 - (t - stop) / 0.3) : 0;
    const x = a.x + phase.away.x * d + shake;
    const z = a.z + phase.away.z * d;
    const facing: Facing | undefined = elapsed < phase.lead ? undefined : phase.away.x >= 0 ? 'right' : 'left';
    this.view.units.moveTo(unit, new THREE.Vector3(x, this.view.groundAt(x, z) + bob, z), facing);
    // 成功したら下がり始めてから、失敗したら止められてから消えていく
    const fadeFrom = captured ? 0.7 : 0.3;
    this.view.units.setOpacity(unit, t <= fadeFrom ? 1 : 1 - THREE.MathUtils.smoothstep(t, fadeFrom, 1));
    if (elapsed >= phase.lead && t >= (captured ? stop : 0) && !exec.hit) {
      exec.hit = true;
      const p = this.view.units.placements().find((x) => x.unit === unit);
      if (p) this.popups.show(p, captured ? '退却失敗 捕縛' : '退却', captured ? 'captured' : 'retreat');
    }
    if (elapsed < exec.duration) return;
    this.nextPhase();
  }

  /** unit が敵から離れる向き（近い敵ほど重く見る。ワールドの xz の単位ベクトル。敵がいなければ右） */
  private awayFromEnemies(unit: UnitData): { x: number; z: number } {
    const layout = this.map!.layout;
    const enemies = this.map!.allUnits().filter((u) => u.team !== unit.team);
    const a = layout.offsetToWorld(unit.col, unit.row);
    let x = 0;
    let z = 0;
    for (const e of enemies) {
      const b = layout.offsetToWorld(e.col, e.row);
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      // 向きを距離の 2 乗で割る（遠い敵ほど効かない）
      const w = 1 / Math.max(dx * dx + dz * dz, 1e-6);
      x += dx * w;
      z += dz * w;
    }
    const len = Math.hypot(x, z);
    return len > 1e-6 ? { x: x / len, z: z / len } : { x: 1, z: 0 };
  }

  /** 予約した攻撃の演出の種類（演出の無い攻撃は null） */
  static strikeFx(unit: UnitData, action: ActionId): StrikeFxKind | null {
    // 一斉攻撃は、加わる兵種それぞれの通常攻撃の演出
    const id = action === 'volley' ? 'attack' : action;
    if (unit.type === 'infantry' && id === 'attack') return 'slash';
    if (unit.type === 'cavalry' && (id === 'attack' || id === 'charge')) return 'lance';
    if (unit.type === 'archer' && id === 'attack') return 'arrows';
    if (unit.type === 'mage' && id === 'thunderfall') return 'thunder';
    return null;
  }

  /** 迎撃の自動攻撃の演出の種類（演出の無い兵種は null）。それぞれの兵種の攻撃と同じ演出（弓兵は矢の雨、魔術師は雷） */
  static interceptFx(shooter: UnitData): StrikeFxKind | null {
    if (shooter.type === 'archer') return 'arrows';
    if (shooter.type === 'mage') return 'thunder';
    return null;
  }

  /** 攻撃・迎撃のアニメーションの進み具合（0〜1。半分の時点で当たる）。演出のある攻撃はカメラが寄る時間（とセリフを待つ時間）を除く */
  private static strikeT(exec: Execution, elapsed: number): number {
    const fx = exec.fx;
    return fx ? THREE.MathUtils.clamp((elapsed - fx.lead) / fx.strikeSec, 0, 1) : Math.min(elapsed / exec.duration, 1);
  }

  /** 演出のエフェクトを、それぞれ当たりの時点（からずらした時点）に合わせて出す（まだ出していなければ）。target は at にいる */
  private spawnFxOnTime(fx: StrikeFx, elapsed: number, target: UnitData, at: Offset): void {
    const layout = this.map!.layout;
    const time = (elapsed - fx.lead) / fx.strikeSec;
    const b = layout.offsetToWorld(at.col, at.row);
    for (const shot of fx.shots) {
      if (shot.spawned || time < 0.5 + (shot.offset - STRIKE_FX[shot.kind].hitSec) / fx.strikeSec) continue;
      shot.spawned = true;
      const a = layout.offsetToWorld(shot.unit.col, shot.unit.row);
      this.spawnStrikeFx(shot.kind, shot.unit, target, b.x >= a.x ? 'right' : 'left');
    }
  }

  /** 演出で当たったときのカメラの揺れ（一斉攻撃は加わるユニットの演出のうち一番大きいもの） */
  private fxShake(fx: StrikeFx): void {
    this.cameraFocus.shake(Math.max(...fx.shots.map((shot) => STRIKE_FX[shot.kind].cameraShake)) * this.map!.layout.size);
  }

  /**
   * 攻撃の演出で、units（先頭が攻撃するユニット）の絵が画面に収まるところまでカメラを寄せる。
   * landing（突撃で飛び出る先）があれば、そこに置いた攻撃するユニットの絵も収める
   */
  private focusOn(units: readonly UnitData[], landing: Offset | null, timing: FocusTiming): void {
    const map = this.map!;
    const placements = this.view.units.placements().filter((p) => units.includes(p.unit));
    const self = placements.find((p) => p.unit === units[0]);
    if (landing && self) {
      const c = map.layout.offsetToWorld(landing.col, landing.row);
      placements.push({ ...self, foot: new THREE.Vector3(c.x, this.view.groundAt(c.x, c.z), c.z) });
    }
    this.cameraFocus.play(placements, timing);
  }

  /** 攻撃の演出のエフェクトを出す */
  private spawnStrikeFx(kind: StrikeFxKind, unit: UnitData, target: UnitData, facing: Facing): void {
    const placements = this.view.units.placements();
    const up = placements.find((p) => p.unit === unit);
    const tp = placements.find((p) => p.unit === target);
    if (!tp) return;
    if (kind === 'slash') this.slashFx.spawn(tp, facing);
    else if (kind === 'thunder') this.thunderFx.spawn(tp);
    else if (up && kind === 'lance') this.lanceFx.spawn(up, tp, this.ctx.camera);
    else if (up) this.arrowFx.spawn(up, tp, this.ctx.camera);
  }

  /**
   * 攻撃のアニメーションを進める。直接攻撃は相手へ踏み込み、半分の時点で当てて兵数を減らす。
   * 突撃で飛び出せるときは、相手を突き抜けて向こうの HEX まで駆け抜け、着いたらそこへ移動を確定する。
   * 演出のある攻撃では、カメラが寄るのを待ってから攻撃し（踏み込みは、踏み込んだまま当てて戻る。弓兵は矢を放つ間に跳ねる）、
   * カメラが戻るのを待つ。エフェクトは、斬撃の刃が相手の中心を通る・ランスが相手を貫く・矢の大半が届く時点が当たりの時点になるように出す。
   */
  private stepStrike(exec: Execution, now: number): void {
    const map = this.map!;
    const s = map.layout.size;
    const { plan } = exec;
    const attack = plan.attack!;
    const elapsed = (now - exec.start) / 1000;
    const fx = exec.fx;
    const t = BattleApp.strikeT(exec, elapsed);
    const a = map.layout.offsetToWorld(plan.unit.col, plan.unit.row);
    const b = map.layout.offsetToWorld(attack.target.col, attack.target.row);
    const facing: Facing = b.x >= a.x ? 'right' : 'left';
    const landing = attack.landing;
    if (landing) {
      // 相手（中間点）を通り過ぎて向こうの HEX まで。出だしと止まるところだけゆっくり
      const c = map.layout.offsetToWorld(landing.col, landing.row);
      const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      const x = a.x + (c.x - a.x) * e;
      const z = a.z + (c.z - a.z) * e;
      this.view.units.moveTo(plan.unit, new THREE.Vector3(x, this.view.groundAt(x, z), z), facing);
    } else {
      const k = fx ? fxMotion(fx, t) : strikeCurve(t);
      this.lunge(plan.unit, attack.target, k);
    }
    // 一斉攻撃は、取り囲んでいる味方も一緒に踏み込む
    for (const u of exec.supporters) this.lunge(u, attack.target, fx ? holdCurve(t) : strikeCurve(t));

    if (fx) this.spawnFxOnTime(fx, elapsed, attack.target, attack.target);
    if (t >= 0.5 && !exec.hit) {
      exec.hit = true;
      this.applyAttack(exec);
      if (fx) this.fxShake(fx);
      const r = exec.report.attack!;
      const losses: [UnitData, UnitData][] = [];
      if (r.targetDestroyed) losses.push([attack.target, plan.unit]);
      if (r.unitDestroyed) losses.push([plan.unit, attack.target]);
      this.holdForTalk(exec, this.lossTalk(losses));
    }
    if (exec.hit) {
      // 当たった相手を揺らす
      const shake = Math.sin(t * 60) * HIT_SHAKE * s * (1 - t) * 2;
      this.view.units.moveTo(attack.target, new THREE.Vector3(b.x + shake, this.view.groundAt(b.x, b.z), b.z));
    }
    if (elapsed < exec.duration) return;
    // 攻撃で壊滅したら飛び出し・続きの移動はしない
    if (exec.report.attack?.unitDestroyed) exec.phases = [];
    else if (landing && map.moveUnit(plan.unit, landing.col, landing.row)) plan.status.moved = true;
    this.view.rebuildUnits();
    this.nextPhase();
  }

  /** unit が target を攻撃する動き。直接攻撃は相手へ踏み込む。遠隔攻撃はその場で小さく跳ねる（k は踏み込み・跳ねる量の 0〜1） */
  private lunge(unit: UnitData, target: Offset, k: number): void {
    const map = this.map!;
    const a = map.layout.offsetToWorld(unit.col, unit.row);
    const b = map.layout.offsetToWorld(target.col, target.row);
    const ranged = COMBAT_DEFS[unit.type].ranged;
    const lunge = ranged ? 0 : k * STRIKE_LUNGE;
    const x = a.x + (b.x - a.x) * lunge;
    const z = a.z + (b.z - a.z) * lunge;
    const hop = ranged ? k * RANGED_HOP * map.layout.size : 0;
    this.view.units.moveTo(unit, new THREE.Vector3(x, this.view.groundAt(x, z) + hop, z), b.x >= a.x ? 'right' : 'left');
  }

  /**
   * unit が pos で by に殲滅された。そのとき隣接している敵ユニット（exclude の同時に殲滅されたものを除く）の数で、
   * 指揮官が捕縛されるかを決めて report に記録する
   */
  private wipeOut(report: ExecuteReport, unit: UnitData, status: UnitStatus, pos: Offset, by: UnitData, exclude: readonly UnitData[]): WipeoutReport {
    const enemies = adjacentEnemies(this.map!, unit, pos).filter((u) => !exclude.includes(u)).length;
    const captureChance = wipeoutCaptureChance(enemies);
    const w: WipeoutReport = {
      unit,
      troopId: this.troopIds.get(unit) ?? null,
      status,
      turn: this.turn,
      by,
      enemies,
      captureChance,
      captured: Math.random() < captureChance,
    };
    report.wipeouts.push(w);
    return w;
  }

  /** 攻撃の結果（ランダム係数を振る）を兵数・士気に反映し、頭上に減った数を出す */
  private applyAttack(exec: Execution): void {
    const map = this.map!;
    const { plan, report } = exec;
    const attack = plan.attack!;
    const ts = this.statuses.get(attack.target)!;
    const rolls = { damage: randomRoll(), counter: randomRoll() };
    const result = attackResult(
      map,
      { unit: plan.unit, status: plan.status, pos: plan.unit },
      { unit: attack.target, status: ts, pos: attack.target },
      attack.action.id,
      rolls,
    );
    ts.soldiers -= result.damage;
    plan.status.soldiers -= result.counter;
    applyMorale(ts, result.morale.defender);
    applyMorale(plan.status, result.morale.attacker);
    plan.status.attacked = true;
    plan.status.justAttacked = true;
    report.attack = {
      ...attack,
      result,
      targetDestroyed: ts.soldiers <= 0,
      unitDestroyed: plan.status.soldiers <= 0,
      unitLeft: Math.max(0, plan.status.soldiers),
      targetLeft: Math.max(0, ts.soldiers),
    };

    // 殲滅されたユニットの指揮官の捕縛（相討ちなら、相手は隣接する敵に数えない）
    const both = report.attack.targetDestroyed && report.attack.unitDestroyed;
    const tw = report.attack.targetDestroyed ? this.wipeOut(report, attack.target, ts, attack.target, plan.unit, both ? [plan.unit] : []) : null;
    const uw = report.attack.unitDestroyed ? this.wipeOut(report, plan.unit, plan.status, plan.unit, attack.target, both ? [attack.target] : []) : null;

    const placements = this.view.units.placements();
    const at = (u: UnitData) => placements.find((p) => p.unit === u);
    const tp = at(attack.target);
    const up = at(plan.unit);
    const label = result.supporters > 0 ? `一斉 -${result.damage}` : `-${result.damage}`;
    if (tp) this.popups.show(tp, `${label}${wipeoutLabel(tw)}`, 'damage');
    // 突撃は当たる時点で相手と重なっているので、反撃の数字は駆け抜ける絵に付いていかせて、相手の数字から離す
    const counterText = `-${result.counter}${wipeoutLabel(uw)}`;
    if (up && result.direct) this.popups.show(up, counterText, 'counter', !!attack.landing);
  }

  /**
   * 実行を終える。行動力を使い、end のこと（迎撃の構え・待機・鼓舞）をして、兵数が 0 になったユニットを消し、
   * 生き残っていれば選び直す
   */
  private finish(plan: Plan, report: ExecuteReport, end: ExecuteEnd): void {
    const map = this.map!;
    const lost = report.lost || !!report.attack?.unitDestroyed;
    // 壊滅したか、退却して戦場からいなくなったか
    const gone = lost || !!report.retreat;
    plan.status.ap -= report.cost;
    // 待機したら、残りの行動力を捨てて行動を終える
    if (end === 'wait') plan.status.ap = 0;
    // 鼓舞: 自分の士気を回復する（壊滅・足止めされたらしない）
    if (end === 'inspire' && !lost && !report.halted) {
      const before = plan.status.morale;
      applyMorale(plan.status, INSPIRE_MIN + Math.floor(Math.random() * (INSPIRE_MAX - INSPIRE_MIN + 1)));
      report.inspire = plan.status.morale - before;
      const p = this.view.units.placements().find((x) => x.unit === plan.unit);
      if (p) this.popups.show(p, `鼓舞 士気+${report.inspire}`, 'boost');
      this.bark('rally', plan.unit, null);
    }
    // 迎撃の構えをとったら、残りの行動力に関わらず行動を終える
    if (report.intercept && !lost && !report.halted) {
      plan.status.intercepting = true;
      plan.status.ap = 0;
    }
    // 弓兵の迎撃で足止めされたら行動を終える
    if (report.halted) plan.status.ap = 0;
    const removed = [report.attack?.targetDestroyed && report.attack.target, gone && report.unit];
    for (const u of removed) {
      if (!u) continue;
      map.removeUnit(u.col, u.row);
      this.statuses.delete(u);
    }
    if (removed.some(Boolean)) this.tags.setStatuses(this.statuses);
    this.view.rebuildUnits();
    // 動いた先で選び直す（残りの行動力でメニューを開く）
    this.setSelected(gone ? null : { col: report.unit.col, row: report.unit.row });
    this.refreshMarks();
    if (report.retreat) {
      this.retreated.push(report.retreat);
      this.emit('retreat', report.retreat);
    }
    for (const w of report.wipeouts) {
      this.wipedOut.push(w);
      this.emit('wipeout', w);
    }
    this.emit('execute', report);
    // もう行動できなくなった（行動済みの印が付いた）ら、そのユニットは行動を終えた
    this.judge(!gone && this.done.has(report.unit) ? [report.unit] : []);
  }

  /**
   * 決着したか調べ、決着していたら戦闘を終える（選択を外し、行動済みの印を消して end で知らせる）。
   * ended はいま行動を終えたユニット（防衛拠点にいる攻撃側のユニットなら入城）
   */
  private judge(ended: readonly UnitData[] = []): void {
    const map = this.map;
    if (!map || this.deployment || this.outcome) return;
    const outcome = judgeBattle(map, this.stronghold, ended, this.judged, this.turn);
    if (!outcome) return;
    this.outcome = outcome;
    this.setSelected(null);
    this.done.clear();
    this.view.units.setDimmed(() => false);
    this.tags.setMarks(this.done);
    this.emit('end', outcome);
  }

  /** 防衛拠点の HEX の地面を塗る */
  private paintStronghold(): void {
    const hold = this.stronghold;
    const color = new THREE.Color(STRONGHOLD_COLOR);
    this.view.overlay.setCellColors((col, row) => (hold && hold.col === col && hold.row === row ? color : null));
  }

  /**
   * unit が situation のセリフを（BARK_CHANCE の確率で）delay 秒後に言う。other は相手（吹き出しを反対の側に出す）。
   * 言うなら読み終えるまでの秒数、言わなければ 0
   */
  private bark(situation: BarkSituation, unit: UnitData, other: UnitData | null, delay = 0): number {
    const speaker = this.speaker(unit);
    if (!speaker || (!this.alwaysBark && Math.random() >= BARK_CHANCE[situation])) return 0;
    const text = this.barks.line(situation, speaker, other && this.speaker(other));
    if (!text) return 0;
    this.emit('bark', unit, situation, text);
    return this.bubbles.say(unit, speaker.status, text, { delay, tone: BARK_TONE[situation], away: other });
  }

  /**
   * 一斉攻撃の掛け合い（EXCHANGE_CHANCE の確率）。members の先頭が攻撃するユニット、続いて加わる味方。
   * 1 行ずつ、前の行を読み終えてから出す。起きたら最後の行を読み終えるまでの秒数、起きなければ 0
   */
  private exchange(members: readonly UnitData[], target: UnitData, delay = 0): number {
    const speakers = members.map((u) => this.speaker(u));
    const ts = this.speaker(target);
    if (!ts || speakers.some((s) => !s) || (!this.alwaysBark && Math.random() >= EXCHANGE_CHANCE)) return 0;
    const lines = this.barks.exchange(speakers as BarkSpeaker[], ts);
    if (!lines?.length) return 0;
    let at = delay;
    for (const { who, text } of lines) {
      const s = speakers[who];
      if (!s) continue;
      this.emit('bark', s.unit, 'exchange', text);
      at = this.bubbles.say(s.unit, s.status, text, { delay: at, tone: BARK_TONE.exchange, away: target });
    }
    return at;
  }

  private speaker(unit: UnitData): BarkSpeaker | null {
    const status = this.statuses.get(unit);
    return status ? { unit, status } : null;
  }

  /** 攻撃の前のセリフ。一斉攻撃は確率で掛け合い、それ以外（掛け合いが起きなければ）は確率で攻撃のつぶやき。読み終えるまでの秒数 */
  private strikeTalk(exec: Execution): number {
    const { unit, attack } = exec.plan;
    if (!attack) return 0;
    const talk = exec.supporters.length > 0 ? this.exchange([unit, ...exec.supporters], attack.target, BARK_BEFORE_SEC) : 0;
    return talk || this.bark('attack', unit, attack.target, BARK_BEFORE_SEC);
  }

  /**
   * 殲滅されたユニットの言葉と、続いて討ち取ったユニットの言葉（討ち取った側も殲滅されたら言わない）。
   * losses は [殲滅されたユニット, 討ち取ったユニット]。読み終えるまでの秒数（誰も言わなければ 0）
   */
  private lossTalk(losses: readonly [lost: UnitData, by: UnitData][]): number {
    const lost = new Set(losses.map(([u]) => u));
    let end = 0;
    for (const [u, by] of losses) {
      const t = this.bark('wiped_out', u, by, BARK_AFTER_HIT_SEC);
      end = Math.max(end, t);
      if (!lost.has(by)) end = Math.max(end, this.bark('enemy_eliminated', by, u, Math.max(t, BARK_AFTER_HIT_SEC)));
    }
    return end;
  }

  /** 当たった後のセリフを talk 秒後に読み終えるまで、カメラを寄せたままにして実行の段階を延ばす */
  private holdForTalk(exec: Execution, talk: number): void {
    if (talk <= 0) return;
    const fx = exec.fx;
    const elapsed = (performance.now() - exec.start) / 1000;
    // カメラが戻り始める時点（演出の無い攻撃は段階の終わり）
    const holdEnd = fx ? fx.lead + fx.strikeSec + FX_HOLD_SEC : exec.duration;
    const extra = elapsed + talk - holdEnd;
    if (extra <= 0) return;
    exec.duration += extra;
    if (fx) this.cameraFocus.extendHold(extra);
  }

  /**
   * 表示確認用: 選択中か調べているユニットに situation のセリフを言わせる（確率に関係なく）。
   * 相手はいちばん近い敵、掛け合いはいちばん近い味方 2 部隊と。言わせるユニットがいない・実行中なら false
   */
  testBark(situation: BarkSituation | 'exchange'): boolean {
    const map = this.map;
    const unit = this.plan?.unit ?? this.inspected;
    if (!map || !unit || this.exec) return false;
    const near = (team: (u: UnitData) => boolean) =>
      map
        .allUnits()
        .filter((u) => u !== unit && team(u))
        .sort((a, b) => hexDistance(map, unit, a) - hexDistance(map, unit, b));
    const enemy = near((u) => u.team !== unit.team)[0] ?? null;
    const always = this.alwaysBark;
    this.alwaysBark = true;
    try {
      if (situation !== 'exchange') return this.bark(situation, unit, situation === 'rally' || situation === 'retreat' ? null : enemy) > 0;
      const allies = near((u) => u.team === unit.team).slice(0, 2);
      return !!enemy && this.exchange([unit, ...allies], enemy) > 0;
    } finally {
      this.alwaysBark = always;
    }
  }

  private openMenu(): void {
    this.menu.open(this.map && this.plan ? this.menuContext(this.plan) : null);
  }

  /** 予約 plan の後の行動メニューの状況 */
  private menuContext(plan: Plan): MenuContext {
    const map = this.map!;
    const pos = BattleApp.planPos(plan);
    const options = BattleApp.moveOptions(plan);
    const targets = attackTargets(map, plan.unit, pos);
    return {
      unit: plan.unit,
      status: plan.status,
      ap: plan.status.ap - BattleApp.planCost(plan),
      canMove: moveRange(map, plan.unit, pos, plan.status.ap, options).size > 0,
      zocLocked: inEnemyZoc(map, plan.unit, pos) && !options.escapeZoc,
      turnStart: BattleApp.turnStart(plan),
      canRetreat: this.retreatDestinations(plan.unit).length > 0,
      planned: BattleApp.planned(plan),
      attackPlanned: !!plan.attack,
      canMoveAfterAttack: !!COMBAT_DEFS[plan.unit.type].moveAfterAttack,
      hasTargets: targets.length > 0,
      hasVolleyTargets: targets.some((t) => volleySupporters(map, plan.unit, t).length > 0),
    };
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.pointerDirty = true;
  }

  private pick(): Offset | null {
    this.raycaster.setFromCamera(this.pointer, this.ctx.camera);
    return this.view.pick(this.raycaster);
  }

  private setHover(o: Offset | null): void {
    this.hovered = o;
    this.view.setHover(o);
    this.emit('hover', this.cellAndUnit(o)[0]);
  }

  /** ユニットを選択する（予約は捨てる） */
  private setSelected(o: Offset | null): void {
    if (this.targeting) this.endTargeting();
    if (this.inspected) {
      this.inspected = null;
      this.view.setRange(null);
    }
    this.selected = o;
    this.view.setFocus(o);
    this.view.setPath(null);
    this.showAttackArrow(null);
    const unit = this.cellAndUnit(o)[1];
    const status = unit && this.statuses.get(unit);
    this.plan = unit && status ? { unit, status, legs: [], attack: null } : null;
    this.openMenu();
    this.emit('select', this.plan?.unit ?? null);
  }

  private cellAndUnit(o: Offset | null): [HexCell | null, UnitData | null] {
    const map = this.map;
    if (!o || !map) return [null, null];
    return [map.get(o.col, o.row) ?? null, map.unitAt(o.col, o.row) ?? null];
  }

  /** メニューを置く位置。移動・突撃を予約していれば、ユニットの絵を予約した行動の後にいる HEX に置いたときの位置 */
  private menuAnchor(placements: readonly UnitPlacement[]): UnitPlacement | null {
    const plan = this.plan;
    const map = this.map;
    const p = plan && placements.find((x) => x.unit === plan.unit);
    if (!plan || !map || !p) return p ?? null;
    const pos = BattleApp.planPos(plan);
    if (pos.col === plan.unit.col && pos.row === plan.unit.row) return p;
    const c = map.layout.offsetToWorld(pos.col, pos.row);
    return { ...p, foot: new THREE.Vector3(c.x, this.view.groundAt(c.x, c.z), c.z) };
  }

  private frame(): void {
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.setHover(this.pick());
    }
    const exec = this.exec;
    if (exec?.phase.kind === 'walk') this.stepWalk(exec, exec.phase, performance.now());
    else if (exec?.phase.kind === 'strike') this.stepStrike(exec, performance.now());
    else if (exec?.phase.kind === 'intercept') this.stepIntercept(exec, exec.phase, performance.now());
    else if (exec?.phase.kind === 'retreat') this.stepRetreat(exec, exec.phase, performance.now());
    // 攻撃の演出の間は、移動のルートと攻撃の矢印を隠す（演出が終われば、残りのルートをまた出す）
    const v = this.view;
    const arrowsShown = !this.exec?.fx;
    for (const arrow of [v.pathArrow, v.afterPathArrow, v.attackArrow, v.supportArrow]) arrow.group.visible = arrowsShown;
    this.cameraFocus.update(performance.now());
    this.slashFx.update(this.ctx.camera);
    this.lanceFx.update(this.ctx.camera);
    this.arrowFx.update(this.ctx.camera);
    this.thunderFx.update(this.ctx.camera);
    // 輪は描画の前に足元へ合わせる（移動のアニメーションで動かした絵に同じフレームで付いていく）
    this.interceptFx.update(this.view.units.placements(), this.statuses, this.map?.layout.size ?? 1, this.view.display.units);
    this.view.render();
    const placements = this.view.units.placements();
    this.tags.update(placements, this.ctx.camera, this.view.display.units, this.hovered, this.selected);
    this.menu.update(this.menuAnchor(placements), this.ctx.camera, this.container.clientWidth, this.container.clientHeight);
    this.popups.update(this.ctx.camera);
    this.bubbles.update(placements, this.ctx.camera, this.view.display.units);
  }
}

/** 頭上の数字に付ける殲滅の印（殲滅されていなければ空。指揮官が捕縛されたら「捕縛」も） */
function wipeoutLabel(w: WipeoutReport | null): string {
  return w ? (w.captured ? ' 壊滅 捕縛' : ' 壊滅') : '';
}

/** 攻撃の踏み込み・跳ねる量（t は攻撃のアニメーションの 0〜1）。前半で踏み込んで戻る */
function strikeCurve(t: number): number {
  return Math.sin(Math.min(t * 2, 1) * Math.PI);
}

/** 演出のある攻撃の踏み込みの量（t は 0〜1）。素早く踏み込み、踏み込んだまま当てて（半分の時点）、ゆっくり戻る */
function holdCurve(t: number): number {
  if (t < 0.3) return 1 - (1 - t / 0.3) ** 2;
  if (t < 0.65) return 1;
  const u = (t - 0.65) / 0.35;
  return 1 - u * u * (3 - 2 * u);
}

/**
 * 演出のある攻撃の、攻撃するユニットの踏み込み・跳ねる量（t は攻撃のアニメーションの 0〜1）。
 * 直接攻撃は踏み込んだまま当てて戻る。弓兵は矢を放ち始めてから放ち終えるまで、魔術師は雷を呼んでから落ちるまでに 1 回跳ねる
 */
function fxMotion(fx: StrikeFx, t: number): number {
  if (fx.kind === 'arrows') return hopCurve(t, fx.strikeSec, ARROW_HIT_SEC, ARROW_RELEASE_SEC);
  if (fx.kind === 'thunder') return hopCurve(t, fx.strikeSec, THUNDER_CAST_SEC, THUNDER_CAST_SEC);
  return holdCurve(t);
}

/** 当たりの時点（t = 0.5）の beforeHit 秒前から duration 秒の間に 1 回跳ねる量（strikeSec は攻撃のアニメーションの時間） */
function hopCurve(t: number, strikeSec: number, beforeHit: number, duration: number): number {
  const u = (t - 0.5 + beforeHit / strikeSec) / (duration / strikeSec);
  return u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0;
}
