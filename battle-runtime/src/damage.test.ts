import { describe, expect, it } from 'vitest';
import { applyMorale, moraleChange } from './morale';
import { typeTraits, type UnitStatus } from './unitStatus';
import { calcDamage, COUNTER_HIT, damageFactors, FIXED_ATTACK_SOLDIERS, type Fighter } from './damage';
import type { UnitType } from '@norden/map-runtime/core/units';

const fighter = (type: UnitType, soldiers: number): Fighter => ({
  type,
  soldiers,
  morale: 50,
  leadership: 50,
  strength: 50,
  encircled: false,
  guarding: false,
  supporters: 0,
  defense: 0,
  walled: false,
  elevation: 0,
});

describe('攻撃力が残りの兵数に依存しない兵種', () => {
  it('魔術師・上級魔術師・ドラゴン・ゴーレム・ベヒーモスは残りの兵数に関わらず同じダメージ', () => {
    for (const type of Object.keys(FIXED_ATTACK_SOLDIERS) as UnitType[]) {
      const def = fighter('infantry', 1000);
      expect(calcDamage(fighter(type, 50), def, COUNTER_HIT, 0)).toBe(calcDamage(fighter(type, 3000), def, COUNTER_HIT, 0));
    }
  });

  it('ほかの兵種は兵数が多いほどダメージが大きい', () => {
    const def = fighter('infantry', 1000);
    expect(calcDamage(fighter('infantry', 300), def, COUNTER_HIT, 0)).toBeLessThan(calcDamage(fighter('infantry', 900), def, COUNTER_HIT, 0));
  });
});

describe('魔法相性', () => {
  const magic = { ...COUNTER_HIT, magic: true };
  const mage = fighter('mage', 400);
  it('ゴーレムは魔法で受けるダメージが 2 倍、ドラゴンは 0.75 倍', () => {
    const golem = fighter('golem', 800);
    const dragon = fighter('dragon', 600);
    expect(damageFactors(mage, golem, magic).magic).toBe(2);
    expect(damageFactors(mage, dragon, magic).magic).toBe(0.75);
    expect(damageFactors(mage, fighter('infantry', 1000), magic).magic).toBe(1);
  });
  it('魔法でなければ効かない', () => {
    expect(damageFactors(fighter('infantry', 1000), fighter('golem', 800), COUNTER_HIT).magic).toBe(1);
  });
});

describe('間接攻撃', () => {
  const archer = fighter('archer', 800);
  const indirect = { ...COUNTER_HIT, indirect: true };
  it('ライフル兵・砲兵は間接攻撃で受けるダメージが 0.8 倍', () => {
    expect(damageFactors(archer, fighter('rifleman', 600), indirect).indirect).toBe(0.8);
    expect(damageFactors(archer, fighter('artillery', 300), indirect).indirect).toBe(0.8);
    expect(damageFactors(archer, fighter('infantry', 1000), indirect).indirect).toBe(1);
  });
  it('直接攻撃には効かない', () => {
    expect(damageFactors(archer, fighter('rifleman', 600), COUNTER_HIT).indirect).toBe(1);
  });
});

describe('一斉攻撃の士気', () => {
  it('攻撃された側の士気の減り方は、加わった味方 1 隊で 2 倍、2 隊で 3 倍', () => {
    const base = moraleChange(100, 0, 50, 50).defender;
    expect(base).toBeLessThan(0);
    expect(moraleChange(100, 0, 50, 50, 1).defender).toBe(base * 2);
    expect(moraleChange(100, 0, 50, 50, 2).defender).toBe(base * 3);
    // 攻撃した側の増え方は変わらない
    expect(moraleChange(100, 0, 50, 50, 2).attacker).toBe(moraleChange(100, 0, 50, 50).attacker);
  });
});

describe('士気が減らない兵種', () => {
  it('ドラゴン・ゴーレム・ベヒーモス・ブレインは士気が減らない（増えはする）', () => {
    for (const type of ['dragon', 'golem', 'behemoth', 'brain'] as const) {
      const s = { ...typeTraits(type), morale: 50 } as UnitStatus;
      applyMorale(s, -20);
      expect(s.morale).toBe(50);
      applyMorale(s, 5);
      expect(s.morale).toBe(55);
    }
    const inf = { ...typeTraits('infantry'), morale: 50 } as UnitStatus;
    applyMorale(inf, -20);
    expect(inf.morale).toBe(30);
  });
});
