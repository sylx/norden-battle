/**
 * 荒地の岩。荒地の HEX に大小の岩を転がす（地形の色だけでは荒地に見えないため）。
 *
 * - 人工物と同じ組み立て先（ctx.b）に足すので、描画の呼び出しは増えない。1 個は 15 三角形の低ポリの岩で、
 *   1 HEX に 12〜20 個（うち大きいものが 1〜2 個）。
 * - 街道・人工物（村・砦・城）・水際には置かない。荒地の HEX の中だけに置く（隣の HEX へはみ出さない）。
 * - 位置・形は HEX ごとの乱数（元のマップの座標）で決まり、切り出したマップや描き直しでも変わらない。
 */
import * as THREE from 'three';
import type { HexCell } from '../../core/mapData.ts';
import { ROAD_WIDTH } from '../../core/roads.ts';
import { PAT } from './material.ts';
import { structureRng, tri, quad, vary, type BuildCtx, type Rng } from './shapes.ts';

/** 岩の色（荒地の地面より少し暗い灰褐色）と、上面の明るい色 */
const ROCK_COLOR = 0x8a7f6c;
const ROCK_TOP = 0xa89d88;
/** 岩の周の頂点の数 */
const SIDES = 5;

export function buildRocks(ctx: BuildCtx, seed: number): void {
  for (const cell of ctx.map.allCells()) {
    if (cell.terrain === 'wasteland' && !cell.feature) rockField(ctx, cell, seed);
  }
}

function rockField(ctx: BuildCtx, cell: HexCell, seed: number): void {
  const layout = ctx.map.layout;
  const s = ctx.s;
  const rng = structureRng(ctx, seed, cell.col, cell.row, 61);
  const c = layout.offsetToWorld(cell.col, cell.row);
  const roadClear = (ROAD_WIDTH / 2 + 0.05) * s;
  const n = 12 + Math.floor(rng() * 9);
  for (let i = 0; i < n; i++) {
    // HEX の内側（少しはみ出してもよい）に散らす。最初の 1〜2 個は大きな岩
    const big = i < 1 + Math.floor(rng() * 2);
    const rr = Math.sqrt(rng()) * layout.inradius * 0.95;
    const a = rng() * Math.PI * 2;
    const x = c.x + Math.cos(a) * rr;
    const z = c.z + Math.sin(a) * rr;
    const radius = (big ? 0.05 + rng() * 0.035 : 0.014 + rng() * 0.022) * s;
    const height = radius * (0.55 + rng() * 0.5);
    const rot = rng() * Math.PI * 2;
    const shade = rng();
    // 形は岩ごとの乱数で決める（置けない岩があっても、ほかの岩の位置・形は変わらない）
    const shape = structureRng(ctx, seed, cell.col, cell.row, 100 + i);
    if (ctx.roads.distance(x, z, roadClear + radius) < roadClear + radius) continue;
    const o = layout.worldToOffset(x, z);
    const under = ctx.map.get(o.col, o.row);
    if (!under || under.feature || under.terrain !== 'wasteland') continue;
    const g = ctx.hm.heightAt(x, z);
    if (g < ctx.waterLevel + 0.02 * s) continue;
    rock(ctx, x, z, g, radius, height, rot, shade, shape);
  }
}

/** 1 個の岩: 地面に埋めた下の周、少しすぼめた上の周、ずらした頂点（側面 5 枚 + 上面 5 枚） */
function rock(ctx: BuildCtx, x: number, z: number, g: number, radius: number, height: number, rot: number, shade: number, rng: Rng): void {
  const color = vary(ROCK_COLOR, rng, 0.12).multiplyScalar(0.85 + 0.25 * shade);
  const top = vary(ROCK_TOP, rng, 0.1).multiplyScalar(0.85 + 0.25 * shade);
  const lower: THREE.Vector3[] = [];
  const upper: THREE.Vector3[] = [];
  for (let k = 0; k < SIDES; k++) {
    const a = rot + (k / SIDES) * Math.PI * 2;
    const r0 = radius * (0.8 + rng() * 0.35);
    const r1 = r0 * (0.55 + rng() * 0.25);
    const a1 = a + (rng() - 0.5) * 0.5;
    // 下の周は斜面でも浮かないよう、その点の地面より少し下に埋める
    const lx = x + Math.cos(a) * r0;
    const lz = z + Math.sin(a) * r0;
    lower.push(new THREE.Vector3(lx, Math.min(g, ctx.hm.heightAt(lx, lz)) - height * 0.25, lz));
    upper.push(new THREE.Vector3(x + Math.cos(a1) * r1, g + height * (0.45 + rng() * 0.25), z + Math.sin(a1) * r1));
  }
  const apex = new THREE.Vector3(x + (rng() - 0.5) * radius * 0.4, g + height, z + (rng() - 0.5) * radius * 0.4);
  const inside = new THREE.Vector3(x, g + height * 0.3, z);
  for (let k = 0; k < SIDES; k++) {
    const j = (k + 1) % SIDES;
    quad(ctx.b, [lower[k], lower[j], upper[j], upper[k]], color, PAT.None, inside);
    tri(ctx.b, [upper[k], upper[j], apex], top, PAT.None, inside);
  }
}
