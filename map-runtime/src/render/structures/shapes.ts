/**
 * 建物を組み立てるための基本形状。
 * 面の法線はフラット。向きは「内側の点」から自動で外向きにそろえる。
 */
import * as THREE from 'three';
import type { Vec2 } from '../../core/hex';
import type { HexMap } from '../../core/mapData';
import { mulberry32 } from '../../core/noise';
import type { RoadIndex } from '../../core/roads';
import type { Heightmap } from '../../core/terrainGen';
import type { GeoBuilder } from '../geoBuilder';
import type { Pattern } from './material';

export interface BuildCtx {
  b: GeoBuilder;
  hm: Heightmap;
  map: HexMap;
  /** hexSize */
  s: number;
  waterLevel: number;
  /** 街道（建物が道を塞がないように使う） */
  roads: RoadIndex;
}

/** HEX ごとの乱数。切り出したマップでも元のマップと同じ形になるよう、元のマップでの座標で引く */
export function structureRng(ctx: BuildCtx, seed: number, col: number, row: number, salt: number): Rng {
  const o = ctx.map.data.origin;
  return cellRng(seed, col + (o?.col ?? 0), row + (o?.row ?? 0), salt);
}

export type Rng = () => number;

/** 色を ±amount の範囲でばらつかせる */
export function vary(hex: number, rng: Rng, amount = 0.08): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(1 - amount + rng() * amount * 2);
}

const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _n = new THREE.Vector3();

function faceNormal(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3): THREE.Vector3 {
  _e1.subVectors(p1, p0);
  _e2.subVectors(p2, p0);
  return _n.crossVectors(_e1, _e2).normalize();
}

/** 四角形。inside を与えると法線がそこから離れる向きになる */
export function quad(
  b: GeoBuilder,
  p: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
  color: THREE.Color,
  pattern: Pattern,
  inside?: THREE.Vector3,
): void {
  let pts = p;
  let n = faceNormal(p[0], p[1], p[2]).clone();
  if (n.lengthSq() < 1e-12) n = faceNormal(p[0], p[2], p[3]).clone();
  if (inside) {
    const c = p[0].clone().add(p[1]).add(p[2]).add(p[3]).multiplyScalar(0.25);
    if (n.dot(c.sub(inside)) < 0) {
      pts = [p[3], p[2], p[1], p[0]];
      n.negate();
    }
  }
  const i0 = b.vertex(pts[0], n, 0, 0, color, pattern);
  const i1 = b.vertex(pts[1], n, 1, 0, color, pattern);
  const i2 = b.vertex(pts[2], n, 1, 1, color, pattern);
  const i3 = b.vertex(pts[3], n, 0, 1, color, pattern);
  b.tri(i0, i1, i2);
  b.tri(i0, i2, i3);
}

export function tri(
  b: GeoBuilder,
  p: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  color: THREE.Color,
  pattern: Pattern,
  inside?: THREE.Vector3,
): void {
  let pts = p;
  const n = faceNormal(p[0], p[1], p[2]).clone();
  if (inside) {
    const c = p[0].clone().add(p[1]).add(p[2]).divideScalar(3);
    if (n.dot(c.sub(inside)) < 0) {
      pts = [p[2], p[1], p[0]];
      n.negate();
    }
  }
  b.tri(b.vertex(pts[0], n, 0, 0, color, pattern), b.vertex(pts[1], n, 1, 0, color, pattern), b.vertex(pts[2], n, 0, 1, color, pattern));
}

/** 六面体。c[0..3] が下面、c[4..7] が上面（同じ順序で並ぶこと）。底面は描かない */
export function hexahedron(b: GeoBuilder, c: THREE.Vector3[], color: THREE.Color, pattern: Pattern, topColor?: THREE.Color): void {
  const inside = new THREE.Vector3();
  for (const p of c) inside.add(p);
  inside.divideScalar(8);
  quad(b, [c[4], c[5], c[6], c[7]], topColor ?? color, pattern, inside);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(b, [c[i], c[j], c[j + 4], c[i + 4]], color, pattern, inside);
  }
}

/** ローカル座標系（中心 + Y 軸回転）。x がローカルの「長さ」方向 */
export class Frame {
  readonly cx: number;
  readonly cz: number;
  private readonly cos: number;
  private readonly sin: number;

