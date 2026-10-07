/**
 * 石のアーチ橋。川の HEX を、指定した軸の両隣の陸へ渡す。
 */
import * as THREE from 'three';
import { bridgeAxis } from '../../core/features';
import type { Vec2 } from '../../core/hex';
import type { HexCell } from '../../core/mapData';
import { PAT } from './material';
import { structureRng, hexahedron, quad, vary, type BuildCtx } from './shapes';

const WIDTH = 0.3;
const PARAPET_T = 0.022;
const PARAPET_H = 0.045;
/** 橋の両端を隣の HEX へどれだけ伸ばすか（中心間距離に対する比） */
const REACH = 0.72;

function smoothMax(a: number, b: number, k: number): number {
  const h = Math.min(Math.max(0.5 + (0.5 * (a - b)) / k, 0), 1);
  return b + (a - b) * h + k * h * (1 - h);
}

export function buildBridge(ctx: BuildCtx, cell: HexCell, seed: number): void {
  const layout = ctx.map.layout;
  const rng = structureRng(ctx, seed, cell.col, cell.row, 3);
  const axis = bridgeAxis(ctx.map, cell);
  const c = layout.offsetToWorld(cell.col, cell.row);
  const na = layout.neighborInDir(cell.col, cell.row, axis);
  const nb = layout.neighborInDir(cell.col, cell.row, axis + 3);
  const wa = layout.offsetToWorld(na.col, na.row);
  const wb = layout.offsetToWorld(nb.col, nb.row);
  const pA: Vec2 = { x: c.x + (wa.x - c.x) * REACH, z: c.z + (wa.z - c.z) * REACH };
  const pB: Vec2 = { x: c.x + (wb.x - c.x) * REACH, z: c.z + (wb.z - c.z) * REACH };
  const len = Math.hypot(pB.x - pA.x, pB.z - pA.z);
  const dir = { x: (pB.x - pA.x) / len, z: (pB.z - pA.z) / len };
  const perp = { x: -dir.z, z: dir.x };

  // 路面の高さ: 両岸を結び、水面より十分上に、中央を少し持ち上げる
  const N = 40;
  const hA = ctx.hm.heightAt(pA.x, pA.z) + 0.012;
  const hB = ctx.hm.heightAt(pB.x, pB.z) + 0.012;
  const minDeck = ctx.waterLevel + 0.11;
  const deck: number[] = [];
  const ground: number[] = [];
  const pts: Vec2[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = { x: pA.x + dir.x * len * t, z: pA.z + dir.z * len * t };
    pts.push(p);
    ground.push(ctx.hm.heightAt(p.x, p.z));
    deck.push(smoothMax(hA + (hB - hA) * t, minDeck + 0.03 * Math.sin(Math.PI * t), 0.05));
  }
  const bottom = Math.min(...ground) - 0.05;
  const u = (i: number) => (i / N - 0.5) * len;

  // 側面形状（アーチの穴あき）を幅方向に押し出す
  const shape = new THREE.Shape();
  shape.moveTo(u(0), bottom);
  shape.lineTo(u(N), bottom);
  for (let i = N; i >= 0; i--) shape.lineTo(u(i), deck[i]);
  shape.closePath();

  // 水の上の区間にアーチを並べる
  let w0 = -1;
  let w1 = -1;
  for (let i = 0; i <= N; i++) {
    if (ground[i] < ctx.waterLevel) {
      if (w0 < 0) w0 = i;
      w1 = i;
    }
  }
  if (w0 >= 0) {
    const u0 = u(Math.max(w0 - 1, 0));
    const u1 = u(Math.min(w1 + 1, N));
    const span = u1 - u0;
    const n = Math.max(1, Math.round(span / 0.3));
    const aw = span / n;
    const spring = ctx.waterLevel - 0.02;
    for (let k = 0; k < n; k++) {
      const uc = u0 + (k + 0.5) * aw;
      const deckAt = deck[Math.round((uc / len + 0.5) * N)];
      const rA = Math.min(aw * 0.36, deckAt - 0.035 - spring);
      if (rA < 0.02) continue;
      const hole = new THREE.Path();
      hole.moveTo(uc - rA, bottom + 0.004);
      hole.lineTo(uc + rA, bottom + 0.004);
      hole.lineTo(uc + rA, spring);
      hole.absarc(uc, spring, rA, 0, Math.PI, false);
      hole.lineTo(uc - rA, bottom + 0.004);
      shape.holes.push(hole);
    }
  }

  const stone = vary(0xa89f8c, rng, 0.05);
  const g = new THREE.ExtrudeGeometry(shape, { depth: WIDTH, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -WIDTH / 2);
  g.rotateY(-Math.atan2(dir.z, dir.x));
  const mid = { x: (pA.x + pB.x) / 2, z: (pA.z + pB.z) / 2 };
  g.translate(mid.x, 0, mid.z);
  ctx.b.append(g, () => stone, PAT.Masonry);

  // 欄干と石畳
  const parapet = stone.clone().multiplyScalar(1.08);
  const road = vary(0x8c8070, rng, 0.05);
  const hw = WIDTH / 2;
  const V = (p: Vec2, off: number, y: number) => new THREE.Vector3(p.x + perp.x * off, y, p.z + perp.z * off);
  for (let i = 0; i < N; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const d0 = deck[i];
    const d1 = deck[i + 1];
    for (const side of [-1, 1]) {
      const o0 = side * hw;
      const o1 = side * (hw - PARAPET_T);
      hexahedron(
        ctx.b,
        [V(p0, o0, d0 - 0.01), V(p1, o0, d1 - 0.01), V(p1, o1, d1 - 0.01), V(p0, o1, d0 - 0.01), V(p0, o0, d0 + PARAPET_H), V(p1, o0, d1 + PARAPET_H), V(p1, o1, d1 + PARAPET_H), V(p0, o1, d0 + PARAPET_H)],
        parapet,
        PAT.Masonry,
      );
    }
    const ro = hw - PARAPET_T;
    const below = V(p0, 0, d0 - 1);
    quad(ctx.b, [V(p0, -ro, d0 + 0.001), V(p1, -ro, d1 + 0.001), V(p1, ro, d1 + 0.001), V(p0, ro, d0 + 0.001)], road, PAT.Masonry, below);
  }
}
