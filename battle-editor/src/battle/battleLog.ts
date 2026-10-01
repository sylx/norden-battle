/**
 * 戦闘ログのウィンドウ（画面の右下、ターン表示の上）。攻撃を実行するたびに 1 件ずつ足す。
 * ツールバー・行動メニューより奥に表示する（style.css の z-index）。
 *
 * - 飾り罫の枠（frame.ts）の上辺に題名の札を載せ、枠の内側にもう 1 本細い罫を引いて二重罫にする。
 * - ターンが変わって最初の記録の前に、飾り罫の区切り（第 n ターン）を入れる。
 * - 新しい記録は下に足し、いちばん下までスクロールする（上を読んでいる間は動かさない）。
 * - 題名の横のボタンで畳める。マップを読み込み直すと空にする。
 * - 記録の一覧と畳むボタン以外（題名の札・枠）をつかんでドラッグで動かせる。画面の外へは出さない。
 */
import { TEAM_DEFS, UNIT_DEFS, type UnitData } from '@norden/map-runtime/core/units';
import type { Offset } from '@norden/map-runtime/core/hex';
import { addFrame } from './frame';
import type { MoraleChange } from './morale';

/** 攻撃 1 回分の記録 */
export interface AttackLogEntry {
  /** intercept: 迎撃の構えの間接ユニットの自動攻撃 */
  kind?: 'intercept';
  turn: number;
  attacker: UnitData;
  target: UnitData;
  /** 行動の名前（攻撃・斉射・突撃など） */
  actionName: string;
  damage: number;
  /** 反撃による減少（直接攻撃でなければ使わない） */
  counter: number;
  direct: boolean;
  /** 相手が包囲されていたか */
  encircled: boolean;
  morale: MoraleChange;
  /** 攻撃の後の兵数 */
  attackerLeft: number;
  targetLeft: number;
  /** 突撃で飛び出た HEX */
  landing: Offset | null;
  /** 迎撃で相手の行動を止めたか */
  halted?: boolean;
}

/** 下端からこれ以内にいれば「最新を見ている」とみなして自動でスクロールする（CSS ピクセル） */
const STICK_BOTTOM = 24;
/** 動かすときに空ける画面の端との間（上は題名の札が枠からはみ出す分も空ける） */
const MARGIN = 6;
const MARGIN_TOP = 16;

export class BattleLog {
  private readonly root: HTMLElement;
  private readonly list: HTMLOListElement;
  private readonly count: HTMLElement;
  private lastTurn = 0;
  private entries = 0;
  /** ドラッグ中のポインターと、つかんだ位置（ウィンドウの左上から） */
  private drag: { id: number; dx: number; dy: number } | null = null;
  /** 一度でも動かしたか（動かすまでは CSS の右下の位置のまま） */
  private moved = false;

  constructor(parent: HTMLElement) {
    this.root = el('section', 'game-window battle-log');
    this.root.id = 'battle-log';
    addFrame(this.root);

    const title = el('h2', 'window-title', '戦闘記録');
    this.count = el('span', 'log-count');
    const toggle = el('button', 'log-toggle');
    toggle.type = 'button';
    toggle.title = '畳む';
    toggle.addEventListener('click', () => {
      const collapsed = this.root.classList.toggle('collapsed');
      toggle.title = collapsed ? '広げる' : '畳む';
      if (!collapsed) this.list.scrollTop = this.list.scrollHeight;
      this.clampToView();
    });
    this.list = el('ol', 'log-list');
    this.root.append(title, toggle, this.count, this.list);
    parent.append(this.root);
    this.clear();
    this.setupDrag();
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

    const li = el('li', `log-entry fresh${e.kind ? ` ${e.kind}` : ''}`);
    const who = el('div', 'log-who');
    who.append(unit(e.attacker), el('span', 'log-verb', 'が'), unit(e.target), el('span', 'log-verb', 'に'));
    if (e.encircled) who.append(el('span', 'log-encircled', '包囲'));
    who.append(el('span', 'log-action', e.actionName));

    const result = el('div', 'log-result');
    result.append(loss('損害', 'damage', e.damage, e.targetLeft, e.morale.defender));
    if (e.direct) result.append(loss('反撃', 'counter', e.counter, e.attackerLeft, e.morale.attacker));
    else result.append(withMorale(el('span', 'log-none', '反撃なし'), e.morale.attacker));
    li.append(who, result);
    if (e.landing && e.attackerLeft > 0) li.append(el('div', 'log-note', `(${e.landing.col}, ${e.landing.row}) へ突破`));
    if (e.halted && e.targetLeft > 0) li.append(el('div', 'log-note halted', '迎撃で足止めされ、行動を中断'));
    li.addEventListener('animationend', () => li.classList.remove('fresh'), { once: true });
    this.list.append(li);

    this.entries++;
    this.updateCount();
    if (stick) this.list.scrollTop = this.list.scrollHeight;
    this.clampToView();
  }

  private setupDrag(): void {
    const root = this.root;
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as Element).closest('.log-list, .log-toggle')) return;
      const r = root.getBoundingClientRect();
      this.drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
      root.setPointerCapture(e.pointerId);
      root.classList.add('moving');
      e.preventDefault();
    });
    root.addEventListener('pointermove', (e) => {
      if (this.drag?.id === e.pointerId) this.moveTo(e.clientX - this.drag.dx, e.clientY - this.drag.dy);
    });
    const end = (e: PointerEvent) => {
      if (this.drag?.id !== e.pointerId) return;
      this.drag = null;
      root.classList.remove('moving');
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => this.clampToView());
  }

  /** 左上を (x, y) へ動かす（画面からはみ出さないように詰める） */
  private moveTo(x: number, y: number): void {
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    const left = Math.max(MARGIN, Math.min(x, window.innerWidth - MARGIN - w));
    const top = Math.max(MARGIN_TOP, Math.min(y, window.innerHeight - MARGIN - h));
    const st = this.root.style;
    st.left = `${Math.round(left)}px`;
    st.top = `${Math.round(top)}px`;
    st.right = st.bottom = 'auto';
    this.moved = true;
  }

  /** 動かした後に画面の大きさ・ウィンドウの高さが変わったら、はみ出さないように詰め直す */
  private clampToView(): void {
    if (!this.moved) return;
    const r = this.root.getBoundingClientRect();
    this.moveTo(r.left, r.top);
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

/** 兵数の減少（減った数と残り。0 なら壊滅）と士気の増減 */
function loss(label: string, kind: string, n: number, left: number, morale: number): HTMLElement {
  const s = el('span', `log-loss ${kind}`);
  s.append(el('span', 'label', label), el('b', '', `−${n}`));
  if (left <= 0) {
    s.append(el('span', 'log-destroyed', '壊滅'));
    return s;
  }
  s.append(el('span', 'left', `残 ${left}`));
  return withMorale(s, morale);
}

/** s の後ろに士気の増減を足す（変わらなければ何もしない） */
function withMorale(s: HTMLElement, morale: number): HTMLElement {
  if (morale !== 0) s.append(el('span', `log-morale ${morale > 0 ? 'up' : 'down'}`, `士気 ${morale > 0 ? '+' : '−'}${Math.abs(morale)}`));
  return s;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