  constructor(cx: number, cz: number, rot: number) {
    this.cx = cx;
    this.cz = cz;
    this.cos = Math.cos(rot);
    this.sin = Math.sin(rot);
  }

  x(lx: number, lz: number): number {
    return this.cx + lx * this.cos - lz * this.sin;
  }

  z(lx: number, lz: number): number {
    return this.cz + lx * this.sin + lz * this.cos;
  }

  v(lx: number, y: number, lz: number): THREE.Vector3 {
    return new THREE.Vector3(this.x(lx, lz), y, this.z(lx, lz));
  }
}

/** ローカル座標の直方体 */
export function box(
  b: GeoBuilder,
  f: Frame,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y0: number,
  y1: number,
  color: THREE.Color,
  pattern: Pattern,
  topColor?: THREE.Color,
): void {
  hexahedron(
    b,
    [f.v(x0, y0, z0), f.v(x1, y0, z0), f.v(x1, y0, z1), f.v(x0, y0, z1), f.v(x0, y1, z0), f.v(x1, y1, z0), f.v(x1, y1, z1), f.v(x0, y1, z1)],
    color,
    pattern,
    topColor,
  );
}

/** 切妻屋根（棟はローカル x 方向）。妻壁は gableColor で塗る */
export function gableRoof(
  b: GeoBuilder,
  f: Frame,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  yBase: number,
  h: number,
  overhang: number,
  roofColor: THREE.Color,
  gableColor: THREE.Color,
  gablePattern: Pattern,
): void {
  const zm = (z0 + z1) / 2;
  const inside = f.v((x0 + x1) / 2, yBase + h * 0.3, zm);
  // 妻壁（壁と同じ面に三角形）
  tri(b, [f.v(x0, yBase, z0), f.v(x0, yBase, z1), f.v(x0, yBase + h, zm)], gableColor, gablePattern, inside);
  tri(b, [f.v(x1, yBase, z0), f.v(x1, yBase, z1), f.v(x1, yBase + h, zm)], gableColor, gablePattern, inside);
  // 屋根面（軒を出す）
  const ox0 = x0 - overhang;
  const ox1 = x1 + overhang;
  const slope = h / ((z1 - z0) / 2);
  const oy = yBase - overhang * slope;
  const oz0 = z0 - overhang;
  const oz1 = z1 + overhang;
  const t = 0.008; // 屋根の厚み
  const roofIn = f.v((x0 + x1) / 2, yBase - h, zm);
  for (const [ze, zr] of [
    [oz0, zm],
    [oz1, zm],
  ]) {
    quad(b, [f.v(ox0, oy, ze), f.v(ox1, oy, ze), f.v(ox1, yBase + h, zr), f.v(ox0, yBase + h, zr)], roofColor, 2, roofIn);
    // 軒先の小口と裏面
    quad(b, [f.v(ox0, oy, ze), f.v(ox1, oy, ze), f.v(ox1, oy - t, ze), f.v(ox0, oy - t, ze)], roofColor.clone().multiplyScalar(0.7), 0, inside);
    quad(b, [f.v(ox0, oy - t, ze), f.v(ox1, oy - t, ze), f.v(ox1, yBase + h - t, zr), f.v(ox0, yBase + h - t, zr)], roofColor.clone().multiplyScalar(0.5), 0, f.v((x0 + x1) / 2, yBase + h * 2, zm));
  }
  // 破風（屋根の端の断面）
  for (const x of [ox0, ox1]) {
    const dir = x < (x0 + x1) / 2 ? -1 : 1;
    const inPt = f.v(x - dir, yBase, zm);
    quad(b, [f.v(x, oy, oz0), f.v(x, yBase + h, zm), f.v(x, yBase + h - t, zm), f.v(x, oy - t, oz0)], roofColor.clone().multiplyScalar(0.7), 0, inPt);
    quad(b, [f.v(x, oy, oz1), f.v(x, yBase + h, zm), f.v(x, yBase + h - t, zm), f.v(x, oy - t, oz1)], roofColor.clone().multiplyScalar(0.7), 0, inPt);
  }
}

