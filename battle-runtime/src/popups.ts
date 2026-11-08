/**
 * ユニットの頭上に出して浮かび上がりながら消える数字（兵数の減少など）。HTML で画面に重ねる。
 */
import * as THREE from 'three';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { fxClock } from './fxClock';

/** 表示している時間（秒）と、その間に浮かぶ高さ（CSS ピクセル）。show の timing で変えられる */
const DURATION = 3;
const RISE = 48;
/**
 * 同じところにほぼ同時に出した数字は重ならないように上へ積む。足元がこの距離（絵の高さ比）より近く、
 * 出してからこの割合の時間しか経っていない数字の上に積む（味方のいる HEX で迎撃されて、味方の巻き添えと迎撃の数字が同時に出るときなど）
 */
const STACK_NEAR = 0.35;
const STACK_WITHIN = 0.5;
/** 積むときの数字どうしの隙間（CSS ピクセル） */
const STACK_GAP = 4;

export interface PopupTiming {
  duration: number;
  rise: number;
}

/** 数字を出す位置（ユニットの絵の UnitPlacement、または地面の点と高さ 0） */
export type PopupAnchor = Pick<UnitPlacement, 'foot' | 'height'>;

interface Popup {
  el: HTMLDivElement;
  /** 出したときに渡された足元（addLine で、同じユニットに出した数字を探す） */
  anchor: THREE.Vector3;
  /** 足元（頭の位置は足元 + 絵の高さ。カメラ正対なので画面上はカメラの上方向）。ユニットに付いていくときは絵の位置そのもの */
  foot: THREE.Vector3;
  height: number;
  start: number;
  duration: number;
  rise: number;
  /** 同じところに出ている数字の上に積むために、上へずらす量（CSS ピクセル） */
  lift: number;
}

export class Popups {
  private readonly root: HTMLDivElement;
  private items: Popup[] = [];

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'popups';
    container.appendChild(this.root);
  }

  /**
   * p のユニットの頭上に text を出す（className で色などを変える）。
   * follow なら、出した後もユニットの絵の動きに付いていく（突撃で相手を駆け抜けるときなど）。そうでなければ出したところに留まる。
   * timing で表示している時間と浮かぶ高さを変える（省くと DURATION・RISE）
   */
  show(p: PopupAnchor, text: string, className: string, follow = false, timing: PopupTiming = { duration: DURATION, rise: RISE }): void {
    const el = document.createElement('div');
    el.className = `popup ${className}`;
    el.textContent = text;
    this.root.appendChild(el);
    const now = fxClock.now();
    const near = Math.max(p.height, 1e-6) * STACK_NEAR;
    // 同じところに出したばかりの数字があれば、その上に積む
    const lift = this.items
      .filter((x) => (now - x.start) / 1000 < x.duration * STACK_WITHIN && Math.hypot(x.foot.x - p.foot.x, x.foot.z - p.foot.z) < near)
      .reduce((top, x) => Math.max(top, x.lift + x.el.offsetHeight + STACK_GAP), 0);
    this.items.push({ el, anchor: p.foot, foot: follow ? p.foot : p.foot.clone(), height: p.height, start: now, ...timing, lift });
  }

  /**
   * p のユニットに最後に出した数字の下に text の行を添える（アーススパイクのダメージに「地形破壊」など）。
   * まだ何も出していなければ、text だけを出す
   */
  addLine(p: PopupAnchor, text: string, className: string): void {
    const item = [...this.items].reverse().find((x) => x.anchor === p.foot);
    if (!item) return this.show(p, text, className);
    const line = document.createElement('div');
    line.className = `popup-line ${className}`;
    line.textContent = text;
    item.el.appendChild(line);
  }

  /** 毎フレーム、描画の後に呼ぶ */
  update(camera: THREE.PerspectiveCamera): void {
    if (this.items.length === 0) return;
    const now = fxClock.now();
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const v = new THREE.Vector3();
    this.items = this.items.filter((p) => {
      const t = (now - p.start) / 1000 / p.duration;
      if (t >= 1) {
        p.el.remove();
        return false;
      }
      v.copy(up).multiplyScalar(p.height).add(p.foot).project(camera);
      const x = ((v.x + 1) / 2) * w;
      const y = ((1 - v.y) / 2) * h - p.rise * (1 - (1 - t) * (1 - t)) - p.lift;
      p.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      // 最後の 3 割で消える
      p.el.style.opacity = String(Math.min(1, (1 - t) / 0.3));
      return true;
    });
  }

  clear(): void {
    for (const p of this.items) p.el.remove();
    this.items = [];
  }

  dispose(): void {
    this.clear();
    this.root.remove();
  }
}
