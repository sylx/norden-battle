/**
 * ゲーム（nordencult）のセリフのデータ（src/data/voiceLines.json）で喋らせる。
 *
 * セリフの選び方（口調・性格からどのセルを引くか）はゲームの src/data/voiceLines.ts をそのまま使う。
 * 喋る騎士は、エディタで選んだものがあればそれ、無ければ部隊を率いる騎士（gameKnights.ts の編成から作った部隊）、
 * それも無ければ口調のある騎士を順に割り当てる（吹き出しに騎士の顔は出さない）。
 */
import { lineBarks, type BarkSource, type UnitStatus } from '@norden/battle-runtime';
import type { UnitData } from '@norden/map-runtime/core/units';
import { pickVoiceLine } from '../../../src/data/voiceLines.ts';
import { GAME_KNIGHTS, knightOfStatus, type GameKnight } from './gameKnights';

/** ユニットに喋らせる騎士の割り当て */
export class KnightCast {
  readonly knights: readonly GameKnight[];
  private readonly voiced: readonly GameKnight[];
  private readonly assigned = new WeakMap<UnitData, GameKnight>();
  private next = 0;

  constructor(knights: readonly GameKnight[]) {
    this.knights = knights;
    const voiced = knights.filter((k) => k.voiceTone);
    this.voiced = voiced.length ? voiced : knights;
  }

  /** unit に喋らせる騎士（status はそのユニットの戦闘中の状態。率いる騎士を引くのに使う） */
  get(unit: UnitData, status?: UnitStatus): GameKnight | undefined {
    let knight = this.assigned.get(unit) ?? knightOfStatus(status);
    if (!knight && this.voiced.length) {
      knight = this.voiced[this.next++ % this.voiced.length];
      this.assigned.set(unit, knight);
    }
    return knight;
  }

  set(unit: UnitData, knight: GameKnight): void {
    this.assigned.set(unit, knight);
  }
}

export const knightCast = new KnightCast(GAME_KNIGHTS);

/** ゲームのセリフで喋らせる */
export const gameBarks: BarkSource = lineBarks((situation, { unit, status }) => pickVoiceLine(situation, knightCast.get(unit, status)));
