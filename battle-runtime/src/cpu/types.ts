/**
 * CPU の思考の設定。
 */

/** 難易度（易しい・普通・難しい）。判断の質だけで差を付け、CPU 側の数値は変えない（段階 3 で中身を入れる） */
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  easy: '易しい',
  normal: '普通',
  hard: '難しい',
};

/** CPU の設定 */
export interface CpuOptions {
  difficulty: Difficulty;
}
