/**
 * カーソルの HEX の地形を出すウィンドウ（画面の左下、ステータス行の上）。ゲームの画面で使う。
 *
 * - 地形の名前と色、人工物、座標、標高、入るのに使う行動力、街道を出す。
 * - 移動先・攻撃の相手を選んでいる間は、その HEX への移動・攻撃の予測を下に足す（ui.ts から渡す）。
 * - カーソルがマップの外にあるときは隠す。
 * - 戦闘ログと同じ飾り罫の枠（frame.ts）に題名の札を載せる。表示するだけなので、マウスは下のマップへ通す。
 */
import { FEATURE_DEFS } from '@norden/map-runtime/core/features';
import type { HexCell } from '@norden/map-runtime/core/mapData';
import { TERRAIN_DEFS } from '@norden/map-runtime/core/terrainTypes';
import { addFrame } from './frame';
import { cellMoveCost } from './movement';

/** 予測などの行。[見出し, 中身の HTML] */
export type InfoRow = readonly [string, string];

export class TerrainInfo {
  private readonly root: HTMLElement;
  private readonly swatch: HTMLElement;
  private readonly name: HTMLElement;
  private readonly feature: HTMLElement;
  private readonly coord: HTMLElement;
  private readonly stats: HTMLDListElement;
  private readonly extra: HTMLDListElement;

  constructor(parent: HTMLElement) {
    this.root = el('section', 'game-window terrain-info');
    addFrame(this.root);
    const head = el('div', 'terrain-head');
    this.swatch = el('i', 'terrain-swatch');
    this.name = el('span', 'terrain-name');
    this.feature = el('span', 'terrain-feature');
    this.coord = el('span', 'terrain-coord');
    head.append(this.swatch, this.name, this.feature, this.coord);
    this.stats = el('dl', 'terrain-stats');
    this.extra = el('dl', 'terrain-extra');
    this.root.append(el('h2', 'window-title', '地形'), head, this.stats, this.extra);
    parent.append(this.root);
    this.show(null);
  }

  show(cell: HexCell | null, extra: readonly InfoRow[] = []): void {
    this.root.hidden = !cell;
    if (!cell) return;
    const terrain = TERRAIN_DEFS[cell.terrain];
    const [r, g, b] = terrain.color.map((v) => Math.round(v * 255));
    this.swatch.style.background = `rgb(${r}, ${g}, ${b})`;
    this.name.textContent = terrain.name;
    this.feature.textContent = cell.feature ? FEATURE_DEFS[cell.feature].name : '';
    this.feature.hidden = !cell.feature;
    this.coord.textContent = `(${cell.col}, ${cell.row})`;

    const cost = cellMoveCost(cell);
    setRows(this.stats, [
      ['標高', `Lv ${cell.elevation}`],
      ['移動', cost === null ? '<span class="blocked">通れない</span>' : `行動力 <b>${cost}</b>`],
      ['街道', cell.roads?.length ? `${cell.roads.length} 方向（沿って入ると行動力が半分）` : '<span class="none">なし</span>'],
    ]);
    setRows(this.extra, extra);
    this.extra.hidden = extra.length === 0;
  }
}

function setRows(dl: HTMLDListElement, rows: readonly InfoRow[]): void {
  dl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
