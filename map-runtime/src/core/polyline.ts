/**
 * 折れ線の補助。HEX の中心を結んだ経路の角を丸めて、距離で位置と向きを引けるようにする
 * （経路の矢印と、経路に沿ったユニットの移動で同じ線を使う）。
 */
import type { Vec2 } from './hex';

/** HEX の中心を結んだ折れ線の角を丸める（Chaikin。両端は動かさない） */
export function smoothPath(points: Vec2[]): Vec2[] {
  let pts = points;
  for (let it = 0; it < 3; it++) {
    const out: Vec2[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (i > 0) out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      if (i < pts.length - 2) out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** 折れ線上の距離 d の位置と進む向き */
export class Polyline {
  private readonly acc: number[] = [0];
  private readonly pts: Vec2[];

  constructor(pts: Vec2[]) {
    this.pts = pts;
    for (let i = 1; i < pts.length; i++) this.acc.push(this.acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }

  get length(): number {
    return this.acc[this.acc.length - 1];
  }

  at(d: number): { x: number; z: number; tx: number; tz: number } {
    const { pts, acc } = this;
    let i = 1;
    while (i < pts.length - 1 && acc[i] < d) i++;
    const a = pts[i - 1];
    const b = pts[i];
    const len = acc[i] - acc[i - 1] || 1;
    const t = (d - acc[i - 1]) / len;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: (b.x - a.x) / len, tz: (b.z - a.z) / len };
  }
}
