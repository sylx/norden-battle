/**
 * CPU の思考の設定。
 */

/** 難易度（易しい・普通・難しい）。判断の質だけで差を付け、CPU 側の数値は変えない（DIFFICULTY_PROFILES） */
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  easy: '易しい',
  normal: '普通',
  hard: '難しい',
};

/**
 * CPU が考える要素。切ると段階 1 の考え方に戻る（BASIC_FEATURES）。シミュレータで段階 1 の CPU と比べるのと、難易度に使う
 */
export interface CpuFeatures {
  /** 範囲攻撃・地点を狙う魔法・自分が中心の攻撃・耕す・状態異常・クールタイム（切ると敵ユニットを狙う攻撃だけ） */
  allAttacks: boolean;
  /** 危険な HEX を見積もる（次の敵の番に受けそうなダメージ・迎撃の構え・要塞砲。切ると攻撃できる敵の数だけ数える） */
  danger: boolean;
  /** 迎撃の構え・鼓舞・退却（切ると攻撃・移動・待機だけ） */
  stances: boolean;
  /** 軍の作戦（入城・拠点の守り・軍団長を下げる・負けを認める） */
  strategy: boolean;
  /** 狙いの集中（弱った相手に与えるダメージを割り増す） */
  focus: boolean;
  /** 連携（番の中で、後に動く味方で殲滅できる相手を先に削る。殲滅・壊滅の見込みをダメージの幅から確率で見る） */
  teamwork: boolean;
  /** 部隊の騎士の性格と軍団長の性格で手を変える（temper.ts。切るとどの部隊も標準） */
  personality: boolean;
  /** 兵種に合わせた配備（切ると自動配置） */
  deploy: boolean;
}

/** すべての要素を考える（難しい） */
export const FULL_FEATURES: CpuFeatures = { allAttacks: true, danger: true, stances: true, strategy: true, focus: true, teamwork: true, personality: true, deploy: true };

/** 段階 1 の CPU（敵ユニットを狙う攻撃・移動・待機だけ、危険は数だけ、作戦も配備も性格も無し） */
export const BASIC_FEATURES: CpuFeatures = { allAttacks: false, danger: false, stances: false, strategy: false, focus: false, teamwork: false, personality: false, deploy: false };

/** 難易度ごとの、考えない要素とノイズ */
export interface DifficultyProfile {
  /** 切る要素 */
  off: readonly (keyof CpuFeatures)[];
  /**
   * 手を選ぶときのノイズ（点数）。候補の点数に 0〜noise の一様な乱数を足して一番いいものを選ぶ
   * （選ぶ手は、一番いい手から noise 点より悪くはならない）
   */
  noise: number;
}

/**
 * 難易度（2026-11-11 にユーザーと決めた）。
 * - 難しい: すべての要素（段階 2 の CPU ＋連携）・ノイズ無し
 * - 普通: 連携を切り（段階 2 の CPU）、小さいノイズ
 * - 易しい: 危険な HEX（数だけ見る）・狙いの集中・連携を切り、大きいノイズ。入城・拠点の守り・味方の巻き添えを避ける・
 *   軍団長を危ない所に出さない（攻撃できる敵の数で見る）は残す（明らかにおかしい手は打たない）
 */
export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: { off: ['danger', 'focus', 'teamwork'], noise: 40 },
  normal: { off: ['teamwork'], noise: 10 },
  hard: { off: [], noise: 0 },
};

/** CPU の設定 */
export interface CpuOptions {
  difficulty: Difficulty;
  /** 考える要素（難易度の要素の上から変える。省略したものは難易度のまま） */
  features?: Partial<CpuFeatures>;
  /** 手を選ぶときのノイズ（省略すると難易度のもの） */
  noise?: number;
}

/** options の考える要素 */
export function featuresOf(options: CpuOptions): CpuFeatures {
  const f: CpuFeatures = { ...FULL_FEATURES };
  for (const k of DIFFICULTY_PROFILES[options.difficulty].off) f[k] = false;
  return { ...f, ...options.features };
}

/** options のノイズ */
export function noiseOf(options: CpuOptions): number {
  return options.noise ?? DIFFICULTY_PROFILES[options.difficulty].noise;
}
