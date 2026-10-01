/**
 * 戦闘画面。マップの描画は map-editor と同じ MapView を使い、パラメータは map-editor の初期値のまま。
 * 戦闘の UI・演出はここに積み上げていく。
 *
 * 行動は予約してから「決定」でまとめて実行する:
 * ユニットを選択 → 行動メニュー → 移動 → 移動先を選ぶ → 移動先でメニュー → … → 攻撃 → 相手を選ぶ → 決定。
 * - 移動は何回かに分けて予約でき、予約したルートは地面に矢印で出す。
 * - 攻撃は 1 ターンに 1 回で、予約した移動先から射程内の敵を選ぶ。相手へ赤い矢印を出す（遠隔攻撃は放物線）。
 *   一斉攻撃は、ほかの味方とも隣接している敵（金の斜線）しか選べない。ほかの敵を選ぶと「包囲していません」でやり直し。
 *   実行すると、相手に隣接している味方も一緒に踏み込んで攻撃する。
 *   攻撃を予約した後は移動できない。騎兵だけは攻撃の後にも移動を予約できる（ZOC の中からは動けないので、
 *   実際に動けるのは相手を壊滅させて ZOC が消えたときなど）。
 * - 突撃（騎兵）は相手を突き抜けて向こうの HEX へ飛び出る。飛び出る先は予約のときに決め、矢印もそこまで伸ばす。
 * - 決定でユニットがルートに沿って歩き、攻撃し、（騎兵なら）続きを歩く（その間は操作を受け付けない）。
 *   兵数が 0 になったユニットは消える。
 * - 迎撃は選んだらすぐに実行する。予約した移動があればそこまで歩き、迎撃の構えで待機して行動を終える（行動力は 0 になる）。
 *   構えは次にそのユニットが行動するまで続く（ターンをまたいでも続く）。
 *   近接ユニットの構えは、受けるダメージを減らして反撃を増やす（damage.ts）。
 *   間接ユニットの構えは、敵が歩いて射程に入った HEX でその敵を止めて 1 回だけ自動で攻撃し、構えを解く。
 *   撃たれた敵は壊滅しなければ続きを歩く。
 *
 * ターン終了で全ユニットの行動力が最大まで戻る。敵の ZOC の中のユニットは、そのターンにまだ移動も攻撃もしていなければ動き出せる。
 *
 * メニューの「取消」で予約をすべて取り消す。
 * Esc: 移動先・攻撃の相手を選ぶのをやめる → 2 階層目を閉じる → 予約を 1 つ戻す → 選択を外す。
 */
import * as THREE from 'three';
import type { Offset } from '@norden/map-runtime/core/hex';
import { Polyline, smoothPath } from '@norden/map-runtime/core/polyline';
import { HexMap, type HexCell, type MapData } from '@norden/map-runtime/core/mapData';
import type { Facing, UnitData } from '@norden/map-runtime/core/units';
import { MapView } from '@norden/map-runtime/render/mapView';
import { SceneContext } from '@norden/map-runtime/render/scene';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import type { MenuAction } from './actions';
import { ActionMenu } from './actionMenu';
import {
  attackForecast,
  attackResult,
  attackTargets,
  chargeLanding,
  COMBAT_DEFS,
  interceptorsAt,
  isAttack,
  volleySupporters,
  type AttackForecast,
  type AttackResult,
} from './combat';
import { randomRoll } from './damage';
import { InterceptEffects } from './interceptFx';
import { applyMorale } from './morale';
import { inEnemyZoc, movePath, moveRange, type MoveOptions, type MoveStep } from './movement';
import { Popups } from './popups';
import { UnitTags } from './unitTags';
import { demoStatuses, type UnitStatus } from './unitStatus';

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
  /** 迎撃の構えをとったか（迎撃コマンド） */
  intercept: boolean;
}

/** 迎撃の自動攻撃 1 回分 */
export interface InterceptReport {
  /** 攻撃した（迎撃の構えの）ユニット */
  unit: UnitData;
  result: AttackResult;
  /** 攻撃を受けた後の、移動していたユニットの兵数 */
  targetLeft: number;
  /** 予約した攻撃の後の移動で受けたか */
  afterAttack: boolean;
}

/** 移動先・攻撃の相手を選んでいる状態 */
type Targeting =
  | { kind: 'move'; cells: Map<number, MoveStep> }
  | { kind: 'attack'; action: MenuAction; cells: Map<number, UnitData> };

