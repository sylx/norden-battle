/**
 * 戦闘画面。マップの描画は map-editor と同じ MapView を使い、パラメータは map-editor の初期値のまま。
 * 戦闘の UI・演出はここに積み上げていく。
 *
 * 行動は予約してから「決定」でまとめて実行する:
 * ユニットを選択 → 行動メニュー → 移動 → 移動先を選ぶ → 移動先でメニュー → … → 攻撃 → 相手を選ぶ → 決定。
 * - 移動は何回かに分けて予約でき、予約したルートは地面に矢印で出す。
 * - 攻撃は 1 ターンに 1 回で、予約した移動先から射程内の敵を選ぶ（射程内の HEX を薄い赤、相手のいる HEX を濃い赤で塗る）。相手へ赤い矢印を出す（遠隔攻撃は放物線。ライフル兵は直線）。
 *   一斉攻撃は、ほかの味方とも隣接している敵（金の斜線）しか選べない。ほかの敵を選ぶと「包囲していません」でやり直し。
 *   相手に隣接している味方からも細い赤い矢印を出し、実行するとその味方も一緒に踏み込んで攻撃する。
 *   攻撃を予約した後は移動できない。騎兵だけは攻撃の後にも移動を予約できる（一撃離脱。攻撃の直後は敵の ZOC の中からでも
 *   動き出せるが、ZOC から ZOC へは移れない）。
 * - 突撃（騎兵）は相手を突き抜けて向こうの HEX へ飛び出る。飛び出る先は予約のときに決め、矢印もそこまで伸ばす。
 * - 決定でユニットがルートに沿って歩き、攻撃し、（騎兵なら）続きを歩く（その間は操作を受け付けない）。
 *   攻撃の演出: カメラが両者へ寄り（cameraFocus.ts）、攻撃して、カメラが元へ戻る。
 *   歩兵の通常攻撃は踏み込んで光の剣で斬る（attackFx/slashFx.ts）。騎兵の通常攻撃・突撃は光るランスで貫く（attackFx/lanceFx.ts）。
 *   弓兵の通常攻撃は無数の光の矢を放物線で降らせる（attackFx/arrowFx.ts）。弓兵の迎撃も同じ演出で、弓兵と撃たれるユニットへ寄る。
 *   魔術師のサンダーフォールは相手の頭上に雷を落とす（attackFx/thunderFx.ts）。魔術師の迎撃も同じ演出。
 *   ライフル兵の通常攻撃は光の弾を続けてまっすぐ撃ち、砲兵の通常攻撃は大きな光の弾を放物線で撃つ（attackFx/projectileFx.ts）。迎撃も同じ演出。
 *   一斉攻撃は、加わる味方も含めた全員へ寄り、それぞれの兵種の演出（斬撃・ランス）を少しずつずらして出す。
 *   突撃で駆け抜けるときは、飛び出る先の HEX まで画面に収める。
 *   兵数が 0 になったユニットは消える。
 * - 攻撃の範囲（attacks.ts の shape）にいる目標以外のユニットにも巻き添えで当たる（combat.ts の splashUnits）。ライフル兵の弾は、
 *   目標の手前の HEX にいるユニットにも敵・味方を問わず当たる。迎撃も同じ。攻撃の相手を選ぶときは、カーソルを乗せた相手で当たる範囲を塗る。
 * - クールタイムのある攻撃は、使った次の自分の番から使えない（UnitStatus.cooldowns。軍の番が始まるときに減らす）。
 * - 状態（conditions.ts）は、付いたユニットの軍の番が終わるときに残りのターンを減らす。攻撃の inflicts で付く。
 *   軍の番が始まるときに効く（startTeamTurn）: 凍結はその番に行動できない、感電は行動力が半分（迎撃もできない）、
 *   混乱は操作できず、番の初めにランダムな HEX へ勝手に移動して行動を終える（順に自動で実行する。その間は操作を受け付けない）。
 * - 入城の決まり: 攻撃側のユニットは、番の初めに城の HEX の中かそのとなりにいたときだけ城の HEX へ入れる（UnitStatus.atCastle。
 *   movement.ts の castleLocked。突撃の飛び出しも）。
 * - 拠点の施設（facilities.ts。陣営ごとに facilities で渡す）: 番を終えると、その陣営の撃つ施設（要塞砲・ガンシップ）が間隔のターンごとに
 *   1 発ずつ撃ち（salvo。カメラを寄せて演出し、その間は操作を受け付けない）、撃ち終えてから次の軍の番になる。撃つ施設で軍団長部隊が殲滅されれば
 *   そこで決着する。バリスタ・魔導台は城の HEX にいるその陣営の弓兵・魔術師の射程を伸ばし（rangeBonusAt）、魔導台は番の初めにクールタイムをさらに減らす。
 * - 自分が中心の攻撃（乱撃）は、行動メニューで選ぶとすぐ予約する。地点を狙う攻撃（アーススパイク・メテオ）は空いた HEX も選べ、
 *   狙った HEX に敵がいればそれが目標、いなければ範囲のユニットはすべて巻き添え。目標の無い攻撃の士気は、敵に与えたダメージの合計で上がる。
 *   味方に当たったときだけ「巻き添え」と出す。手前で当たって壊滅したユニットも、実行を終えたときに消える
 *   （迎撃の構えのユニットなら、それより後の迎撃は撃たない）。
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
 * その軍のユニットがすべて行動済みになったら allDone のイベントで知らせる（画面はターン終了のボタンを目立たせる）。
 * 未行動のユニット（行動済みでない、いまの番の軍のユニット）は、画面のナビゲーションから順に選べる（selectPending。カメラも寄せる）。
 * ターン終了で次の軍の番になり、その軍の全ユニットの行動力が最大まで戻る（全軍が 1 回ずつ行動したらターンの数が進む）。
 * 敵の ZOC の中のユニットは、その番にまだ移動も攻撃もしていなければ動き出せる。
 *
 * 勝敗（victory.ts）: 行動を実行し終えるたびと軍の番を終えるときに調べる。どちらかの陣営の部隊がすべて殲滅・退却するか、攻撃側のユニットが
 * 防衛拠点（マップの stronghold。地面を金色に塗る）で行動を終える（もう行動できなくなる・拠点にいるまま番を終える。入城）か、
 * どちらかの陣営の軍団長の部隊が殲滅される・退却する（軍団長部隊の全滅・退却）と決着し、戦闘を終える（end のイベント。outcome に残す）。
 * 軍団長部隊の全滅・退却、入城で決着したときは、負けた陣営に残っている部隊を強制退却させてから戦闘を終える（rout のイベント。routing）:
 * 1 部隊ずつ選んでカメラを寄せ、行動メニューに退却先の拠点の一覧を出す（「戻る」は無く、Esc も効かない）。拠点を選ぶと
 * 退却と同じように実行し（失敗すると捕虜になる。RetreatReport の forced）、次の部隊へ進む。負けた陣営に退却先が無ければすぐに終える。
 * 決着した後（強制退却の間も）はユニットを選べず、ターンも終えられない。
 *
 * - 待機は選んだらすぐに実行する。予約した行動があれば実行してから、残りの行動力を捨てて行動を終える（行動力は 0 になる）。
 * - 鼓舞（指揮官のスキル。行動力 2）は選んだらすぐに実行する。予約した行動があれば実行してから、自分の士気を 10〜20 回復する。
 *   予約した行動の途中で壊滅・足止めされたときは鼓舞しない。
 * - 退却（ターンの初めだけ。行動力は使わない）は、選ぶと行動メニューに退却先の拠点（retreats。軍ごとに使う側が渡す）の一覧を出し、
 *   拠点を選ぶとすぐに実行する。退却先の無い軍のユニットは選べない。隣接している敵ユニットの数で決まる確率で失敗し（retreat.ts）、
 *   失敗すると捕虜になる。成功したユニットは敵から離れる向きへ下がりながら消え、失敗したユニットは下がりかけたところで止められて消える。
 *   結果は retreat のイベントで知らせ、retreated に残す（捕虜をどう扱うかは使う側が決める）。
 * - 兵数が 0 になった（殲滅された）ユニットの指揮官は自動退却し、そのとき隣接している敵ユニットの数で決まる確率で捕縛される（wipeout.ts）。
 *   捕縛されなければ軍の最初の退却先へ落ち延びる（退却先が無ければ落ち延びる先は無い）。結果は wipeout のイベントで知らせ、wipedOut に残す。
 * - 戦闘を終えるときに、勝った陣営が捕縛した指揮官（退却に失敗した・殲滅されて捕縛された負けた陣営の部隊）を outcome.captives に付ける。
 *   負けた陣営が捕縛したものは無効なので付けない。
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
import { canAct, SKILL_DEFS, type MenuAction, type MenuContext } from './actions';
import type { AttackId, MenuAttackId, StrikeFxKind } from './attacks';
import { BARK_CHANCE, BARK_TONE, demoBarks, EXCHANGE_CHANCE, type BarkSituation, type BarkSource, type BarkSpeaker } from './barks';
import {
  attackArc,
  attackForecast,
  attackRange,
  attackResult,
  attackTargets,
  chargeLanding,
  COMBAT_DEFS,
  hexDistance,
  interceptorsAt,
  areaCells,
  attacksOf,
  facilityResult,
  isAttack,
  mainTargetAt,
  mightOf,
  resolveAttack,
  splashResult,
  splashUnits,
  volleySupporters,
  type ResolvedAttack,
  type AttackForecast,
  type AttackResult,
  type Combatant,
} from './combat';
import { ARROW_HIT_SEC, ARROW_RELEASE_SEC, ArrowEffects } from './attackFx/arrowFx';
import { BEAM_HIT_SEC, BeamEffects, BLAST_STYLE, FROST_STYLE, IMPACT_HIT_SEC, ImpactEffects, PILLAR_HIT_SEC, PillarEffects, SMASH_STYLE, SPIKE_STYLE } from './attackFx/areaFx';
import { BREATH_STYLE, BreathEffects, breathHitSec, FLAME_LANCE_STYLE } from './attackFx/breathFx';
import { CameraFocus, type FocusTiming } from './cameraFocus';
import { hasCondition, setCondition, tickConditions, tickCooldowns, type ConditionId } from './conditions';
import { randomRoll } from './damage';
import { demoTroops, Deployment, SIDE_TEAM, type DeployState, type TroopFactory } from './deployment';
import { InterceptEffects } from './interceptFx';
import { LANCE_HIT_SEC, LanceEffects } from './attackFx/lanceFx';
import { applyMorale, moraleChange } from './morale';
import { ActionMenuModel } from './menuModel';
import { adjacentEnemies, retreatFailChance, type RetreatDestination, type RetreatDestinations, type RetreatReport } from './retreat';
import { wipeoutCaptureChance, type WipeoutReport } from './wipeout';
import { inEnemyZoc, movePath, moveRange, nearCastle, type MoveOptions, type MoveStep } from './movement';
import { Popups } from './popups';
import { BULLET_STYLE, GUNSHIP_STYLE, ProjectileEffects, SHELL_STYLE } from './attackFx/projectileFx';
import { DEFAULT_INTERVALS, FACILITY_NAMES, firesOn, FORTRESS_CANNON_RANGE, rangeBonus, type BattleFacilities, type FiringFacility, type SideFacilities } from './facilities';
import { SLASH_HIT_SEC, SlashEffects } from './attackFx/slashFx';
import { SpeechBubbles } from './speechBubbles';
import { THUNDER_HIT_SEC, ThunderEffects } from './attackFx/thunderFx';
import { UnitTags } from './unitTags';
import { demoStatuses, type UnitStatus } from './unitStatus';
import { judgeBattle, loserOf, sideUnits, type BattleOutcome, type CapturedUnit, type CommanderLoss } from './victory';

/** 移動できる HEX の色と、そのうち敵の ZOC で止まる HEX の印の色 */
const MOVE_RANGE_COLOR = 0x4aa8ff;
const MOVE_ZOC_COLOR = 0xff8a3a;
/** 攻撃できる相手の HEX の色と、一斉攻撃でそのうち選べる（味方と取り囲んだ）相手の印の色 */
const ATTACK_RANGE_COLOR = 0xff4a3a;
const VOLLEY_MARK_COLOR = 0xffd060;
/** 攻撃の相手を選ぶときに、カーソルを乗せた相手で当たる範囲の色 */
const SPLASH_AREA_COLOR = 0xffa040;
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
 * 雷を落とす（魔術師）、弾を撃って届くまで（ライフル兵・砲兵）
 */
