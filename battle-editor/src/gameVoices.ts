/**
 * ゲーム（nordencult）のセリフのデータ（src/data/voiceLines.json）と騎士（src/data/characterData.json）。
 *
 * norden-battle を nordencult のサブモジュールとして置いているとき（../../ がゲーム）だけ読める。
 * GitHub Pages のビルドなど、ゲームが無いときは gameVoices が null になり、表示確認用のセリフ（demoBarks）を使う。
 * セリフの選び方（口調・性格からどのセルを引くか）はゲームの src/data/voiceLines.ts をそのまま使う。
 */
import { lineBarks, type BarkSource } from '@norden/battle-runtime';
import type { UnitData } from '@norden/map-runtime/core/units';

/** 騎士（characterData.json の 1 行のうち、使うところだけ） */
export interface GameKnight {
  id: string;
  name: string;
  voiceTone?: string;
  personality?: string[];
}

/** ゲームの src/data/voiceLines.ts のうち、使うところだけ */
interface VoiceLinesModule {
  pickVoiceLine(situation: string, profile: { voiceTone?: string; personality?: readonly string[] } | undefined): string | null;
}

// ファイルが無ければ空になる（import と違ってビルドが止まらない）
const voiceLines = Object.values(import.meta.glob<VoiceLinesModule>('../../../src/data/voiceLines.ts', { eager: true }))[0];
const knights = Object.values(
  import.meta.glob<GameKnight[]>('../../../src/data/characterData.json', { eager: true, import: 'default' }),
)[0];

/**
 * ユニットに喋らせる騎士の割り当て。決めていないユニットには、口調のある騎士を順に割り当てる
 * （騎士 ID はユニットの指揮官の顔とは関係ない。吹き出しの顔は表示確認用の顔のまま）
 */
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

  get(unit: UnitData): GameKnight | undefined {
    let knight = this.assigned.get(unit);
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

/** ゲームのセリフで喋らせる（cast は喋るユニットの騎士）。ゲームが無ければ null */
export const gameVoices: { cast: KnightCast; barks: BarkSource } | null = (() => {
  if (!voiceLines || !knights) return null;
  const cast = new KnightCast(knights);
  return { cast, barks: lineBarks((situation, { unit }) => voiceLines.pickVoiceLine(situation, cast.get(unit))) };
})();
