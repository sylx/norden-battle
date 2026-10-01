/**
 * ユニットの頭上に出して浮かび上がりながら消える数字（兵数の減少など）。HTML で画面に重ねる。
 */
import * as THREE from 'three';
import type { UnitPlacement } from '@norden/map-runtime/render/units';

/** 表示している時間（秒）と、その間に浮かぶ高さ（CSS ピクセル） */
const DURATION = 1.6;
const RISE = 36;

interface Popup {
  el: HTMLDivElement;
  /** 頭の位置（足元 + 絵の高さ。カメラ正対なので画面上はカメラの上方向） */
  foot: THREE.Vector3;
  height: number;
  start: number;
}

export class Popups {
  private readonly root: HTMLDivElement;
  private items: Popup[] = [];

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'popups';
    container.appendChild(this.root);
  }

  /** p のユニットの頭上に text を出す（className で色などを変える） */
  show(p: UnitPlacement, text: string, className: string): void {
    const el = document.createElement('div');
    el.className = `popup ${className}`;
    el.textContent = text;
    this.root.appendChild(el);
    this.items.push({ el, foot: p.foot.clone(), height: p.height, start: performance.now() });
  }

  /** 毎フレーム、描画の後に呼ぶ */
  update(camera: THREE.PerspectiveCamera): void {
    if (this.items.length === 0) return;
    const now = performance.now();
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const v = new THREE.Vector3();
    this.items = this.items.filter((p) => {
      const t = (now - p.start) / 1000 / DURATION;
      if (t >= 1) {
        p.el.remove();
        return false;
      }
      v.copy(up).multiplyScalar(p.height).add(p.foot).project(camera);
      const x = ((v.x + 1) / 2) * w;
      const y = ((1 - v.y) / 2) * h - RISE * (1 - (1 - t) * (1 - t));
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
}