const SLASH_STRIKE_SEC = 0.7;
const LANCE_STRIKE_SEC = 0.7;
const LANCE_CHARGE_SEC = 1.0;
const ARROW_STRIKE_SEC = 1.5;
const THUNDER_STRIKE_SEC = 1.0;
const BULLET_STRIKE_SEC = 1.0;
const SHELL_STRIKE_SEC = 1.9;
/** 爪で引き裂く（ドラゴンのクロウ）、炎を吹き出して範囲の端まで届き消えるまで（ブレス・フレイムランス） */
const CLAW_STRIKE_SEC = 0.7;
const BREATH_STRIKE_SEC = 2 * breathHitSec(BREATH_STYLE);
const FLAME_STRIKE_SEC = 2 * breathHitSec(FLAME_LANCE_STYLE);
/** 周りをなぎ払う（乱撃）、地面を揺らす（殴り）、溜めて光線を放つ（光線）、雷が跳ねる（チェイン）、凍らせる（フロスト）、岩が突き出る（スパイク）、魔法陣から光の柱が降って爆発する（メテオ） */
const WHIRL_STRIKE_SEC = 0.8;
const SMASH_STRIKE_SEC = 0.6;
const BEAM_STRIKE_SEC = 2 * BEAM_HIT_SEC;
const CHAIN_STRIKE_SEC = 1.4;
const FROST_STRIKE_SEC = 0.8;
const SPIKE_STRIKE_SEC = 0.8;
const METEOR_STRIKE_SEC = 2 * PILLAR_HIT_SEC;
/** 要塞砲の弾・ガンシップの掃射のアニメーションの時間（秒。半分の時点で当たる） */
const CANNON_STRIKE_SEC = 2 * SHELL_STYLE.hitSec;
const GUNSHIP_STRIKE_SEC = 2 * GUNSHIP_STYLE.hitSec;
/** ガンシップの掃射を撃つところ（目標の上空。HEX の大きさ比の横・高さ） */
const GUNSHIP_OFFSET = { x: -2.5, y: 7 };
/** チェインライトニングの雷が次の相手へ跳ぶまでの時間（秒） */
const CHAIN_STEP_SEC = 0.14;
/** 混乱したユニットが勝手に動き出すまでの間（ミリ秒。番のカットインや前の動きの後） */
const AUTO_DELAY_MS = 900;
/** 鼓舞で回復する士気（この範囲の整数） */
const INSPIRE_MIN = 10;
const INSPIRE_MAX = 20;
/** 魔術師が雷を呼んで跳ねる時間（秒。雷が落ちる時点で終わる） */
const THUNDER_CAST_SEC = 0.35;
/** 砲兵が撃った反動で跳ねる時間（秒） */
const SHELL_RECOIL_SEC = 0.25;
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

/** 一斉攻撃で、加わるユニットごとにエフェクトをずらす時間（秒） */
const VOLLEY_FX_STAGGER_SEC = 0.06;

/** 攻撃の演出の種類ごとの、エフェクトを出してから当たるまでの時間（秒）と、当たったときのカメラの揺れ（hexSize 比） */
const STRIKE_FX: Record<StrikeFxKind, { hitSec: number; cameraShake: number }> = {
  slash: { hitSec: SLASH_HIT_SEC, cameraShake: 0.04 },
  lance: { hitSec: LANCE_HIT_SEC, cameraShake: 0.06 },
  arrows: { hitSec: ARROW_HIT_SEC, cameraShake: 0.03 },
  thunder: { hitSec: THUNDER_HIT_SEC, cameraShake: 0.08 },
  bullets: { hitSec: BULLET_STYLE.hitSec, cameraShake: 0.02 },
  shell: { hitSec: SHELL_STYLE.hitSec, cameraShake: 0.1 },
  claw: { hitSec: SLASH_HIT_SEC, cameraShake: 0.07 },
  breath: { hitSec: breathHitSec(BREATH_STYLE), cameraShake: 0.09 },
  flame: { hitSec: breathHitSec(FLAME_LANCE_STYLE), cameraShake: 0.05 },
  whirl: { hitSec: SLASH_HIT_SEC, cameraShake: 0.06 },
  smash: { hitSec: IMPACT_HIT_SEC, cameraShake: 0.1 },
  beam: { hitSec: BEAM_HIT_SEC, cameraShake: 0.14 },
  chain: { hitSec: THUNDER_HIT_SEC, cameraShake: 0.08 },
  frost: { hitSec: IMPACT_HIT_SEC, cameraShake: 0.03 },
  spike: { hitSec: IMPACT_HIT_SEC, cameraShake: 0.07 },
  meteor: { hitSec: PILLAR_HIT_SEC, cameraShake: 0.18 },
};

/** 軍が行動する順（防衛側が先）。部隊のいない軍は飛ばす */
export const TURN_ORDER: readonly TeamId[] = [SIDE_TEAM.defender, SIDE_TEAM.attacker, 'green'];

/** deploy: 配備フェーズ、battle: 戦闘 */
export type BattlePhase = 'deploy' | 'battle';

/** 予約した攻撃 */
export interface PlannedAttack {
  action: MenuAction;
  /** 攻撃の ID（action.id と同じ） */
  id: MenuAttackId;
  /** 目標（自分が中心の攻撃と、地点を狙って敵がいない HEX を選んだときは null） */
  target: UnitData | null;
  /** 狙った HEX（自分が中心の攻撃は攻撃する HEX） */
  at: Offset;
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
    /** 目標への攻撃の結果（目標が無ければ null） */
    result: AttackResult | null;
    targetDestroyed: boolean;
    unitDestroyed: boolean;
    /** 攻撃の後の兵数（自分・相手） */
    unitLeft: number;
    targetLeft: number;
    /** 範囲の巻き添えで当たったユニット（ライフル兵の弾が目標の手前で当たったものなど。当たらなければ空） */
    splash: SplashHit[];
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
  /** 範囲の巻き添えで当たったユニット（ライフル兵の弾が撃たれたユニットの手前で当たったものなど。当たらなければ空） */
  splash: SplashHit[];
}

/** 番の終わりに施設が撃った 1 発 */
export interface FacilityReport {
  kind: FiringFacility;
  /** 施設を持つ陣営 */
  side: DeploySide;
  turn: number;
  target: UnitData;
  result: AttackResult;
  /** 撃たれた後の兵数 */
  left: number;
  destroyed: boolean;
}

/** 範囲の巻き添えで当たったユニット 1 つ分（敵・味方を問わない。味方に当たったものは「巻き添え」と出す） */
export interface SplashHit {
  unit: UnitData;
  /** 撃ったユニットの味方か（巻き添え） */
  friendly: boolean;
  result: AttackResult;
  /** 当たった後の兵数 */
  left: number;
  destroyed: boolean;
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
  /** 行動済みの印を数え直したとき。allDone はいまの番の軍のユニットがすべて行動済みか（配備フェーズ・強制退却の間は false） */
  allDone: [allDone: boolean];
  /** 決定で予約を実行し終えたとき（退却も。そのときは retreat の後） */
  execute: [report: ExecuteReport];
  /** ユニットが退却した・退却に失敗して捕虜になったとき（ユニットはもうマップにいない） */
  retreat: [report: RetreatReport];
  /** ユニットが殲滅されたとき（ユニットはもうマップにいない。指揮官が捕縛されたかは report.captured） */
  wipeout: [report: WipeoutReport];
  /** 軍団長部隊の全滅・退却、入城で決着し、負けた陣営に残った部隊（units）の強制退却を始めるとき（execute の後。終えたら end） */
  rout: [outcome: BattleOutcome, units: readonly UnitData[]];
  /** 戦闘が決着したとき（execute の後。強制退却があれば、すべて退却し終えた後） */
  end: [outcome: BattleOutcome];
  /** ユニットがセリフを言うと決まったとき（掛け合いの 2 行目からなど、吹き出しを出すのは遅れることがある） */
  bark: [unit: UnitData, situation: BarkSituation | 'exchange', text: string];
  /** 番の終わりに施設が撃ったとき（撃たれたユニットが殲滅されたら、この後に wipeout） */
  facility: [report: FacilityReport];
  /** 実行のほかで、ユニットの状態（付いている状態など）を書き換えたとき（表示確認用の setCondition など） */
  statusChange: [unit: UnitData];
}

/** マップのユニットに戦闘中の状態を配る（既定は表示確認用の仮の値） */
export type StatusFactory = (units: readonly UnitData[]) => Map<UnitData, UnitStatus>;

/** 移動先・攻撃の相手を選んでいる状態 */
type Targeting =
  | { kind: 'move'; cells: Map<number, MoveStep> }
  | {
      kind: 'attack';
      action: MenuAction;
      attack: ResolvedAttack;
      /** 選べる HEX（敵ユニットを狙う攻撃は敵のいる HEX、地点を狙う攻撃は射程のすべての HEX） */
      cells: Map<number, Offset>;
      /** 狙える HEX の塗り（カーソルを乗せた相手で当たる範囲を重ねる前） */
      range: RangeCell[];
    };

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

