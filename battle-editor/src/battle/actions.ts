/**
 * ユニットの行動の定義と、行動メニューの項目の組み立て。
 *
 * メニューは 2 階層。1 階層目は常に全部並べ、選べないものは無効にする。
 * 2 階層目（攻撃の種類・指揮官のスキル）は選べるものだけを並べる。
 * 選べるかどうかは残り行動力・兵種・指揮官のスキルで決まる。コスト・兵種の制限は仮の値。
 */
import type { UnitData, UnitType } from '@norden/map-runtime/core/units';
import type { UnitStatus } from './unitStatus';

export type ActionId = 'move' | 'attack' | 'volley' | 'charge' | 'intercept' | 'retreat' | `skill:${SkillId}`;

/** 指揮官のスキル（特殊の項目） */
export type SkillId = 'betray' | 'inspire' | 'fireAttack' | 'ambush';

interface SkillDef {
  name: string;
  /** 消費する行動力 */
  cost: number;
}

export const SKILL_DEFS: Record<SkillId, SkillDef> = {
  betray: { name: '寝返り', cost: 4 },
  inspire: { name: '鼓舞', cost: 2 },
  fireAttack: { name: '火計', cost: 3 },
  ambush: { name: '伏兵', cost: 2 },
};

interface ActionDef {
  id: ActionId;
  name: string;
  cost: number;
  /** 使える兵種（省略時はすべて） */
  types?: readonly UnitType[];
}

interface GroupDef {
  name: string;
  /** 2 階層目。'skills' は指揮官のスキル */
  children: readonly ActionDef[] | 'skills';
}

/** 1 階層目の並び */
const MENU: readonly (ActionDef | GroupDef)[] = [
  { id: 'move', name: '移動', cost: 1 },
  {
    name: '攻撃',
    children: [
      { id: 'attack', name: '通常攻撃', cost: 2 },
      { id: 'volley', name: '一斉攻撃', cost: 3, types: ['archer', 'mage'] },
      { id: 'charge', name: '突撃', cost: 3, types: ['cavalry'] },
    ],
  },
  { id: 'intercept', name: '迎撃', cost: 2 },
  { name: '特殊', children: 'skills' },
  { id: 'retreat', name: '退却', cost: 1 },
];

export interface MenuAction {
  id: ActionId;
  name: string;
  cost: number;
}

export interface MenuEntry {
  name: string;
  enabled: boolean;
  /** 選べない理由（enabled = false のとき） */
  reason?: string;
  /** 1 階層目で直接選ぶ行動 */
  action?: MenuAction;
  /** 2 階層目（選べるものだけ） */
  children?: MenuAction[];
}

/** ユニットの行動メニューの 1 階層目 */
export function buildActionMenu(unit: UnitData, status: UnitStatus): MenuEntry[] {
  const lacksAp = (cost: number) => status.ap < cost;
  return MENU.map((def): MenuEntry => {
    if ('id' in def) {
      const action = { id: def.id, name: def.name, cost: def.cost };
      if (def.types && !def.types.includes(unit.type)) return { name: def.name, enabled: false, reason: 'この兵種は使えない', action };
      if (lacksAp(def.cost)) return { name: def.name, enabled: false, reason: '行動力が足りない', action };
      return { name: def.name, enabled: true, action };
    }
    const cands: MenuAction[] =
      def.children === 'skills'
        ? status.skills.map((s) => ({ id: `skill:${s}`, name: SKILL_DEFS[s].name, cost: SKILL_DEFS[s].cost }))
        : def.children.filter((c) => !c.types || c.types.includes(unit.type)).map(({ id, name, cost }) => ({ id, name, cost }));
    if (cands.length === 0) return { name: def.name, enabled: false, reason: def.children === 'skills' ? 'スキルがない' : 'この兵種は使えない' };
    const children = cands.filter((c) => !lacksAp(c.cost));
    if (children.length === 0) return { name: def.name, enabled: false, reason: '行動力が足りない' };
    return { name: def.name, enabled: true, children };
  });
}
