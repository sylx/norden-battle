/**
 * ユニットに重ねる情報札。HTML で画面に重ねるので、カメラの拡大縮小に関係なく同じ大きさで表示される。
 *
 * - 小さい札（.unit-mini）: どのユニットにも常に出す。兵数の数字と、兵数・士気の細いゲージ、状態の色の点だけ。
 *   詳しい札と同じく絵の右上に固定し（自分の HEX に収まる大きさ）、ずらさない・引き出し線も引かない。
 * - 詳しい札（.unit-tag。指揮官の顔・兵士数と士気のグラフ・状態の印）: カーソルの下のユニットにだけ出す。
 *   絵の右上に置き、画面の右端からはみ出すなら左上、上端からはみ出すなら下へずらす。詳しい札を出す間は小さい札を隠す。
 * - Shift を押している間は、全ユニットの詳しい札を出す。札どうしが重なるときは周りの空いている位置へずらし
 *   （なるべく小さなずれで済む位置・ユニットの絵にかぶらない位置・前のフレームと同じ位置を優先）、
 *   ユニットの中心から札へ軍の色の引き出し線を引く（ずれても持ち主が分かるように）。
 * - 選択中のユニットの詳しい札は出さない（部隊のウィンドウに同じ中身を出す。renderStatus を共用する）。小さい札は出す。
 * - 行動済みのユニットは、絵の右上に E の印を付ける（setMarks。絵を暗くするのは BattleApp）。札は暗くしない。
 * - 軍団長の部隊（UnitStatus.commander）は、絵の左上に L（Leader）の印を付ける（どちらの軍も、選択中でも付ける）。
 * - 付いている状態（UnitStatus.conditions。conditions.ts）は、札の右上に 1 文字の印を並べる（部隊のウィンドウの札も同じ）。
 */
import * as THREE from 'three';
import type { Offset } from '@norden/map-runtime/core/hex';
import { TEAM_DEFS, type UnitData } from '@norden/map-runtime/core/units';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import { CONDITION_DEFS } from './conditions';
import { MAX_MORALE, type UnitStatus } from './unitStatus';

/** 詳しい札の大きさ（CSS ピクセル。ui/battle.css の .unit-tags .unit-tag と合わせる） */
const TAG_W = 172;
const TAG_H = 56;
/** 詳しい札の顔の円の直径（枠を除く） */
const TAG_FACE_SIZE = 48;
/** ウィンドウの中の札（StatusCard.tsx。ui/battle.css の .unit-tag）の顔の円の直径（枠を除く） */
const FACE_SIZE = 32;
/**
 * 詳しい札の位置。絵の右上の角（E の印の中心）から、札の左端を右へ離す量（TAG_GAP_X）と、
 * 札の下端を上へ離す量（TAG_GAP_Y）。負なら角を越えて絵の側へ食い込む。
 * 左上に出すとき（画面の右端からはみ出すとき）は左右を反転して、札の右端を絵の左上の角（L の印の中心）から左へ離す
 */
const TAG_GAP_X = -10;
const TAG_GAP_Y = -10;
/** 小さい札の高さ（ui/battle.css の .unit-mini と合わせる） */
const MINI_H = 14;
/** 小さい札の位置。詳しい札と同じく、絵の右上の角（E の印の中心）から札の左端を右へ・下端を上へ離す量（負なら食い込む） */
const MINI_GAP_X = -20;
const MINI_GAP_Y = 0;
/** 札を画面の端から離す量 */
const EDGE = 4;
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
/** E の印の中心を絵の範囲の右上の角から、L の印の中心を左上の角から内側へ寄せる量（絵の幅・高さ比。絵の周りの透明な余白の分） */
const MARK_INSET_X = 0.2;
const MARK_INSET_Y = 0.12;
/** E の印だけを、絵の右上の角からさらにずらす量（CSS ピクセル。右・下が正）。小さい札にかぶらないよう左下へ。札の位置の基準（角）は動かさない */
const END_MARK_DX = -6;
const END_MARK_DY = 14;
/** 画面外のユニットの札は出さない（この余白まで） */
const OFFSCREEN_MARGIN = 80;
/** 士気がこれ未満なら低い色にする */
const LOW_MORALE = 30;
/** 兵数がこれ以下なら赤くする */
const LOW_SOLDIERS = 100;

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
  /** 詳しい札 */
  el: HTMLDivElement;
  /** 小さい札 */
  mini: HTMLDivElement;
  line: SVGLineElement;
  dot: SVGCircleElement;
  /** 行動済みの E の印（絵の右上） */
  mark: HTMLDivElement;
  /** 軍団長の L の印（絵の左上） */
  lead: HTMLDivElement;
  /** 前のフレームで選んだ候補（-1 は未表示） */
  slot: number;
  /** 表示中の値（変わったときだけ DOM を書き換える） */
  shown: string;
  miniShown: string;
}