/** 施設が撃つ 1 発（演出の進み具合） */
interface SalvoShot {
  kind: FiringFacility;
  target: UnitData;
  start: number;
  /** カメラが寄るのを待つ時間・撃つアニメーションの時間・全体の時間（秒） */
  lead: number;
  strikeSec: number;
  duration: number;
  spawned: boolean;
  hit: boolean;
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
  /** 範囲の端の HEX（直線に吹く炎は、目標ではなくここまで届かせる。範囲の無い攻撃は null） */
  end: Offset | null;
  /** 範囲のエフェクトを出す HEX（なぎ払い・岩・メテオ・跳ねる雷。順に出すものは並びの順） */
  area: Offset[];
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
  /** 3 本の爪の跡（ドラゴンのクロウ） */
  readonly clawFx = new SlashEffects({ color: 0xff6a3a, blades: 3, gap: 0.16 });
  /** 範囲の端まで吹く炎（ドラゴンのブレス・フレイムランス） */
  readonly breathFx = new BreathEffects();
  /** 地面の衝撃（殴り・氷・岩・爆発） */
  readonly impactFx = new ImpactEffects();
  /** 溜めて放つ光線（ベヒーモス） */
  readonly beamFx = new BeamEffects();
  /** 魔法陣と、降ってくる光の柱・爆発（メテオフォール） */
  readonly pillarFx = new PillarEffects();
  /** 光るランスの突き（騎兵の通常攻撃・突撃） */
  readonly lanceFx = new LanceEffects();
  /** 光の矢の雨（弓兵の通常攻撃） */
  readonly arrowFx = new ArrowEffects();
  /** 頭上に落ちる雷（魔術師のサンダーフォール） */
  readonly thunderFx = new ThunderEffects();
  /** まっすぐ飛ぶ光の弾（ライフル兵の通常攻撃） */
  readonly bulletFx = new ProjectileEffects(BULLET_STYLE);
  /** 放物線で飛ぶ大きな光の弾（砲兵の通常攻撃・要塞砲） */
  readonly shellFx = new ProjectileEffects(SHELL_STYLE);
  /** 上空から降らせる光の弾（ガンシップ） */
  readonly gunshipFx = new ProjectileEffects(GUNSHIP_STYLE);
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
  /** 陣営ごとの拠点の施設（ゲームは都市の施設から渡す） */
  facilities: SideFacilities = {};
  /** この戦闘で退却した・退却に失敗して捕虜になったユニット（順に。マップを読み込むと空にする） */
  readonly retreated: RetreatReport[] = [];
  /** この戦闘で殲滅されたユニット（順に。マップを読み込むと空にする） */
  readonly wipedOut: WipeoutReport[] = [];
  /** 殲滅・退却で戦場からいなくなったユニットを率いていた騎士の名前（記録・案内で部隊を呼ぶため。マップを読み込むと空にする） */
  private goneLeaders = new Map<UnitData, string>();
  /** 配備したユニットの部隊の ID（戦闘が始まったときに配備から写す） */
  private troopIds = new Map<UnitData, string>();
  /** 防衛拠点の HEX（マップの stronghold。無ければ入城では決着しない） */
  stronghold: Offset | null = null;
  /** 戦闘の決着（まだなら null） */
  outcome: BattleOutcome | null = null;
  /** 全滅で負けにする陣営（戦闘が始まったときに部隊のいた陣営） */
  private judged = new Set<DeploySide>();
  /** 軍団長の部隊が殲滅された・退却した陣営と、そのこと */
  private fallen = new Map<DeploySide, CommanderLoss>();
  /** 強制退却の最中なら、その決着と、まだ退却先を選んでいない部隊（順に。退却先を選んでいる部隊は含まない） */
  private rout: { outcome: BattleOutcome; team: TeamId; queue: UnitData[] } | null = null;

