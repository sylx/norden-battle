/**
 * 戦闘画面。マップの描画は map-editor と同じ MapView を使い、パラメータは map-editor の初期値のまま。
 * 戦闘の UI・演出はここに積み上げていく。
 *
 * 行動は予約してから「決定」でまとめて実行する:
 * ユニットを選択 → 行動メニュー → 移動 → 移動先を選ぶ → 移動先でメニュー → … → 攻撃 → 相手を選ぶ → 決定。
 * - 移動は何回かに分けて予約でき、予約したルートは地面に矢印で出す。
 * - 攻撃は 1 ターンに 1 回で、予約した移動先から射程内の敵を選ぶ。相手へ赤い矢印を出す（遠隔攻撃は放物線）。
 *   攻撃を予約した後は移動できない。騎兵だけは攻撃の後にも移動を予約できる（敵の ZOC の中からでも動き出せる）。
 * - 決定でユニットがルートに沿って歩き、攻撃し、（騎兵なら）続きを歩く（その間は操作を受け付けない）。
 *   兵数が 0 になったユニットは消える。
 *
 * ターン終了で全ユニットの行動力が最大まで戻る。敵の ZOC の中のユニットは、そのターンにまだ移動していなければ動き出せる。
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
import { attackResult, attackTargets, COMBAT_DEFS, hexDistance, isAttack, type AttackResult } from './combat';
import { inEnemyZoc, movePath, moveRange, type MoveOptions, type MoveStep } from './movement';
import { Popups } from './popups';
import { UnitTags } from './unitTags';
import { demoStatuses, type UnitStatus } from './unitStatus';

/** 移動できる HEX の色と、そのうち敵の ZOC で止まる HEX の印の色 */
const MOVE_RANGE_COLOR = 0x4aa8ff;
const MOVE_ZOC_COLOR = 0xff8a3a;
/** 攻撃できる相手の HEX の色 */
const ATTACK_RANGE_COLOR = 0xff4a3a;
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
/** 当たったユニットの揺れ（hexSize 比） */
const HIT_SHAKE = 0.05;

/** 予約した攻撃 */
export interface PlannedAttack {
  action: MenuAction;
  target: UnitData;
  /** 何回目の移動の後に攻撃するか（legs のうち、これより前が攻撃前の移動、以降が攻撃後の移動） */
  afterLeg: number;
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
  attack?: PlannedAttack & { result: AttackResult; targetDestroyed: boolean; unitDestroyed: boolean };
}

/** 移動先・攻撃の相手を選んでいる状態 */
type Targeting =
  | { kind: 'move'; cells: Map<number, MoveStep> }
  | { kind: 'attack'; action: MenuAction; cells: Map<number, UnitData> };

