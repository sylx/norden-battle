/**
 * ユニットに重ねる情報札（指揮官の顔・兵士数と士気のグラフ）。
 *
 * - HTML で画面に重ねるので、カメラの拡大縮小に関係なく同じ大きさで表示される。
 * - 札はユニットの足元に置く（札の縁と顔の枠は軍の色）。
 * - 札どうしが重なるときは、周りの空いている位置へずらす（画面上の位置を毎フレーム決め直す）。
 *   なるべく小さなずれで済む位置・ユニットの絵にかぶらない位置・前のフレームと同じ位置を優先して、
 *   カメラを動かしてもちらつかないようにする。
 * - どの札も、ユニットの中心から札へ軍の色の引き出し線を引く（ずれても持ち主が分かるように）。
 * - 選択中のユニットの札は出さない（行動メニューの上に同じ中身を出す。renderStatus を共用する）。
 */
import * as THREE from 'three';
import type { Offset } from '@norden/map-runtime/core/hex';
import { TEAM_DEFS, type UnitData } from '@norden/map-runtime/core/units';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { FACE_GRID, FACE_SHEET_URL, MAX_MORALE, type UnitStatus } from './unitStatus';

/** 札の大きさ（CSS ピクセル。ui/battle.css の .unit-tag と合わせる） */
const TAG_W = 124;
const TAG_H = 40;
/** 顔の円の直径（枠を除く） */
const FACE_SIZE = 32;
/** 顔を円に切り抜くときの拡大率（顔画像の縁の余白を落とす） */
const FACE_ZOOM = 1.15;
/** 既定の位置での、足元から札の上端までの距離（負なら札の上端が足元より上で、足に少しかかる） */
const FOOT_OFFSET = -8;
/** 札の位置の候補の間隔と範囲（既定の位置から左右・上下に何段ずらすか）。細かく刻んで小さなずれで済ませる */
const STEP_X = TAG_W / 4;
const STEP_Y = TAG_H / 2;
const RANGE_X = 4;
const RANGE_UP = 4;
const RANGE_DOWN = 3;
/** 位置を決めるときの重み */
const COST_TAG_OVERLAP = 40; // 札どうしの重なり（面積あたり）。実質的に禁止
const COST_OWN_OVERLAP = 0.6; // 自分の絵へのかぶり（面積あたり）
const COST_SPRITE_OVERLAP = 0.25; // ほかのユニットの絵へのかぶり（面積あたり）
const COST_OFFSCREEN = 4; // 画面外にはみ出す面積あたり
const COST_DISTANCE = 2; // 既定の位置からの距離あたり
const BONUS_KEEP = 120; // 前のフレームと同じ候補
/** 画面外のユニットの札は出さない（この余白まで） */
const OFFSCREEN_MARGIN = 80;
/** 士気がこれ未満なら低い色にする */
const LOW_MORALE = 30;

interface Point {
  x: number;
  y: number;
}

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

interface Tag {
  unit: UnitData;
  el: HTMLDivElement;
  line: SVGLineElement;
  dot: SVGCircleElement;
  /** 前のフレームで選んだ候補（-1 は未表示） */
  slot: number;
  /** 表示中の値（変わったときだけ DOM を書き換える） */
  shown: string;
}

/** 候補の位置（既定の位置＝札の上端中央が足元から FOOT_OFFSET の位置からのずれ）。既定の位置が先頭 */
const SLOTS: { dx: number; dy: number; dist: number }[] = (() => {
  const out: { dx: number; dy: number; dist: number }[] = [];
  for (let j = -RANGE_UP; j <= RANGE_DOWN; j++) {
    for (let i = -RANGE_X; i <= RANGE_X; i++) {
      const dx = i * STEP_X;
      const dy = j * STEP_Y;
      out.push({ dx, dy, dist: Math.hypot(dx, dy) });
    }
  }
  return out.sort((a, b) => a.dist - b.dist);
})();

