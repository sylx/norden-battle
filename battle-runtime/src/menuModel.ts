/**
 * 選択中のユニットの行動メニューの状態（DOM を持たない）。描画は ui/ActionMenu.tsx。
 *
 * - BattleApp が開け閉めし、毎フレーム、メニューを添えるユニットの絵の画面上の範囲を渡す。
 * - React の側は subscribe / getState（useSyncExternalStore）で中身の変化を受け取り、
 *   onFrame で毎フレームの位置の更新を受け取る（位置は再描画せずに DOM を直接動かす）。
 * - 2 階層目の開け閉めもここで持つ（Esc で BattleApp から閉じるため）。
 */
import * as THREE from 'three';
import type { UnitData } from '@norden/map-runtime/core/units';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { buildActionMenu, type MenuAction, type MenuContext, type MenuEntry } from './actions';

/** 画面上の範囲（コンテナの左上からの CSS ピクセル） */
export interface ScreenRect {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface MenuState {
  /** 開いているユニットのメニュー（閉じていれば null） */
  ctx: MenuContext | null;
  entries: readonly MenuEntry[];
  /** 2 階層目を開いている 1 階層目の項目の番号 */
  openIndex: number | null;
  /** true の間はメニューを隠しておく（移動先を選んでいる間など） */
  suspended: boolean;
}

/** 毎フレームの位置の基準。sprite はユニットの絵の範囲（画面の外・カメラの後ろなら null） */
export interface MenuFrame {
  sprite: ScreenRect | null;
  /** コンテナの大きさ */
  width: number;
  height: number;
}

export class ActionMenuModel {
  /** 行動を選んだとき */
  onAction: (unit: UnitData, action: MenuAction) => void = () => {};

  private state: MenuState = { ctx: null, entries: [], openIndex: null, suspended: false };
  private readonly listeners = new Set<() => void>();
  private readonly frameListeners = new Set<(frame: MenuFrame) => void>();

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  readonly getState = (): MenuState => this.state;

  /** 毎フレームの位置の更新を受け取る */
  onFrame(fn: (frame: MenuFrame) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  get isOpen(): boolean {
    return this.state.ctx !== null;
  }

  get suspended(): boolean {
    return this.state.suspended;
  }

  set suspended(suspended: boolean) {
    if (suspended !== this.state.suspended) this.set({ suspended });
  }

  /** ユニットのメニューを開く（null で閉じる）。開いたまま呼ぶと中身を作り直す */
  open(ctx: MenuContext | null): void {
    this.set({ ctx, entries: ctx ? buildActionMenu(ctx) : [], openIndex: null });
  }

  /** 1 階層目の index の項目の 2 階層目を開く */
  openSub(index: number): void {
    if (this.state.openIndex !== index) this.set({ openIndex: index });
  }

  /** 2 階層目だけを閉じる。閉じたものがあれば true */
  closeSub(): boolean {
    if (this.state.openIndex === null) return false;
    this.set({ openIndex: null });
    return true;
  }

  choose(action: MenuAction): void {
    this.closeSub();
    const unit = this.state.ctx?.unit;
    if (unit) this.onAction(unit, action);
  }

  /** 毎フレーム、描画の後に呼ぶ。anchor（メニューを添えるユニットの絵の位置と大きさ）の画面上の範囲を知らせる */
  update(anchor: UnitPlacement | null, camera: THREE.PerspectiveCamera, width: number, height: number): void {
    if (!this.state.ctx || this.frameListeners.size === 0) return;
    const frame: MenuFrame = { sprite: anchor && spriteRect(anchor, camera, width, height), width, height };
    for (const fn of this.frameListeners) fn(frame);
  }

  private set(patch: Partial<MenuState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
}

/** 画面上のユニットの絵の範囲（足元・頭・幅から求める） */
function spriteRect(p: UnitPlacement, camera: THREE.PerspectiveCamera, w: number, h: number): ScreenRect | null {
  const v = new THREE.Vector3();
  const toScreen = (q: THREE.Vector3) => {
    v.copy(q).project(camera);
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, behind: v.z > 1 };
  };
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const foot = toScreen(p.foot);
  if (foot.behind) return null;
  const head = toScreen(up.multiplyScalar(p.height).add(p.foot));
  const half = toScreen(right.multiplyScalar(p.width / 2).add(p.foot)).x - foot.x;
  return { l: head.x - half, t: head.y, r: head.x + half, b: foot.y };
}
