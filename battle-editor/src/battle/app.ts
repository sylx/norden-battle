/**
 * 戦闘画面。マップの描画は map-editor と同じ MapView を使い、パラメータは map-editor の初期値のまま。
 * 戦闘の UI・演出はここに積み上げていく。
 *
 * 行動は予約してから「決定」でまとめて実行する。いまは移動だけ:
 * ユニットを選択 → 行動メニュー → 移動 → 移動先を選ぶ → 移動先でメニュー → 移動 → … → 決定。
 * 移動は何回かに分けて予約でき、予約したルートは地面に矢印で出す。決定でユニットが最後の移動先へ動き、行動力を使う。
 *
 * Esc: 移動先を選ぶのをやめる → 2 階層目を閉じる → 予約を 1 つ戻す → 選択を外す。
 */
import * as THREE from 'three';
import type { Offset } from '@norden/map-runtime/core/hex';
import { HexMap, type HexCell, type MapData } from '@norden/map-runtime/core/mapData';
import type { UnitData } from '@norden/map-runtime/core/units';
import { MapView } from '@norden/map-runtime/render/mapView';
import { SceneContext } from '@norden/map-runtime/render/scene';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import type { MenuAction } from './actions';
import { ActionMenu } from './actionMenu';
import { movePath, moveRange, type MoveStep } from './movement';
import { UnitTags } from './unitTags';
import { demoStatuses, type UnitStatus } from './unitStatus';

/** 移動できる HEX の色 */
const MOVE_RANGE_COLOR = 0x4aa8ff;

/** 選択中のユニットの予約 */
export interface Plan {
  unit: UnitData;
  status: UnitStatus;
  /** 予約した移動（各回の到着地。cost はそこまでの合計） */
  legs: MoveStep[];
}

export class BattleApp {
  readonly ctx: SceneContext;
  readonly view: MapView;
  /** ユニットの頭上の情報札（顔・兵士数・士気） */
  readonly tags: UnitTags;
  /** 選択中のユニットの行動メニュー */
  readonly menu: ActionMenu;
  /** 戦闘中のユニットの状態 */
  statuses = new Map<UnitData, UnitStatus>();
  /** 選択中のユニットの HEX */
  selected: Offset | null = null;
  hovered: Offset | null = null;
  /** 選択中のユニットの予約（選択していなければ null） */
  plan: Plan | null = null;

  onHover: (cell: HexCell | null, unit: UnitData | null) => void = () => {};
  onSelect: (cell: HexCell | null, unit: UnitData | null) => void = () => {};
  /** 行動メニューで行動を選んだとき（決定を除く） */
  onAction: (unit: UnitData, action: MenuAction) => void = () => {};
  /** 予約が増えた・減ったとき */
  onPlanChange: (plan: Plan) => void = () => {};
  /** 移動先を選ぶ状態をやめたとき */
  onMoveCancel: () => void = () => {};
  /** 決定で予約を実行したとき（cost は使った行動力） */
  onExecute: (unit: UnitData, from: Offset, cost: number) => void = () => {};

  /** 移動先を選ぶ状態のとき、移動できる HEX（キーは row × cols + col） */
  private moveTargets: Map<number, MoveStep> | null = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private pointerDirty = false;
  private downPos: { x: number; y: number } | null = null;

