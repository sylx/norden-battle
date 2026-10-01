/**
 * 選択中のユニットの近くに出す行動メニュー（HTML で画面に重ねる）。
 *
 * - ユニットの絵（移動を予約したら予約した移動先に置いた絵）の右（入らなければ左）に置き、
 *   カメラを動かしても毎フレーム追いかける。
 * - 上部にユニットの状態（情報札と同じ顔・兵士数・士気と、残り行動力）を出す。
 * - 2 階層目は 1 階層目の項目の横に開く。マウスは項目に乗せる、タッチはタップで開く。
 * - パネルの四隅には飾り罫（.corner）を置く。いまは CSS の仮の線で、画像に差し替えられるよう
 *   パネルの内側に飾りの分の余白を取ってある（style.css の --frame-*）。
 */
import * as THREE from 'three';
import { TEAM_DEFS, UNIT_DEFS, type UnitData } from '@norden/map-runtime/core/units';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { buildActionMenu, type MenuAction, type MenuContext, type MenuEntry } from './actions';
import { renderStatus, STATUS_HTML } from './unitTags';

/** ユニットの絵とメニューの間隔（CSS ピクセル） */
const GAP = 14;
/** 画面の端からの余白 */
const MARGIN = 8;
/** 1 階層目と 2 階層目の間隔 */
const SUB_GAP = 4;

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

export class ActionMenu {
  /** 行動を選んだとき */
  onAction: (unit: UnitData, action: MenuAction) => void = () => {};

