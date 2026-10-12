/**
 * 戦闘中のセリフ（攻撃・迎撃・鼓舞・殲滅などのときのつぶやきと、一斉攻撃の掛け合い）。
 *
 * どの場面で喋るか・喋る確率はここで決め、何を喋るかは BarkSource に任せる。
 * ゲームでは騎士の口調・性格から会話データを引く BarkSource を渡す（BattleScreen の barks）。
 * 渡されないときは表示確認用の決まったセリフ（demoBarks）。
 * 吹き出しの表示は speechBubbles.ts、いつ喋らせるかは app.ts。
 */
import type { UnitData } from '@norden/map-runtime/core/units';
import type { UnitStatus } from './unitStatus';

export const BARK_SITUATIONS = [
  'attack', // 攻撃時（ランダム）
  'intercept', // 迎撃時（範囲侵入時の自動反撃・防御態勢）。構えた弓兵・魔術師が射程に入った敵を撃つ前だけ
  'rally', // 特殊コマンド「鼓舞」実行時
  'enemy_eliminated', // 敵部隊殲滅時（ランダム）
  'retreat', // 退却時
  'wiped_out', // 殲滅（撃退・全滅）された時
] as const;

export type BarkSituation = (typeof BARK_SITUATIONS)[number];

/** 場面ごとに喋る確率（ランダムの場面だけ 1 未満） */
export const BARK_CHANCE: Record<BarkSituation, number> = {
  attack: 0.5,
  intercept: 1,
  rally: 1,
  enemy_eliminated: 0.6,
  retreat: 1,
  wiped_out: 1,
};

/** 一斉攻撃で掛け合いが起きる確率 */
export const EXCHANGE_CHANCE = 0.6;

/** 場面の名前（エディタ・戦闘記録などに出す） */
export const BARK_SITUATION_NAMES: Record<BarkSituation | 'exchange', string> = {
  attack: '攻撃',
  intercept: '迎撃',
  rally: '鼓舞',
  enemy_eliminated: '敵部隊殲滅',
  retreat: '退却',
  wiped_out: '殲滅された',
  exchange: '一斉攻撃の掛け合い',
};

/**
 * 吹き出しの調子。shout: 叫ぶ（大きな字・弾んで出る）、calm: 普通、weak: 弱々しい（くすんだ吹き出し・ゆっくり出る）
 */
export type BarkTone = 'shout' | 'calm' | 'weak';

export const BARK_TONE: Record<BarkSituation | 'exchange', BarkTone> = {
  attack: 'shout',
  intercept: 'shout',
  rally: 'shout',
  enemy_eliminated: 'calm',
  retreat: 'weak',
  wiped_out: 'weak',
  exchange: 'shout',
};

/** 喋る部隊 */
export interface BarkSpeaker {
  unit: UnitData;
  status: UnitStatus;
}

/** 掛け合いの 1 行。who は参加する部隊の番号（0 が攻撃する部隊、1 から加わる味方） */
export interface ExchangeLine {
  who: number;
  text: string;
}

/** 何を喋るか */
export interface BarkSource {
  /** situation で speaker が言うセリフ（other は相手。いなければ null）。言わなければ null */
  line(situation: BarkSituation, speaker: BarkSpeaker, other: BarkSpeaker | null): string | null;
  /** 一斉攻撃の掛け合い（members の先頭が攻撃する部隊、続いて加わる味方。target は相手）。起きなければ null */
  exchange(members: readonly BarkSpeaker[], target: BarkSpeaker): ExchangeLine[] | null;
}

/** 表示確認用の決まったセリフ（場面ごとにいくつかから選ぶ） */
const DEMO_LINES: Record<BarkSituation, readonly string[]> = {
  attack: ['この一撃、受けてみよ！', '押し通る！', '怯むな、斬り込め！', '隙だらけだ！'],
  intercept: ['ここから先へは通さん！', '来たな……迎え撃て！', '構えを崩すな！'],
  rally: ['皆の者、顔を上げよ！ 勝機は我らにある！', '恐れるな！ 我らが旗はまだ倒れていない！', '声を上げろ！ ここが踏ん張りどころだ！'],
  enemy_eliminated: ['敵部隊、討ち取ったり！', '他愛もない。', '次はどいつだ？'],
  retreat: ['くっ……ここは退くぞ！', '体勢を立て直す。一度下がれ！'],
  wiped_out: ['無念……ここまでか……', 'ぐっ……申し訳ありません……', 'まだ……倒れるわけには……'],
};

/** 表示確認用の掛け合い（who は 0: 攻撃する部隊、1・2: 加わる味方。味方が足りない行は飛ばす） */
const DEMO_EXCHANGES: readonly (readonly ExchangeLine[])[] = [
  [
    { who: 0, text: '囲んだぞ！ 合わせろ！' },
    { who: 1, text: '応！ 遅れるなよ！' },
  ],
  [
    { who: 1, text: '背中は預かった！ 行け！' },
    { who: 0, text: '恩に着る！ 一気に押し潰す！' },
  ],
  [
    { who: 0, text: '今だ、同時に仕掛ける！' },
    { who: 1, text: '待ちくたびれたぜ！' },
    { who: 2, text: '逃がしはしない！' },
  ],
];

export const demoBarks: BarkSource = {
  line: (situation) => pick(DEMO_LINES[situation]),
  exchange: (members) => {
    const lines = pick(DEMO_EXCHANGES).filter((l) => l.who < members.length);
    // 加わる味方が 1 部隊しかいないときに、言う人が 1 人だけになる掛け合いは使わない
    return new Set(lines.map((l) => l.who)).size >= 2 ? lines : null;
  },
};

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}