/**
 * 実行の 1 段階。
 * - walk: path に沿って歩く。commit なら着いた HEX へ移動を確定する（迎撃で止まった途中の HEX では確定しない）
 * - strike: 予約した攻撃をする
 * - intercept: shooter（迎撃の構えの間接ユニット）が、at まで歩いてきたユニットを攻撃する
 */
type Phase =
  | { kind: 'walk'; path: Offset[]; commit: boolean }
  | { kind: 'strike' }
  | { kind: 'intercept'; shooter: UnitData; at: Offset };

/** 決定した予約の実行（アニメーション）。phases を順に進める */
interface Execution {
  plan: Plan;
  report: ExecuteReport;
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
}

export class BattleApp {
  readonly ctx: SceneContext;
  readonly view: MapView;
  /** ユニットの頭上の情報札（顔・兵士数・士気） */
  readonly tags: UnitTags;
  /** 選択中のユニットの行動メニュー */
  readonly menu: ActionMenu;
  /** 兵数の減少などを頭上に出す */
  readonly popups: Popups;
  /** 迎撃の構えのユニットの足元の光の輪 */
  readonly interceptFx = new InterceptEffects();
  /** 戦闘中のユニットの状態 */
  statuses = new Map<UnitData, UnitStatus>();
  /** 選択中のユニットの HEX */
  selected: Offset | null = null;
  hovered: Offset | null = null;
  /** 選択中のユニットの予約（選択していなければ null） */
  plan: Plan | null = null;
  /** 何ターン目か（1 から） */
  turn = 1;

  onHover: (cell: HexCell | null, unit: UnitData | null) => void = () => {};
  onSelect: (cell: HexCell | null, unit: UnitData | null) => void = () => {};
  /** 行動メニューで行動を選んだとき（決定・取消を除く） */
  onAction: (unit: UnitData, action: MenuAction) => void = () => {};
  /** 予約が増えた・減ったとき */
  onPlanChange: (plan: Plan) => void = () => {};
  /** 移動先・攻撃の相手を選ぶ状態をやめたとき */
  onTargetCancel: () => void = () => {};
  /** 選べない攻撃の相手を選んだとき（選び直しになる） */
  onTargetReject: (reason: string) => void = () => {};
  /** ターンが変わったとき */
  onTurn: (turn: number) => void = () => {};
  /** 決定で予約を実行し終えたとき */
  onExecute: (report: ExecuteReport) => void = () => {};

  private targeting: Targeting | null = null;
  private exec: Execution | null = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private pointerDirty = false;
  private downPos: { x: number; y: number } | null = null;

