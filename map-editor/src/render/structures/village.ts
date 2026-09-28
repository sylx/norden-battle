/**
 * 村: HEX 内に家々を散らして置く。たまに教会、編み垣の畑、干し草の山。
 */
import * as THREE from 'three';
import type { HexCell } from '../../core/mapData';
import { ROAD_WIDTH } from '../../core/roads';
import { PAT, type Pattern } from './material';
import {
  box,
  cellRng,
  cone,
  cylinder,
  footprint,
  Frame,
  gableRoof,
  groundRange,
  pyramidRoof,
  terrainWall,
  vary,
  type BuildCtx,
  type Rng,
} from './shapes';

export type WallStyle = 'plaster' | 'stone' | 'wood';

/** 瓦（赤茶）・スレート・藁葺き */
export const ROOF_TILE = [0x9a4a2e, 0x8a3f28, 0xa5573a, 0x7a3a26];
export const ROOF_SLATE = 0x535a66;
export const ROOF_THATCH = 0x9c8452;
const PLASTER = [0xe8dcc4, 0xddd2b8, 0xefe6d2, 0xd8c8a8];
const STONE = 0xa39a8a;
const WOOD_WALL = 0x6e5238;
const TIMBER = 0x4a3526;
const OPENING = 0x2a2420;
const PLINTH = 0x7d776c;

export interface HouseOpts {
  L: number;
  W: number;
  wallH: number;
  style: WallStyle;
  roof: number;
  /** 屋根の高さ（省略時は W に比例） */
  roofH?: number;
  chimney?: boolean;
}

export interface HouseResult {
  base: number;
  floor: number;
  top: number;
}

/** 家 1 軒（ローカル x が棟の方向） */
export function house(ctx: BuildCtx, f: Frame, o: HouseOpts, rng: Rng): HouseResult {
  const b = ctx.b;
  const hl = o.L / 2;
  const hw = o.W / 2;
  const g = groundRange(ctx.hm, footprint(f, -hl, hl, -hw, hw));
  const base = g.min - 0.03;
  const floor = g.max + 0.006;
  const top = floor + o.wallH;

  // 基礎（斜面では段差を石積みで吸収する）
  box(b, f, -hl - 0.004, hl + 0.004, -hw - 0.004, hw + 0.004, base, floor, vary(PLINTH, rng), PAT.Masonry);

  let wallColor: THREE.Color;
  let wallPat: Pattern;
  if (o.style === 'plaster') {
    wallColor = vary(PLASTER[Math.floor(rng() * PLASTER.length)], rng, 0.04);
    wallPat = PAT.Plaster;
  } else if (o.style === 'stone') {
    wallColor = vary(STONE, rng);
    wallPat = PAT.Masonry;
  } else {
    wallColor = vary(WOOD_WALL, rng);
    wallPat = PAT.Wood;
  }
  box(b, f, -hl, hl, -hw, hw, floor, top, wallColor, wallPat);

  // 木骨（漆喰壁の家だけ）
  if (o.style === 'plaster') {
    const tc = vary(TIMBER, rng);
    const t = 0.0045;
    const e = 0.0015;
    for (const x of [-hl, hl]) for (const z of [-hw, hw]) box(b, f, x - t, x + t, z - t, z + t, floor, top, tc, PAT.Wood);
    const y = floor + o.wallH * 0.5;
    box(b, f, -hl - e, hl + e, -hw - e, -hw + e, y - 0.003, y + 0.003, tc, PAT.Wood);
    box(b, f, -hl - e, hl + e, hw - e, hw + e, y - 0.003, y + 0.003, tc, PAT.Wood);
    box(b, f, -hl - e, -hl + e, -hw - e, hw + e, y - 0.003, y + 0.003, tc, PAT.Wood);
    box(b, f, hl - e, hl + e, -hw - e, hw + e, y - 0.003, y + 0.003, tc, PAT.Wood);
  }

  // 扉と窓
  const oc = vary(OPENING, rng, 0.05);
  const doorX = (rng() - 0.5) * o.L * 0.35;
  box(b, f, doorX - 0.012, doorX + 0.012, hw - 0.001, hw + 0.003, floor, floor + Math.min(0.045, o.wallH * 0.75), vary(0x3e2a1c, rng), PAT.Wood);
  const wy = floor + o.wallH * 0.62;
  const ws = Math.min(0.009, o.wallH * 0.14);
  for (const x of [-o.L * 0.3, o.L * 0.3]) {
    if (Math.abs(x - doorX) > 0.03) box(b, f, x - ws, x + ws, hw - 0.001, hw + 0.0025, wy - ws, wy + ws, oc, PAT.None);
    box(b, f, x - ws, x + ws, -hw - 0.0025, -hw + 0.001, wy - ws, wy + ws, oc, PAT.None);
  }

  // 屋根
  const roofH = o.roofH ?? o.W * 0.55;
  gableRoof(b, f, -hl, hl, -hw, hw, top, roofH, 0.014, vary(o.roof, rng), wallColor, wallPat);

  // 煙突
  if (o.chimney ?? rng() < 0.5) {
    const cx = hl * (0.3 + rng() * 0.4) * (rng() < 0.5 ? -1 : 1);
    const cz = hw * 0.35;
    box(b, f, cx - 0.009, cx + 0.009, cz - 0.009, cz + 0.009, top, top + roofH + 0.015, vary(STONE, rng), PAT.Masonry);
  }
  return { base, floor, top };
}

