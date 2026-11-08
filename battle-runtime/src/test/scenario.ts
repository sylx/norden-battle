/**
 * 描画なしの戦闘のテストに使う場面（兵種を混ぜた両軍が、拠点・城・要塞砲・退却先のあるマップで戦う）。
 */
import type { UnitData } from '@norden/map-runtime/core/units';
import type { BattleState } from '../engine/state';
import { battle } from './engine';
import { place, testMap } from './fixtures';

/** 防衛側（赤）が拠点と城を守り、攻撃側（青）が東から攻める 14 × 9 のマップ */
export function scenario(): BattleState {
  const map = testMap(14, 9, [
    { col: 2, row: 4, feature: 'castle' },
    { col: 3, row: 4, feature: 'castle' },
    { col: 2, row: 3, feature: 'castle' },
    { col: 6, row: 2, terrain: 'forest' },
    { col: 6, row: 3, terrain: 'forest' },
    { col: 7, row: 6, terrain: 'forest' },
    { col: 8, row: 4, terrain: 'hills' },
  ]);
  const red = (type: Parameters<typeof place>[1], col: number, row: number) => place(map, type, 'red', col, row);
  const blue = (type: Parameters<typeof place>[1], col: number, row: number) => place(map, type, 'blue', col, row);
  const units: (UnitData | [UnitData, object])[] = [
    [red('infantry', 3, 4), { commander: true, name: '赤の軍団長', skills: ['inspire'] }],
    red('archer', 2, 3),
    red('rifleman', 4, 5),
    [red('wizard', 2, 4), { spells: ['frostNova', 'earthSpike'] }],
    red('cavalry', 4, 2),
    red('landsknecht', 5, 4),
    [blue('infantry', 12, 4), { commander: true, name: '青の軍団長', skills: ['inspire'] }],
    blue('cavalry', 11, 2),
    blue('cavalry', 11, 6),
    blue('artillery', 13, 3),
    [blue('mage', 12, 6), { spells: ['meteorFall'] }],
    blue('dragon', 10, 4),
  ];
  return battle(map, units as Parameters<typeof battle>[1], {
    stronghold: { col: 2, row: 4 },
    retreats: { red: [{ id: 'r', name: '赤の後方' }], blue: [{ id: 'b', name: '青の後方' }] },
    facilities: { defender: { fortressCannon: { interval: 2 }, ballista: true } },
  });
}