  private readonly listeners = new Map<keyof BattleEvents, Set<(...args: never[]) => void>>();
  private readonly container: HTMLElement;
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || this.exec || this.outcome || this.rout) return;
    if (this.deployment) this.pickTroop(null);
    else if (this.targeting) this.cancelTargeting();
    else if (this.menu.closeRetreat()) this.emit('targetCancel');
    else if (this.menu.closeSub()) return;
    else if (this.plan && BattleApp.planned(this.plan)) this.undo();
    else this.setSelected(null);
  };
  private targeting: Targeting | null = null;
  private exec: Execution | null = null;
  /** 番の初めに勝手に動かす混乱したユニット（順に）と、次を動かす時刻（performance.now()）。動かしている間は autoRunning */
  private autoQueue: UnitData[] = [];
  private autoAt = 0;
  private autoRunning = false;
  /** 番の終わりに施設が撃っている（queue はこれから撃つ施設、cur は撃っている 1 発）。撃ち終えたら次の軍の番にする */
  private salvo: { side: DeploySide; queue: FiringFacility[]; cur: SalvoShot | null } | null = null;
  /** 行動メニューで隠したくない、予約した移動のルートと攻撃の矢印（ワールドの折れ線。予約が無ければ空） */
  private menuAvoid: THREE.Vector3[][] = [];

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
    this.ctx.overlay.add(this.interceptFx.group, this.slashFx.group, this.lanceFx.group, this.arrowFx.group, this.thunderFx.group, this.bulletFx.group, this.shellFx.group, this.clawFx.group, this.breathFx.group, this.impactFx.group, this.beamFx.group, this.pillarFx.group, this.gunshipFx.group);
    this.menu.onAction = (unit, action) => {
      // 混乱したユニットを勝手に動かしている間・施設が撃っている間は操作を受け付けない
      if (this.autoMoving || this.salvo) return;
      if (action.id === 'confirm') return this.execute('confirm');
      if (action.id === 'intercept') return this.execute('intercept');
      if (action.id === 'wait') return this.execute('wait');
      if (action.id === 'skill:inspire') return this.execute('inspire');
      if (action.id === 'cancel') return this.clearPlan();
      if (action.id === 'retreat') this.openRetreat(unit);
      else if (action.id === 'move') this.startMove();
      else if (isAttack(action.id)) this.startAttack(action, action.id);
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

  /** 負けた陣営の残りの部隊を強制退却させている最中か */
  get routing(): boolean {
    return this.rout !== null;
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
    this.clawFx.clear();
    this.breathFx.clear();
    this.impactFx.clear();
    this.beamFx.clear();
    this.pillarFx.clear();
    this.gunshipFx.clear();
    this.autoQueue = [];
    this.salvo = null;
    this.lanceFx.clear();
    this.arrowFx.clear();
    this.thunderFx.clear();
    this.bulletFx.clear();
    this.shellFx.clear();
    this.cameraFocus.stop();
    this.statuses = makeStatuses(map.allUnits());
    this.retreated.length = 0;
    this.wipedOut.length = 0;
    this.goneLeaders = new Map();
    this.troopIds = new Map();
    this.outcome = null;
    this.judged = new Set();
    this.fallen = new Map();
    this.rout = null;
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

  /** いまの番の軍のユニット（上の行から、同じ行なら左から。配備フェーズ・決着の後・強制退却の間は空） */
  teamUnits(): UnitData[] {
    const map = this.map;
    if (!map || this.deployment || this.outcome || this.rout) return [];
    return map
      .allUnits()
      .filter((u) => u.team === this.activeTeam)
      .sort((a, b) => a.row - b.row || a.col - b.col);
  }

  /** いまの番の軍の、まだ行動済みでないユニット（teamUnits の順） */
  pendingUnits(): UnitData[] {
    return this.teamUnits().filter((u) => !this.done.has(u));
  }

  /**
   * 未行動のユニットを順に選ぶ（dir = 1 で次、-1 で前。選択中のユニットから teamUnits の順にたどり、端では反対の端へ戻る）。
   * 選んだユニットへカメラを動かす。選んだら true（実行中・未行動のユニットがいなければ false）
   */
  selectPending(dir: 1 | -1): boolean {
    if (this.exec) return false;
    const all = this.teamUnits();
    const pending = all.filter((u) => !this.done.has(u));
    if (pending.length === 0) return false;
    const current = this.plan?.unit ?? null;
    const start = current ? all.indexOf(current) : -1;
    let next: UnitData | undefined;
    if (start < 0) next = dir > 0 ? pending[0] : pending[pending.length - 1];
    else {
      for (let k = 1; k <= all.length && !next; k++) {
        const u = all[(start + dir * k + all.length * k) % all.length];
        if (!this.done.has(u)) next = u;
      }
    }
    if (!next) return false;
    if (next !== current) this.setSelected({ col: next.col, row: next.row });
    const p = this.view.units.placements().find((x) => x.unit === next);
    if (p) this.cameraFocus.panTo(p.foot);
    return true;
  }

  /** 部隊のウィンドウに出すユニット（カーソルの下 → 選択中 → 調べている相手方の順。どれも無ければ null） */
  infoUnit(): UnitData | null {
    const map = this.map;
    const hovered = this.hovered && map?.unitAt(this.hovered.col, this.hovered.row);
    return hovered ?? this.plan?.unit ?? this.inspected;
  }

  /** ユニットを率いる騎士の名前（戦場からいなくなったユニットも引ける。騎士がいなければ undefined） */
  leaderOf(unit: UnitData): string | undefined {
    return this.statuses.get(unit)?.name ?? this.goneLeaders.get(unit);
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
    this.startTeamTurn(this.activeTeam);
    this.refreshMarks();
    this.emit('phase', 'battle');
    this.emit('turn', this.turn, this.activeTeam);
  }

  /**
   * いまの軍の番を終えて次の軍の番にする。選択と予約を捨て、次の軍の全ユニットの行動力を最大まで戻して
   * 移動済み・攻撃済みを消す。全軍が 1 回ずつ行動したらターンの数を進める（実行中・配備フェーズは何もしない）
   */
  endTurn(): boolean {
    if (this.exec || !this.map || this.deployment || this.outcome || this.rout || this.autoMoving || this.salvo) return false;
    this.setSelected(null);
    // 番を終えると、その軍のユニットは行動を終える（防衛拠点にいれば入城）
    this.judge(this.map.allUnits().filter((u) => u.team === this.activeTeam));
    if (this.outcome || this.rout) return false;
    // この番に撃つ施設があれば、撃ち終えてから次の軍の番にする
    const side = DEPLOY_SIDES.find((s) => SIDE_TEAM[s] === this.activeTeam);
    const f = side && this.facilities[side];
    const firing = (['fortressCannon', 'gunship'] as const).filter((k) => {
      const w = f?.[k];
      return !!w && firesOn(this.turn, w.interval ?? DEFAULT_INTERVALS[k]);
    });
    if (side && firing.length > 0) {
      this.salvo = { side, queue: firing, cur: null };
      return true;
    }
    this.passTurn();
    return true;
  }

  /** 番を終えた軍の状態のターンを減らして、次の軍の番にする */
  private passTurn(): void {
    if (!this.map) return;
    // 番を終えた軍のユニットの状態の残りターンを減らす
    for (const [unit, status] of this.statuses) if (unit.team === this.activeTeam) tickConditions(status);
    const next = this.nextTeam(this.activeTeam);
    if (TURN_ORDER.indexOf(next) <= TURN_ORDER.indexOf(this.activeTeam)) this.turn++;
    this.activeTeam = next;
    this.startTeamTurn(next);
    this.refreshMarks();
    this.emit('turn', this.turn, this.activeTeam);
  }

  /** 施設が撃っている間を進める。1 発ずつ目標を選んでカメラを寄せ、演出の半分で当てる。撃ち終えたら次の軍の番にする */
  private stepSalvo(now: number): void {
    const salvo = this.salvo!;
    const map = this.map;
    if (!map) return;
    let shot = salvo.cur;
    if (!shot) {
      const kind = salvo.queue.shift();
      if (!kind) {
        this.salvo = null;
        return this.passTurn();
      }
      const targets = this.facilityTargets(kind, salvo.side);
      if (targets.length === 0) return;
      const target = targets[Math.floor(Math.random() * targets.length)];
      const strikeSec = kind === 'fortressCannon' ? CANNON_STRIKE_SEC : GUNSHIP_STRIKE_SEC;
      const lead = FX_ZOOM_IN_SEC;
      shot = salvo.cur = { kind, target, start: now, lead, strikeSec, duration: lead + strikeSec + FX_HOLD_SEC + FX_ZOOM_OUT_SEC, spawned: false, hit: false };
      this.focusOn([target], null, { in: FX_ZOOM_IN_SEC, hold: strikeSec + FX_HOLD_SEC, out: FX_ZOOM_OUT_SEC }, kind === 'fortressCannon' ? this.stronghold : null);
    }
    const elapsed = (now - shot.start) / 1000;
    const t = (elapsed - shot.lead) / shot.strikeSec;
    const hitSec = shot.kind === 'fortressCannon' ? SHELL_STYLE.hitSec : GUNSHIP_STYLE.hitSec;
    if (!shot.spawned && t >= 0.5 - hitSec / shot.strikeSec) {
      shot.spawned = true;
      this.spawnFacilityFx(shot.kind, shot.target);
    }
    if (!shot.hit && t >= 0.5) {
      shot.hit = true;
      this.applyFacilityShot(shot.kind, salvo.side, shot.target);
      this.cameraFocus.shake((shot.kind === 'fortressCannon' ? STRIKE_FX.shell.cameraShake : 0.05) * map.layout.size);
    }
    if (elapsed < shot.duration) return;
    salvo.cur = null;
    // 撃った施設で決着した（軍団長部隊の全滅）ら、次の軍の番にはしない
    if (this.outcome || this.rout) this.salvo = null;
  }

  /** side の kind の施設が撃てる敵（要塞砲は拠点から射程以内で、城の HEX にいないもの。ガンシップは全域） */
  private facilityTargets(kind: FiringFacility, side: DeploySide): UnitData[] {
    const map = this.map!;
    const enemies = map.allUnits().filter((u) => u.team !== SIDE_TEAM[side] && this.statuses.has(u));
    if (kind === 'gunship') return enemies;
    const hold = this.stronghold;
    if (!hold) return [];
    return enemies.filter((u) => hexDistance(map, hold, u) <= FORTRESS_CANNON_RANGE && map.get(u.col, u.row)?.feature !== 'castle');
  }

  /** 施設の弾を撃つ（要塞砲は拠点から、ガンシップは目標の上空から） */
  private spawnFacilityFx(kind: FiringFacility, target: UnitData): void {
    const tp = this.view.units.placements().find((p) => p.unit === target);
    const size = this.map!.layout.size;
    if (!tp) return;
    if (kind === 'fortressCannon' && this.stronghold) {
      return this.shellFx.spawn({ ...tp, foot: this.groundPoint(this.stronghold) }, tp, this.ctx.camera);
    }
    const sky = tp.foot.clone().add(new THREE.Vector3(GUNSHIP_OFFSET.x * size, GUNSHIP_OFFSET.y * size, 0));
    this.gunshipFx.spawn({ ...tp, foot: sky }, tp, this.ctx.camera);
  }

  /** 施設の 1 発を兵数・士気に反映し、殲滅したら戦場から除いて知らせ、決着を調べる */
  private applyFacilityShot(kind: FiringFacility, side: DeploySide, target: UnitData): void {
    const map = this.map!;
    const status = this.statuses.get(target);
    if (!status) return;
    const result = facilityResult(map, kind, { unit: target, status, pos: target }, randomRoll());
    status.soldiers -= result.damage;
    applyMorale(status, result.morale.defender);
    const destroyed = status.soldiers <= 0;
    const lost: { wipeouts: WipeoutReport[] } = { wipeouts: [] };
    const w = destroyed ? this.wipeOut(lost, target, status, target, null, []) : null;
    const p = this.view.units.placements().find((x) => x.unit === target);
    if (p) this.popups.show(p, `${FACILITY_NAMES[kind]} -${result.damage}${wipeoutLabel(w)}`, 'damage');
    if (w) {
      this.removeUnits([target]);
      this.wipedOut.push(w);
      this.markFallen(target, status, 'commander');
    }
    this.emit('facility', { kind, side, turn: this.turn, target, result, left: Math.max(0, status.soldiers), destroyed });
    if (!w) return;
    this.emit('wipeout', w);
    this.judge();
  }

  /** 戦場からユニットを除く（騎士の名前は記録に残す） */
  private removeUnits(units: readonly UnitData[]): void {
    const map = this.map!;
    for (const u of units) {
      map.removeUnit(u.col, u.row);
      const leader = this.statuses.get(u)?.name;
      if (leader) this.goneLeaders.set(u, leader);
      this.statuses.delete(u);
    }
    if (units.length > 0) this.tags.setStatuses(this.statuses);
    this.view.rebuildUnits();
  }

  /** 軍団長の部隊がいなくなったら、その陣営の負けにする（もう負けていればそのまま） */
  private markFallen(unit: UnitData, status: UnitStatus, reason: CommanderLoss['reason']): void {
    const side = DEPLOY_SIDES.find((s) => SIDE_TEAM[s] === unit.team);
    if (status.commander && side && !this.fallen.has(side)) this.fallen.set(side, { unit, reason });
  }

  /** side の陣営の施設（無ければ undefined） */
  private facilitiesOf(team: TeamId): BattleFacilities | undefined {
    const side = DEPLOY_SIDES.find((s) => SIDE_TEAM[s] === team);
    return side && this.facilities[side];
  }

  /** unit が pos（城の HEX）にいるときに施設で伸びる射程（バリスタ・魔導台） */
  private rangeBonusAt(unit: UnitData, pos: Offset): number {
    if (this.map?.get(pos.col, pos.row)?.feature !== 'castle') return 0;
    return rangeBonus(this.facilitiesOf(unit.team), unit.type, !!COMBAT_DEFS[unit.type].magic);
  }

  /**
   * team の番を始める。行動力などを戻し（refreshTeam）、状態を効かせる: 凍結は行動力 0、感電は行動力が半分。
   * 混乱したユニットは、少し間をおいてから順に勝手に動かす（autoQueue）
   */
  private startTeamTurn(team: TeamId): void {
    this.refreshTeam(team);
    const confused: UnitData[] = [];
    for (const [unit, status] of this.statuses) {
      if (unit.team !== team) continue;
      // 入城の決まり: 番の初めに城の HEX の中かそのとなりにいれば、この番は城の HEX へ入れる
      status.atCastle = !!this.map && nearCastle(this.map, unit);
      // 魔導台: 城の HEX にいる魔術師はクールタイムがさらに 1 減る
      if (this.facilitiesOf(team)?.magicTower && COMBAT_DEFS[unit.type].magic && this.map?.get(unit.col, unit.row)?.feature === 'castle') tickCooldowns(status);
      if (hasCondition(status, 'freeze')) status.ap = 0;
      else if (hasCondition(status, 'confusion')) confused.push(unit);
      else if (hasCondition(status, 'shock')) status.ap = Math.floor(status.maxAp / 2);
    }
    this.autoQueue = confused;
    this.autoAt = performance.now() + AUTO_DELAY_MS;
  }

  /** 混乱したユニットを 1 部隊、ランダムな HEX へ動かして行動を終えさせる（動ける HEX が無ければその場で行動を終える） */
  private nextAuto(): void {
    const map = this.map;
    let unit = this.autoQueue.shift();
    while (unit && !map?.allUnits().includes(unit)) unit = this.autoQueue.shift();
    const status = unit && this.statuses.get(unit);
    if (!map || !unit || !status || this.outcome || this.rout) return;
    this.autoAt = performance.now() + AUTO_DELAY_MS;
    this.setSelected({ col: unit.col, row: unit.row });
    const p = this.view.units.placements().find((x) => x.unit === unit);
    if (p) this.popups.show(p, '混乱', 'retreat');
    const steps = [...moveRange(map, unit, unit, status.ap, { escapeZoc: true, castleLocked: BattleApp.castleLocked(unit, status) }).values()];
    const plan = this.plan;
    if (steps.length === 0 || !plan) {
      status.ap = 0;
      this.setSelected(null);
      this.refreshMarks();
      return;
    }
    plan.legs = [steps[Math.floor(Math.random() * steps.length)]];
    this.autoRunning = true;
    this.execute('wait');
  }

  /** 混乱したユニットを勝手に動かしている（その間は操作を受け付けない） */
  get autoMoving(): boolean {
    return this.autoQueue.length > 0 || this.autoRunning;
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
   * （配備フェーズでは配備していない陣営のユニット、強制退却の間は退却する陣営のほかのユニット）の絵を暗くする（情報札は暗くしない）
   */
  private refreshMarks(): void {
    const map = this.map;
    // 強制退却の間は、退却する陣営のほかを暗くして、E の印は付けない
    const team = this.rout?.team ?? this.deployState?.team ?? this.activeTeam;
    this.done.clear();
    if (map && !this.deployment && !this.rout) {
      for (const [unit, status] of this.statuses) {
        if (unit.team !== team) continue;
        if (!canAct(this.menuContext({ unit, status, legs: [], attack: null }))) this.done.add(unit);
      }
    }
    this.view.units.setDimmed((u) => u.team !== team || this.done.has(u));
    this.tags.setMarks(this.done);
    const own = map && !this.deployment && !this.rout ? map.allUnits().filter((u) => u.team === team) : [];
    this.emit('allDone', own.length > 0 && own.every((u) => this.done.has(u)));
  }

  /** team の全ユニットの行動力を最大まで戻し、移動済み・攻撃済みを消す（番の初め） */
  private refreshTeam(team: TeamId): void {
    for (const [unit, status] of this.statuses) {
      if (unit.team !== team) continue;
      status.ap = status.maxAp;
      status.moved = false;
      status.attacked = false;
      status.justAttacked = false;
      tickCooldowns(status);
    }
  }

  /**
   * 表示確認用: unit に id の状態を turns ターン付ける（付いていれば長いほうにする。turns が 0 以下なら外す）。
   * ゲームの進行では攻撃の inflicts で付く
   */
  setCondition(unit: UnitData, id: ConditionId, turns: number): void {
    const status = this.statuses.get(unit);
    if (!status) return;
    setCondition(status, id, turns);
    this.statusChanged(unit);
  }

  /** 表示確認用: unit の id の攻撃を、あと turns 回の自分の番は使えないようにする（0 以下で外す）。ゲームの進行では攻撃の cooldown で入る */
  setCooldown(unit: UnitData, id: AttackId, turns: number): void {
    const status = this.statuses.get(unit);
    if (!status) return;
    if (turns > 0) status.cooldowns[id] = turns;
    else delete status.cooldowns[id];
    this.statusChanged(unit);
  }

  /** 実行のほかでユニットの状態を書き換えたら、行動メニューと行動済みの印を作り直して知らせる */
  private statusChanged(unit: UnitData): void {
    if (this.plan?.unit === unit && !this.targeting && !this.exec) this.openMenu();
    this.refreshMarks();
    this.emit('statusChange', unit);
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
    const at = this.targeting.cells.get(o.row * map.layout.cols + o.col);
    if (!at) return null;
    const id = this.targeting.attack.id;
    const target = mainTargetAt(map, plan.unit, at, id);
    const ts = target && this.statuses.get(target);
    const reason = target && this.rejectReason(this.targeting.attack, target);
    if (reason) return { rejected: reason };
    const attacker = { unit: plan.unit, status: plan.status, pos: BattleApp.planPos(plan) };
    const splash = splashUnits(map, plan.unit, attacker.pos, target, at, id).flatMap((u) => {
      const status = this.statuses.get(u);
      return status ? [{ unit: u, status, pos: u }] : [];
    });
    return attackForecast(map, attacker, target && ts ? { unit: target, status: ts, pos: target } : null, id, splash);
  }

  /** attack で target を攻撃できない理由（できれば null）。一斉攻撃は、ほかの味方とも隣接している相手しか選べない */
  private rejectReason(attack: ResolvedAttack, target: UnitData): string | null {
    if (attack.special !== 'volley') return null;
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
   * 攻撃側のユニットは、番の初めに城の HEX の中かそのとなりにいなければ、城の外から城の HEX へ入れない（入城の決まり）。
   */
  static moveOptions(plan: Plan): MoveOptions {
    const afterAttack =
      !!COMBAT_DEFS[plan.unit.type].moveAfterAttack && (BattleApp.attackIsLast(plan) || (plan.status.justAttacked && !BattleApp.planned(plan)));
    return { spent: BattleApp.planCost(plan), escapeZoc: BattleApp.turnStart(plan) || afterAttack, castleLocked: BattleApp.castleLocked(plan.unit, plan.status) };
  }

  /** 入城の決まりで、unit が城の外から城の HEX へ入れないか（防衛側でない軍で、番の初めに城の HEX の中にもとなりにもいなかった） */
  static castleLocked(unit: UnitData, status: UnitStatus): boolean {
    return unit.team !== SIDE_TEAM.defender && !status.atCastle;
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
    if (this.outcome || this.rout || this.autoMoving || this.salvo) return;
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
        const at = t.cells.get(key)!;
        const target = mainTargetAt(map, this.plan!.unit, at, t.attack.id);
        const reason = target && this.rejectReason(t.attack, target);
        if (reason) this.emit('targetReject', reason);
        else this.setAttack(t.action, t.attack, at);
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
    // 次の番は、いまの位置が番の初めの位置になる（入城の決まり）
    const castleLocked = unit.team !== SIDE_TEAM.defender && !nearCastle(map, unit);
    const moves = moveRange(map, unit, unit, ap, { escapeZoc: true, castleLocked });
    const out = new Map<number, RangeCell>();
    for (const [k, step] of moves) out.set(k, { col: step.col, row: step.row, mark: step.zoc });
    const attacks = attacksOf(unit.type, status).map((id) => resolveAttack(unit.type, id));
    if (attacks.length === 0) return [...out.values()];
    const self = unit.row * cols + unit.col;
    const froms = [{ pos: unit as Offset, spent: 0 }, ...[...moves.values()].map((step) => ({ pos: step as Offset, spent: step.cost }))];
    for (const { pos, spent } of froms) {
      for (const a of attacks) {
        // 動いた後に残る行動力でできる攻撃の射程だけ数える
        if (ap - spent < a.cost) continue;
        for (const o of attackRange(map, unit, pos, a.id, this.rangeBonusAt(unit, pos))) {
          const k = o.row * cols + o.col;
          if (k !== self && !out.has(k)) out.set(k, { ...o, alt: true });
        }
      }
    }
    return [...out.values()];
  }

  /** unit の軍の退却先の拠点 */
  retreatDestinations(unit: UnitData): readonly RetreatDestination[] {
    return this.retreats[unit.team] ?? [];
  }

  /** 行動メニューに退却先の拠点の一覧と、退却に失敗する確率を出す（forced: 負けた陣営の強制退却） */
  private openRetreat(unit: UnitData, forced = false): void {
    const destinations = this.retreatDestinations(unit);
    if (!this.map || destinations.length === 0) return;
    const enemies = adjacentEnemies(this.map, unit).length;
    this.menu.openRetreat({ destinations, enemies, failChance: retreatFailChance(enemies, this.statuses.get(unit)?.uncapturable), forced });
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
  private startAttack(action: MenuAction, id: MenuAttackId): void {
    const map = this.map;
    const plan = this.plan;
    if (!map || !plan) return;
    const cols = map.layout.cols;
    const pos = BattleApp.planPos(plan);
    const attack = resolveAttack(plan.unit.type, id);
    // 自分が中心の攻撃（乱撃）は相手を選ばずにすぐ予約する
    if (attack.aim === 'self') return this.setAttack(action, attack, pos);
    const bonus = this.rangeBonusAt(plan.unit, pos);
    const aimable = attack.aim === 'unit' ? attackTargets(map, plan.unit, pos, id, bonus) : attackRange(map, plan.unit, pos, id, bonus);
    const cells = new Map(aimable.map((o): [number, Offset] => [o.row * cols + o.col, { col: o.col, row: o.row }]));
    // 射程内の HEX を薄く塗り、選べる HEX は濃く塗る。一斉攻撃は、選べる（ほかの味方と取り囲んだ）相手に印を付ける
    const range = attackRange(map, plan.unit, pos, id, bonus).map((o): RangeCell => {
      if (!cells.has(o.row * cols + o.col)) return { ...o, weak: true };
      const u = mainTargetAt(map, plan.unit, o, id);
      return { ...o, mark: attack.special === 'volley' && !!u && !this.rejectReason(attack, u) };
    });
    this.targeting = { kind: 'attack', action, attack, cells, range };
    this.menu.suspended = true;
    this.setHover(this.hovered);
  }

  /**
   * 攻撃の相手を選ぶ状態の塗り。狙える HEX に、カーソルを乗せた相手で当たる範囲（目標のほかにも当たる攻撃だけ）を別の色で重ねる
   */
  private paintAttackRange(t: Extract<Targeting, { kind: 'attack' }>, hover: Offset | null): void {
    const map = this.map!;
    const plan = this.plan!;
    const cols = map.layout.cols;
    const target = hover && t.cells.get(hover.row * cols + hover.col);
    const pos = BattleApp.planPos(plan);
    // 範囲の HEX と、跳ねる雷などで当たるユニットの HEX
    const area = target && t.attack.shape.kind !== 'single'
      ? [...areaCells(map, pos, target, t.attack.shape), ...splashUnits(map, plan.unit, pos, mainTargetAt(map, plan.unit, target, t.attack.id), target, t.attack.id)]
      : [];
    if (!target || area.length === 0) return this.view.setRange(t.range, ATTACK_RANGE_COLOR, VOLLEY_MARK_COLOR);
    const cells = new Map<number, RangeCell>(t.range.map((c) => [c.row * cols + c.col, c]));
    for (const o of area) {
      const k = o.row * cols + o.col;
      // 目標の HEX はそのまま濃く塗る
      if (o.col === target.col && o.row === target.row) continue;
      cells.set(k, { col: o.col, row: o.row, alt: true });
    }
    this.view.setRange(cells.values(), ATTACK_RANGE_COLOR, VOLLEY_MARK_COLOR, SPLASH_AREA_COLOR);
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

  /** attack を at を狙って予約する（目標は at のユニット。自分が中心の攻撃は at が攻撃する HEX） */
  private setAttack(action: MenuAction, attack: ResolvedAttack, at: Offset): void {
    const plan = this.plan!;
    const pos = BattleApp.planPos(plan);
    const target = mainTargetAt(this.map!, plan.unit, at, attack.id);
    const landing = attack.special === 'charge' && target ? chargeLanding(this.map!, pos, target, BattleApp.castleLocked(plan.unit, plan.status)) : null;
    plan.attack = { action, id: attack.id as MenuAttackId, target, at: { col: at.col, row: at.row }, afterLeg: plan.legs.length, landing };
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
    this.menuAvoid = this.planLines(plan, split);
    this.openMenu();
    this.emit('planChange', plan);
  }

  /** 予約した移動のルート（攻撃の前・後）と攻撃の矢印を、HEX の中心を結んだワールドの折れ線にする（行動メニューが避ける） */
  private planLines(plan: Plan, split: number): THREE.Vector3[][] {
    const map = this.map!;
    const at = (o: Offset) => {
      const c = map.layout.offsetToWorld(o.col, o.row);
      return new THREE.Vector3(c.x, this.view.groundAt(c.x, c.z), c.z);
    };
    const lines = [plan.legs.slice(0, split), plan.legs.slice(split)].filter((legs) => legs.length > 0).map((legs) => movePath(legs));
    const attack = plan.attack;
    if (attack) lines.push([BattleApp.attackPos(plan), attack.at, ...(attack.landing ? [attack.landing] : [])]);
    return lines.map((line) => line.map(at));
  }

  /** 攻撃の矢印。一斉攻撃は、加わる味方からも細い矢印を出す */
  private showAttackArrow(plan: Plan | null): void {
    if (!plan?.attack) {
      this.view.setSupportAttacks([], null);
      return this.view.setAttack(null, null);
    }
    const { id, target, at, landing } = plan.attack;
    const def = resolveAttack(plan.unit.type, id);
    // 自分が中心の攻撃は矢印を出さない
    this.view.setAttack(def.aim === 'self' ? null : BattleApp.attackPos(plan), def.aim === 'self' ? null : at, attackArc(plan.unit.type, id), landing);
    this.view.setSupportAttacks(def.special === 'volley' && target ? volleySupporters(this.map!, plan.unit, target) : [], target);
  }

  /**
   * 予約を実行する。攻撃の前の移動 → 攻撃 → 攻撃の後の移動（騎兵）の順に進め、最後に end のこと（迎撃の構え・待機・鼓舞）をする。
   * 決定（confirm）は予約が無ければ何もしない。迎撃は攻撃を予約していないときだけ選べる。
   * 退却（retreat）は予約の無いターンの初めだけで、to へ退却する（成否はここで決める）。強制退却はいつでも退却する。
   */
  private execute(end: ExecuteEnd, to?: RetreatDestination): void {
    const map = this.map;
    const plan = this.plan;
    if (!map || !plan || (end === 'confirm' && !BattleApp.planned(plan))) return;
    // 強制退却の間は退却しかしない
    if (this.rout && end !== 'retreat') return;
    if (end === 'retreat' && (!to || (!this.rout && (!BattleApp.turnStart(plan) || plan.status.ap < plan.status.maxAp)))) return;
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
      const failChance = retreatFailChance(enemies, plan.status.uncapturable);
      report.retreat = {
        unit: plan.unit,
        troopId: this.troopIds.get(plan.unit) ?? null,
        status: plan.status,
        turn: this.turn,
        to,
        enemies,
        failChance,
        captured: Math.random() < failChance,
        forced: !!this.rout,
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
    // 目標の手前で弾が当たって壊滅した迎撃の構えのユニットは撃たない
    while ((phase?.kind === 'walk' && phase.path.length < 2) || (phase?.kind === 'intercept' && !((this.statuses.get(phase.shooter)?.soldiers ?? 0) > 0))) {
      if (phase.kind === 'walk' && phase.commit && phase.path.length > 0) this.commitWalk(exec, phase.path[0]);
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
      const volley = phase.kind === 'strike' && !!attack && resolveAttack(exec.plan.unit.type, attack.id).special === 'volley';
      exec.supporters = volley && attack?.target ? volleySupporters(map, exec.plan.unit, attack.target) : [];
      const kind = phase.kind === 'strike' ? BattleApp.strikeFx(exec.plan.unit, attack!.id) : BattleApp.interceptFx(phase.shooter);
      // 攻撃・迎撃の前のセリフ（演出のある攻撃は、カメラが寄ったまま読み終えるのを待ってから攻撃する）
      const talk = phase.kind === 'strike' ? this.strikeTalk(exec) : this.bark('intercept', phase.shooter, exec.plan.unit, BARK_BEFORE_SEC);
      if (kind) {
        const strikeSec = {
          slash: SLASH_STRIKE_SEC,
          lance: attack?.landing ? LANCE_CHARGE_SEC : LANCE_STRIKE_SEC,
          arrows: ARROW_STRIKE_SEC,
          thunder: THUNDER_STRIKE_SEC,
          bullets: BULLET_STRIKE_SEC,
          shell: SHELL_STRIKE_SEC,
          claw: CLAW_STRIKE_SEC,
          breath: BREATH_STRIKE_SEC,
          flame: FLAME_STRIKE_SEC,
          whirl: WHIRL_STRIKE_SEC,
          smash: SMASH_STRIKE_SEC,
          beam: BEAM_STRIKE_SEC,
          chain: CHAIN_STRIKE_SEC,
          frost: FROST_STRIKE_SEC,
          spike: SPIKE_STRIKE_SEC,
          meteor: METEOR_STRIKE_SEC,
        }[kind];
        // 一斉攻撃は、加わる味方もそれぞれの兵種の演出を、当たりの時点を中心に少しずつずらして出す
        const units = phase.kind === 'strike' ? [exec.plan.unit, ...exec.supporters] : [phase.shooter];
        const shots = units.flatMap((unit, i): FxShot[] => {
          const k = i === 0 ? kind : BattleApp.strikeFx(unit, 'volley');
          return k ? [{ unit, kind: k, offset: (i - (units.length - 1) / 2) * VOLLEY_FX_STAGGER_SEC, spawned: false }] : [];
        });
        const lead = Math.max(FX_ZOOM_IN_SEC, talk);
        exec.fx = {
          kind,
          strikeSec,
          shots,
          lead,
          end: phase.kind === 'strike' ? this.areaEnd(exec.plan) : null,
          area: phase.kind === 'strike' ? this.fxArea(exec.plan, kind) : [],
        };
        exec.duration = lead + strikeSec + FX_HOLD_SEC + FX_ZOOM_OUT_SEC;
        const timing = { in: FX_ZOOM_IN_SEC, hold: lead - FX_ZOOM_IN_SEC + strikeSec + FX_HOLD_SEC, out: FX_ZOOM_OUT_SEC };
        if (phase.kind === 'strike') {
          // 範囲の巻き添えになるユニットも画面に収める
          const a = attack!;
          const splash = splashUnits(map, exec.plan.unit, exec.plan.unit, a.target, a.at, a.id);
          this.focusOn([exec.plan.unit, ...(a.target ? [a.target] : []), ...exec.supporters, ...splash], a.landing, timing, a.at);
        }
        else this.focusOn([phase.shooter, exec.plan.unit], null, timing);
      } else {
        exec.duration = phase.kind === 'strike' && attack!.landing ? CHARGE_SEC : STRIKE_SEC;
      }
      return;
    }
    const { path } = phase;
    for (let i = 1; i < path.length; i++) {
      const shooters = interceptorsAt(map, this.statuses, exec.plan.unit, path[i], (u) => this.rangeBonusAt(u, u));
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
    // 移動していたユニットは、撃たれた HEX（at）で殲滅される
    const w = report.lost ? this.wipeOut(report, plan.unit, plan.status, phase.at, phase.shooter, []) : null;
    if (!report.lost) this.inflict(plan.status, resolveAttack(phase.shooter.type, 'interceptFire'));
    const splash = this.applySplash(report, { unit: phase.shooter, status: ss, pos: phase.shooter }, plan.unit, phase.at, 'interceptFire');
    report.intercepts.push({ unit: phase.shooter, result, targetLeft: Math.max(0, plan.status.soldiers), afterAttack: !!report.attack, halted: false, splash });
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

  /** 予約した攻撃の演出の種類（攻撃の定義の fx。省略は兵種の通常攻撃の演出） */
  static strikeFx(unit: UnitData, id: MenuAttackId): StrikeFxKind | null {
    // 一斉攻撃は、加わる兵種それぞれの通常攻撃の演出
    return resolveAttack(unit.type, id === 'volley' ? 'attack' : id).fx;
  }

  /**
   * 迎撃の自動攻撃の演出の種類。それぞれの兵種の攻撃と同じ演出
   * （弓兵は矢の雨、魔術師は雷、ライフル兵は光の弾、砲兵は大きな光の弾）
   */
  static interceptFx(shooter: UnitData): StrikeFxKind | null {
    return resolveAttack(shooter.type, 'interceptFire').fx;
  }

  /** 攻撃・迎撃のアニメーションの進み具合（0〜1。半分の時点で当たる）。演出のある攻撃はカメラが寄る時間（とセリフを待つ時間）を除く */
  private static strikeT(exec: Execution, elapsed: number): number {
    const fx = exec.fx;
    return fx ? THREE.MathUtils.clamp((elapsed - fx.lead) / fx.strikeSec, 0, 1) : Math.min(elapsed / exec.duration, 1);
  }

  /** 演出のエフェクトを、それぞれ当たりの時点（からずらした時点）に合わせて出す（まだ出していなければ）。target は at にいる */
  private spawnFxOnTime(fx: StrikeFx, elapsed: number, target: UnitData | null, at: Offset): void {
    const layout = this.map!.layout;
    const time = (elapsed - fx.lead) / fx.strikeSec;
    const b = layout.offsetToWorld(at.col, at.row);
    for (const shot of fx.shots) {
      if (shot.spawned || time < 0.5 + (shot.offset - STRIKE_FX[shot.kind].hitSec) / fx.strikeSec) continue;
      shot.spawned = true;
      const a = layout.offsetToWorld(shot.unit.col, shot.unit.row);
      this.spawnStrikeFx(shot.kind, shot.unit, target, at, b.x >= a.x ? 'right' : 'left', fx);
    }
  }

  /** HEX の中心の地面の点（ワールド） */
  private groundPoint(o: Offset): THREE.Vector3 {
    const c = this.map!.layout.offsetToWorld(o.col, o.row);
    return new THREE.Vector3(c.x, this.view.groundAt(c.x, c.z), c.z);
  }

  /** 予約した攻撃の範囲の端の HEX（直線の範囲の攻撃だけ。ほかは null） */
  private areaEnd(plan: Plan): Offset | null {
    const attack = plan.attack;
    if (!attack) return null;
    const def = resolveAttack(plan.unit.type, attack.id);
    if (def.shape.kind !== 'line') return null;
    return areaCells(this.map!, plan.unit, attack.at, def.shape).at(-1) ?? null;
  }

  /** kind の演出で、範囲のエフェクトを出す HEX（なぎ払いは当たるユニット、岩・メテオは範囲、跳ねる雷は目標から跳ぶ順） */
  private fxArea(plan: Plan, kind: StrikeFxKind): Offset[] {
    const attack = plan.attack;
    const map = this.map!;
    if (!attack) return [];
    const splash = splashUnits(map, plan.unit, plan.unit, attack.target, attack.at, attack.id);
    if (kind === 'whirl') return splash.map((u) => ({ col: u.col, row: u.row }));
    if (kind === 'chain') return [...(attack.target ? [attack.target] : []), ...splash].map((u) => ({ col: u.col, row: u.row }));
    if (kind === 'spike' || kind === 'meteor') return areaCells(map, plan.unit, attack.at, resolveAttack(plan.unit.type, attack.id).shape);
    return [];
  }

  /** 演出で当たったときのカメラの揺れ（一斉攻撃は加わるユニットの演出のうち一番大きいもの） */
  private fxShake(fx: StrikeFx): void {
    this.cameraFocus.shake(Math.max(...fx.shots.map((shot) => STRIKE_FX[shot.kind].cameraShake)) * this.map!.layout.size);
  }

  /**
   * 攻撃の演出で、units（先頭が攻撃するユニット）の絵が画面に収まるところまでカメラを寄せる。
   * landing（突撃で飛び出る先）があれば、そこに置いた攻撃するユニットの絵も収める
   */
  private focusOn(units: readonly UnitData[], landing: Offset | null, timing: FocusTiming, aimed: Offset | null = null): void {
    const placements = this.view.units.placements().filter((p) => units.includes(p.unit));
    const self = placements.find((p) => p.unit === units[0]);
    // 突撃で飛び出る先と、狙った地点（ユニットのいない HEX を狙ったとき）も収める
    for (const o of [landing, aimed]) if (o && self) placements.push({ ...self, foot: this.groundPoint(o) });
    this.cameraFocus.play(placements, timing);
  }

  /**
   * 攻撃の演出のエフェクトを出す。target は at にいる目標（いなければ null）。fx は範囲の端の HEX（直線に吹く炎が届くところ）と
   * 範囲のエフェクトを出す HEX を持つ
   */
  private spawnStrikeFx(kind: StrikeFxKind, unit: UnitData, target: UnitData | null, at: Offset, facing: Facing, fx: StrikeFx | null = null): void {
    const placements = this.view.units.placements();
    const size = this.map!.layout.size;
    const up = placements.find((p) => p.unit === unit);
    const placementAt = (o: Offset) => placements.find((p) => p.unit.col === o.col && p.unit.row === o.row);
    const area = fx?.area ?? [];
    // 範囲に出すもの（目標がいなくても出す）
    if (kind === 'whirl') {
      for (const o of area) {
        const p = placementAt(o);
        if (p && up) this.slashFx.spawn(p, p.foot.x >= up.foot.x ? 'right' : 'left');
      }
      return;
    }
    if (kind === 'spike') return area.forEach((o) => this.impactFx.spawn(this.groundPoint(o), size, SPIKE_STYLE));
    // 光の柱・光線が届いたところで爆発する
    const map = this.map;
    const blastAt = (sec: number) => setTimeout(() => this.map === map && this.impactFx.spawn(this.groundPoint(at), size, BLAST_STYLE), sec * 1000);
    if (kind === 'meteor') {
      // 魔法陣と爆発は範囲の HEX をすべて覆う大きさ（一番遠い HEX の中心まで + HEX の内接円の半径）
      const center = this.groundPoint(at);
      const far = Math.max(0, ...area.map((o) => { const g = this.groundPoint(o); return Math.hypot(g.x - center.x, g.z - center.z); }));
      this.pillarFx.spawn(center, size, far + size * Math.sqrt(3) / 2);
      return void blastAt(PILLAR_HIT_SEC);
    }
    if (kind === 'beam' && up) {
      const from = up.foot.clone().add(new THREE.Vector3(0, up.height * 0.55, 0));
      const to = this.groundPoint(at).add(new THREE.Vector3(0, up.height * 0.3, 0));
      this.beamFx.spawn(from, to, size * 0.45);
      return void blastAt(BEAM_HIT_SEC);
    }
    if (kind === 'chain') {
      // 目標から跳ぶ順に、少しずつ遅らせて雷を落とす
      area.forEach((o, i) => {
        const p = placementAt(o);
        if (p) setTimeout(() => this.map === map && this.thunderFx.spawn(p), i * CHAIN_STEP_SEC * 1000);
      });
      return;
    }
    const tp = target && placements.find((p) => p.unit === target);
    if (!tp) return;
    if ((kind === 'breath' || kind === 'flame') && up) {
      const to = fx?.end ? this.groundPoint(fx.end) : tp.foot;
      return this.breathFx.spawn(up, to, kind === 'breath' ? BREATH_STYLE : FLAME_LANCE_STYLE);
    }
    if (kind === 'smash') return this.impactFx.spawn(tp.foot, size, SMASH_STYLE);
    if (kind === 'frost') return this.impactFx.spawn(tp.foot, size, FROST_STYLE);
    if (kind === 'slash') this.slashFx.spawn(tp, facing);
    else if (kind === 'claw') this.clawFx.spawn(tp, facing);
    else if (kind === 'thunder') this.thunderFx.spawn(tp);
    else if (up && kind === 'lance') this.lanceFx.spawn(up, tp, this.ctx.camera);
    else if (up && kind === 'bullets') this.bulletFx.spawn(up, tp, this.ctx.camera);
    else if (up && kind === 'shell') this.shellFx.spawn(up, tp, this.ctx.camera);
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
    const b = map.layout.offsetToWorld(attack.at.col, attack.at.row);
    const facing: Facing = b.x >= a.x ? 'right' : 'left';
    const target = attack.target;
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
      this.lunge(plan.unit, attack.at, k, attack.id);
    }
    // 一斉攻撃は、取り囲んでいる味方も一緒に踏み込む
    for (const u of exec.supporters) this.lunge(u, attack.at, fx ? holdCurve(t) : strikeCurve(t), 'attack');

    if (fx) this.spawnFxOnTime(fx, elapsed, target, attack.at);
    if (t >= 0.5 && !exec.hit) {
      exec.hit = true;
      this.applyAttack(exec);
      if (fx) this.fxShake(fx);
      const r = exec.report.attack!;
      const losses: [UnitData, UnitData][] = [];
      if (target && r.targetDestroyed) losses.push([target, plan.unit]);
      if (target && r.unitDestroyed) losses.push([plan.unit, target]);
      this.holdForTalk(exec, this.lossTalk(losses));
    }
    if (exec.hit && target) {
      // 当たった相手を揺らす
      const shake = Math.sin(t * 60) * HIT_SHAKE * s * (1 - t) * 2;
      this.view.units.moveTo(target, new THREE.Vector3(b.x + shake, this.view.groundAt(b.x, b.z), b.z));
    }
    if (elapsed < exec.duration) return;
    // 攻撃で壊滅したら飛び出し・続きの移動はしない
    if (exec.report.attack?.unitDestroyed) exec.phases = [];
    else if (landing && map.moveUnit(plan.unit, landing.col, landing.row)) plan.status.moved = true;
    this.view.rebuildUnits();
    this.nextPhase();
  }

  /**
   * unit が target を id の攻撃で攻撃する動き。直接攻撃は相手へ踏み込む。遠隔攻撃（遠隔の兵種か、反撃を受けない攻撃。ブレスなど）は
   * その場で小さく跳ねる（k は踏み込み・跳ねる量の 0〜1）
   */
  private lunge(unit: UnitData, target: Offset, k: number, id: AttackId): void {
    const map = this.map!;
    const a = map.layout.offsetToWorld(unit.col, unit.row);
    const b = map.layout.offsetToWorld(target.col, target.row);
    const ranged = COMBAT_DEFS[unit.type].ranged || resolveAttack(unit.type, id).indirect;
    const lunge = ranged ? 0 : k * STRIKE_LUNGE;
    const x = a.x + (b.x - a.x) * lunge;
    const z = a.z + (b.z - a.z) * lunge;
    const hop = ranged ? k * RANGED_HOP * map.layout.size : 0;
    this.view.units.moveTo(unit, new THREE.Vector3(x, this.view.groundAt(x, z) + hop, z), b.x >= a.x ? 'right' : 'left');
  }

  /**
   * unit が pos で by に殲滅された。そのとき隣接している敵ユニット（exclude の同時に殲滅されたものを除く）の数で、
   * 指揮官が捕縛されるか（されなければ軍の最初の退却先へ落ち延びる）を決めて report に記録する
   */
  private wipeOut(report: Pick<ExecuteReport, 'wipeouts'>, unit: UnitData, status: UnitStatus, pos: Offset, by: UnitData | null, exclude: readonly UnitData[]): WipeoutReport {
    const enemies = adjacentEnemies(this.map!, unit, pos).filter((u) => !exclude.includes(u)).length;
    const captureChance = wipeoutCaptureChance(enemies, status.uncapturable);
    const w: WipeoutReport = {
      unit,
      troopId: this.troopIds.get(unit) ?? null,
      status,
      turn: this.turn,
      by,
      enemies,
      captureChance,
      captured: Math.random() < captureChance,
      to: null,
    };
    if (!w.captured) w.to = this.retreatDestinations(unit)[0] ?? null;
    report.wipeouts.push(w);
    return w;
  }

  /**
   * 目標（at にいる target）を id の攻撃で撃ったときの範囲の巻き添え（ライフル兵の弾が目標の手前の HEX にいるユニットに当たったものなど）の
   * 結果（ランダム係数を振る）を、兵数・士気に反映し、頭上に減った数を出す。撃ったユニットの士気は増減しない（目標への攻撃の分だけ）
   */
  private applySplash(report: ExecuteReport, shooter: Combatant, target: UnitData | null, at: Offset, id: AttackId): SplashHit[] {
    const map = this.map!;
    const placements = this.view.units.placements();
    const attack = resolveAttack(shooter.unit.type, id);
    return splashUnits(map, shooter.unit, shooter.pos, target, at, id).flatMap((unit): SplashHit[] => {
      const status = this.statuses.get(unit);
      if (!status || status.soldiers <= 0) return [];
      const result = splashResult(map, shooter, { unit, status, pos: unit }, id, randomRoll());
      status.soldiers -= result.damage;
      applyMorale(status, result.morale.defender);
      const destroyed = status.soldiers <= 0;
      if (!destroyed) this.inflict(status, attack);
      const w = destroyed ? this.wipeOut(report, unit, status, unit, shooter.unit, []) : null;
      // 味方に当たったときだけ巻き添えと出す
      const friendly = unit.team === shooter.unit.team;
      const p = placements.find((x) => x.unit === unit);
      if (p) this.popups.show(p, `${friendly ? '巻き添え ' : ''}-${result.damage}${wipeoutLabel(w)}`, 'damage');
      return [{ unit, friendly, result, left: Math.max(0, status.soldiers), destroyed }];
    });
  }

  /** 攻撃が当たったユニット（status）に、攻撃の inflicts の状態をそれぞれの確率で付ける */
  private inflict(status: UnitStatus, attack: ResolvedAttack): void {
    for (const { condition, chance, turns } of attack.inflicts) if (Math.random() < chance) setCondition(status, condition, turns);
  }

  /** 攻撃の結果（ランダム係数を振る）を兵数・士気に反映し、頭上に減った数を出す */
  private applyAttack(exec: Execution): void {
    const map = this.map!;
    const { plan, report } = exec;
    const attack = plan.attack!;
    const target = attack.target;
    const ts = target ? (this.statuses.get(target) ?? null) : null;
    const rolls = { damage: randomRoll(), counter: randomRoll() };
    const def = resolveAttack(plan.unit.type, attack.id);
    const attacker = { unit: plan.unit, status: plan.status, pos: plan.unit };
    const result = target && ts ? attackResult(map, attacker, { unit: target, status: ts, pos: target }, attack.id, rolls) : null;
    if (result && ts) {
      ts.soldiers -= result.damage;
      plan.status.soldiers -= result.counter;
      applyMorale(ts, result.morale.defender);
      applyMorale(plan.status, result.morale.attacker);
    }
    plan.status.attacked = true;
    plan.status.justAttacked = true;
    // クールタイム: 使った次の自分の番から cooldown 回の番は使えない（番が始まるたびに減らすので 1 多く入れる）
    if (def.cooldown > 0) plan.status.cooldowns[attack.id] = def.cooldown + 1;
    if (ts && ts.soldiers > 0) this.inflict(ts, def);
    report.attack = {
      ...attack,
      result,
      targetDestroyed: !!ts && ts.soldiers <= 0,
      unitDestroyed: plan.status.soldiers <= 0,
      unitLeft: Math.max(0, plan.status.soldiers),
      targetLeft: ts ? Math.max(0, ts.soldiers) : 0,
      splash: [],
    };

    // 殲滅されたユニットの指揮官の捕縛（相討ちなら、相手は隣接する敵に数えない）
    const both = report.attack.targetDestroyed && report.attack.unitDestroyed;
    const tw = target && ts && report.attack.targetDestroyed ? this.wipeOut(report, target, ts, target, plan.unit, both ? [plan.unit] : []) : null;
    const uw = target && report.attack.unitDestroyed ? this.wipeOut(report, plan.unit, plan.status, plan.unit, target, both ? [target] : []) : null;
    report.attack.splash = this.applySplash(report, attacker, target, attack.at, attack.id);
    // 目標の無い攻撃（乱撃・敵のいない地点）は、敵に与えたダメージの合計で士気が上がる
    if (!result) {
      const dealt = report.attack.splash.filter((h) => !h.friendly).reduce((sum, h) => sum + h.result.damage, 0);
      applyMorale(plan.status, moraleChange(dealt, 0, mightOf(plan.unit, plan.status), 50).attacker);
    }

    const placements = this.view.units.placements();
    const at = (u: UnitData) => placements.find((p) => p.unit === u);
    const tp = target && at(target);
    const up = at(plan.unit);
    if (!result) return;
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
    const splash = [...(report.attack?.splash ?? []), ...report.intercepts.flatMap((i) => i.splash)];
    const removed = [report.attack?.targetDestroyed && report.attack.target, gone && report.unit, ...splash.map((h) => h.destroyed && h.unit)];
    const wasAuto = this.autoRunning;
    this.autoRunning = false;
    for (const u of removed) {
      if (!u) continue;
      map.removeUnit(u.col, u.row);
      const leader = this.statuses.get(u)?.name;
      if (leader) this.goneLeaders.set(u, leader);
      this.statuses.delete(u);
    }
    if (removed.some(Boolean)) this.tags.setStatuses(this.statuses);
    this.view.rebuildUnits();
    // 動いた先で選び直す（残りの行動力でメニューを開く）
    // 混乱して勝手に動いたユニットは選ばない
    this.setSelected(gone || wasAuto ? null : { col: report.unit.col, row: report.unit.row });
    this.refreshMarks();
    // 軍団長の部隊がいなくなったら、その陣営の負け（強制退却で退却したときは、もう決着している）
    const loseCommander = (unit: UnitData, status: UnitStatus, reason: CommanderLoss['reason']) => this.markFallen(unit, status, reason);
    if (report.retreat) {
      this.retreated.push(report.retreat);
      if (!report.retreat.forced) loseCommander(report.retreat.unit, report.retreat.status, 'commanderRetreat');
      this.emit('retreat', report.retreat);
    }
    for (const w of report.wipeouts) {
      this.wipedOut.push(w);
      loseCommander(w.unit, w.status, 'commander');
      this.emit('wipeout', w);
    }
    this.emit('execute', report);
    // もう行動できなくなった（行動済みの印が付いた）ら、そのユニットは行動を終えた
    this.judge(!gone && this.done.has(report.unit) ? [report.unit] : []);
  }

  /**
   * 決着したか調べ、決着していたら戦闘を終える。軍団長部隊の全滅・退却、入城で負けた陣営に部隊が残っていて退却先もあれば、
   * 先に強制退却させる（強制退却の間は、1 部隊が退却し終えるたびに次の部隊へ進む）。
   * ended はいま行動を終えたユニット（防衛拠点にいる攻撃側のユニットなら入城）
   */
  private judge(ended: readonly UnitData[] = []): void {
    const map = this.map;
    if (!map || this.deployment || this.outcome) return;
    if (this.rout) return this.nextRout();
    const outcome = judgeBattle(map, this.stronghold, ended, this.judged, this.turn, this.fallen);
    if (!outcome) return;
    const team = SIDE_TEAM[loserOf(outcome)];
    // 退却できない部隊（ブレイン）は戦場に残る
    const left = map.allUnits().filter((u) => u.team === team && !this.statuses.get(u)?.noRetreat);
    if (left.length === 0 || !this.retreats[team]?.length) return this.endBattle(outcome);
    this.rout = { outcome, team, queue: left };
    this.setSelected(null);
    this.refreshMarks();
    this.emit('rout', outcome, left);
    this.nextRout();
  }

  /** 強制退却で、次の部隊を選んで退却先の拠点の一覧を出す（カメラをその部隊へ動かす）。残っていなければ戦闘を終える */
  private nextRout(): void {
    const rout = this.rout!;
    const map = this.map!;
    let unit = rout.queue.shift();
    while (unit && !map.allUnits().includes(unit)) unit = rout.queue.shift();
    if (!unit) {
      this.rout = null;
      return this.endBattle(rout.outcome);
    }
    this.setSelected({ col: unit.col, row: unit.row });
    this.openRetreat(unit, true);
    const p = this.view.units.placements().find((x) => x.unit === unit);
    if (p) this.cameraFocus.panTo(p.foot);
  }

  /**
   * 戦闘を終える（選択を外し、行動済みの印を消して end で知らせる）。戦場に残った部隊を outcome.remaining に、
   * 勝った陣営が捕縛した指揮官（退却に失敗した・殲滅されて捕縛された負けた陣営の部隊。退却・殲滅の順）を outcome.captives に付ける
   */
  private endBattle(judged: BattleOutcome): void {
    const remaining = (this.map?.allUnits() ?? []).flatMap((unit) => {
      const status = this.statuses.get(unit);
      return status ? [{ unit, troopId: this.troopIds.get(unit) ?? null, status }] : [];
    });
    const loser = SIDE_TEAM[loserOf(judged)];
    const captives = [
      ...this.retreated.map((r) => ({ ...r, cause: 'retreat' as const })),
      ...this.wipedOut.map((w) => ({ ...w, cause: 'wipeout' as const })),
    ]
      .filter((r) => r.captured && r.unit.team === loser)
      .map(({ unit, troopId, status, turn, cause }): CapturedUnit => ({ unit, troopId, status, turn, cause }));
    const outcome: BattleOutcome = { ...judged, remaining, captives };
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
    const talk = exec.supporters.length > 0 && attack.target ? this.exchange([unit, ...exec.supporters], attack.target, BARK_BEFORE_SEC) : 0;
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
    const attacks = attacksOf(plan.unit.type, plan.status);
    // 狙える相手のいる攻撃（自分が中心の攻撃は、範囲に敵がいるとき）
    const targetable = attacks.filter((id) =>
      resolveAttack(plan.unit.type, id).aim === 'self'
        ? splashUnits(map, plan.unit, pos, null, pos, id).some((u) => u.team !== plan.unit.team)
        : attackTargets(map, plan.unit, pos, id, this.rangeBonusAt(plan.unit, pos)).length > 0,
    );
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
      hasTargets: targetable.length > 0,
      targetable,
      hasVolleyTargets: attacks.includes('volley') && attackTargets(map, plan.unit, pos, 'volley').some((t) => volleySupporters(map, plan.unit, t).length > 0),
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
    if (this.targeting?.kind === 'attack') this.paintAttackRange(this.targeting, o);
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
    this.menuAvoid = [];
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
    this.clawFx.update(this.ctx.camera);
    this.breathFx.update();
    this.impactFx.update(this.ctx.camera);
    this.beamFx.update(this.ctx.camera);
    this.pillarFx.update(this.ctx.camera);
    this.gunshipFx.update(this.ctx.camera);
    if (this.salvo) this.stepSalvo(performance.now());
    // 混乱したユニットを順に勝手に動かす
    if (!this.exec && this.autoQueue.length > 0 && performance.now() >= this.autoAt) this.nextAuto();
    this.lanceFx.update(this.ctx.camera);
    this.arrowFx.update(this.ctx.camera);
    this.thunderFx.update(this.ctx.camera);
    this.bulletFx.update(this.ctx.camera);
    this.shellFx.update(this.ctx.camera);
    // 輪は描画の前に足元へ合わせる（移動のアニメーションで動かした絵に同じフレームで付いていく）
    this.interceptFx.update(this.view.units.placements(), this.statuses, this.map?.layout.size ?? 1, this.view.display.units);
    this.view.render();
    const placements = this.view.units.placements();
    this.tags.update(placements, this.ctx.camera, this.view.display.units, this.hovered, this.selected);
    this.menu.update(this.menuAnchor(placements), this.ctx.camera, this.container.clientWidth, this.container.clientHeight, this.menuAvoid);
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
 * 直接攻撃は踏み込んだまま当てて戻る。弓兵は矢を放ち始めてから放ち終えるまで、魔術師は雷を呼んでから落ちるまで、
 * ライフル兵は弾を撃ち始めてから撃ち終えるまでに 1 回跳ねる。砲兵は撃った反動で 1 回跳ねる
 */
function fxMotion(fx: StrikeFx, t: number): number {
  if (fx.kind === 'arrows') return hopCurve(t, fx.strikeSec, ARROW_HIT_SEC, ARROW_RELEASE_SEC);
  if (fx.kind === 'thunder') return hopCurve(t, fx.strikeSec, THUNDER_CAST_SEC, THUNDER_CAST_SEC);
  if (fx.kind === 'bullets') return hopCurve(t, fx.strikeSec, BULLET_STYLE.hitSec, BULLET_STYLE.fireSpread);
  if (fx.kind === 'shell') return hopCurve(t, fx.strikeSec, SHELL_STYLE.hitSec, SHELL_RECOIL_SEC);
  return holdCurve(t);
}

/** 当たりの時点（t = 0.5）の beforeHit 秒前から duration 秒の間に 1 回跳ねる量（strikeSec は攻撃のアニメーションの時間） */
function hopCurve(t: number, strikeSec: number, beforeHit: number, duration: number): number {
  const u = (t - 0.5 + beforeHit / strikeSec) / (duration / strikeSec);
  return u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0;
}