/** 実行の 1 段階。walk: ルートに沿って歩く、strike: 攻撃する */
type Phase = { kind: 'walk'; legs: MoveStep[] } | { kind: 'strike' };

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
    this.menu.onAction = (unit, action) => {
      if (action.id === 'confirm') return this.execute();
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
      status.justAttacked = false;
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

  /** 攻撃の相手を選ぶ状態のとき、o のユニットを攻撃したときの結果の予測（攻撃できなければ null） */
  attackPreviewAt(o: Offset | null): AttackResult | null {
    const map = this.map;
    const plan = this.plan;
    if (!o || this.targeting?.kind !== 'attack' || !map || !plan) return null;
    const target = this.targeting.cells.get(o.row * map.layout.cols + o.col);
    const ts = target && this.statuses.get(target);
    if (!target || !ts) return null;
    const distance = hexDistance(map, BattleApp.planPos(plan), target);
    return attackResult(plan.unit, plan.status, target, ts, this.targeting.action.id, distance);
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

  /**
   * 続きの移動を探すときの条件。そのターンにまだ移動していなければ（予約も無ければ）敵の ZOC から動き出せる。
   * 攻撃の直後（騎兵。予約した攻撃の後、または実行した攻撃の後にまだ移動していない）も ZOC から動き出せる。
   */
  static moveOptions(plan: Plan): MoveOptions {
    const turnStart = !plan.status.moved && plan.legs.length === 0;
    const afterAttack = BattleApp.attackIsLast(plan) || (plan.status.justAttacked && plan.legs.length === 0);
    return { spent: BattleApp.planCost(plan), escapeZoc: turnStart || afterAttack };
  }

  /** 攻撃する HEX（攻撃の前の移動の先） */
  static attackPos(plan: Plan): Offset {
    const i = plan.attack?.afterLeg ?? plan.legs.length;
    return i > 0 ? plan.legs[i - 1] : plan.unit;
  }

  /** 予約した移動の先（予約が無ければユニットのいる HEX） */
  static planPos(plan: Plan): Offset {
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
      else if (t.kind === 'attack' && t.cells.has(key)) this.setAttack(t.action, t.cells.get(key)!);
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
    this.view.setRange(cells.values(), ATTACK_RANGE_COLOR);
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
    this.plan!.attack = { action, target, afterLeg: this.plan!.legs.length };
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
    this.view.setAttack(BattleApp.attackPos(plan), plan.attack.target, COMBAT_DEFS[plan.unit.type].ranged);
  }

  /** 予約を実行する。攻撃の前の移動 → 攻撃 → 攻撃の後の移動（騎兵）の順に進める */
  private execute(): void {
    const plan = this.plan;
    if (!this.map || !plan || !BattleApp.planned(plan)) return;
    const report: ExecuteReport = {
      unit: plan.unit,
      from: { col: plan.unit.col, row: plan.unit.row },
      moveCost: BattleApp.moveCost(plan),
      cost: BattleApp.planCost(plan),
    };
    const split = plan.attack?.afterLeg ?? plan.legs.length;
    const phases: Phase[] = [
      { kind: 'walk', legs: plan.legs.slice(0, split) },
      ...(plan.attack ? [{ kind: 'strike' as const }, { kind: 'walk' as const, legs: plan.legs.slice(split) }] : []),
    ];
    this.menu.open(null);
    this.exec = { plan, report, phases, phase: phases[0], start: 0, duration: 0, line: null, facing: undefined, hit: false };
    this.nextPhase();
  }

  /** 実行の次の段階へ進む（空の移動は飛ばす）。段階が無くなったら終える */
  private nextPhase(): void {
    const exec = this.exec!;
    const map = this.map!;
    let phase = exec.phases.shift();
    while (phase?.kind === 'walk' && phase.legs.length === 0) phase = exec.phases.shift();
    if (!phase) {
      this.exec = null;
      return this.finish(exec.plan, exec.report);
    }
    exec.phase = phase;
    exec.start = performance.now();
    exec.hit = false;
    if (phase.kind === 'strike') {
      exec.duration = STRIKE_SEC;
      return;
    }
    exec.line = new Polyline(smoothPath(movePath(phase.legs).map((o) => map.layout.offsetToWorld(o.col, o.row))));
    const hexStep = map.layout.size * Math.sqrt(3);
    exec.duration = Math.max(exec.line.length / hexStep / WALK_HEX_PER_SEC, WALK_MIN_SEC);
    exec.facing = undefined;
  }

  /** 移動のアニメーションを進める。着いたら移動を確定して次の段階へ */
  private stepWalk(exec: Execution, legs: MoveStep[], now: number): void {
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

    // 移動を確定する（ユニットをこの段階の最後の移動先へ動かす）
    const { plan } = exec;
    const to = legs[legs.length - 1];
    if (map.moveUnit(plan.unit, to.col, to.row)) {
      plan.status.moved = true;
      plan.status.justAttacked = false;
    }
    this.view.rebuildUnits();
    this.nextPhase();
  }

  /** 攻撃のアニメーションを進める。直接攻撃は相手へ踏み込み、半分の時点で当てて兵数を減らす */
  private stepStrike(exec: Execution, now: number): void {
    const map = this.map!;
    const s = map.layout.size;
    const { plan } = exec;
    const attack = plan.attack!;
    const t = Math.min((now - exec.start) / 1000 / exec.duration, 1);
    const a = map.layout.offsetToWorld(plan.unit.col, plan.unit.row);
    const b = map.layout.offsetToWorld(attack.target.col, attack.target.row);
    const facing: Facing = b.x >= a.x ? 'right' : 'left';
    // 直接攻撃は相手へ踏み込んで戻る。遠隔攻撃はその場で小さく跳ねる
    const ranged = COMBAT_DEFS[plan.unit.type].ranged;
    const k = Math.sin(Math.min(t * 2, 1) * Math.PI);
    const lunge = ranged ? 0 : k * STRIKE_LUNGE;
    const ax = a.x + (b.x - a.x) * lunge;
    const az = a.z + (b.z - a.z) * lunge;
    const hop = ranged ? k * 0.05 * s : 0;
    this.view.units.moveTo(plan.unit, new THREE.Vector3(ax, this.view.groundAt(ax, az) + hop, az), facing);

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
    // 攻撃で壊滅したら続きの移動はしない
    if (exec.report.attack?.unitDestroyed) exec.phases = [];
    this.view.rebuildUnits();
    this.nextPhase();
  }

  /** 攻撃の結果を兵数に反映し、頭上に減った数を出す */
  private applyAttack(exec: Execution): void {
    const map = this.map!;
    const { plan, report } = exec;
    const attack = plan.attack!;
    const ts = this.statuses.get(attack.target)!;
    const result = attackResult(plan.unit, plan.status, attack.target, ts, attack.action.id, hexDistance(map, plan.unit, attack.target));
    ts.soldiers -= result.damage;
    plan.status.soldiers -= result.counter;
    plan.status.attacked = true;
    plan.status.justAttacked = true;
    report.attack = { ...attack, result, targetDestroyed: ts.soldiers <= 0, unitDestroyed: plan.status.soldiers <= 0 };

    const placements = this.view.units.placements();
    const at = (u: UnitData) => placements.find((p) => p.unit === u);
    const tp = at(attack.target);
    const up = at(plan.unit);
    if (tp) this.popups.show(tp, report.attack.targetDestroyed ? `-${result.damage} 壊滅` : `-${result.damage}`, 'damage');
    if (up && result.direct) this.popups.show(up, report.attack.unitDestroyed ? `-${result.counter} 壊滅` : `-${result.counter}`, 'counter');
  }

  /** 実行を終える。行動力を使い、兵数が 0 になったユニットを消し、生き残っていれば選び直す */
  private finish(plan: Plan, report: ExecuteReport): void {
    const map = this.map!;
    plan.status.ap -= report.cost;
    const removed = [report.attack?.targetDestroyed && report.attack.target, report.attack?.unitDestroyed && report.unit];
    for (const u of removed) {
      if (!u) continue;
      map.removeUnit(u.col, u.row);
      this.statuses.delete(u);
    }
    if (removed.some(Boolean)) this.tags.setStatuses(this.statuses);
    this.view.rebuildUnits();
    // 動いた先で選び直す（残りの行動力でメニューを開く）
    this.setSelected(report.attack?.unitDestroyed ? null : { col: report.unit.col, row: report.unit.row });
    this.onExecute(report);
  }

  private openMenu(): void {
    const map = this.map;
    const plan = this.plan;
    if (!map || !plan) return this.menu.open(null);
    const pos = BattleApp.planPos(plan);
    const options = BattleApp.moveOptions(plan);
    this.menu.open({
      unit: plan.unit,
      status: plan.status,
      ap: plan.status.ap - BattleApp.planCost(plan),
      canMove: moveRange(map, plan.unit, pos, plan.status.ap, options).size > 0,
      zocLocked: inEnemyZoc(map, plan.unit, pos) && !options.escapeZoc,
      planned: BattleApp.planned(plan),
      attackPlanned: !!plan.attack,
      canMoveAfterAttack: !!COMBAT_DEFS[plan.unit.type].moveAfterAttack,
      hasTargets: attackTargets(map, plan.unit, pos).length > 0,
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

  /** メニューを置く位置。移動を予約していれば、ユニットの絵を予約した移動先に置いたときの位置 */
  private menuAnchor(placements: readonly UnitPlacement[]): UnitPlacement | null {
    const plan = this.plan;
    const map = this.map;
    const p = plan && placements.find((x) => x.unit === plan.unit);
    if (!plan || !map || !p || plan.legs.length === 0) return p ?? null;
    const pos = BattleApp.planPos(plan);
    const c = map.layout.offsetToWorld(pos.col, pos.row);
    return { ...p, foot: new THREE.Vector3(c.x, this.view.groundAt(c.x, c.z), c.z) };
  }

  private frame(): void {
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.setHover(this.pick());
    }
    const exec = this.exec;
    if (exec?.phase.kind === 'walk') this.stepWalk(exec, exec.phase.legs, performance.now());
    else if (exec?.phase.kind === 'strike') this.stepStrike(exec, performance.now());
    this.view.render();
    const placements = this.view.units.placements();
    this.tags.update(placements, this.ctx.camera, this.view.display.units, this.hovered, this.selected);
    this.menu.update(this.menuAnchor(placements), this.ctx.camera);
    this.popups.update(this.ctx.camera);
  }
}
