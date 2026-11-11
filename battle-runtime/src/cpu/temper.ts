/**
 * 性格（部隊を率いる騎士の行動・戦闘スタイル。UnitStatus.personality）で、CPU の点数の重みとしきい値を変える（CpuFeatures.personality）。
 *
 * - 部隊の気質（Temper）: その部隊の騎士の性格で、その部隊の手の好みを変える（decide.ts の重みに掛ける倍率）
 *   - 猛進: 受けるダメージ・危険を軽く見て、与えるダメージと前に出ることを重く見る。迎撃の構えを好まない。自分からは退却しない
 *   - 慎重: 受けるダメージ・危険・地形の守りを重く見て、前に出にくい。迎撃の構え・鼓舞を好み、早めに退却する
 *   - 勇敢: 相手の軍団長と強い相手を狙い、弱った相手は狙わない。弱った味方・自軍の軍団長の隣で敵との間に立つ。退却は遅い
 *   - 実利: 殲滅（捕縛）できる相手と弱った相手を狙い、与えるものに比べて受けるものの多い攻撃を嫌う。勝ち目が薄ければ早めに退く
 * - 軍の気質（ArmyTemper）: 軍団長の騎士の性格で、軍の作戦（全軍の前に出る度合い・防衛側が拠点の周りに留まる広さ・軍団長の出方・
 *   負けを認めるしきい値）を変える
 * - 軍団長の部隊と防衛側の拠点の守りの部隊は、自分の性格で受けるダメージ・危険・前に出る度合い・迎撃の構えを変えるのを半分にする
 *   （軍団長を敵の前に放り出さない・拠点を空けない。役目を性格より先にする）
 * - 性格の無い部隊・軍団長は標準（段階 2 の CPU のまま）
 */
import type { BattleStyle, UnitStatus } from '../unitStatus';
import { CONCEDE_LEFT, CONCEDE_RATIO, CONCEDE_STALL_RATIO, GUARD_RADIUS, RETREAT_SOLDIERS, WEIGHTS as W } from './weights';

/** 部隊の気質（decide.ts の重みに掛ける倍率としきい値） */
export interface Temper {
  /** 敵に与えるダメージ */
  dealt: number;
  /** 受けるダメージ（反撃・移動の途中の迎撃） */
  taken: number;
  /** 危険な HEX（次の敵の番に受けそうなダメージ・殲滅されそうな HEX） */
  danger: number;
  /** 敵に近づく */
  approach: number;
  /** 地形の守り */
  terrain: number;
  /** 迎撃の構え */
  stance: number;
  /** 鼓舞 */
  inspire: number;
  /** 相手を殲滅する見込み（軍団長を討つ分は除く） */
  kill: number;
  /** 弱った相手を狙う割り増し */
  focus: number;
  /** 相手の軍団長を狙う割り増し */
  commanderTarget: number;
  /** 強い相手を狙う割り増し（与えるダメージ × min(1, 相手の兵力 ÷ 自分の兵力) に掛ける） */
  strongTarget: number;
  /** 効率の悪い攻撃の減点（受ける − 与える × EFFICIENT_SHARE が正なら、その分に掛けて引く） */
  efficiency: number;
  /** 弱った味方・自軍の軍団長の隣で、敵との間に立つ点数 */
  shield: number;
  /** 自分から退却を考える兵数（戦闘の初めの兵数に対する割合。null は退却しない） */
  retreat: number | null;
}

/** 軍の気質（軍団長の性格で決まる軍の作戦の値） */
export interface ArmyTemper {
  /** 全軍の敵に近づく重みの倍率 */
  approach: number;
  /** 防衛側: 拠点の周りに留まる重みの倍率と、留まりたい距離（HEX） */
  guard: number;
  guardRadius: number;
  /** 軍団長の部隊が敵に近づく重みに掛ける倍率（WEIGHTS.commanderApproach の代わり） */
  commanderApproach: number;
  /** 全軍の、相手の軍団長を狙う割り増しの倍率 */
  commanderTarget: number;
  /** 全軍の、弱った相手を狙う割り増しの倍率 */
  focus: number;
  /** 負けを認めるしきい値（weights.ts の CONCEDE_LEFT・CONCEDE_RATIO・CONCEDE_STALL_RATIO の代わり） */
  concedeLeft: number;
  concedeRatio: number;
  concedeStallRatio: number;
}

/** 効率を見る攻撃で、受けるダメージが与えるダメージのこの割合を超えた分を減点する */
export const EFFICIENT_SHARE = 0.25;

