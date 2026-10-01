/**
 * 戦闘ログのウィンドウ（画面の右下、ターン表示の上）。攻撃を実行するたびに 1 件ずつ足す。
 *
 * - 飾り罫の枠（frame.ts）の上辺に題名の札を載せ、枠の内側にもう 1 本細い罫を引いて二重罫にする。
 * - ターンが変わって最初の記録の前に、飾り罫の区切り（第 n ターン）を入れる。
 * - 新しい記録は下に足し、いちばん下までスクロールする（上を読んでいる間は動かさない）。
 * - 題名の横のボタンで畳める。マップを読み込み直すと空にする。
 */
import { TEAM_DEFS, UNIT_DEFS, type UnitData } from '@norden/map-runtime/core/units';
import type { Offset } from '@norden/map-runtime/core/hex';
import { addFrame } from './frame';

/** 攻撃 1 回分の記録 */
export interface AttackLogEntry {
  turn: number;
  attacker: UnitData;
  target: UnitData;
  /** 行動の名前（攻撃・斉射・突撃など） */
  actionName: string;
  damage: number;
  /** 反撃による減少（直接攻撃でなければ使わない） */
  counter: number;
  direct: boolean;
  /** 攻撃の後の兵数 */
  attackerLeft: number;
  targetLeft: number;
  /** 突撃で飛び出た HEX */
  landing: Offset | null;
}

/** 下端からこれ以内にいれば「最新を見ている」とみなして自動でスクロールする（CSS ピクセル） */
const STICK_BOTTOM = 24;

export class BattleLog {
  private readonly root: HTMLElement;
  private readonly list: HTMLOListElement;
  private readonly count: HTMLElement;
  private lastTurn = 0;
  private entries = 0;

  constructor(parent: HTMLElement) {
    this.root = el('section', 'battle-log');
    this.root.id = 'battle-log';
    addFrame(this.root);

    const title = el('h2', 'log-title', '戦闘記録');
    this.count = el('span', 'log-count');
    const toggle = el('button', 'log-toggle');
    toggle.type = 'button';
    toggle.title = '畳む';
    toggle.addEventListener('click', () => {
      const collapsed = this.root.classList.toggle('collapsed');
      toggle.title = collapsed ? '広げる' : '畳む';
      if (!collapsed) this.list.scrollTop = this.list.scrollHeight;
    });
    this.list = el('ol', 'log-list');
    this.root.append(title, toggle, this.count, this.list);
    parent.append(this.root);
    this.clear();
  }

  clear(): void {
    this.lastTurn = 0;
    this.entries = 0;
    this.list.replaceChildren(el('li', 'log-empty', 'まだ戦闘はありません'));
    this.updateCount();
  }

  addAttack(e: AttackLogEntry): void {
    const stick = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight <= STICK_BOTTOM;
    if (this.entries === 0) this.list.replaceChildren();
    if (e.turn !== this.lastTurn) {
      this.lastTurn = e.turn;
      const rule = el('li', 'log-turn');
      rule.append(el('span', '', `第 ${e.turn} ターン`));
      this.list.append(rule);
    }

    const li = el('li', 'log-entry fresh');
    const who = el('div', 'log-who');
    who.append(unit(e.attacker), el('span', 'log-verb', 'が'), unit(e.target), el('span', 'log-verb', 'に'), el('span', 'log-action', e.actionName));

    const result = el('div', 'log-result');
    result.append(loss('損害', 'damage', e.damage, e.targetLeft));
    if (e.direct) result.append(loss('反撃', 'counter', e.counter, e.attackerLeft));
    else result.append(el('span', 'log-none', '反撃なし'));
    li.append(who, result);
    if (e.landing && e.attackerLeft > 0) li.append(el('div', 'log-note', `(${e.landing.col}, ${e.landing.row}) へ突破`));
    li.addEventListener('animationend', () => li.classList.remove('fresh'), { once: true });
    this.list.append(li);

    this.entries++;
    this.updateCount();
    if (stick) this.list.scrollTop = this.list.scrollHeight;
  }

  private updateCount(): void {
    this.count.textContent = `${this.entries} 件`;
  }
}

/** 軍の色の印を付けたユニット名 */
function unit(u: UnitData): HTMLElement {
  const team = TEAM_DEFS[u.team];
  const s = el('span', 'log-unit', `${team.name} ${UNIT_DEFS[u.type].name}`);
  s.style.setProperty('--team', team.color);
  return s;
}

/** 兵数の減少（減った数と残り。0 なら壊滅） */
function loss(label: string, kind: string, n: number, left: number): HTMLElement {
  const s = el('span', `log-loss ${kind}`);
  s.append(el('span', 'label', label), el('b', '', `−${n}`));
  s.append(left > 0 ? el('span', 'left', `残 ${left}`) : el('span', 'log-destroyed', '壊滅'));
  return s;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
