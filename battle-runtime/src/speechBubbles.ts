/**
 * ユニットのセリフの吹き出し（barks.ts）。HTML で画面に重ねる。
 *
 * - 吹き出しはユニットの頭の上に、しっぽを頭へ向けて出す。本体は相手と反対の側へずらす（相手の頭上の数字とかぶらないように）。
 * - ユニットの絵の動き（踏み込み・カメラの寄り）に毎フレーム付いていく。ユニットが消えた後は最後の位置に残る（殲滅されたときの言葉）。
 * - 中身は指揮官の顔とセリフ。セリフは 1 字ずつ出す（大きさは最初から全文の分にして、出している間に吹き出しが伸びないようにする）。
 * - 調子（BarkTone）で見た目を変える。shout: 太く大きな字で弾んで出る、calm: 普通、weak: くすんだ吹き出しでゆっくり出る。
 * - 吹き出しどうしが重なるときは、後から出たものを上へずらす（しっぽを伸ばしてユニットにつなぐ）。
 * - 同じユニットが続けて喋ったときは、前の吹き出しを消して入れ替える。
 */
import * as THREE from 'three';
import { TEAM_DEFS, type UnitData } from '@norden/map-runtime/core/units';
import type { UnitPlacement } from '@norden/map-runtime/render/units';
import type { BarkTone } from './barks';
import { setFace } from './unitTags';
import type { UnitStatus } from './unitStatus';

/** 1 秒に出す字数 */
const TYPE_CPS: Record<BarkTone, number> = { shout: 30, calm: 24, weak: 12 };
/** 全文を出してから、読み終えたとみなす（次の演出へ進んでよい）までの時間（秒） */
const READ_BEAT_SEC = 0.45;
/** 全文を出してから消え始めるまでの時間（秒）。最低限の時間と、1 字あたりに足す時間 */
const HOLD_SEC = 1.2;
const HOLD_PER_CHAR_SEC = 0.05;
/** 消える時間（秒。ui/battle.css の bark-out と合わせる） */
const FADE_SEC = 0.3;
/** しっぽの長さ・しっぽを付ける位置（本体の端から）・頭との間（CSS ピクセル） */
const TAIL_H = 14;
const TAIL_INSET = 26;
const HEAD_GAP = 2;
/** ユニットの絵の高さのうち、頭の位置（絵の上の透明な余白の分だけ下げる） */
const HEAD_RATIO = 0.88;
/** 重なりを避けるときの吹き出しどうしの間と、画面の端との間（CSS ピクセル） */
const GAP = 4;
const MARGIN = 8;
/** 顔の円の直径（枠を除く。ui/battle.css の .bark-face と合わせる） */
const FACE_SIZE = 30;

export interface SayOptions {
  /** 何秒後に出すか */
  delay?: number;
  tone?: BarkTone;
  /** 相手（吹き出しの本体をこのユニットと反対の側へずらす。いなければ右） */
  away?: UnitData | null;
}

interface Bubble {
  unit: UnitData;
  el: HTMLDivElement;
  shown: HTMLSpanElement;
  rest: HTMLSpanElement;
  chars: string[];
  tone: BarkTone;
  away: UnitData | null;
  /** 出す時刻（ms） */
  start: number;
  /** 出してから消えるまで（秒） */
  total: number;
  /** 最後に見えたユニットの足元と絵の高さ（ユニットが消えた後はここに残す） */
  foot: THREE.Vector3 | null;
  height: number;
  /** 本体を頭のどちら側に出すか（出すときに決める） */
  side: 'left' | 'right' | null;
  /** 本体の大きさ（出すときに測る） */
  w: number;
  h: number;
  /** 出している字数 */
  typed: number;
}