function pickRoof(rng: Rng): number {
  const r = rng();
  if (r < 0.65) return ROOF_TILE[Math.floor(rng() * ROOF_TILE.length)];
  if (r < 0.85) return ROOF_THATCH;
  return ROOF_SLATE;
}

function church(ctx: BuildCtx, f: Frame, rng: Rng): void {
  const L = 0.24;
  const W = 0.11;
  const res = house(ctx, f, { L, W, wallH: 0.1, style: 'stone', roof: rng() < 0.5 ? ROOF_SLATE : ROOF_TILE[0], chimney: false }, rng);
  // 鐘楼
  const t = 0.04;
  const x0 = -L / 2 - t * 1.6;
  const x1 = -L / 2 + 0.01;
  const stone = vary(STONE, rng);
  const towerTop = res.top + 0.14;
  box(ctx.b, f, x0, x1, -t, t, res.base, towerTop, stone, PAT.Masonry);
  // 鐘の開口
  const oc = vary(OPENING, rng);
  const my = towerTop - 0.03;
  box(ctx.b, f, (x0 + x1) / 2 - 0.01, (x0 + x1) / 2 + 0.01, t - 0.001, t + 0.002, my - 0.014, my + 0.014, oc, PAT.None);
  box(ctx.b, f, (x0 + x1) / 2 - 0.01, (x0 + x1) / 2 + 0.01, -t - 0.002, -t + 0.001, my - 0.014, my + 0.014, oc, PAT.None);
  pyramidRoof(ctx.b, f, x0 - 0.006, x1 + 0.006, -t - 0.006, t + 0.006, towerTop, 0.12, vary(ROOF_SLATE, rng));
}

/** 編み垣で囲った畑 */
function fencedPlot(ctx: BuildCtx, f: Frame, x0: number, x1: number, z0: number, z1: number, rng: Rng): void {
  const c = vary(0x6a5236, rng);
  const pts = [
    { x: f.x(x0, z0), z: f.z(x0, z0) },
    { x: f.x(x1, z0), z: f.z(x1, z0) },
    { x: f.x(x1, z1), z: f.z(x1, z1) },
    { x: f.x(x0, z1), z: f.z(x0, z1) },
  ];
  for (let i = 0; i < 4; i++) terrainWall(ctx, pts[i], pts[(i + 1) % 4], 0.004, 0.022, c, PAT.Wood);
}