export class UnitTags {
  private readonly root: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly tags = new Map<UnitData, Tag>();
  private statuses = new Map<UnitData, UnitStatus>();

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'unit-tags';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('unit-tag-lines');
    this.root.appendChild(this.svg);
    container.appendChild(this.root);
  }

  dispose(): void {
    this.tags.clear();
    this.root.remove();
  }

  /** 表示するユニットの状態を入れ替える（マップを読み込んだとき） */
  setStatuses(statuses: Map<UnitData, UnitStatus>): void {
    this.statuses = statuses;
    for (const tag of this.tags.values()) this.removeTag(tag);
    this.tags.clear();
  }

  /**
   * 毎フレーム、描画の後に呼ぶ。placements はユニットの画像の位置、
   * hover の HEX のユニットの札は強調して一番手前に出す。selected の HEX のユニットの札は出さない。
   */
  update(
    placements: readonly UnitPlacement[],
    camera: THREE.PerspectiveCamera,
    visible: boolean,
    hover: Offset | null,
    selected: Offset | null,
  ): void {
    this.root.hidden = !visible;
    if (!visible) return;
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    const screen: Rect = { l: 0, t: 0, r: w, b: h };
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const v = new THREE.Vector3();
    const toScreen = (p: THREE.Vector3) => {
      v.copy(p).project(camera);
      return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, behind: v.z > 1 };
    };

    // ユニットの足元と、画面上の絵の範囲
    const items: { tag: Tag; foot: Point; sprite: Rect; priority: number }[] = [];
    const sprites: Rect[] = [];
    const isAt = (u: UnitData, o: Offset | null) => !!o && o.col === u.col && o.row === u.row;
    for (const p of placements) {
      const status = this.statuses.get(p.unit);
      if (!status) continue;
      const foot = toScreen(p.foot);
      const head = toScreen(v.copy(up).multiplyScalar(p.height).add(p.foot));
      const half = toScreen(v.copy(right).multiplyScalar(p.width / 2).add(p.foot)).x - foot.x;
      const sprite = { l: head.x - half, t: head.y, r: head.x + half, b: foot.y };
      sprites.push(sprite);
      const tag = this.tagFor(p.unit);
      const off =
        foot.behind ||
        head.x < -OFFSCREEN_MARGIN ||
        head.x > w + OFFSCREEN_MARGIN ||
        head.y < -OFFSCREEN_MARGIN ||
        foot.y > h + OFFSCREEN_MARGIN;
      // 選択中のユニットは行動メニューに中身を出すので札は消す（絵の範囲はほかの札が避けるよう残す）
      if (off || isAt(p.unit, selected)) {
        this.hideTag(tag);
        continue;
      }
      this.render(tag, status, isAt(p.unit, hover));
      // 強調するもの → 手前（画面の下）のユニットの順に、良い位置を先に取る
      const priority = (isAt(p.unit, hover) ? 1e6 : 0) + foot.y;
      items.push({ tag, foot, sprite, priority });
    }
    items.sort((a, b) => b.priority - a.priority);

    const placed: Rect[] = [];
    items.forEach(({ tag, foot, sprite }, order) => {
      let best = 0;
      let bestCost = Infinity;
      SLOTS.forEach((slot, s) => {
        const rect = tagRect(foot, slot);
        let cost = slot.dist * COST_DISTANCE - (s === tag.slot ? BONUS_KEEP : 0);
        if (cost >= bestCost) return;
        for (const p of placed) cost += overlap(rect, p) * COST_TAG_OVERLAP;
        for (const sp of sprites) cost += overlap(rect, sp) * (sp === sprite ? COST_OWN_OVERLAP : COST_SPRITE_OVERLAP);
        cost += (area(rect) - overlap(rect, screen)) * COST_OFFSCREEN;
        if (cost < bestCost) {
          bestCost = cost;
          best = s;
        }
      });
      tag.slot = best;
      const rect = tagRect(foot, SLOTS[best]);
      placed.push(rect);
      tag.el.style.transform = `translate(${rect.l}px, ${rect.t}px)`;
      // 優先度の高いもの（先に置いたもの）ほど手前
      tag.el.style.zIndex = String(items.length - order);
      tag.el.hidden = false;

      // 引き出し線: ユニットの中心から札のいちばん近い点へ
      const center = { x: (sprite.l + sprite.r) / 2, y: (sprite.t + sprite.b) / 2 };
      const end = nearestOnRect(rect, center);
      setAttrs(tag.line, { x1: center.x, y1: center.y, x2: end.x, y2: end.y });
      setAttrs(tag.dot, { cx: center.x, cy: center.y });
      tag.line.style.display = tag.dot.style.display = '';
    });
  }

  private tagFor(unit: UnitData): Tag {
    let tag = this.tags.get(unit);
    if (tag) return tag;
    const color = TEAM_DEFS[unit.team].color;
    const el = document.createElement('div');
    el.className = 'unit-tag';
    el.style.setProperty('--team', color);
    el.innerHTML = STATUS_HTML;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    line.setAttribute('stroke', color);
    dot.setAttribute('fill', color);
    dot.setAttribute('r', '2.5');
    this.svg.append(line, dot);
    this.root.appendChild(el);
    tag = {
      unit,
      el,
      line,
      dot,
      slot: -1,
      shown: '',
    };
    this.tags.set(unit, tag);
    return tag;
  }

  private render(tag: Tag, s: UnitStatus, active: boolean): void {
    const key = `${s.soldiers}/${s.maxSoldiers}/${s.morale}/${s.face}/${active}`;
    if (key === tag.shown) return;
    tag.shown = key;
    tag.el.classList.toggle('active', active);
    tag.line.classList.toggle('active', active);
    renderStatus(tag.el, s);
  }

  private hideTag(tag: Tag): void {
    tag.el.hidden = true;
    tag.line.style.display = tag.dot.style.display = 'none';
    tag.slot = -1;
  }

  private removeTag(tag: Tag): void {
    tag.el.remove();
    tag.line.remove();
    tag.dot.remove();
  }
}