  constructor(container: HTMLElement) {
    this.ctx = new SceneContext(container);
    this.view = new MapView(this.ctx);
    this.tags = new UnitTags(container);
    this.menu = new ActionMenu(container);
    this.popups = new Popups(container);
    this.ctx.overlay.add(this.interceptFx.group);
    this.menu.onAction = (unit, action) => {
      if (action.id === 'confirm') return this.execute(false);
      if (action.id === 'intercept') return this.execute(true);
      if (action.id === 'cancel') return this.clearPlan();
      if (action.id === 'move') this.startMove();
      else if (isAttack(action.id)) this.startAttack(action);
      this.onAction(unit, action);
    };
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
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.exec) return;
      if (this.targeting) this.cancelTargeting();
      else if (this.menu.closeSub()) return;
      else if (this.plan && BattleApp.planned(this.plan)) this.undo();
      else this.setSelected(null);
    });
    this.ctx.renderer.setAnimationLoop(() => this.frame());
  }

  get map(): HexMap | null {
    return this.view.map;
  }

  loadMap(data: MapData): void {
    const map = new HexMap(data);
    this.exec = null;
    this.popups.clear();
    this.statuses = demoStatuses(map.allUnits());
    this.tags.setStatuses(this.statuses);
    this.view.setMap(map);
    this.setSelected(null);
    this.turn = 1;
    this.onTurn(this.turn);
  }

  /** ターンを終える。選択と予約を捨て、全ユニットの行動力を最大まで戻して移動済み・攻撃済みを消す（実行中は何もしない） */
  endTurn(): boolean {
    if (this.exec || !this.map) return false;
    this.setSelected(null);
    for (const status of this.statuses.values()) {
      status.ap = status.maxAp;
      status.moved = false;
      status.attacked = false;
    }
    this.turn++;
    this.onTurn(this.turn);
    return true;
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

  /** 続きの移動を探すときの条件。ターンの初めだけ敵の ZOC から動き出せる */
  static moveOptions(plan: Plan): MoveOptions {
    return { spent: BattleApp.planCost(plan), escapeZoc: BattleApp.turnStart(plan) };
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
    const map = this.map;
    const unit = o && map?.unitAt(o.col, o.row);
    const isSelf = !!unit && unit === this.plan?.unit;
    const t = this.targeting;
    if (t && map) {
      const key = o ? o.row * map.layout.cols + o.col : -1;
      if (t.kind === 'move' && t.cells.has(key)) this.addLeg(t.cells.get(key)!);
      else if (t.kind === 'attack' && t.cells.has(key)) {
        const target = t.cells.get(key)!;
        const reason = this.rejectReason(t.action, target);
        if (reason) this.onTargetReject(reason);
        else this.setAttack(t.action, target);
      }
      // ほかのユニットは選び直し、それ以外（範囲外・自分）はメニューに戻る
      else if (unit && !isSelf) this.setSelected(o);
      else this.cancelTargeting();
      return;
    }
    // 選択中のユニットをもう一度クリックしたときはそのまま（予約を捨てない）
    if (isSelf) return;
    // ユニットのいる HEX ならそのユニットを選択し、いない HEX なら選択を外す
    this.setSelected(unit ? o : null);
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
    const cells = new Map(attackTargets(map, plan.unit, BattleApp.planPos(plan)).map((u) => [u.row * cols + u.col, u]));
    this.targeting = { kind: 'attack', action, cells };
    // 一斉攻撃は、選べる（ほかの味方と取り囲んだ）相手に印を付ける
    const range = [...cells.values()].map((u) => ({ col: u.col, row: u.row, mark: action.id === 'volley' && !this.rejectReason(action, u) }));
    this.view.setRange(range, ATTACK_RANGE_COLOR, VOLLEY_MARK_COLOR);
    this.menu.suspended = true;
    this.setHover(this.hovered);
  }

  /** 移動先・攻撃の相手を選ぶ状態をやめてメニューに戻る */
  private cancelTargeting(): void {
    if (!this.targeting) return;
    this.endTargeting();
    this.onTargetCancel();
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
    this.view.setPath(plan.legs.length > 0 ? movePath(plan.legs) : null);
    this.showAttackArrow(plan);
    this.openMenu();
    this.onPlanChange(plan);
  }

  private showAttackArrow(plan: Plan | null): void {
    if (!plan?.attack) return this.view.setAttack(null, null);
    const { target, landing } = plan.attack;
    this.view.setAttack(BattleApp.attackPos(plan), target, COMBAT_DEFS[plan.unit.type].ranged, landing);
  }

  /**
   * 予約を実行する。攻撃の前の移動 → 攻撃 → 攻撃の後の移動（騎兵）の順に進める。
   * intercept なら予約した移動の後に迎撃の構えをとる（攻撃は予約していない）。
   */
  private execute(intercept: boolean): void {
    const plan = this.plan;
    if (!this.map || !plan || (!intercept && !BattleApp.planned(plan))) return;
    const report: ExecuteReport = {
      unit: plan.unit,
      from: { col: plan.unit.col, row: plan.unit.row },
      moveCost: BattleApp.moveCost(plan),
      cost: BattleApp.planCost(plan),
      intercepts: [],
      lost: false,
      intercept,
    };
    // 行動したら迎撃の構えは解ける
    plan.status.intercepting = false;
    const split = plan.attack?.afterLeg ?? plan.legs.length;
    const walk = (legs: MoveStep[]): Phase => ({ kind: 'walk', path: legs.length > 0 ? movePath(legs) : [], commit: true });
    const phases: Phase[] = [walk(plan.legs.slice(0, split)), ...(plan.attack ? [{ kind: 'strike' as const }, walk(plan.legs.slice(split))] : [])];
    this.menu.open(null);
    this.exec = { plan, report, phases, phase: phases[0], start: 0, duration: 0, line: null, facing: undefined, hit: false, supporters: [] };
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
      return this.finish(exec.plan, exec.report);
    }
    exec.start = performance.now();
    exec.hit = false;
    if (phase.kind !== 'walk') {
      exec.phase = phase;
      exec.duration = phase.kind === 'strike' && exec.plan.attack!.landing ? CHARGE_SEC : STRIKE_SEC;
      const attack = exec.plan.attack;
      exec.supporters = phase.kind === 'strike' && attack?.action.id === 'volley' ? volleySupporters(map, exec.plan.unit, attack.target) : [];
      return;
    }
    const { path } = phase;
    for (let i = 1; i < path.length; i++) {
      const shooters = interceptorsAt(map, this.statuses, exec.plan.unit, path[i]);
      if (shooters.length === 0) continue;
      exec.phases.unshift(
        ...shooters.map((shooter): Phase => ({ kind: 'intercept', shooter, at: path[i] })),
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
    if (this.map!.moveUnit(plan.unit, to.col, to.row)) plan.status.moved = true;
    this.view.rebuildUnits();
  }

  /** 迎撃のアニメーションを進める。迎撃したユニットはその場で跳ね、半分の時点で当てて兵数を減らす */
  private stepIntercept(exec: Execution, phase: Extract<Phase, { kind: 'intercept' }>, now: number): void {
    const map = this.map!;
    const s = map.layout.size;
    const t = Math.min((now - exec.start) / 1000 / exec.duration, 1);
    const a = map.layout.offsetToWorld(phase.shooter.col, phase.shooter.row);
    const b = map.layout.offsetToWorld(phase.at.col, phase.at.row);
    const hop = Math.sin(Math.min(t * 2, 1) * Math.PI) * RANGED_HOP * s;
    this.view.units.moveTo(phase.shooter, new THREE.Vector3(a.x, this.view.groundAt(a.x, a.z) + hop, a.z), b.x >= a.x ? 'right' : 'left');
    if (t >= 0.5 && !exec.hit) {
      exec.hit = true;
      this.applyIntercept(exec, phase);
    }
    if (exec.hit) {
      const shake = Math.sin(t * 60) * HIT_SHAKE * s * (1 - t) * 2;
      this.view.units.moveTo(exec.plan.unit, new THREE.Vector3(b.x + shake, this.view.groundAt(b.x, b.z), b.z));
    }
    if (t < 1) return;
    // 壊滅したらそこで打ち切る
    if (exec.report.lost) exec.phases = [];
    this.nextPhase();
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
    report.intercepts.push({ unit: phase.shooter, result, targetLeft: Math.max(0, plan.status.soldiers), afterAttack: !!report.attack });
    const p = this.view.units.placements().find((x) => x.unit === plan.unit);
    if (p) this.popups.show(p, report.lost ? `迎撃 -${result.damage} 壊滅` : `迎撃 -${result.damage}`, 'damage');
  }

  /**
   * 攻撃のアニメーションを進める。直接攻撃は相手へ踏み込み、半分の時点で当てて兵数を減らす。
   * 突撃で飛び出せるときは、相手を突き抜けて向こうの HEX まで駆け抜け、着いたらそこへ移動を確定する。
   */
  private stepStrike(exec: Execution, now: number): void {
    const map = this.map!;
    const s = map.layout.size;
    const { plan } = exec;
    const attack = plan.attack!;
    const t = Math.min((now - exec.start) / 1000 / exec.duration, 1);
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
      this.lunge(plan.unit, attack.target, t);
    }
    // 一斉攻撃は、取り囲んでいる味方も一緒に踏み込む
    for (const u of exec.supporters) this.lunge(u, attack.target, t);

    if (t >= 0.5 && !exec.hit) {
      exec.hit = true;
      this.applyAttack(exec);
    }
    if (exec.hit) {
      // 当たった相手を揺らす
      const shake = Math.sin(t * 60) * HIT_SHAKE * s * (1 - t) * 2;
      this.view.units.moveTo(attack.target, new THREE.Vector3(b.x + shake, this.view.groundAt(b.x, b.z), b.z));
    }
    if (t < 1) return;
    // 攻撃で壊滅したら飛び出し・続きの移動はしない
    if (exec.report.attack?.unitDestroyed) exec.phases = [];
    else if (landing && map.moveUnit(plan.unit, landing.col, landing.row)) plan.status.moved = true;
    this.view.rebuildUnits();
    this.nextPhase();
  }

  /** unit が target を攻撃する動き。直接攻撃は相手へ踏み込んで戻る。遠隔攻撃はその場で小さく跳ねる（t は 0〜1） */
  private lunge(unit: UnitData, target: Offset, t: number): void {
    const map = this.map!;
    const a = map.layout.offsetToWorld(unit.col, unit.row);
    const b = map.layout.offsetToWorld(target.col, target.row);
    const ranged = COMBAT_DEFS[unit.type].ranged;
    const k = Math.sin(Math.min(t * 2, 1) * Math.PI);
    const lunge = ranged ? 0 : k * STRIKE_LUNGE;
    const x = a.x + (b.x - a.x) * lunge;
    const z = a.z + (b.z - a.z) * lunge;
    const hop = ranged ? k * RANGED_HOP * map.layout.size : 0;
    this.view.units.moveTo(unit, new THREE.Vector3(x, this.view.groundAt(x, z) + hop, z), b.x >= a.x ? 'right' : 'left');
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
    report.attack = {
      ...attack,
      result,
      targetDestroyed: ts.soldiers <= 0,
      unitDestroyed: plan.status.soldiers <= 0,
      unitLeft: Math.max(0, plan.status.soldiers),
      targetLeft: Math.max(0, ts.soldiers),
    };

    const placements = this.view.units.placements();
    const at = (u: UnitData) => placements.find((p) => p.unit === u);
    const tp = at(attack.target);
    const up = at(plan.unit);
    const label = result.supporters > 0 ? `一斉 -${result.damage}` : `-${result.damage}`;
    if (tp) this.popups.show(tp, report.attack.targetDestroyed ? `${label} 壊滅` : label, 'damage');
    if (up && result.direct) this.popups.show(up, report.attack.unitDestroyed ? `-${result.counter} 壊滅` : `-${result.counter}`, 'counter');
  }

  /** 実行を終える。行動力を使い、兵数が 0 になったユニットを消し、生き残っていれば選び直す */
  private finish(plan: Plan, report: ExecuteReport): void {
    const map = this.map!;
    const lost = report.lost || !!report.attack?.unitDestroyed;
    plan.status.ap -= report.cost;
    // 迎撃の構えをとったら、残りの行動力に関わらず行動を終える
    if (report.intercept && !lost) {
      plan.status.intercepting = true;
      plan.status.ap = 0;
    }
    const removed = [report.attack?.targetDestroyed && report.attack.target, lost && report.unit];
    for (const u of removed) {
      if (!u) continue;
      map.removeUnit(u.col, u.row);
      this.statuses.delete(u);
    }
    if (removed.some(Boolean)) this.tags.setStatuses(this.statuses);
    this.view.rebuildUnits();
    // 動いた先で選び直す（残りの行動力でメニューを開く）
    this.setSelected(lost ? null : { col: report.unit.col, row: report.unit.row });
    this.onExecute(report);
  }

  private openMenu(): void {
    const map = this.map;
    const plan = this.plan;
    if (!map || !plan) return this.menu.open(null);
    const pos = BattleApp.planPos(plan);
    const options = BattleApp.moveOptions(plan);
    const targets = attackTargets(map, plan.unit, pos);
    this.menu.open({
      unit: plan.unit,
      status: plan.status,
      ap: plan.status.ap - BattleApp.planCost(plan),
      canMove: moveRange(map, plan.unit, pos, plan.status.ap, options).size > 0,
      zocLocked: inEnemyZoc(map, plan.unit, pos) && !options.escapeZoc,
      turnStart: BattleApp.turnStart(plan),
      planned: BattleApp.planned(plan),
      attackPlanned: !!plan.attack,
      canMoveAfterAttack: !!COMBAT_DEFS[plan.unit.type].moveAfterAttack,
      hasTargets: targets.length > 0,
      hasVolleyTargets: targets.some((t) => volleySupporters(map, plan.unit, t).length > 0),
    });
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
    this.onHover(...this.cellAndUnit(o));
  }

  /** ユニットを選択する（予約は捨てる） */
  private setSelected(o: Offset | null): void {
    if (this.targeting) this.endTargeting();
    this.selected = o;
    this.view.setFocus(o);
    this.view.setPath(null);
    this.showAttackArrow(null);
    const [cell, unit] = this.cellAndUnit(o);
    const status = unit && this.statuses.get(unit);
    this.plan = unit && status ? { unit, status, legs: [], attack: null } : null;
    this.openMenu();
    this.onSelect(cell, unit);
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
    // 輪は描画の前に足元へ合わせる（移動のアニメーションで動かした絵に同じフレームで付いていく）
    this.interceptFx.update(this.view.units.placements(), this.statuses, this.map?.layout.size ?? 1, this.view.display.units);
    this.view.render();
    const placements = this.view.units.placements();
    this.tags.update(placements, this.ctx.camera, this.view.display.units, this.hovered, this.selected);
    this.menu.update(this.menuAnchor(placements), this.ctx.camera);
    this.popups.update(this.ctx.camera);
  }
}
