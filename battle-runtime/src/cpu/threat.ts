/**
 * 次の敵の番に攻撃されそうな HEX（脅威）。敵ユニットごとに、次の番に（最大の行動力で）動ける HEX から攻撃の射程に入る HEX を数える。
 * 軽く数えるための近似: 動いた後に残る行動力・直線の攻撃の向き・ZOC で止まる先の細かい違いは見ない。
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { TeamId } from '@norden/map-runtime/core/units';
import { attacksOf, resolveAttack } from '../combat';
import { moveRange, nearCastle, nearStronghold } from '../movement';
import { SIDE_TEAM } from '../deployment';
import type { BattleState } from '../engine/state';
import { rangeBonusAt } from '../engine/state';

/** HEX のキー（row × cols + col） */
export const cellKey = (state: BattleState, o: Offset): number => o.row * state.map.layout.cols + o.col;

/** team から見た脅威: HEX ごとに、次の番にそこを攻撃できる敵の部隊の数 */
export function threatMap(state: BattleState, team: TeamId): Map<number, number> {
  const map = state.map;
  const layout = map.layout;
  const out = new Map<number, number>();
  for (const enemy of map.allUnits()) {
    if (enemy.team === team) continue;
    const status = state.statuses.get(enemy);
    if (!status) continue;
    const ids = attacksOf(enemy.type, status);
    if (ids.length === 0) continue;
    const attacks = ids.map((id) => resolveAttack(enemy.type, id)).filter((a) => a.aim !== 'self' || a.shape.kind === 'around');
    const reach = Math.max(...attacks.map((a) => (a.aim === 'self' ? (a.shape.kind === 'around' ? a.shape.radius : 0) : a.range.max)));
    // 次の番は、いまの位置が番の初めの位置になる（入城の決まり）
    const attacker = enemy.team !== SIDE_TEAM.defender;
    const moves = moveRange(map, enemy, enemy, status.maxAp, {
      escapeZoc: true,
      castleLocked: attacker && !nearCastle(map, enemy),
      strongholdLocked: attacker && !nearStronghold(map, state.stronghold, enemy) ? state.stronghold : null,
    });
    const froms: Offset[] = [enemy, ...moves.values()];
    const hit = new Set<number>();
    for (const from of froms) {
      const r = reach + rangeBonusAt(state, enemy, from);
      const a = layout.offsetToAxial(from.col, from.row);
      for (let dq = -r; dq <= r; dq++) {
        for (let dr = Math.max(-r, -dq - r); dr <= Math.min(r, -dq + r); dr++) {
          const o = layout.axialToOffset(a.q + dq, a.r + dr);
          if (layout.inBounds(o.col, o.row)) hit.add(o.row * layout.cols + o.col);
        }
      }
    }
    for (const k of hit) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}
