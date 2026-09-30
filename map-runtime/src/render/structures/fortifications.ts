/**
 * 城・砦。
 * 同種の HEX がつながった領域ごとに、外周の辺に壁（城 = 石の城壁、砦 = 木柵）、
 * 外周の頂点に塔、1 か所に門を置き、内側に建物を建てる。
 */
import * as THREE from 'three';
import { featureRegions, type FeatureId } from '../../core/features';
import type { Offset, Vec2 } from '../../core/hex';
import type { HexCell } from '../../core/mapData';
import { TERRAIN_DEFS } from '../../core/terrainTypes';
import { PAT } from './material';
import { box, cellRng, cone, cylinder, footprint, Frame, groundRange, pyramidRoof, terrainWall, vary, type BuildCtx, type Rng } from './shapes';
import { house, ROOF_SLATE, ROOF_THATCH, ROOF_TILE } from './village';

interface Edge {
  cell: HexCell;
  dir: number;
  nb: Offset;
  a: Vec2;
  b: Vec2;
  /** 領域の外向き（セル中心 → 隣の中心） */
  out: Vec2;
}

interface Region {
  cells: HexCell[];
  edges: Edge[];
  vertices: Vec2[];
  gate: Edge | null;
  rng: Rng;
}

export function buildFortifications(ctx: BuildCtx, seed: number): void {
  for (const type of ['castle', 'fort'] as const) {
    for (const cells of featureRegions(ctx.map, type)) {
      const region = analyzeRegion(ctx, cells, type, seed);
      if (type === 'castle') buildCastle(ctx, region);
      else buildFort(ctx, region);
    }
  }
}

function analyzeRegion(ctx: BuildCtx, cells: HexCell[], type: FeatureId, seed: number): Region {
  const layout = ctx.map.layout;
  const key = (col: number, row: number) => `${col},${row}`;
  const inRegion = new Set(cells.map((c) => key(c.col, c.row)));
  const rng = cellRng(seed, cells[0].col, cells[0].row, type === 'castle' ? 11 : 12);

  const edges: Edge[] = [];
  const verts = new Map<string, Vec2>();
  for (const cell of cells) {
    const c = layout.offsetToWorld(cell.col, cell.row);
    for (let dir = 0; dir < 6; dir++) {
      const nb = layout.neighborInDir(cell.col, cell.row, dir);
      if (inRegion.has(key(nb.col, nb.row))) continue;
      const [a, b] = layout.edgeEndpoints(cell.col, cell.row, dir);
      const n = layout.offsetToWorld(nb.col, nb.row);
      const len = Math.hypot(n.x - c.x, n.z - c.z);
      edges.push({ cell, dir, nb, a, b, out: { x: (n.x - c.x) / len, z: (n.z - c.z) / len } });
      for (const p of [a, b]) verts.set(`${Math.round(p.x * 1000)},${Math.round(p.z * 1000)}`, p);
    }
  }

  // 門: 街道が来ている辺を最優先。無ければ陸続きで、村や橋に面していて、高低差の小さい辺
  let gate: Edge | null = null;
  let best = -Infinity;
  for (const e of edges) {
    const nc = ctx.map.get(e.nb.col, e.nb.row);
    let score: number;
    if (!nc) score = -10;
    else if (TERRAIN_DEFS[nc.terrain].isWater && nc.feature !== 'bridge') score = -5;
    else {
      score = -Math.abs(nc.elevation - e.cell.elevation);
      if (nc.terrain === 'mountain') score -= 2;
      if (nc.feature === 'village' || nc.feature === 'bridge') score += 3;
    }
    if (e.cell.roads?.includes(e.dir)) score += 20;
    score += rng() * 0.5;
    if (score > best) {
      best = score;
      gate = e;
    }
  }
  if (best <= -5) gate = null;

  return { cells, edges, vertices: [...verts.values()], gate, rng };
}

