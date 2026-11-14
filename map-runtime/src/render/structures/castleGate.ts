/**
 * 橋が城の辺に直接つながるときの、橋と城門の取り合い。
 * 橋は城の中まで伸ばさず城門の外側の面で止め、城門の床は橋の路面の高さにそろえる。
 */
import type { Vec2 } from '../../core/hex.ts';
import type { HexCell } from '../../core/mapData.ts';
import type { BuildCtx } from './shapes.ts';

/** 城門（門の両脇の塔）の、壁の中心から外側の面までの奥行き */
export const CASTLE_GATE_DEPTH = 0.065;
/** 橋の路面の最低の高さ（水面から） */
export const BRIDGE_MIN_DECK = 0.11;

/**
 * 城の HEX cell の dir の辺に橋がつながるときの、橋の端（城門の外側の面）と門の床の高さ。
 * 床は門の内側の地面の高さ。ただし橋の路面の最低の高さより下げない
 */
export function castleBridgeGate(ctx: BuildCtx, cell: HexCell, dir: number): { end: Vec2; floor: number } {
  const layout = ctx.map.layout;
  const [a, b] = layout.edgeEndpoints(cell.col, cell.row, dir);
  const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const c = layout.offsetToWorld(cell.col, cell.row);
  const len = Math.hypot(m.x - c.x, m.z - c.z);
  const out = { x: (m.x - c.x) / len, z: (m.z - c.z) / len };
  const inside = CASTLE_GATE_DEPTH + 0.03;
  const ground = ctx.hm.heightAt(m.x - out.x * inside, m.z - out.z * inside);
  // 門の塔に少しめり込ませて隙間を作らない
  const reach = CASTLE_GATE_DEPTH - 0.01;
  return {
    end: { x: m.x + out.x * reach, z: m.z + out.z * reach },
    floor: Math.max(ground, ctx.waterLevel + BRIDGE_MIN_DECK) + 0.012,
  };
}