/** 標準の部隊の気質（段階 2 の CPU） */
export const STANDARD_TEMPER: Temper = {
  dealt: 1,
  taken: 1,
  danger: 1,
  approach: 1,
  terrain: 1,
  stance: 1,
  inspire: 1,
  kill: 1,
  focus: 1,
  commanderTarget: 1,
  strongTarget: 0,
  efficiency: 0,
  shield: 0,
  retreat: RETREAT_SOLDIERS,
};

/** 性格ごとの部隊の気質（標準と違うところ） */
export const STYLE_TEMPERS: Record<BattleStyle, Partial<Temper>> = {
  aggressive: { dealt: 1.15, taken: 0.6, danger: 0.5, approach: 1.5, stance: 0.5, retreat: null },
  cautious: { taken: 1.4, danger: 1.5, terrain: 1.5, approach: 0.8, stance: 1.5, inspire: 1.5, retreat: 0.5 },
  valiant: { commanderTarget: 3, strongTarget: 0.8, focus: 0, shield: 25, retreat: 0.2 },
  pragmatic: { kill: 2, focus: 2.5, efficiency: 0.6, retreat: 0.45 },
};

/** 標準の軍の気質（段階 2 の CPU） */
export const STANDARD_ARMY: ArmyTemper = {
  approach: 1,
  guard: 1,
  guardRadius: GUARD_RADIUS,
  commanderApproach: W.commanderApproach,
  commanderTarget: 1,
  focus: 1,
  concedeLeft: CONCEDE_LEFT,
  concedeRatio: CONCEDE_RATIO,
  concedeStallRatio: CONCEDE_STALL_RATIO,
};

/** 軍団長の性格ごとの軍の気質（標準と違うところ） */
export const STYLE_ARMIES: Record<BattleStyle, Partial<ArmyTemper>> = {
  // 全軍で押し出し、防衛側も拠点の周りを少し離れて討ちに出る。負けをなかなか認めない
  // （拠点の周りの重みを 0.6・広さを 4 にすると、拠点を空けて入城される戦いが標準の 1.4 倍になり、防衛側の勝率が 3 分の 1 に落ちた）
  aggressive: { approach: 1.2, guard: 0.8, commanderApproach: 0.6, concedeLeft: 0.2, concedeRatio: 6, concedeStallRatio: 3 },
  // 全軍が前に出にくく、防衛側は拠点の近くを固める。軍団長は後ろに下げ、早めに負けを認める
  cautious: { approach: 0.85, guard: 1.5, guardRadius: 2, commanderApproach: 0.25, concedeLeft: 0.4, concedeRatio: 3, concedeStallRatio: 1.6 },
  // 軍団長が自分も前に出て、全軍で相手の軍団長を狙う。負けを認めるのは遅い
  // （軍団長の出方を 0.8 にすると、攻撃側で軍団長を討たれる戦いが標準の 1.7 倍になった）
  valiant: { approach: 1.1, commanderApproach: 0.6, commanderTarget: 1.5, concedeLeft: 0.2, concedeRatio: 5, concedeStallRatio: 2.5 },
  // 全軍で弱った相手を討ち取る。勝ち目が薄ければ早めに負けを認める
  pragmatic: { focus: 1.3, concedeLeft: 0.4, concedeRatio: 3, concedeStallRatio: 1.8 },
};

/** 軍団長・拠点の守りの部隊が自分の性格で変える倍率を、標準に寄せる割合（0.5 なら半分だけ変える） */
const COMMANDER_SOFTEN = 0.5;

const soften = (f: number) => 1 + (f - 1) * COMMANDER_SOFTEN;

/** 部隊の気質（性格を見ないなら標準）。garrison は防衛側の拠点の守りの部隊か */
export function temperOf(status: UnitStatus, personality = true, garrison = false): Temper {
  const style = personality ? status.personality : undefined;
  const t: Temper = { ...STANDARD_TEMPER, ...(style && STYLE_TEMPERS[style]) };
  if (status.commander || garrison) {
    t.taken = soften(t.taken);
    t.danger = soften(t.danger);
    t.approach = soften(t.approach);
    t.stance = soften(t.stance);
  }
  return t;
}

/** 軍団長の性格で決まる軍の気質（軍団長がいない・性格を見ないなら標準） */
export function armyTemperOf(commander: UnitStatus | undefined, personality = true): ArmyTemper {
  const style = personality ? commander?.personality : undefined;
  return { ...STANDARD_ARMY, ...(style && STYLE_ARMIES[style]) };
}