/** 壁のローカル座標系: x = 壁に沿う方向, z = +1 が外側 */
function edgeFrame(p: Vec2, dir: Vec2, perp: Vec2, out: Vec2): Frame {
  const outSign = perp.x * out.x + perp.z * out.z >= 0 ? 1 : -1;
  // Frame のローカル z は (-sin, cos) = perp。外向きが +z になるよう回転を反転する
  const rot = Math.atan2(dir.z, dir.x);
  return outSign > 0 ? new Frame(p.x, p.z, rot) : new Frame(p.x, p.z, rot + Math.PI);
}

function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

// ---- 城 -------------------------------------------------------------------

const WALL_H = 0.2;
const WALL_T = 0.07;
const TOWER_R = 0.08;
const TOWER_H = 0.3;
const GATE_HALF = 0.075;

function buildCastle(ctx: BuildCtx, r: Region): void {
  const rng = r.rng;
  const stone = vary(0xb3aa98, rng, 0.05);
  const walk = stone.clone().multiplyScalar(0.8);
  const towerRoof = rng() < 0.6 ? (rng() < 0.5 ? ROOF_SLATE : ROOF_TILE[1]) : null;

  const castleWall = (a: Vec2, b: Vec2, out: Vec2) => {
    if (Math.hypot(b.x - a.x, b.z - a.z) < 0.02) return;
    const w = terrainWall(ctx, a, b, WALL_T, WALL_H, stone, PAT.Masonry, walk);
    // 狭間（外側の胸壁）
    const step = 0.045;
    const n = Math.floor(w.len / step);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const p = lerp2(a, b, t);
      const si = t * (w.samples.length - 1);
      const s0 = w.samples[Math.floor(si)];
      const s1 = w.samples[Math.min(Math.ceil(si), w.samples.length - 1)];
      const top = s0.top + (s1.top - s0.top) * (si - Math.floor(si));
      const f = edgeFrame(p, w.dir, w.perp, out);
      const hz = WALL_T / 2;
      box(ctx.b, f, -0.011, 0.011, hz - 0.018, hz, top - 0.001, top + 0.028, stone, PAT.Masonry);
    }
  };

  for (const e of r.edges) {
    if (e === r.gate) {
      const mid = lerp2(e.a, e.b, 0.5);
      const len = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z);
      const t = GATE_HALF / len;
      castleWall(e.a, lerp2(e.a, e.b, 0.5 - t), e.out);
      castleWall(lerp2(e.a, e.b, 0.5 + t), e.b, e.out);
      gatehouse(ctx, mid, { x: (e.b.x - e.a.x) / len, z: (e.b.z - e.a.z) / len }, e.out, stone, rng);
    } else {
      castleWall(e.a, e.b, e.out);
    }
  }

  for (const v of r.vertices) roundTower(ctx, v, TOWER_R, TOWER_H, stone, towerRoof, rng);

  // 主塔（領域の中でいちばん内側の HEX）
  const layout = ctx.map.layout;
  const inner = [...r.cells].sort((p, q) => innerCount(r, q) - innerCount(r, p))[0];
  const kc = layout.offsetToWorld(inner.col, inner.row);
  keep(ctx, kc, stone, towerRoof ?? ROOF_SLATE, rng);

  // 他の HEX に館や兵舎
  for (const cell of r.cells) {
    const c = layout.offsetToWorld(cell.col, cell.row);
    const n = cell === inner ? 1 : 2 + Math.floor(rng() * 2);
    const placed: { x: number; z: number; r: number }[] = cell === inner ? [{ x: kc.x, z: kc.z, r: 0.36 }] : []; // 主塔 + 付属の館
    for (let i = 0, attempt = 0; i < n && attempt < 30; attempt++) {
      const rr = Math.sqrt(rng()) * layout.inradius * 0.5;
      const a = rng() * Math.PI * 2;
      const x = c.x + Math.cos(a) * rr;
      const z = c.z + Math.sin(a) * rr;
      const L = 0.2 + rng() * 0.1;
      const W = 0.1 + rng() * 0.04;
      const rad = Math.hypot(L, W) / 2 + 0.02;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + rad)) continue;
      if (Math.hypot(x - c.x, z - c.z) + rad > layout.inradius - WALL_T - 0.03 && r.cells.length === 1) continue;
      house(ctx, new Frame(x, z, rng() * Math.PI), { L, W, wallH: 0.1 + rng() * 0.04, style: rng() < 0.7 ? 'stone' : 'plaster', roof: rng() < 0.5 ? ROOF_SLATE : ROOF_TILE[0] }, rng);
      placed.push({ x, z, r: rad });
      i++;
    }
  }
}

