/**
 * 攻撃の演出でカメラを寄せる。指定したユニットがすべて画面に収まるところまで寄り、決めた時間そのままにして、
 * 元の位置へ戻る。その間はカメラの操作を止める。俯角・向きは変えない（注視点と距離だけを動かす）。
 * 当たったときにカメラを小さく揺らす（shake）。
 */
import * as THREE from 'three';
import type { SceneContext } from '@norden/map-runtime/render/scene';
import type { UnitPlacement } from '@norden/map-runtime/render/units';

/** 寄ったとき、ユニットの絵の範囲が画面の幅・高さに占める割合 */
const FILL = 0.6;
/** 揺れの時間（秒） */
const SHAKE_SEC = 0.28;

/** 寄る・そのまま・戻るの時間（秒） */
export interface FocusTiming {
  in: number;
  hold: number;
  out: number;
}

interface View {
  target: THREE.Vector3;
  position: THREE.Vector3;
}

export class CameraFocus {
  private readonly ctx: SceneContext;
  /** 寄る前のカメラ（寄っていなければ null） */
  private home: View | null = null;
  private readonly focus: View = { target: new THREE.Vector3(), position: new THREE.Vector3() };
  private timing: FocusTiming = { in: 0, hold: 0, out: 0 };
  private start = 0;
  private shakeStart = -Infinity;
  private shakeAmount = 0;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
  }

  /** units の絵がすべて画面に収まるところまで寄って、timing のとおりに戻る */
  play(units: readonly UnitPlacement[], timing: FocusTiming): void {
    const { camera, controls } = this.ctx;
    if (units.length === 0) return;
    // 続けて寄るときは、最初に寄る前の位置へ戻す
    const home = this.home ?? { target: controls.target.clone(), position: camera.position.clone() };
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    // 絵の四隅を画面の右・上方向に並べたときの範囲
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    const mean = new THREE.Vector3();
    for (const p of units) {
      const x = p.foot.dot(right);
      const y = p.foot.dot(up);
      x0 = Math.min(x0, x - p.width / 2);
      x1 = Math.max(x1, x + p.width / 2);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y + p.height);
      mean.add(p.foot);
    }
    mean.divideScalar(units.length);
    const target = mean
      .clone()
      .addScaledVector(right, (x0 + x1) / 2 - mean.dot(right))
      .addScaledVector(up, (y0 + y1) / 2 - mean.dot(up));
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = THREE.MathUtils.clamp(
      Math.max((x1 - x0) / (2 * tanV * camera.aspect * FILL), (y1 - y0) / (2 * tanV * FILL)),
      controls.minDistance,
      controls.maxDistance,
    );
    const back = home.position.clone().sub(home.target).normalize();
    this.focus.target.copy(target);
    this.focus.position.copy(target).addScaledVector(back, dist);
    this.home = home;
    this.timing = timing;
    this.start = performance.now();
    controls.enabled = false;
  }

  /** カメラを揺らす（amount はワールド単位の揺れ幅） */
  shake(amount: number): void {
    this.shakeStart = performance.now();
    this.shakeAmount = amount;
  }

  /** 寄るのをやめる（元の位置へは戻さない。マップを読み直したときなど） */
  stop(): void {
    this.home = null;
    this.shakeStart = -Infinity;
    this.ctx.controls.enabled = true;
  }

  /** 毎フレーム、描画の前に呼ぶ */
  update(now: number): void {
    const home = this.home;
    if (!home) return;
    const { camera, controls } = this.ctx;
    const t = (now - this.start) / 1000;
    const { in: tin, hold, out } = this.timing;
    let k = 0;
    if (t < tin) k = easeInOut(t / tin);
    else if (t < tin + hold) k = 1;
    else if (t < tin + hold + out) k = 1 - easeInOut((t - tin - hold) / out);
    controls.target.lerpVectors(home.target, this.focus.target, k);
    camera.position.lerpVectors(home.position, this.focus.position, k);
    const st = (now - this.shakeStart) / 1000;
    if (st < SHAKE_SEC) {
      const a = this.shakeAmount * (1 - st / SHAKE_SEC) ** 2;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const offset = right.multiplyScalar(Math.sin(st * 95) * a).addScaledVector(up, Math.sin(st * 70 + 1.3) * a * 0.6);
      controls.target.add(offset);
      camera.position.add(offset);
    }
    if (t >= tin + hold + out) this.stop();
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
