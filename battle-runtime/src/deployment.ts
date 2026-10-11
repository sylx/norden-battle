/**
 * 配備フェーズ。戦闘画面に入った直後に、マップの初期配置地点（MapData.deploy）へ陣営ごとに部隊を選んで置く。
 *
 * - 防衛側（赤軍）→ 攻撃側（青軍）の順に配備する（ターンと同じく防衛側が先）。配置地点か部隊が無い陣営は飛ばす。
 * - 未配備の部隊を選び、その陣営の配置地点の空いている HEX をクリックして置く。置くと次の未配備の部隊を選ぶ。
 * - 置いた部隊をクリックすると選び直し、ほかの配置地点へ動かせる。選んだ部隊を別の部隊の上に置くと入れ替える。
 *   配置地点の外をクリックすると選ぶのをやめる。
 * - 1 つの陣営が置けるのは MAX_DEPLOY 部隊まで（配置地点がそれより少なければ配置地点の数まで）。置かなかった部隊は戦闘に出ない。
 *   上限まで置いた後も、置いた部隊と未配備の部隊を入れ替えることはできる。
 * - 「配備完了」（1 部隊以上置いたとき）で次の陣営へ。最後の陣営が終われば戦闘が始まる。
 *
 * マップのユニットと戦闘中の状態（statuses）を直接書き換える。描画の更新は BattleApp がする。
 */
import type { Offset } from '@norden/map-runtime/core/hex';
import type { BattleDeployment, DeploySide, HexMap } from '@norden/map-runtime/core/mapData';
import { canPlaceUnit, type TeamId, type UnitData, type UnitType } from '@norden/map-runtime/core/units';
import { demoStatus, FACE_COUNT, hash, type UnitStatus } from './unitStatus';

/** 陣営の軍 */
export const SIDE_TEAM: Record<DeploySide, TeamId> = { defender: 'red', attacker: 'blue' };
export const SIDE_NAMES: Record<DeploySide, string> = { defender: '防衛側', attacker: '攻撃側' };
/** 1 つの陣営が配備できる部隊の数 */
export const MAX_DEPLOY = 6;
/** 配備する順（防衛側が先） */
const DEPLOY_ORDER: readonly DeploySide[] = ['defender', 'attacker'];

/** 配備する部隊 */
export interface Troop {
  /** 部隊を見分ける ID（すべての部隊の中で一意） */
  id: string;
  side: DeploySide;
  type: UnitType;
  /** 戦闘中の状態（配備するとそのユニットの状態になる） */
  status: UnitStatus;
}

/** 配備する部隊を配る（既定は表示確認用の仮の部隊。demoTroops） */
export type TroopFactory = (deploy: BattleDeployment) => Troop[];

/** 配備の様子（変わるたびに作り直す） */
export interface DeployState {
  side: DeploySide;
  team: TeamId;
  /** この陣営の部隊 */
  troops: readonly Troop[];
  /** 配備した部隊の HEX（部隊の ID で引く） */
  placed: ReadonlyMap<string, Offset>;
  /** 選んでいる部隊の ID */
  picked: string | null;
  /** この陣営の配置地点の数 */
  slots: number;
  /** この陣営が置ける部隊の数（MAX_DEPLOY と配置地点の数の小さいほう） */
  limit: number;
  /** この後に配備する陣営があるか */
  more: boolean;
}

/** 表示確認用の仮の部隊の兵種の並び */
const DEMO_PATTERN: readonly UnitType[] = ['infantry', 'infantry', 'archer', 'cavalry', 'infantry', 'mage', 'archer', 'cavalry'];

/** 表示確認用の仮の部隊。配置地点のある陣営ごとに 8 部隊（顔は陣営ごとに順に、兵士数・士気は決まったばらつき） */
export function demoTroops(deploy: BattleDeployment): Troop[] {
  return DEPLOY_ORDER.flatMap((side, s) =>
    deploy[side].length === 0
      ? []
      : DEMO_PATTERN.map((type, i) => ({
          id: `${side}-${i + 1}`,
          side,
          type,
          status: demoStatus(type, (s * 4 + i) % FACE_COUNT, hash(i, s, 1), hash(i, s, 2)),
        })),
  );
}

export class Deployment {
  private readonly map: HexMap;
  private readonly deploy: BattleDeployment;
  private readonly troops: readonly Troop[];
  private readonly statuses: Map<UnitData, UnitStatus>;
  /** 配備する陣営（順に） */
  private readonly sides: DeploySide[];
  private index = 0;
  private picked: Troop | null = null;
  /** 配備した部隊のユニット */
  private readonly units = new Map<Troop, UnitData>();
  private snapshot: DeployState | null = null;

  /** map のユニットと statuses（戦闘中の状態）を、置いた部隊に合わせて書き換える */
  constructor(map: HexMap, deploy: BattleDeployment, troops: readonly Troop[], statuses: Map<UnitData, UnitStatus>) {
    this.map = map;
    this.deploy = deploy;
    this.troops = troops;
    this.statuses = statuses;
    this.sides = DEPLOY_ORDER.filter((side) => this.slotsOf(side).length > 0 && troops.some((t) => t.side === side));
  }

  /** 配備している陣営（終わったら null） */
  get side(): DeploySide | null {
    return this.sides[this.index] ?? null;
  }

  /** 配備している陣営の配置地点（置けない HEX と、ほかのユニットが最初からいる HEX を除く） */
  slots(): Offset[] {
    const side = this.side;
    return side ? this.slotsOf(side) : [];
  }

