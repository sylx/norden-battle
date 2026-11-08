/**
 * CPU の配備（CpuFeatures.deploy）。兵種に合わせて前後を考えて置く。
 *
 * - 配置地点を、敵に近い順（攻撃側は防衛拠点、防衛側は攻撃側の配置地点。無ければ敵のユニット）に並べる。
 *   地形の守りのある HEX は少し前に数える（前に出る部隊が守りの良い地形で敵を受ける）
 * - 置ける数より部隊が多ければ、軍団長の部隊と編成の上の部隊を選ぶ（自動配置と同じ。どの部隊を出すかは編成を組んだ側が決める）
 * - 前に出る兵種（射程の無い兵種。守りの固い兵種ほど前）を前の列に、射程のある兵種（射程の短い兵種ほど前）をそのすぐ後ろに置く
 * - 軍団長の部隊は、ほかの部隊の後ろの数列のうち、守りの良い地形・後ろ寄りの HEX に置く
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import { cellDefense, COMBAT_DEFS, hexDistance } from '../combat';
import { UNIT_POWER } from '../damage';
import type { Deployment, Troop } from '../deployment';
import type { BattleState } from '../engine/state';

/** 軍団長の部隊を置く HEX を探す、ほかの部隊の後ろの列の数 */
const COMMANDER_ROWS = 4;
/** 前の列を決めるとき、地形の守り 1.0 を何 HEX 前に数えるか */
const COVER_HEXES = 3;

/** 配備している陣営の部隊を、兵種に合わせて置く（置いてあった部隊は置き直す） */
export function deployTroops(state: BattleState, deployment: Deployment): void {
  const ds = deployment.state();
  if (!ds) return;
  for (const id of ds.placed.keys()) deployment.unplace(id);
  const map = state.map;
  const slots = deployment.slots().filter((s) => !map.unitAt(s.col, s.row));
  const refs = enemyRefs(state, deployment, ds.side);
  if (slots.length === 0 || refs.length === 0) {
    deployment.auto();
    return;
  }
  const dist = (o: Offset) => Math.min(...refs.map((r) => hexDistance(map, o, r)));
  const cover = (o: Offset) => {
    const cell = map.get(o.col, o.row);
    return cell ? cellDefense(cell) : 0;
  };
  // 前から順に
  const ordered = [...slots].sort((a, b) => dist(a) - cover(a) * COVER_HEXES - (dist(b) - cover(b) * COVER_HEXES) || a.row - b.row || a.col - b.col);
  const troops = pickTroops(ds.troops, Math.min(ds.limit, slots.length));
  const commander = troops.find((t) => t.status.commander) ?? null;
  const others = troops.filter((t) => t !== commander);
  const front = others.filter((t) => !COMBAT_DEFS[t.type].ranged).sort((a, b) => UNIT_POWER[b.type].defense - UNIT_POWER[a.type].defense);
  const back = others
    .filter((t) => COMBAT_DEFS[t.type].ranged)
    .sort((a, b) => COMBAT_DEFS[a.type].minRange - COMBAT_DEFS[b.type].minRange || COMBAT_DEFS[a.type].maxRange - COMBAT_DEFS[b.type].maxRange);
  const free = [...ordered];
  if (commander) {
    // ほかの部隊の分を前に残し、その後ろの数列から守りの良い・後ろ寄りの HEX
    const rear = free.slice(others.length, others.length + COMMANDER_ROWS);
    const pool = rear.length > 0 ? rear : free.slice(-1);
    const at = pool.reduce((a, o) => (cover(o) * 100 + dist(o) > cover(a) * 100 + dist(a) ? o : a));
    deployment.place(commander.id, at);
    free.splice(free.indexOf(at), 1);
  }
  for (const t of [...front, ...back]) {
    const at = free.shift();
    if (!at) break;
    deployment.place(t.id, at);
  }
}

/** 置く部隊を選ぶ（軍団長の部隊と、編成の上から limit まで。どの部隊を出すかは編成を組んだ側が決める。自動配置と同じ） */
function pickTroops(troops: readonly Troop[], limit: number): Troop[] {
  return [...troops.filter((t) => t.status.commander), ...troops.filter((t) => !t.status.commander)].slice(0, limit);
}

/** 前を決める敵の目印（攻撃側は防衛拠点、防衛側は攻撃側の配置地点。無ければ敵のユニット） */
function enemyRefs(state: BattleState, deployment: Deployment, side: 'attacker' | 'defender'): Offset[] {
  const team = deployment.state()!.team;
  const enemies = state.map.allUnits().filter((u) => u.team !== team);
  if (side === 'attacker') return state.stronghold ? [state.stronghold] : enemies.length > 0 ? enemies : deployment.sideSlots('defender');
  const slots = deployment.sideSlots('attacker');
  return slots.length > 0 ? slots : enemies;
}
