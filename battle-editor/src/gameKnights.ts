/**
 * ゲーム（nordencult）の騎士・勢力のデータと顔の画像で、battle-editor の部隊を組む。
 *
 * norden-battle は nordencult のサブモジュールとして置く（../../ がゲーム）。ゲームのデータを直接読む。
 * - 陣営（攻撃側・防衛側）ごとに勢力を選ぶと、その勢力の騎士で部隊の一覧（編成）を作る（当主が先頭、あとは統率の高い順）。
 * - 編成の 1 行は騎士・兵種・兵数・士気・魔法（magic の兵種だけが使う）。軍団長は陣営に 1 部隊。騎士・兵種はエディタで選び直せる（兵種は率いられないものも選べる）。
 * - 部隊の能力（統率・武力・知力）・名前・顔は騎士のもの（ゲームの battleTroops.ts と同じ）。傭兵は捕縛されない。
 * - ゲームの騎士にはまだ戦闘のスキルが無いので、スキルは表示確認用に行の順で仮に配る（EDITOR_SKILLS）。
 * - 配備の無いマップ（ユニットを置いてあるマップ）では、防衛側の編成を赤軍、攻撃側の編成を青軍のユニットに上から順に割り当てる
 *   （兵種はマップのユニットのまま）。ほかの軍は表示確認用の仮の状態。
 * - 部隊の状態から騎士を引けるようにしておく（knightOfStatus。セリフを指揮官の騎士で喋らせる）。
 */
import {
  demoStatuses,
  SIDE_TEAM,
  SPELL_IDS,
  troopStatus,
  type BattleFactions,
  type Portrait,
  type SkillId,
  type SpellId,
  type StatusFactory,
  type Troop,
  type TroopFactory,
  type UnitStatus,
} from '@norden/battle-runtime';
import type { DeploySide } from '@norden/map-runtime/core/mapData';
import { UNIT_TYPES, type UnitType } from '@norden/map-runtime/core/units';
import characterData from '../../../src/data/characterData.json';
import characterStart from '../../../src/data/characterStart.json';
import factionData from '../../../src/data/factionData.json';
import type { Character, CharacterStart } from '../../../src/data/character.ts';
import { characterSheet } from '../../../src/data/characterSheets.ts';
import { DEFAULT_UNIT_TYPES, UNIT_TYPES_BY_CHARACTER_TYPE } from '../../../src/data/unitTypes.ts';

export type GameKnight = Character;

export const GAME_KNIGHTS: readonly GameKnight[] = characterData as GameKnight[];
const KNIGHT_MAP = new Map(GAME_KNIGHTS.map((k) => [k.id, k]));
const STARTS = new Map((characterStart as CharacterStart[]).map((s) => [s.id, s]));

export interface GameFaction {
  id: string;
  name: string;
}

export const GAME_FACTIONS: readonly GameFaction[] = factionData.map(({ id, name }) => ({ id, name }));
/** 勢力に仕えていない騎士（傭兵・放浪）の「勢力」 */
export const NO_FACTION: GameFaction = { id: '', name: '勢力なし' };

export const knightById = (id: string): GameKnight | undefined => KNIGHT_MAP.get(id);

/** 開始時に仕える勢力の ID（仕えていなければ ''。捕虜は捕まっている勢力ではなく仕えていた勢力） */
export const factionIdOf = (k: GameKnight): string => STARTS.get(k.id)?.factionId ?? '';

export const factionName = (id: string): string => GAME_FACTIONS.find((f) => f.id === id)?.name ?? NO_FACTION.name;

/** 騎士の種別で率いられる兵種か（ゲームの UNIT_TYPES_BY_CHARACTER_TYPE） */
export const canLead = (k: GameKnight, type: UnitType): boolean => (UNIT_TYPES_BY_CHARACTER_TYPE[k.type] as readonly string[]).includes(type);

/** 騎士の種別の既定の兵種（傭兵は傭兵団の兵種） */
export const defaultUnitType = (k: GameKnight): UnitType => k.mercenaryInfo?.unitType ?? DEFAULT_UNIT_TYPES[k.type];

/** 騎士の顔をスプライトシートから切り出す指定（ゲームの battleTroops.ts の portraitOf と同じ） */
export function portraitOf({ imageInfo: { sprite, faceRect } }: GameKnight): Portrait {
  const { url, width, height } = characterSheet(sprite.sheet);
  return { url, width, height, rect: { x: sprite.x + faceRect.x, y: sprite.y + faceRect.y, width: faceRect.width, height: faceRect.height } };
}

/** 編成の 1 部隊 */
export interface RosterEntry {
  knightId: string;
  type: UnitType;
  soldiers: number;
  morale: number;
  /** 持たせる魔法（magic の兵種だけが使う） */
  spells: SpellId[];
}

/** 陣営の編成 */
export interface SideRoster {
  /** 勢力の ID（'' は勢力なし） */
  factionId: string;
  entries: RosterEntry[];
  /** 軍団長の部隊（entries の番号） */
  commander: number;
}

export type Rosters = Record<DeploySide, SideRoster>;

/** 編成に並べる部隊の数（配備できるのは MAX_DEPLOY まで。残りは配備のときに入れ替えられる） */
export const ROSTER_SIZE = 8;
/** 部隊の兵数の既定（兵種ごと。無ければ DEFAULT_SOLDIERS） */
const SOLDIERS: Partial<Record<UnitType, number>> = { infantry: 1000, archer: 800, cavalry: 600, mage: 400, wizard: 400, rifleman: 600, artillery: 300, landsknecht: 800, dragon: 600, golem: 800, behemoth: 1200, brain: 1000 };
const DEFAULT_SOLDIERS = 800;
/** ゲームの開始時の士気（src/game/economy/balance.ts の INITIAL_MORALE） */
export const DEFAULT_MORALE = 70;
/** 表示確認用のスキル（編成の行の順に配る） */
const EDITOR_SKILLS: SkillId[][] = [['inspire'], ['betray'], [], ['fireAttack', 'ambush'], ['inspire'], [], ['ambush'], ['fireAttack']];

