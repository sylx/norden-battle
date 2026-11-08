/**
 * 戦闘のルールの乱数の口。ルールの乱数（ダメージのブレ・退却の失敗・殲滅の捕縛・状態異常・鼓舞・混乱の移動先・施設の目標）は
 * すべてこれを通して引く。シードを固定すれば、演出ありでも描画なしでも同じ結果になる（引く順番が同じなので）。
 * セリフ・演出の乱数は描画の側で、これを使わない。
 */

/** 0 以上 1 未満の数を返す */
export interface Rng {
  next(): number;
}

/** Math.random をそのまま使う（シードで再現しない。BattleApp の既定） */
export const mathRng: Rng = { next: () => Math.random() };

/** seed から再現できる乱数（mulberry32） */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** −1〜1 の乱数（ダメージのランダム係数） */
export function roll(rng: Rng): number {
  return rng.next() * 2 - 1;
}

/** 確率 p で true */
export function chance(rng: Rng, p: number): boolean {
  return rng.next() < p;
}

/** list から 1 つ選ぶ（list は空でないこと） */
export function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng.next() * list.length)];
}

/** min 以上 max 以下の整数 */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng.next() * (max - min + 1));
}
