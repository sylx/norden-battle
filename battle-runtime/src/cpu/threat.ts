/**
 * 次の敵の番に、敵の部隊が動ける HEX と攻撃できる HEX（届く範囲）。敵ユニットごとに、次の番に（最大の行動力で）動ける HEX から
 * 攻撃の射程に入る HEX を数える。
 * 軽く数えるための近似: 動いた後に残る行動力・直線の攻撃の向き・ZOC で止まる先の細かい違いは見ない。
 *
 * - threatMap（段階 1）: HEX ごとに、そこを攻撃できる敵の部隊の数
 * - enemyReach（段階 2）: 敵ごとの、動ける HEX と攻撃できる HEX。次の番にクールタイムの明けない攻撃は数えない。
 *   受けそうなダメージ（danger.ts）・迎撃の構えの見込み（decide.ts）に使う
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { TeamId, UnitData } from '@norden/map-runtime/core/units';
import type { MenuAttackId } from '../attacks';
import { attacksOf, resolveAttack } from '../combat';
import { moveRange, nearCastle, nearStronghold } from '../movement';
import { SIDE_TEAM } from '../deployment';
import type { BattleState } from '../engine/state';
import { rangeBonusAt } from '../engine/state';
import type { UnitStatus } from '../unitStatus';

/** HEX のキー（row × cols + col） */
export const cellKey = (state: BattleState, o: Offset): number => o.row * state.map.layout.cols + o.col;

/** 敵の部隊が次の番に届く範囲 */
export interface Reach {
  /** 動ける HEX（いまの HEX を含む） */
  moves: Set<number>;
  /** 攻撃できる HEX */
  attack: Set<number>;
  /** 次の番に使える、ユニットを狙える攻撃（クールタイムの明けないもの・自分が中心の攻撃を除く。受けそうなダメージを見積もる） */
  attacks: MenuAttackId[];
}

/** 次の番に使える攻撃（番の初めにクールタイムが 1 減るので、残り 1 以下なら使える） */
function readyAttacks(enemy: UnitData, status: UnitStatus): MenuAttackId[] {
  return attacksOf(enemy.type, status).filter((id) => (status.cooldowns[id] ?? 0) <= 1);
}

/**
 * enemy が次の番に届く範囲。ids の攻撃（省略すると兵種の攻撃すべて。自分が中心の攻撃は周りを斬るものだけ数える）の射程で数える
 */
function reachOf(state: BattleState, enemy: UnitData, status: UnitStatus, ids: readonly MenuAttackId[]): Reach {
  const map = state.map;
  const layout = map.layout;
  const attacks = ids.map((id) => resolveAttack(enemy.type, id)).filter((a) => a.aim !== 'self' || a.shape.kind === 'around');
  // 攻撃できなければ、動ける HEX だけ
  const reach = attacks.length === 0 ? -1 : Math.max(...attacks.map((a) => (a.aim === 'self' ? (a.shape.kind === 'around' ? a.shape.radius : 0) : a.range.max)));
  // 次の番は、いまの位置が番の初めの位置になる（入城の決まり）
  const attacker = enemy.team !== SIDE_TEAM.defender;
  const steps = moveRange(map, enemy, enemy, status.maxAp, {
    escapeZoc: true,
    castleLocked: attacker && !nearCastle(map, enemy),
    strongholdLocked: attacker && !nearStronghold(map, state.stronghold, enemy) ? state.stronghold : null,
  });
  const froms: Offset[] = [enemy, ...steps.values()];
  const moves = new Set(froms.map((o) => cellKey(state, o)));
  const hit = new Set<number>();
  for (const from of froms) {
    if (reach < 0) break;
    const r = reach + rangeBonusAt(state, enemy, from);
    const a = layout.offsetToAxial(from.col, from.row);
    for (let dq = -r; dq <= r; dq++) {
      for (let dr = Math.max(-r, -dq - r); dr <= Math.min(r, -dq + r); dr++) {
        const o = layout.axialToOffset(a.q + dq, a.r + dr);
        if (layout.inBounds(o.col, o.row)) hit.add(o.row * layout.cols + o.col);
      }
    }
  }
  return { moves, attack: hit, attacks: attacks.filter((a) => a.aim !== 'self').map((a) => a.id as MenuAttackId) };
}

/** team から見た脅威（段階 1）: HEX ごとに、次の番にそこを攻撃できる敵の部隊の数 */
export function threatMap(state: BattleState, team: TeamId): Map<number, number> {
  const out = new Map<number, number>();
  for (const enemy of state.map.allUnits()) {
    if (enemy.team === team) continue;
    const status = state.statuses.get(enemy);
    if (!status) continue;
    const r = reachOf(state, enemy, status, attacksOf(enemy.type, status));
    for (const k of r.attack) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** team から見た、敵の部隊ごとの次の番に届く範囲（次の番に使える攻撃で数える。攻撃できない部隊は動ける HEX だけ） */
export function enemyReach(state: BattleState, team: TeamId): Map<UnitData, Reach> {
  const out = new Map<UnitData, Reach>();
  for (const enemy of state.map.allUnits()) {
    if (enemy.team === team) continue;
    const status = state.statuses.get(enemy);
    if (!status) continue;
    out.set(enemy, reachOf(state, enemy, status, readyAttacks(enemy, status)));
  }
  return out;
}