  /** 選んでいる部隊の HEX（選んでいない・未配備なら null） */
  pickedAt(): Offset | null {
    const u = this.picked && this.units.get(this.picked);
    return u ? { col: u.col, row: u.row } : null;
  }

  state(): DeployState | null {
    const side = this.side;
    if (!side) return null;
    if (this.snapshot) return this.snapshot;
    const troops = this.troops.filter((t) => t.side === side);
    const placed = new Map<string, Offset>();
    for (const t of troops) {
      const u = this.units.get(t);
      if (u) placed.set(t.id, { col: u.col, row: u.row });
    }
    this.snapshot = {
      side,
      team: SIDE_TEAM[side],
      troops,
      placed,
      picked: this.picked?.id ?? null,
      slots: this.slots().length,
      limit: this.limit(),
      more: this.index < this.sides.length - 1,
    };
    return this.snapshot;
  }

  /** 部隊を選ぶ（null で選ぶのをやめる。もう一度同じ部隊を選んでもやめる） */
  pick(id: string | null): void {
    const troop = this.troopOf(id);
    this.picked = troop && troop !== this.picked ? troop : null;
    this.changed();
  }

  /** 配備した部隊を外す（未配備に戻す） */
  unplace(id: string): void {
    const troop = this.troopOf(id);
    if (!troop) return;
    this.put(troop, null);
    if (this.picked === troop) this.picked = null;
    this.changed();
  }

  /** HEX をクリックしたとき（配置地点なら置く・選ぶ・入れ替える。外なら選ぶのをやめる） */
  click(o: Offset | null): void {
    const slot = o && this.slots().find((s) => s.col === o.col && s.row === o.row);
    if (!slot) {
      this.picked = null;
      return this.changed();
    }
    const there = this.map.unitAt(slot.col, slot.row);
    const occupant = there ? this.troopAt(there) : null;
    const picked = this.picked;
    if (occupant) {
      if (picked && picked !== occupant) {
        // 選んでいる部隊（の HEX）と入れ替える
        const from = this.pickedAt();
        this.put(occupant, null);
        this.put(picked, slot);
        this.put(occupant, from);
        this.picked = null;
      } else {
        this.picked = picked === occupant ? null : occupant;
      }
      return this.changed();
    }
    if (!picked) return;
    const fromReserve = !this.units.has(picked);
    // 上限まで置いたら、未配備の部隊は置いた部隊と入れ替えるしかない
    if (fromReserve && this.placedCount() >= this.limit()) return;
    this.put(picked, slot);
    // 未配備の一覧から置いたときは、続けて置けるように次の未配備の部隊を選ぶ（上限まで置いたら選ばない）
    this.picked = fromReserve && this.placedCount() < this.limit() ? this.nextReserve(picked) : null;
    this.changed();
  }

  /** 未配備の部隊を、空いている配置地点へ順に置く */
  auto(): void {
    const side = this.side;
    if (!side) return;
    const free = this.slots().filter((s) => !this.map.unitAt(s.col, s.row));
    for (const troop of this.troops) {
      if (troop.side !== side || this.units.has(troop)) continue;
      if (this.placedCount() >= this.limit()) break;
      const slot = free.shift();
      if (!slot) break;
      this.put(troop, slot);
    }
    this.picked = null;
    this.changed();
  }

  /** 配備を終えて次の陣営へ進む（1 部隊も置いていなければ何もしない）。進めたら true */
  finish(): boolean {
    const side = this.side;
    if (!side || !this.troops.some((t) => t.side === side && this.units.has(t))) return false;
    this.index++;
    this.picked = null;
    this.changed();
    return true;
  }

  /** 配備している陣営が置ける部隊の数 */
  private limit(): number {
    return Math.min(MAX_DEPLOY, this.slots().length);
  }

  /** 配備している陣営が置いた部隊の数 */
  private placedCount(): number {
    let n = 0;
    for (const troop of this.units.keys()) if (troop.side === this.side) n++;
    return n;
  }

  private slotsOf(side: DeploySide): Offset[] {
    return this.deploy[side].filter((o) => {
      const cell = this.map.get(o.col, o.row);
      const there = this.map.unitAt(o.col, o.row);
      return !!cell && canPlaceUnit(cell) && (!there || !!this.troopAt(there));
    });
  }

  private troopOf(id: string | null): Troop | null {
    const side = this.side;
    return (id !== null && this.troops.find((t) => t.id === id && t.side === side)) || null;
  }

  /** u がこの陣営で配備した部隊なら、その部隊 */
  private troopAt(u: UnitData): Troop | null {
    for (const [troop, unit] of this.units) if (unit === u) return troop.side === this.side ? troop : null;
    return null;
  }

  private nextReserve(after: Troop): Troop | null {
    const list = this.troops.filter((t) => t.side === after.side);
    const i = list.indexOf(after);
    return [...list.slice(i + 1), ...list.slice(0, i)].find((t) => !this.units.has(t)) ?? null;
  }

  /** 部隊を o へ置く（null なら外す）。置き直すときは前の HEX から取り除く */
  private put(troop: Troop, o: Offset | null): void {
    const old = this.units.get(troop);
    if (old) {
      this.map.removeUnit(old.col, old.row);
      this.statuses.delete(old);
      this.units.delete(troop);
    }
    if (!o) return;
    this.map.setUnit({ col: o.col, row: o.row, type: troop.type, team: SIDE_TEAM[troop.side] });
    // マップは写しを持つので、置いたものを引き直す
    const unit = this.map.unitAt(o.col, o.row)!;
    this.units.set(troop, unit);
    this.statuses.set(unit, troop.status);
  }

  private changed(): void {
    this.snapshot = null;
  }
}