function haystack(ctx: BuildCtx, x: number, z: number, rng: Rng): void {
  const g = ctx.hm.heightAt(x, z);
  const c = vary(0xc8a850, rng);
  const r = 0.018 + rng() * 0.008;
  cylinder(ctx.b, x, z, g - 0.01, g + r * 0.9, r, r, 8, c, PAT.None);
  cone(ctx.b, x, z, g + r * 0.9, r * 1.4, r * 1.05, 8, c.clone().multiplyScalar(0.92), PAT.None);
}

export function buildVillage(ctx: BuildCtx, cell: HexCell, seed: number): void {
  const layout = ctx.map.layout;
  const c = layout.offsetToWorld(cell.col, cell.row);
  const ri = layout.inradius;
  const rng = cellRng(seed, cell.col, cell.row, 1);
  const axis = rng() * Math.PI;
  const placed: { x: number; z: number; r: number }[] = [];

  // 道の中心からこの距離までは建物を置かない
  const roadClear = (ROAD_WIDTH / 2 + 0.02) * ctx.s;
  const fits = (x: number, z: number, r: number) => {
    if (Math.hypot(x - c.x, z - c.z) > ri * 0.86 - r * 0.6) return false;
    if (ctx.roads.distance(x, z, r * 0.8 + roadClear) < r * 0.8 + roadClear) return false;
    return placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + r);
  };
  const flatEnough = (f: Frame, hl: number, hw: number) => {
    const g = groundRange(ctx.hm, footprint(f, -hl, hl, -hw, hw));
    return g.max - g.min < 0.1 && g.min > ctx.waterLevel + 0.015;
  };

  if (rng() < 0.4) {
    const x = c.x + (rng() - 0.5) * 0.2;
    const z = c.z + (rng() - 0.5) * 0.2;
    const f = new Frame(x, z, axis);
    if (fits(x, z, 0.19) && flatEnough(f, 0.16, 0.06)) {
      church(ctx, f, rng);
      placed.push({ x, z, r: 0.19 });
    }
  }

  const target = 6 + Math.floor(rng() * 4);
  let houses = 0;
  for (let attempt = 0; attempt < 90 && houses < target; attempt++) {
    const r = Math.sqrt(rng()) * ri * 0.8;
    const a = rng() * Math.PI * 2;
    const x = c.x + Math.cos(a) * r;
    const z = c.z + Math.sin(a) * r;
    const L = 0.12 + rng() * 0.07;
    const W = 0.08 + rng() * 0.035;
    const rad = Math.hypot(L, W) / 2 + 0.025;
    if (!fits(x, z, rad)) continue;
    const f = new Frame(x, z, axis + (rng() < 0.5 ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.35);
    if (!flatEnough(f, L / 2, W / 2)) continue;

    const sr = rng();
    const style: WallStyle = sr < 0.62 ? 'plaster' : sr < 0.85 ? 'stone' : 'wood';
    house(ctx, f, { L, W, wallH: 0.065 + rng() * 0.03, style, roof: pickRoof(rng) }, rng);
    placed.push({ x, z, r: rad });
    houses++;

    // 家の横に畑
    if (rng() < 0.3) {
      const side = rng() < 0.5 ? -1 : 1;
      const px0 = side > 0 ? L / 2 + 0.02 : -L / 2 - 0.13;
      const cx = f.x(px0 + 0.055, 0);
      const cz = f.z(px0 + 0.055, 0);
      if (fits(cx, cz, 0.07)) {
        fencedPlot(ctx, f, px0, px0 + 0.11, -0.05, 0.05, rng);
        placed.push({ x: cx, z: cz, r: 0.07 });
      }
    }
  }

  const stacks = Math.floor(rng() * 3);
  for (let i = 0, attempt = 0; i < stacks && attempt < 20; attempt++) {
    const r = Math.sqrt(rng()) * ri * 0.75;
    const a = rng() * Math.PI * 2;
    const x = c.x + Math.cos(a) * r;
    const z = c.z + Math.sin(a) * r;
    if (!fits(x, z, 0.03)) continue;
    haystack(ctx, x, z, rng);
    placed.push({ x, z, r: 0.03 });
    i++;
  }
}