function innerCount(r: Region, cell: HexCell): number {
  return 6 - r.edges.filter((e) => e.cell === cell).length;
}

function roundTower(ctx: BuildCtx, p: Vec2, radius: number, height: number, stone: THREE.Color, roof: number | null, rng: Rng): void {
  const pts = [0, 1, 2, 3].map((i) => ({ x: p.x + Math.cos(i * 1.57) * radius, z: p.z + Math.sin(i * 1.57) * radius }));
  const g = groundRange(ctx.hm, [p, ...pts]);
  const top = Math.max(g.max, ctx.waterLevel) + height;
  cylinder(ctx.b, p.x, p.z, g.min - 0.1, top, radius, radius * 0.94, 14, stone, PAT.Masonry);
  // 張り出し + 狭間
  const rr = radius * 1.12;
  cylinder(ctx.b, p.x, p.z, top - 0.018, top + 0.012, radius * 0.94, rr, 14, stone, PAT.Masonry);
  if (roof !== null) {
    cone(ctx.b, p.x, p.z, top + 0.012, radius * 1.9, rr * 1.06, 14, vary(roof, rng), PAT.Roof);
  } else {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const f = new Frame(p.x + Math.cos(a) * (rr - 0.009), p.z + Math.sin(a) * (rr - 0.009), a);
      box(ctx.b, f, -0.009, 0.009, -0.011, 0.011, top + 0.011, top + 0.038, stone, PAT.Masonry);
    }
  }
}

function gatehouse(ctx: BuildCtx, mid: Vec2, dir: Vec2, out: Vec2, stone: THREE.Color, rng: Rng): void {
  const perp = { x: -dir.z, z: dir.x };
  const f = edgeFrame(mid, dir, perp, out);
  const g = groundRange(ctx.hm, footprint(f, -GATE_HALF - 0.1, GATE_HALF + 0.1, -WALL_T, WALL_T));
  const top = g.max + WALL_H + 0.08;
  const d = WALL_T / 2 + 0.03;
  // 両脇の塔
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -GATE_HALF - 0.1 : GATE_HALF;
    const x1 = s < 0 ? -GATE_HALF : GATE_HALF + 0.1;
    box(ctx.b, f, x0, x1, -d, d, g.min - 0.1, top, stone, PAT.Masonry);
    for (const [mx, mz] of [
      [x0 + 0.012, -d + 0.012],
      [x1 - 0.012, -d + 0.012],
      [x0 + 0.012, d - 0.012],
      [x1 - 0.012, d - 0.012],
      [(x0 + x1) / 2, d - 0.012],
    ])
      box(ctx.b, f, mx - 0.012, mx + 0.012, mz - 0.012, mz + 0.012, top, top + 0.03, stone, PAT.Masonry);
  }
  // 門の上のアーチ部
  const opening = g.min + 0.11;
  box(ctx.b, f, -GATE_HALF, GATE_HALF, -WALL_T / 2 - 0.01, WALL_T / 2 + 0.01, opening, top - 0.03, stone, PAT.Masonry);
  // 扉
  box(ctx.b, f, -GATE_HALF, GATE_HALF, WALL_T / 2 - 0.004, WALL_T / 2 + 0.006, g.min - 0.02, opening, vary(0x3e2a1c, rng), PAT.Wood);
}