export class SpeechBubbles {
  private readonly root: HTMLDivElement;
  private items: Bubble[] = [];

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'barks';
    container.appendChild(this.root);
  }

  /**
   * unit の頭上に text を出す（status は喋る部隊の状態。指揮官の顔を出す）。
   * 戻り値は、今から読み終えるまでの秒数（全文を出し終えて少し間を置くまで。次の演出をこの後にする）
   */
  say(unit: UnitData, status: UnitStatus, text: string, { delay = 0, tone = 'calm', away = null }: SayOptions = {}): number {
    for (const b of this.items.filter((x) => x.unit === unit)) this.remove(b);
    const el = document.createElement('div');
    el.className = `bark ${tone}`;
    el.hidden = true;
    el.style.setProperty('--team', TEAM_DEFS[unit.team].color);
    el.innerHTML = `
      <div class="bark-pop">
        <div class="bark-body"><div class="bark-face"></div><p class="bark-text"><span class="shown"></span><span class="rest"></span></p></div>
        <div class="bark-tail"></div>
      </div>`;
    setFace(el.querySelector('.bark-face') as HTMLElement, status, FACE_SIZE);
    const chars = [...text];
    const rest = el.querySelector('.rest') as HTMLSpanElement;
    rest.textContent = text;
    this.root.appendChild(el);
    const typeSec = chars.length / TYPE_CPS[tone];
    this.items.push({
      unit,
      el,
      shown: el.querySelector('.shown') as HTMLSpanElement,
      rest,
      chars,
      tone,
      away,
      start: performance.now() + delay * 1000,
      total: typeSec + HOLD_SEC + HOLD_PER_CHAR_SEC * chars.length + FADE_SEC,
      foot: null,
      height: 0,
      side: null,
      w: 0,
      h: 0,
      typed: -1,
    });
    return delay + typeSec + READ_BEAT_SEC;
  }

  /** 毎フレーム、描画の後に呼ぶ。placements はユニットの画像の位置 */
  update(placements: readonly UnitPlacement[], camera: THREE.PerspectiveCamera, visible: boolean): void {
    this.root.hidden = !visible;
    if (this.items.length === 0 || !visible) return;
    const now = performance.now();
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const v = new THREE.Vector3();
    const toScreen = (foot: THREE.Vector3, height: number) => {
      v.copy(up).multiplyScalar(height).add(foot).project(camera);
      return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
    };
    const placed: { l: number; t: number; r: number; b: number }[] = [];
    // 先に出たものから置く（後から出たものがずれる）
    this.items.sort((a, b) => a.start - b.start);
    this.items = this.items.filter((b) => {
      const t = (now - b.start) / 1000;
      if (t >= b.total) {
        b.el.remove();
        return false;
      }
      if (t < 0) return true;
      const p = placements.find((x) => x.unit === b.unit);
      if (p) {
        b.foot = (b.foot ?? new THREE.Vector3()).copy(p.foot);
        b.height = p.height;
      }
      if (!b.foot) return true;
      if (b.el.hidden) this.show(b, placements, toScreen);

      const typed = Math.min(b.chars.length, Math.floor(t * TYPE_CPS[b.tone]) + 1);
      if (typed !== b.typed) {
        b.typed = typed;
        b.shown.textContent = b.chars.slice(0, typed).join('');
        b.rest.textContent = b.chars.slice(typed).join('');
      }
      b.el.classList.toggle('out', t >= b.total - FADE_SEC);

      // しっぽの先を頭に置き、本体を頭の左か右へずらす。ほかの吹き出しと重なれば上へ逃がす
      const head = toScreen(b.foot, b.height * HEAD_RATIO);
      const ax = head.x;
      const ay = head.y - HEAD_GAP;
      let l = b.side === 'left' ? ax - b.w + TAIL_INSET : ax - TAIL_INSET;
      l = Math.min(Math.max(l, MARGIN), W - b.w - MARGIN);
      let top = ay - TAIL_H - b.h;
      for (let moved = true, n = 0; moved && n < 8; n++) {
        moved = false;
        for (const r of placed) {
          if (l < r.r + GAP && l + b.w > r.l - GAP && top < r.b + GAP && top + b.h > r.t - GAP) {
            top = r.t - GAP - b.h;
            moved = true;
          }
        }
      }
      top = Math.max(top, MARGIN);
      placed.push({ l, t: top, r: l + b.w, b: top + b.h });
      const tailX = Math.min(Math.max(ax - l, 14), b.w - 14);
      const tailH = Math.max(0, ay - (top + b.h));
      b.el.style.transform = `translate(${l.toFixed(1)}px, ${top.toFixed(1)}px)`;
      b.el.style.setProperty('--tail-x', `${tailX.toFixed(1)}px`);
      b.el.style.setProperty('--tail-h', `${tailH.toFixed(1)}px`);
      return true;
    });
  }

  /** 出し始める。大きさを測り、本体を頭のどちら側に出すかを決める（相手が右にいれば左） */
  private show(b: Bubble, placements: readonly UnitPlacement[], toScreen: (foot: THREE.Vector3, height: number) => { x: number }): void {
    b.el.hidden = false;
    b.w = b.el.offsetWidth;
    b.h = b.el.offsetHeight;
    const other = b.away && placements.find((x) => x.unit === b.away);
    b.side = other && toScreen(other.foot, 0).x > toScreen(b.foot!, 0).x ? 'left' : 'right';
    b.el.classList.add(b.side);
  }

  clear(): void {
    for (const b of this.items) b.el.remove();
    this.items = [];
  }

  dispose(): void {
    this.clear();
    this.root.remove();
  }

  private remove(b: Bubble): void {
    b.el.remove();
    this.items = this.items.filter((x) => x !== b);
  }
}
