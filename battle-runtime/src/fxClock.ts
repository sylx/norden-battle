/**
 * 演出の時計（ミリ秒）。BattleApp が毎フレーム、演出の速度の倍率を掛けて進める（tick）。
 * 演出の時刻はすべてこれで測る（歩く・攻撃・迎撃・退却のアニメーション、カメラ、攻撃の演出、頭上の数字、セリフの吹き出し、施設の射撃）。
 * 速度を途中で変えても、残りの時間の進み方が変わるだけで演出は途切れない。
 * 戦闘画面は同時に 1 つなので、モジュールに 1 つだけ置く（同じフレームに 2 回 tick しても進みすぎない）。
 * 足元の輪・状態の印のような繰り返すだけの演出は実時間のまま。
 */
class FxClock {
  /** 速度の倍率（1 で実時間） */
  speed = 1;
  private t = performance.now();
  private last = performance.now();
  private timers: { at: number; fn: () => void }[] = [];

  /** いまの演出の時刻（ミリ秒） */
  now(): number {
    return this.t;
  }

  /** 実時間の経過に speed を掛けて進め、時刻の来た予約を呼ぶ（毎フレームの初めに呼ぶ） */
  tick(): void {
    const real = performance.now();
    this.t += Math.max(0, real - this.last) * this.speed;
    this.last = real;
    if (this.timers.length === 0) return;
    const due = this.timers.filter((x) => x.at <= this.t);
    if (due.length === 0) return;
    this.timers = this.timers.filter((x) => x.at > this.t);
    for (const x of due) x.fn();
  }

  /** 演出の時刻で sec 秒後に fn を呼ぶ（setTimeout の代わり。速度に合わせて早まる・遅れる） */
  after(sec: number, fn: () => void): void {
    this.timers.push({ at: this.t + sec * 1000, fn });
  }

  /** 予約をすべて捨てる（マップを読み込み直すとき） */
  clearTimers(): void {
    this.timers = [];
  }
}

export const fxClock = new FxClock();