function keep(ctx: BuildCtx, c: Vec2, stone: THREE.Color, roofColor: number, rng: Rng): void {
  const rot = rng() * Math.PI;
  const f = new Frame(c.x, c.z, rot);
  const K = 0.14;
  const g = groundRange(ctx.hm, footprint(f, -K, K, -K, K));
  const top = g.max + 0.42;
  box(ctx.b, f, -K, K, -K, K, g.min - 0.1, top, stone, PAT.Masonry, stone.clone().multiplyScalar(0.8));
  // 窓（縦長の矢狭間）
  const oc = vary(0x2a2420, rng);
  for (const y of [top - 0.1, top - 0.22]) {
    for (const x of [-K * 0.45, K * 0.45]) {
      box(ctx.b, f, x - 0.006, x + 0.006, K - 0.001, K + 0.002, y - 0.022, y + 0.022, oc, PAT.None);
      box(ctx.b, f, x - 0.006, x + 0.006, -K - 0.002, -K + 0.001, y - 0.022, y + 0.022, oc, PAT.None);
    }
  }
  // 胸壁
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t = -K + ((i + 0.5) / n) * 2 * K;
    box(ctx.b, f, t - 0.012, t + 0.012, K - 0.02, K, top, top + 0.03, stone, PAT.Masonry);
    box(ctx.b, f, t - 0.012, t + 0.012, -K, -K + 0.02, top, top + 0.03, stone, PAT.Masonry);
    box(ctx.b, f, K - 0.02, K, t - 0.012, t + 0.012, top, top + 0.03, stone, PAT.Masonry);
    box(ctx.b, f, -K, -K + 0.02, t - 0.012, t + 0.012, top, top + 0.03, stone, PAT.Masonry);
  }
  // 四隅の小塔
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const x = f.x(sx * K, sz * K);
    const z = f.z(sx * K, sz * K);
    cylinder(ctx.b, x, z, top - 0.1, top + 0.07, 0.034, 0.034, 10, stone, PAT.Masonry);
    cone(ctx.b, x, z, top + 0.07, 0.1, 0.042, 10, vary(roofColor, rng), PAT.Roof);
  }
  // 付属の館
  const hallF = new Frame(f.x(0, K + 0.075), f.z(0, K + 0.075), rot);
  house(ctx, hallF, { L: K * 2 + 0.04, W: 0.13, wallH: 0.15, style: 'stone', roof: roofColor, chimney: true }, rng);
}

// ---- 砦 -------------------------------------------------------------------

const PALISADE_H = 0.13;
const LOG_R = 0.011;

function buildFort(ctx: BuildCtx, r: Region): void {
  const rng = r.rng;
  const wood = 0x6b4f35;

  const palisade = (a: Vec2, b: Vec2) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(len / (LOG_R * 2)));
    for (let i = 0; i < n; i++) {
      const p = lerp2(a, b, (i + 0.5) / n);
      const g = ctx.hm.heightAt(p.x, p.z);
      const h = PALISADE_H * (0.9 + rng() * 0.2);
      const c = vary(wood, rng, 0.12);
      cylinder(ctx.b, p.x, p.z, g - 0.05, g + h, LOG_R, LOG_R, 5, c, PAT.Wood);
      cone(ctx.b, p.x, p.z, g + h, 0.022, LOG_R, 5, c, PAT.Wood);
    }
  };

  for (const e of r.edges) {
    if (e === r.gate) {
      const len = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z);
      const t = GATE_HALF / len;
      palisade(e.a, lerp2(e.a, e.b, 0.5 - t));
      palisade(lerp2(e.a, e.b, 0.5 + t), e.b);
      fortGate(ctx, lerp2(e.a, e.b, 0.5), { x: (e.b.x - e.a.x) / len, z: (e.b.z - e.a.z) / len }, e.out, rng);
    } else {
      palisade(e.a, e.b);
    }
  }

  for (const v of r.vertices) watchtower(ctx, v, rng);

  // 内側に小屋と天幕
  const layout = ctx.map.layout;
  for (const cell of r.cells) {
    const c = layout.offsetToWorld(cell.col, cell.row);
    const placed: { x: number; z: number; r: number }[] = [];
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0, attempt = 0; i < n && attempt < 40; attempt++) {
      const rr = Math.sqrt(rng()) * layout.inradius * 0.62;
      const a = rng() * Math.PI * 2;
      const x = c.x + Math.cos(a) * rr;
      const z = c.z + Math.sin(a) * rr;
      const isHut = i < 2;
      const rad = isHut ? 0.11 : 0.05;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + rad)) continue;
      if (isHut) {
        house(ctx, new Frame(x, z, rng() * Math.PI), { L: 0.15 + rng() * 0.05, W: 0.09, wallH: 0.06, style: 'wood', roof: ROOF_THATCH }, rng);
      } else {
        const g = ctx.hm.heightAt(x, z);
        cone(ctx.b, x, z, g - 0.005, 0.07, 0.05, 6, vary(0xd9ccaa, rng, 0.05), PAT.None);
      }
      placed.push({ x, z, r: rad });
      i++;
    }
  }
}