  private readonly root: HTMLDivElement;
  private readonly main: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  /** true の間はメニューを隠しておく（移動先を選んでいる間など） */
  suspended = false;
  private unit: UnitData | null = null;
  /** 2 階層目を開いている 1 階層目の項目 */
  private openItem: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'action-menu';
    this.root.hidden = true;
    this.main = framedPanel('main');
    this.sub = framedPanel('sub');
    this.sub.hidden = true;
    this.root.append(this.main, this.sub);
    container.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.unit !== null;
  }

  /** ユニットのメニューを開く（null で閉じる）。開いたまま呼ぶと中身を作り直す */
  open(ctx: MenuContext | null): void {
    this.closeSub();
    this.unit = ctx?.unit ?? null;
    this.root.hidden = !ctx;
    if (!ctx) return;
    const { unit, status } = ctx;

    const team = TEAM_DEFS[unit.team];
    this.root.style.setProperty('--team', team.color);
    const head = el('div', 'menu-head');
    const title = el('div', 'menu-title', `${team.name} ${UNIT_DEFS[unit.type].name}`);
    const card = el('div', 'unit-tag in-menu');
    card.innerHTML = STATUS_HTML;
    renderStatus(card, status);
    const ap = el('div', 'menu-ap');
    ap.append(el('span', 'label', '行動力'), el('span', 'value', `${ctx.ap}`), el('span', 'max', `/${status.maxAp}`));
    // 予約で使う分は欠けて見せる（0.5 刻みなので半分の印もある）
    const pips = el('span', 'pips');
    for (let i = 0; i < status.maxAp; i++) {
      const cls = i + 1 <= ctx.ap ? 'on' : i < ctx.ap ? 'half' : i < status.ap ? 'spent' : '';
      pips.append(el('i', cls));
    }
    ap.append(pips);
    head.append(title, card, ap);

    const list = el('ul', 'menu-items');
    for (const entry of buildActionMenu(ctx)) list.append(this.item(entry));
    this.body(this.main).replaceChildren(head, list);
  }

  /** 2 階層目だけを閉じる。閉じたものがあれば true */
  closeSub(): boolean {
    if (!this.openItem) return false;
    this.openItem.classList.remove('open');
    this.openItem = null;
    this.sub.hidden = true;
    return true;
  }

  /** 毎フレーム、描画の後に呼ぶ。anchor（ユニットの絵の位置と大きさ）の横へメニューを動かす */
  update(anchor: UnitPlacement | null, camera: THREE.PerspectiveCamera): void {
    if (!this.unit) return;
    const p = anchor;
    const container = this.root.parentElement!;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const sprite = p && spriteRect(p, camera, w, h);
    const offscreen = !sprite || sprite.r < 0 || sprite.l > w || sprite.b < 0 || sprite.t > h;
    this.root.hidden = offscreen || this.suspended;
    if (this.root.hidden || !sprite) return;

    const mw = this.main.offsetWidth;
    const mh = this.main.offsetHeight;
    const sw = this.openItem ? this.sub.offsetWidth + SUB_GAP : 0;
    // 1 階層目は絵の右に入れば右、だめなら左。2 階層目の開け閉めではメニューを動かさない（逃げるように見えるため）
    const onRight = sprite.r + GAP + mw <= w - MARGIN || sprite.l - GAP - mw < MARGIN;
    let x = onRight ? sprite.r + GAP : sprite.l - GAP - mw;
    x = Math.min(Math.max(x, MARGIN), w - MARGIN - mw);
    const y = Math.min(Math.max(sprite.t, MARGIN), h - MARGIN - mh);
    this.root.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;

    if (this.openItem) {
      // 2 階層目は開いた項目の高さにそろえ、外側（絵と反対側）へ開く。画面からはみ出すなら内側へ
      const subRight = onRight ? x + mw + sw <= w - MARGIN : x - sw < MARGIN;
      this.sub.style.left = subRight ? `${mw + SUB_GAP}px` : `${-sw}px`;
      const top = this.openItem.offsetTop - this.body(this.sub).offsetTop;
      this.sub.style.top = `${Math.min(Math.max(top, MARGIN - y), h - MARGIN - y - this.sub.offsetHeight)}px`;
    }
  }

  private item(entry: MenuEntry): HTMLLIElement {
    const li = el('li', 'menu-item');
    li.append(el('span', 'name', entry.name));
    if (entry.action?.cost !== undefined) li.append(cost(entry.action.cost));
    if (entry.action?.id === 'confirm' || entry.action?.id === 'cancel') li.classList.add(entry.action.id);
    if (entry.children) li.append(el('span', 'arrow'));
    if (!entry.enabled) {
      li.classList.add('disabled');
      li.title = entry.reason ?? '';
      return li;
    }
    if (entry.action) {
      const action = entry.action;
      li.addEventListener('pointerenter', () => this.closeSub());
      li.addEventListener('click', () => this.choose(action));
    } else if (entry.children) {
      const children = entry.children;
      li.classList.add('has-sub');
      li.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse') this.openSub(li, children);
      });
      li.addEventListener('click', () => {
        if (this.openItem === li) this.closeSub();
        else this.openSub(li, children);
      });
    }
    return li;
  }

  private openSub(li: HTMLElement, actions: readonly MenuAction[]): void {
    if (this.openItem === li) return;
    this.closeSub();
    this.openItem = li;
    li.classList.add('open');
    const list = el('ul', 'menu-items');
    for (const a of actions) {
      const item = el('li', 'menu-item');
      item.append(el('span', 'name', a.name));
      if (a.cost !== undefined) item.append(cost(a.cost));
      item.addEventListener('click', () => this.choose(a));
      list.append(item);
    }
    this.body(this.sub).replaceChildren(list);
    this.sub.hidden = false;
  }

  private choose(action: MenuAction): void {
    this.closeSub();
    if (this.unit) this.onAction(this.unit, action);
  }

  private body(panel: HTMLElement): HTMLElement {
    return panel.querySelector('.menu-body') as HTMLElement;
  }
}

/** 四隅に飾り罫を置いたパネル */
function framedPanel(kind: string): HTMLDivElement {
  const panel = el('div', `menu-panel ${kind}`);
  for (const c of ['tl', 'tr', 'bl', 'br']) panel.append(el('span', `corner ${c}`));
  panel.append(el('div', 'menu-body'));
  return panel;
}

/** 消費する行動力 */
function cost(n: number): HTMLElement {
  const c = el('span', 'cost', String(n));
  c.title = `行動力 ${n}`;
  return c;
}

/** 画面上のユニットの絵の範囲（足元・頭・幅から求める） */
function spriteRect(p: UnitPlacement, camera: THREE.PerspectiveCamera, w: number, h: number): Rect | null {
  const v = new THREE.Vector3();
  const toScreen = (q: THREE.Vector3) => {
    v.copy(q).project(camera);
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, behind: v.z > 1 };
  };
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const foot = toScreen(p.foot);
  if (foot.behind) return null;
  const head = toScreen(up.multiplyScalar(p.height).add(p.foot));
  const half = toScreen(right.multiplyScalar(p.width / 2).add(p.foot)).x - foot.x;
  return { l: head.x - half, t: head.y, r: head.x + half, b: foot.y };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