export const defaultSoldiers = (type: UnitType): number => SOLDIERS[type] ?? DEFAULT_SOLDIERS;

/** 騎士の部隊の既定（騎士の既定の兵種と、その兵種の兵数） */
export function entryFor(k: GameKnight): RosterEntry {
  const type = defaultUnitType(k);
  return { knightId: k.id, type, soldiers: defaultSoldiers(type), morale: DEFAULT_MORALE, spells: [] };
}

/** 勢力の騎士（当主が先頭、あとは統率の高い順） */
export function factionKnights(factionId: string): GameKnight[] {
  return GAME_KNIGHTS.filter((k) => factionIdOf(k) === factionId).sort(
    (a, b) => Number(!!b.isPatriarch) - Number(!!a.isPatriarch) || b.leadership - a.leadership || a.id.localeCompare(b.id),
  );
}

/** 勢力の騎士で組んだ既定の編成（先頭の騎士が軍団長） */
export function defaultRoster(factionId: string): SideRoster {
  return { factionId, entries: factionKnights(factionId).slice(0, ROSTER_SIZE).map(entryFor), commander: 0 };
}

/** 最初の編成（表示確認用の仮の勢力 demoFactions と同じ組み合わせ） */
export const DEFAULT_ROSTERS: Rosters = { attacker: defaultRoster('valhardt'), defender: defaultRoster('nordis') };

/** 陣営ごとの勢力の名前（BattleScreen の factions） */
export const rosterFactions = (rosters: Rosters): BattleFactions => ({
  attacker: { name: factionName(rosters.attacker.factionId) },
  defender: { name: factionName(rosters.defender.factionId) },
});

/** 部隊の状態から、率いる騎士を引く（編成から作った部隊だけ） */
const knights = new WeakMap<UnitStatus, GameKnight>();
export const knightOfStatus = (status: UnitStatus | undefined): GameKnight | undefined => (status ? knights.get(status) : undefined);

/** 編成の 1 部隊の戦闘中の状態（兵種は type。配備の無いマップではマップのユニットの兵種） */
function entryStatus(roster: SideRoster, i: number, type: UnitType): UnitStatus | null {
  const e = roster.entries[i];
  const k = e && knightById(e.knightId);
  if (!k) return null;
  const status = troopStatus(type, {
    soldiers: e.soldiers,
    morale: e.morale,
    leadership: k.leadership,
    strength: k.strength,
    intelligence: k.intelligence,
    name: k.name,
    portrait: portraitOf(k),
    skills: EDITOR_SKILLS[i % EDITOR_SKILLS.length],
    commander: i === roster.commander,
    uncapturable: !!k.mercenaryInfo,
    spells: e.spells,
  });
  knights.set(status, k);
  return status;
}

const SIDES: readonly DeploySide[] = ['defender', 'attacker'];

/** 配備する部隊（部隊の ID は騎士の ID。同じ騎士を 2 度置いたときは番号を付ける） */
export function rosterTroops(rosters: Rosters): TroopFactory {
  return () => {
    const used = new Set<string>();
    return SIDES.flatMap((side) =>
      rosters[side].entries.flatMap((e, i): Troop[] => {
        const status = entryStatus(rosters[side], i, e.type);
        if (!status) return [];
        let id = e.knightId;
        for (let n = 2; used.has(id); n++) id = `${e.knightId}-${n}`;
        used.add(id);
        return [{ id, side, type: e.type, status }];
      }),
    );
  };
}

/** マップに置いてあるユニットの状態（防衛側の編成を赤軍、攻撃側の編成を青軍に上から順に。ほかと余りは仮の状態） */
export function rosterStatuses(rosters: Rosters): StatusFactory {
  return (units) => {
    const out = demoStatuses(units);
    for (const side of SIDES) {
      const team = units.filter((u) => u.team === SIDE_TEAM[side]).sort((a, b) => a.row - b.row || a.col - b.col);
      team.forEach((u, i) => {
        const status = entryStatus(rosters[side], i, u.type);
        if (status) out.set(u, status);
      });
    }
    return out;
  };
}

/** 保存した編成が今のデータで使えるか（無い騎士・兵種を含まないか）を確かめて読む。使えなければ null */
export function parseRosters(value: unknown): Rosters | null {
  const ok = (r: unknown): r is SideRoster => {
    if (!r || typeof r !== 'object') return false;
    const { factionId, entries, commander } = r as SideRoster;
    return (
      typeof factionId === 'string' &&
      typeof commander === 'number' &&
      Array.isArray(entries) &&
      entries.every(
        (e) =>
          !!knightById(e?.knightId) &&
          (UNIT_TYPES as readonly string[]).includes(e.type) &&
          Number.isFinite(e.soldiers) &&
          Number.isFinite(e.morale) &&
          (e.spells === undefined || (Array.isArray(e.spells) && e.spells.every((id) => (SPELL_IDS as readonly string[]).includes(id)))),
      )
    );
  };
  // 魔法を覚える前に保存した編成には spells が無い
  const fill = (r: SideRoster): SideRoster => ({ ...r, entries: r.entries.map((e) => ({ ...e, spells: e.spells ?? [] })) });
  const v = value as Partial<Rosters> | null;
  return v && ok(v.attacker) && ok(v.defender) ? { attacker: fill(v.attacker), defender: fill(v.defender) } : null;
}
