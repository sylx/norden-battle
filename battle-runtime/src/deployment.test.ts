/**
 * 配備フェーズ（軍団長の部隊を置かないと配備完了できない）のテスト。
 */
import { describe, expect, it } from 'vitest';
import type { UnitData } from '@norden/map-runtime/core/units';
import { Deployment, type Troop } from './deployment';
import { status, testMap } from './test/fixtures';
import type { UnitStatus } from './unitStatus';

/** 防衛側の配置地点が 3 つ、2 番目の部隊が軍団長 */
function setup() {
  const map = testMap();
  const deploy = { defender: [{ col: 1, row: 1 }, { col: 2, row: 1 }, { col: 3, row: 1 }], attacker: [] };
  const troops: Troop[] = [0, 1, 2, 3].map((i) => ({
    id: `defender-${i}`,
    side: 'defender',
    type: 'infantry',
    status: { ...status('infantry'), commander: i === 1 },
  }));
  const d = new Deployment(map, deploy, troops, new Map<UnitData, UnitStatus>());
  return { d, troops };
}

describe('配備完了', () => {
  it('軍団長の部隊を置いていなければ配備完了できない', () => {
    const { d } = setup();
    d.pick('defender-0');
    d.click({ col: 1, row: 1 });
    expect(d.state()?.commanderMissing).toBe(true);
    expect(d.finish()).toBe(false);
    d.pick(null);
    d.pick('defender-1');
    d.click({ col: 2, row: 1 });
    expect(d.state()?.commanderMissing).toBe(false);
    expect(d.finish()).toBe(true);
  });

  it('自動配置は軍団長の部隊から置く', () => {
    const { d } = setup();
    d.auto();
    const state = d.state()!;
    expect(state.placed.get('defender-1')).toEqual({ col: 1, row: 1 });
    expect(state.commanderMissing).toBe(false);
  });
});
