/** 移動できる HEX の色 */
const MOVE_RANGE_COLOR = 0x4aa8ff;

/**
 * 戦闘画面。マップの描画は map-editor と同じ MapView を使い、パラメータは map-editor の初期値のまま。
 * 戦闘の UI・演出はここに積み上げていく。
 *
 * 操作の流れ: ユニットを選択 → 行動メニュー → 移動を選ぶと移動できる HEX を出して移動先を選ぶ状態になる。
 * 移動先を選ぶと、そこまでの最短ルートを地面に矢印で出す（選び直せる）。
 * 移動先を選ぶ状態では、Esc か範囲外のクリックでメニューに戻る。
 */
import * as THREE from 'three';
import type { Offset } from '@norden/map-runtime/core/hex';
import { HexMap, type HexCell, type MapData } from '@norden/map-runtime/core/mapData';
import type { UnitData } from '@norden/map-runtime/core/units';
import { MapView } from '@norden/map-runtime/render/mapView';
import { SceneContext } from '@norden/map-runtime/render/scene';
import type { MenuAction } from './actions';
import { ActionMenu } from './actionMenu';
import { movePath, moveRange, type MoveStep } from './movement';
import { UnitTags } from './unitTags';
import { demoStatuses, type UnitStatus } from './unitStatus';

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

  onHover: (cell: HexCell | null, unit: UnitData | null) => void = () => {};
  onSelect: (cell: HexCell | null, unit: UnitData | null) => void = () => {};
  /** 行動メニューで行動を選んだとき */
  onAction: (unit: UnitData, action: MenuAction) => void = () => {};
  /** 移動先を選んだとき */
  onMoveTarget: (unit: UnitData, step: MoveStep) => void = () => {};
  /** 移動先を選ぶ状態をやめたとき */
  onMoveCancel: () => void = () => {};

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
      if (action.id === 'move') this.startMove(unit);
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
    // Esc: 移動先を選ぶのをやめる → 2 階層目を閉じる → 選択を外す
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.moveTargets) this.cancelMove();
      else if (!this.menu.closeSub()) this.setSelected(null);
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

  private click(o: Offset | null): void {
    const map = this.map;
    const unit = o && map?.unitAt(o.col, o.row);
    if (this.moveTargets) {
      const step = this.moveStepAt(o);
      const mover = this.selected && map?.unitAt(this.selected.col, this.selected.row);
      if (step && mover) {
        this.view.setPath(movePath(step));
        this.onMoveTarget(mover, step);
      }
      // ほかのユニットは選び直し、それ以外（範囲外・自分）はメニューに戻る
      else if (unit && !(o.col === this.selected?.col && o.row === this.selected.row)) this.setSelected(o);
      else this.cancelMove();
      return;
    }
    // ユニットのいる HEX ならそのユニットを選択し、いない HEX なら選択を外す
    this.setSelected(unit ? o : null);
  }

  /** 移動できる HEX を出して、移動先を選ぶ状態にする */
  private startMove(unit: UnitData): void {
    const map = this.map;
    const status = this.statuses.get(unit);
    if (!map || !status) return;
    this.moveTargets = moveRange(map, unit, status.ap);
    this.view.setRange(this.moveTargets.values(), MOVE_RANGE_COLOR);
    this.menu.suspended = true;
    this.setHover(this.hovered);
  }

  /** 移動先を選ぶ状態をやめてメニューに戻る */
  private cancelMove(): void {
    if (!this.moveTargets) return;
    this.endMove();
    this.onMoveCancel();
  }

  private endMove(): void {
    this.moveTargets = null;
    this.view.setRange(null);
    this.view.setPath(null);
    this.menu.suspended = false;
    this.setHover(this.hovered);
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

  private setSelected(o: Offset | null): void {
    if (this.moveTargets) this.endMove();
    this.selected = o;
    this.view.setFocus(o);
    const [cell, unit] = this.cellAndUnit(o);
    this.menu.open(unit, unit ? this.statuses.get(unit) : undefined);
    this.onSelect(cell, unit);
  }

  private cellAndUnit(o: Offset | null): [HexCell | null, UnitData | null] {
    const map = this.map;
    if (!o || !map) return [null, null];
    return [map.get(o.col, o.row) ?? null, map.unitAt(o.col, o.row) ?? null];
  }

  private frame(): void {
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.setHover(this.pick());
    }
    this.view.render();
    const placements = this.view.units.placements();
    this.tags.update(placements, this.ctx.camera, this.view.display.units, this.hovered, this.selected);
    this.menu.update(placements, this.ctx.camera);
  }
}