/** 札の中身（顔・兵士数と士気のグラフ）。renderStatus で値を入れる。外側の要素に .unit-tag と --team（軍の色）を付けて使う */
export const STATUS_HTML = `
  <div class="face"></div>
  <div class="bars">
    <div class="bar soldiers"><span class="label">兵数</span><span class="value"></span><div class="track"><div class="fill"></div></div></div>
    <div class="bar morale"><span class="label">士気</span><span class="value"></span><div class="track"><div class="fill"></div></div></div>
  </div>`;

/** STATUS_HTML を入れた要素に値を入れる */
export function renderStatus(el: HTMLElement, s: UnitStatus): void {
  const q = (sel: string) => el.querySelector(sel) as HTMLElement;
  q('.soldiers .value').textContent = String(s.soldiers);
  q('.soldiers .fill').style.width = `${(100 * clamp01(s.soldiers / s.maxSoldiers)).toFixed(1)}%`;
  q('.morale .value').textContent = String(s.morale);
  q('.morale .fill').style.width = `${(100 * clamp01(s.morale / MAX_MORALE)).toFixed(1)}%`;
  el.classList.toggle('low-morale', s.morale < LOW_MORALE);

  // 顔: 並べた画像のうち 1 枚を、少し拡大して円の中に収める
  const face = q('.face');
  const cell = FACE_SIZE * FACE_ZOOM;
  const margin = (cell - FACE_SIZE) / 2;
  const col = s.face % FACE_GRID;
  const row = Math.floor(s.face / FACE_GRID);
  face.style.backgroundImage = `url("${FACE_SHEET_URL}")`;
  face.style.backgroundSize = `${cell * FACE_GRID}px ${cell * FACE_GRID}px`;
  face.style.backgroundPosition = `${-(col * cell + margin)}px ${-(row * cell + margin)}px`;
}

/** 候補の位置に置いたときの札の範囲 */
function tagRect(foot: Point, slot: { dx: number; dy: number }): Rect {
  const cx = foot.x + slot.dx;
  const t = foot.y + FOOT_OFFSET + slot.dy;
  return { l: cx - TAG_W / 2, t, r: cx + TAG_W / 2, b: t + TAG_H };
}

/** 札の上でいちばん近い点（角の丸みの分だけ内側に寄せる） */
function nearestOnRect(r: Rect, p: Point): Point {
  return { x: Math.min(Math.max(p.x, r.l + 6), r.r - 6), y: Math.min(Math.max(p.y, r.t), r.b) };
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 0 && h > 0 ? w * h : 0;
}

function area(r: Rect): number {
  return (r.r - r.l) * (r.b - r.t);
}

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}

function setAttrs(el: SVGElement, attrs: Record<string, number>): void {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v.toFixed(1));
}
