/**
 * 行動メニューの組み立てのテスト。M007 の段階 1 で攻撃の項目を兵種の攻撃の一覧から組み立てるようにする前の振る舞いを固定する。
 */
import { describe, expect, it } from 'vitest';
import { UNIT_TYPES, type UnitType } from '@norden/map-runtime/core/units';
import { buildActionMenu, canAct, minAttackCost, type MenuContext } from './actions';
import { COMBAT_DEFS } from './combat';
import { status } from './test/fixtures';

function ctx(type: UnitType, patch: Partial<MenuContext> = {}): MenuContext {
  const s = status(type);
  return {
    unit: { type, team: 'blue', col: 0, row: 0 },
    status: s,
    ap: s.maxAp,
    canMove: true,
    zocLocked: false,
    turnStart: true,
    canRetreat: true,
    planned: false,
    attackPlanned: false,
    canMoveAfterAttack: type === 'cavalry',
    hasTargets: true,
    hasVolleyTargets: true,
    targetable: COMBAT_DEFS[type].attacks,
    ...patch,
  };
}

const attackChildren = (c: MenuContext) => buildActionMenu(c).find((e) => e.name === '攻撃')?.children?.map((a) => `${a.id}:${a.cost}`);

describe('攻撃の項目', () => {
  it('兵種ごとに並ぶ攻撃', () => {
    const table = Object.fromEntries(UNIT_TYPES.map((t) => [t, attackChildren(ctx(t))]));
    expect(table).toEqual({
      infantry: ['attack:2', 'volley:4'],
      archer: ['attack:2'],
      cavalry: ['attack:2', 'volley:4', 'charge:3'],
      mage: ['thunderfall:4'],
      wizard: ['thunderfall:4'],
      rifleman: ['attack:2'],
      artillery: ['attack:2'],
      landsknecht: ['attack:2', 'volley:4'],
    });
  });

  it('取り囲んだ敵がいなければ一斉攻撃は並ばない', () => {
    expect(attackChildren(ctx('infantry', { hasVolleyTargets: false }))).toEqual(['attack:2']);
  });

  it('行動力が足りない攻撃は並ばず、どれも足りなければ攻撃を選べない', () => {
    expect(attackChildren(ctx('cavalry', { ap: 3 }))).toEqual(['attack:2', 'charge:3']);
    const entry = buildActionMenu(ctx('mage', { ap: 3 })).find((e) => e.name === '攻撃')!;
    expect(entry.enabled).toBe(false);
    expect(entry.reason).toBe('行動力が足りない');
  });

  it('クールタイム中の攻撃は灰色で残り、あと何ターンかが理由に出る', () => {
    const s = { ...status('infantry'), cooldowns: { attack: 2 } };
    const children = buildActionMenu(ctx('infantry', { status: s })).find((e) => e.name === '攻撃')!.children!;
    expect(children.map((c) => [c.id, c.reason])).toEqual([
      ['attack', 'あと 2 ターン'],
      ['volley', undefined],
    ]);
  });

  it('狙える相手のいない攻撃は並ばない', () => {
    expect(attackChildren(ctx('cavalry', { targetable: ['charge'] }))).toEqual(['charge:3']);
  });

  it('攻撃済み・予約済み・相手がいないときは攻撃を選べない', () => {
    const reason = (patch: Partial<MenuContext>) => buildActionMenu(ctx('infantry', patch)).find((e) => e.name === '攻撃')!.reason;
    expect(reason({ status: { ...status('infantry'), attacked: true } })).toBe('このターンは攻撃済み');
    expect(reason({ attackPlanned: true })).toBe('攻撃は予約済み');
    expect(reason({ hasTargets: false })).toBe('攻撃できる敵がいない');
  });

  it('いちばん少ない攻撃の行動力（一斉攻撃を除く）', () => {
    expect(Object.fromEntries(UNIT_TYPES.map((t) => [t, minAttackCost(t)]))).toEqual({
      infantry: 2,
      archer: 2,
      cavalry: 2,
      mage: 4,
      wizard: 4,
      rifleman: 2,
      artillery: 2,
      landsknecht: 2,
    });
  });
});

describe('ほかの項目', () => {
  it('騎兵は迎撃できない', () => {
    const entry = buildActionMenu(ctx('cavalry')).find((e) => e.name === '迎撃')!;
    expect(entry.enabled).toBe(false);
  });

  it('攻撃の後は移動できない（騎兵は除く）', () => {
    const move = (type: UnitType) => buildActionMenu(ctx(type, { attackPlanned: true })).find((e) => e.name === '移動')!.enabled;
    expect(move('infantry')).toBe(false);
    expect(move('cavalry')).toBe(true);
  });

  it('攻撃も移動も退却もできなければ行動済み', () => {
    expect(canAct(ctx('infantry'))).toBe(true);
    expect(canAct(ctx('archer', { canMove: false, hasTargets: false, turnStart: false, status: { ...status('archer'), attacked: true, skills: [] } }))).toBe(false);
  });
});