function watchtower(ctx: BuildCtx, p: Vec2, rng: Rng): void {
  const f = new Frame(p.x, p.z, rng() * Math.PI);
  const s = 0.045;
  const g = groundRange(ctx.hm, footprint(f, -s, s, -s, s));
  const wood = vary(0x5e4430, rng);
  const deck = g.max + 0.19;
  const roofY = deck + 0.08;
  for (const [x, z] of [
    [-s, -s],
    [s, -s],
    [s, s],
    [-s, s],
  ])
    box(ctx.b, f, x - 0.007, x + 0.007, z - 0.007, z + 0.007, g.min - 0.05, roofY, wood, PAT.Wood);
  box(ctx.b, f, -s - 0.012, s + 0.012, -s - 0.012, s + 0.012, deck - 0.012, deck, wood, PAT.Wood);
  // 手すり（板張り）
  const e = s + 0.012;
  box(ctx.b, f, -e, e, -e, -e + 0.004, deck, deck + 0.03, wood, PAT.Wood);
  box(ctx.b, f, -e, e, e - 0.004, e, deck, deck + 0.03, wood, PAT.Wood);
  box(ctx.b, f, -e, -e + 0.004, -e, e, deck, deck + 0.03, wood, PAT.Wood);
  box(ctx.b, f, e - 0.004, e, -e, e, deck, deck + 0.03, wood, PAT.Wood);
  pyramidRoof(ctx.b, f, -s - 0.025, s + 0.025, -s - 0.025, s + 0.025, roofY, 0.06, vary(ROOF_THATCH, rng));
}

function fortGate(ctx: BuildCtx, mid: Vec2, dir: Vec2, out: Vec2, rng: Rng): void {
  const perp = { x: -dir.z, z: dir.x };
  const f = edgeFrame(mid, dir, perp, out);
  const g = groundRange(ctx.hm, footprint(f, -GATE_HALF, GATE_HALF, -0.02, 0.02));
  const wood = vary(0x5e4430, rng);
  const top = g.max + PALISADE_H + 0.05;
  for (const x of [-GATE_HALF, GATE_HALF]) {
    const px = f.x(x, 0);
    const pz = f.z(x, 0);
    cylinder(ctx.b, px, pz, g.min - 0.05, top, 0.018, 0.016, 6, wood, PAT.Wood);
  }
  box(ctx.b, f, -GATE_HALF - 0.02, GATE_HALF + 0.02, -0.012, 0.012, top - 0.03, top - 0.008, wood, PAT.Wood);
  // 扉（少し開いている）
  const door = vary(0x6b4f35, rng);
  box(ctx.b, f, -GATE_HALF + 0.012, -0.01, -0.006, 0.006, g.min - 0.02, g.max + PALISADE_H - 0.01, door, PAT.Wood);
  box(ctx.b, f, 0.01, GATE_HALF - 0.012, -0.006, 0.006, g.min - 0.02, g.max + PALISADE_H - 0.01, door, PAT.Wood);
}
