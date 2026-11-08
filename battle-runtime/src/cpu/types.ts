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

/**
 * CPU が考える要素。切ると段階 1 の考え方に戻る（BASIC_FEATURES）。シミュレータで段階 1 の CPU と比べるのと、段階 3 の難易度に使う
 */
export interface CpuFeatures {
  /** 範囲攻撃・地点を狙う魔法・自分が中心の攻撃・耕す・状態異常・クールタイム（切ると敵ユニットを狙う攻撃だけ） */
  allAttacks: boolean;
  /** 危険な HEX を見積もる（次の敵の番に受けそうなダメージ・迎撃の構え・要塞砲。切ると攻撃できる敵の数だけ数える） */
  danger: boolean;
  /** 迎撃の構え・鼓舞・退却（切ると攻撃・移動・待機だけ） */
  stances: boolean;
  /** 軍の作戦（入城・拠点の守り・軍団長を下げる・狙いの集中・負けを認める） */
  strategy: boolean;
  /** 兵種に合わせた配備（切ると自動配置） */
  deploy: boolean;
}

/** すべての要素を考える（段階 2 の CPU） */
export const FULL_FEATURES: CpuFeatures = { allAttacks: true, danger: true, stances: true, strategy: true, deploy: true };

/** 段階 1 の CPU（敵ユニットを狙う攻撃・移動・待機だけ、危険は数だけ、作戦も配備も無し） */
export const BASIC_FEATURES: CpuFeatures = { allAttacks: false, danger: false, stances: false, strategy: false, deploy: false };

/** CPU の設定 */
export interface CpuOptions {
  difficulty: Difficulty;
  /** 考える要素（省略したものは考える。FULL_FEATURES） */
  features?: Partial<CpuFeatures>;
}

/** options の考える要素 */
export function featuresOf(options: CpuOptions): CpuFeatures {
  return { ...FULL_FEATURES, ...options.features };
}