/** 全ユニットの詳しい札を出すときの候補の位置（既定の位置＝絵の右上からのずれ）。既定の位置が先頭 */
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
  private done: ReadonlySet<UnitData> = new Set();
  /** Shift を押している間は全ユニットの詳しい札を出す */
  private showAll = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'unit-tags';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('unit-tag-lines');
    this.root.appendChild(this.svg);
    container.appendChild(this.root);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    this.tags.clear();
    this.root.remove();
  }

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Shift') this.showAll = e.type === 'keydown';
  };

  /** ウィンドウを離れたら Shift を離したことにする（keyup を受け取れないので） */
  private readonly onBlur = () => {
    this.showAll = false;
  };

  /** 表示するユニットの状態を入れ替える（マップを読み込んだとき） */
  setStatuses(statuses: Map<UnitData, UnitStatus>): void {
    this.statuses = statuses;
    for (const tag of this.tags.values()) this.removeTag(tag);
    this.tags.clear();
  }

  /** 行動済みのユニット（E の印を付ける）を決める */
  setMarks(done: ReadonlySet<UnitData>): void {
    this.done = done;
  }

  /**
   * 毎フレーム、描画の後に呼ぶ。placements はユニットの画像の位置、
   * hover の HEX のユニットには詳しい札を出す（Shift で全ユニットに出すときは強調して一番手前に出す）。
   * selected の HEX のユニットには詳しい札を出さない（小さい札は出す）。
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
    const items: { tag: Tag; base: Point; sprite: Rect; priority: number }[] = [];
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
      // E の印は選択中のユニットにも付ける（絵に付いていく）
      const done = !off && this.done.has(p.unit);
      tag.mark.hidden = !done;
      const my = sprite.t + (sprite.b - sprite.t) * MARK_INSET_Y;
      if (done) {
        const mx = sprite.r - (sprite.r - sprite.l) * MARK_INSET_X + END_MARK_DX;
        tag.mark.style.transform = `translate(${mx.toFixed(1)}px, ${(my + END_MARK_DY).toFixed(1)}px) translate(-50%, -50%)`;
      }
      const lead = !off && !!status.commander;
      tag.lead.hidden = !lead;
      if (lead) {
        const lx = sprite.l + (sprite.r - sprite.l) * MARK_INSET_X;
        tag.lead.style.transform = `translate(${lx.toFixed(1)}px, ${my.toFixed(1)}px) translate(-50%, -50%)`;
      }
      if (off) {
        this.hideTag(tag);
        tag.mini.hidden = true;
        continue;
      }
      // 詳しい札はカーソルの下のユニット（Shift を押している間は全ユニット）に出す。
      // 選択中のユニットは部隊のウィンドウに中身を出し、行動メニューも添えるので出さない（絵の範囲はほかの札が避けるよう残す）
      const hovered = isAt(p.unit, hover);
      if (isAt(p.unit, selected) || !(hovered || this.showAll)) {
        this.hideTag(tag);
        this.renderMini(tag, status);
        // 絵の右上の角（E の印の中心）の右上
        const nx = sprite.r - (sprite.r - sprite.l) * MARK_INSET_X + MINI_GAP_X;
        const ny = my - MINI_GAP_Y - MINI_H;
        tag.mini.style.transform = `translate(${nx.toFixed(1)}px, ${ny.toFixed(1)}px)`;
        tag.mini.hidden = false;
        continue;
      }
      tag.mini.hidden = true;
      this.render(tag, status, hovered && this.showAll);
      // 既定の位置: 絵の右上の角（E の印の中心）の右上。右端からはみ出すなら左上（L の印の中心の左上）
      const sw = sprite.r - sprite.l;
      let l = sprite.r - sw * MARK_INSET_X + TAG_GAP_X;
      if (l + TAG_W > w - EDGE) l = sprite.l + sw * MARK_INSET_X - TAG_GAP_X - TAG_W;
      const base = { x: l, y: my - TAG_GAP_Y - TAG_H };
      // 強調するもの → 手前（画面の下）のユニットの順に、良い位置を先に取る
      const priority = (hovered ? 1e6 : 0) + foot.y;
      items.push({ tag, base, sprite, priority });
    }

    // カーソルの下の 1 枚だけなら、既定の位置を画面に収めて置く（ずらさない・引き出し線も引かない）
    if (!this.showAll) {
      for (const { tag, base, sprite } of items) {
        let t = base.y;
        // 上端からはみ出すなら、絵の下（足元の下）へ
        if (t < EDGE) t = Math.min(sprite.b + 2, h - EDGE - TAG_H);
        const l = Math.min(Math.max(base.x, EDGE), w - EDGE - TAG_W);
        this.showTag(tag, { l, t, r: l + TAG_W, b: t + TAG_H }, 1);
        tag.line.style.display = tag.dot.style.display = 'none';
      }
      return;
    }

    items.sort((a, b) => b.priority - a.priority);
    const placed: Rect[] = [];
    items.forEach(({ tag, base, sprite }, order) => {
      let best = 0;
      let bestCost = Infinity;
      SLOTS.forEach((slot, s) => {
        const rect = tagRect(base, slot);
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
      const rect = tagRect(base, SLOTS[best]);
      placed.push(rect);
      // 優先度の高いもの（先に置いたもの）ほど手前
      this.showTag(tag, rect, items.length - order);

      // 引き出し線: ユニットの中心から札のいちばん近い点へ
      const center = { x: (sprite.l + sprite.r) / 2, y: (sprite.t + sprite.b) / 2 };
      const end = nearestOnRect(rect, center);
      setAttrs(tag.line, { x1: center.x, y1: center.y, x2: end.x, y2: end.y });
      setAttrs(tag.dot, { cx: center.x, cy: center.y });
      tag.line.style.display = tag.dot.style.display = '';
    });
  }

  private showTag(tag: Tag, rect: Rect, z: number): void {
    tag.el.style.transform = `translate(${rect.l.toFixed(1)}px, ${rect.t.toFixed(1)}px)`;
    // 小さい札（z-index 0）より手前
    tag.el.style.zIndex = String(z);
    tag.el.hidden = false;
  }

  private tagFor(unit: UnitData): Tag {
    let tag = this.tags.get(unit);
    if (tag) return tag;
    const color = TEAM_DEFS[unit.team].color;
    const el = document.createElement('div');
    el.className = 'unit-tag';
    el.style.setProperty('--team', color);
    el.innerHTML = STATUS_HTML;
    el.hidden = true;
    const mini = document.createElement('div');
    mini.className = 'unit-mini';
    mini.style.setProperty('--team', color);
    mini.innerHTML = MINI_HTML;
    mini.hidden = true;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    line.setAttribute('stroke', color);
    dot.setAttribute('fill', color);
    dot.setAttribute('r', '2.5');
    this.svg.append(line, dot);
    const mark = document.createElement('div');
    mark.className = 'unit-end-mark';
    mark.textContent = 'E';
    mark.hidden = true;
    const lead = document.createElement('div');
    lead.className = 'unit-lead-mark';
    lead.textContent = 'L';
    lead.title = '軍団長';
    lead.hidden = true;
    this.root.append(mini, el, mark, lead);
    tag = {
      unit,
      el,
      mini,
      line,
      dot,
      mark,
      lead,
      slot: -1,
      shown: '',
      miniShown: '',
    };
    this.tags.set(unit, tag);
    return tag;
  }

  private render(tag: Tag, s: UnitStatus, active: boolean): void {
    const key = `${s.soldiers}/${s.initialSoldiers}/${s.morale}/${s.portrait?.url ?? ''}/${active}/${s.conditions.map((c) => c.id).join(',')}`;
    if (key === tag.shown) return;
    tag.shown = key;
    tag.el.classList.toggle('active', active);
    tag.line.classList.toggle('active', active);
    renderStatus(tag.el, s, TAG_FACE_SIZE);
  }

  private renderMini(tag: Tag, s: UnitStatus): void {
    const key = `${s.soldiers}/${s.initialSoldiers}/${s.morale}/${s.conditions.map((c) => c.id).join(',')}`;
    if (key === tag.miniShown) return;
    tag.miniShown = key;
    const el = tag.mini;
    const q = (sel: string) => el.querySelector(sel) as HTMLElement;
    q('.n').textContent = String(s.soldiers);
    q('.soldiers > b').style.width = `${(100 * clamp01(s.soldiers / s.initialSoldiers)).toFixed(1)}%`;
    q('.morale > b').style.width = `${(100 * clamp01(s.morale / MAX_MORALE)).toFixed(1)}%`;
    el.classList.toggle('low-morale', s.morale < LOW_MORALE);
    el.classList.toggle('low-soldiers', s.soldiers <= LOW_SOLDIERS);
    q('.cdots').replaceChildren(
      ...s.conditions.map((c) => {
        const dot = document.createElement('i');
        dot.style.setProperty('--cond', CONDITION_DEFS[c.id].color);
        return dot;
      }),
    );
  }

  private hideTag(tag: Tag): void {
    tag.el.hidden = true;
    tag.line.style.display = tag.dot.style.display = 'none';
    tag.slot = -1;
  }

  private removeTag(tag: Tag): void {
    tag.el.remove();
    tag.mini.remove();
    tag.mark.remove();
    tag.lead.remove();
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
  </div>
  <div class="conds"></div>`;

/** 小さい札の中身（兵数の数字・兵数と士気の細いゲージ・状態の色の点） */
const MINI_HTML = `
  <span class="n"></span>
  <span class="gauges"><span class="g soldiers"><b></b></span><span class="g morale"><b></b></span></span>
  <span class="cdots"></span>`;