/** 四角錐の屋根 */
export function pyramidRoof(
  b: GeoBuilder,
  f: Frame,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  yBase: number,
  h: number,
  color: THREE.Color,
): void {
  const apex = f.v((x0 + x1) / 2, yBase + h, (z0 + z1) / 2);
  const inside = f.v((x0 + x1) / 2, yBase, (z0 + z1) / 2);
  const c = [f.v(x0, yBase, z0), f.v(x1, yBase, z0), f.v(x1, yBase, z1), f.v(x0, yBase, z1)];
  for (let i = 0; i < 4; i++) tri(b, [c[i], c[(i + 1) % 4], apex], color, 2, inside);
}

export function cylinder(
  b: GeoBuilder,
  x: number,
  z: number,
  y0: number,
  y1: number,
  r0: number,
  r1: number,
  segs: number,
  color: THREE.Color,
  pattern: Pattern,
): void {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, segs, 1, false);
  g.translate(x, (y0 + y1) / 2, z);
  b.append(g, () => color, pattern);
}

export function cone(b: GeoBuilder, x: number, z: number, y0: number, h: number, r: number, segs: number, color: THREE.Color, pattern: Pattern): void {
  const g = new THREE.ConeGeometry(r, h, segs, 1, true);
  g.translate(x, y0 + h / 2, z);
  b.append(g, () => color, pattern);
}

/** 点群の地面の高さの最小・最大 */
export function groundRange(hm: Heightmap, pts: Vec2[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    const h = hm.heightAt(p.x, p.z);
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
  return { min, max };
}

/** Frame の矩形の四隅と中心 */
export function footprint(f: Frame, x0: number, x1: number, z0: number, z1: number): Vec2[] {
  return [
    { x: f.x(x0, z0), z: f.z(x0, z0) },
    { x: f.x(x1, z0), z: f.z(x1, z0) },
    { x: f.x(x1, z1), z: f.z(x1, z1) },
    { x: f.x(x0, z1), z: f.z(x0, z1) },
    { x: f.x((x0 + x1) / 2, (z0 + z1) / 2), z: f.z((x0 + x1) / 2, (z0 + z1) / 2) },
  ];
}

/** 地形に沿った壁（a → b）。上端も地形に沿う。onTop は上端の各点で呼ばれる（狭間などを載せる用） */
export function terrainWall(
  ctx: BuildCtx,
  a: Vec2,
  bEnd: Vec2,
  thick: number,
  height: number,
  color: THREE.Color,
  pattern: Pattern,
  topColor?: THREE.Color,
): { samples: { p: Vec2; top: number }[]; dir: Vec2; perp: Vec2; len: number } {
  const dx = bEnd.x - a.x;
  const dz = bEnd.z - a.z;
  const len = Math.hypot(dx, dz);
  const dir = { x: dx / len, z: dz / len };
  const perp = { x: -dir.z, z: dir.x };
  const n = Math.max(2, Math.ceil(len / 0.06));
  const ht = thick / 2;
  const samples: { p: Vec2; top: number; ground: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * len;
    const p = { x: a.x + dir.x * t, z: a.z + dir.z * t };
    const g = Math.min(
      ctx.hm.heightAt(p.x + perp.x * ht, p.z + perp.z * ht),
      ctx.hm.heightAt(p.x - perp.x * ht, p.z - perp.z * ht),
    );
    samples.push({ p, ground: g, top: Math.max(g, ctx.waterLevel) + height });
  }
  const V = (p: Vec2, side: number, y: number) => new THREE.Vector3(p.x + perp.x * ht * side, y, p.z + perp.z * ht * side);
  for (let i = 0; i < n; i++) {
    const s0 = samples[i];
    const s1 = samples[i + 1];
    const y0 = Math.min(s0.ground, s1.ground) - 0.1;
    hexahedron(
      ctx.b,
      [V(s0.p, -1, y0), V(s1.p, -1, y0), V(s1.p, 1, y0), V(s0.p, 1, y0), V(s0.p, -1, s0.top), V(s1.p, -1, s1.top), V(s1.p, 1, s1.top), V(s0.p, 1, s0.top)],
      color,
      pattern,
      topColor,
    );
  }
  return { samples, dir, perp, len };
}

/** HEX ごとに決定的な乱数列 */
export function cellRng(seed: number, col: number, row: number, salt: number): Rng {
  return mulberry32((Math.imul(seed, 73856093) ^ Math.imul(col + 1, 19349663) ^ Math.imul(row + 1, 83492791) ^ Math.imul(salt, 2654435761)) >>> 0);
}