  constructor(container: HTMLElement) {
    this.ctx = new SceneContext(container);
    this.view = new MapView(this.ctx);
    this.tags = new UnitTags(container);
    this.menu = new ActionMenu(container);
    this.menu.onAction = (unit, action) => {
      if (action.id === 'confirm') return this.execute();
      if (action.id === 'move') this.startMove();
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
      if (moved > 4) return; // ドラッグ（パン）はクリック扱いしない
      this.setPointer(e);
      this.click(this.pick());
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.moveTargets) this.cancelMove();
      else if (this.menu.closeSub()) return;
      else if (this.plan && this.plan.legs.length > 0) this.undoLeg();
      else this.setSelected(null);
    });
    this.ctx.renderer.setAnimationLoop(() => this.frame());
  }

  get map(): HexMap | null {
    return this.view.map;
  }

  loadMap(data: MapData): void {
    const map = new HexMap(data);
    this.statuses = demoStatuses(map.allUnits());
    this.tags.setStatuses(this.statuses);
    this.view.setMap(map);
    this.setSelected(null);
  }

  /** 移動先を選ぶ状態のとき、o へ移動するときの最短経路（移動できなければ null） */
  moveStepAt(o: Offset | null): MoveStep | null {
    if (!o || !this.moveTargets || !this.map) return null;
    return this.moveTargets.get(o.row * this.map.layout.cols + o.col) ?? null;
  }

  /** 予約した移動で使う行動力 */
  static planCost(plan: Plan): number {
    return plan.legs.at(-1)?.cost ?? 0;
  }

  /** 予約した移動の先（予約が無ければユニットのいる HEX） */
  static planPos(plan: Plan): Offset {
    return plan.legs.at(-1) ?? plan.unit;
  }

  private click(o: Offset | null): void {
    const unit = o && this.map?.unitAt(o.col, o.row);
    const isSelf = !!unit && unit === this.plan?.unit;
    if (this.moveTargets) {
      const step = this.moveStepAt(o);
      if (step) this.addLeg(step);
      // ほかのユニットは選び直し、それ以外（範囲外・自分）はメニューに戻る
      else if (unit && !isSelf) this.setSelected(o);
      else this.cancelMove();
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
    this.moveTargets = moveRange(map, plan.unit, BattleApp.planPos(plan), plan.status.ap, BattleApp.planCost(plan));
    this.view.setRange(this.moveTargets.values(), MOVE_RANGE_COLOR);
    this.menu.suspended = true;
    this.setHover(this.hovered);
  }

  /** 移動先を選ぶ状態をやめてメニューに戻る */
  private cancelMove(): void {
    if (!this.moveTargets) return;
    this.endTargeting();
    this.onMoveCancel();
  }

  private endTargeting(): void {
    this.moveTargets = null;
    this.view.setRange(null);
    this.menu.suspended = false;
    this.setHover(this.hovered);
  }

  /** 移動を 1 回分予約して、移動先でメニューを開き直す */
  private addLeg(step: MoveStep): void {
    const plan = this.plan!;
    plan.legs.push(step);
    this.endTargeting();
    this.planChanged();
  }

  /** 最後に予約した移動を取り消す */
  private undoLeg(): void {
    this.plan!.legs.pop();
    this.planChanged();
  }

  private planChanged(): void {
    const plan = this.plan!;
    this.view.setPath(plan.legs.length > 0 ? movePath(plan.legs) : null);
    this.openMenu();
    this.onPlanChange(plan);
  }

  /** 予約を実行する（ユニットを最後の移動先へ動かして行動力を使う） */
  private execute(): void {
    const map = this.map;
    const plan = this.plan;
    if (!map || !plan) return;
    const { unit, status } = plan;
    const from = { col: unit.col, row: unit.row };
    const to = BattleApp.planPos(plan);
    const cost = BattleApp.planCost(plan);
    if (!map.moveUnit(unit, to.col, to.row)) return;
    status.ap -= cost;
    this.view.rebuildUnits();
    // 動いた先で選び直す（残りの行動力でメニューを開く）
    this.setSelected(to);
    this.onExecute(unit, from, cost);
  }

  private openMenu(): void {
    const map = this.map;
    const plan = this.plan;
    if (!map || !plan) return this.menu.open(null);
    const spent = BattleApp.planCost(plan);
    const ap = plan.status.ap - spent;
    this.menu.open({
      unit: plan.unit,
      status: plan.status,
      ap,
      canMove: moveRange(map, plan.unit, BattleApp.planPos(plan), plan.status.ap, spent).size > 0,
      planned: plan.legs.length > 0,
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
    if (this.moveTargets) this.endTargeting();
    this.selected = o;
    this.view.setFocus(o);
    this.view.setPath(null);
    const [cell, unit] = this.cellAndUnit(o);
    const status = unit && this.statuses.get(unit);
    this.plan = unit && status ? { unit, status, legs: [] } : null;
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
    this.view.render();
    const placements = this.view.units.placements();
    this.tags.update(placements, this.ctx.camera, this.view.display.units, this.hovered, this.selected);
    this.menu.update(this.menuAnchor(placements), this.ctx.camera);
  }
}