/** STATUS_HTML を入れた要素に値を入れる。faceSize は顔の円の直径（枠を除く。CSS の .face と合わせる） */
export function renderStatus(el: HTMLElement, s: UnitStatus, faceSize = FACE_SIZE): void {
  const q = (sel: string) => el.querySelector(sel) as HTMLElement;
  // 人の兵ではない部隊（ドラゴンなど）は兵数を HP と呼ぶ
  q('.soldiers .label').textContent = s.monster ? 'HP' : '兵数';
  q('.soldiers .value').textContent = String(s.soldiers);
  // 兵数のゲージは戦闘が始まったときの兵数を満タンにする
  q('.soldiers .fill').style.width = `${(100 * clamp01(s.soldiers / s.initialSoldiers)).toFixed(1)}%`;
  q('.morale .value').textContent = String(s.morale);
  q('.morale .fill').style.width = `${(100 * clamp01(s.morale / MAX_MORALE)).toFixed(1)}%`;
  el.classList.toggle('low-morale', s.morale < LOW_MORALE);
  el.classList.toggle('low-soldiers', s.soldiers <= LOW_SOLDIERS);
  setFace(q('.face'), s, faceSize);
  const conds = q('.conds');
  conds.replaceChildren(
    ...s.conditions.map((c) => {
      const def = CONDITION_DEFS[c.id];
      const mark = document.createElement('span');
      mark.className = 'cond';
      mark.textContent = def.mark;
      mark.title = `${def.name}（あと ${c.turns} ターン）`;
      mark.style.setProperty('--cond', def.color);
      return mark;
    }),
  );
}

/** el の背景に指揮官の顔を入れる。portrait の範囲の短い辺を size に合わせ、真ん中を円に収める。portrait が無ければ顔を出さない */
export function setFace(el: HTMLElement, { portrait }: Pick<UnitStatus, 'portrait'>, size: number): void {
  if (!portrait) {
    el.style.backgroundImage = '';
    return;
  }
  const { url, width, height, rect } = portrait;
  const scale = size / Math.min(rect.width, rect.height);
  const x = (rect.x + rect.width / 2) * scale - size / 2;
  const y = (rect.y + rect.height / 2) * scale - size / 2;
  el.style.backgroundImage = `url("${url}")`;
  el.style.backgroundSize = `${width * scale}px ${height * scale}px`;
  el.style.backgroundPosition = `${-x}px ${-y}px`;
}

/** 候補の位置に置いたときの札の範囲（base は既定の位置の左上） */
function tagRect(base: Point, slot: { dx: number; dy: number }): Rect {
  const l = base.x + slot.dx;
  const t = base.y + slot.dy;
  return { l, t, r: l + TAG_W, b: t + TAG_H };
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
