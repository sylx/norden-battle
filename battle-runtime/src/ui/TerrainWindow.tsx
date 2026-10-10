/**
 * カーソルの HEX の地形を出すウィンドウ（画面の左下、ステータス行の上）。
 *
 * - 地形の名前と色、人工物、座標、標高、入るのに使う行動力、街道を出す。
 * - 移動先・攻撃の相手を選んでいる間は、その HEX への移動・攻撃の予測を下に足す。
 * - カーソルがマップの外にあるときは隠す。
 * - norden-ui の細いベゼル（ThinFrame）の枠に題名の札を載せる。表示するだけなので、マウスは下のマップへ通す。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ThinFrame } from 'norden-ui';
import { FEATURE_DEFS } from '@norden/map-runtime/core/features';
import type { HexCell } from '@norden/map-runtime/core/mapData';
import { TERRAIN_DEFS } from '@norden/map-runtime/core/terrainTypes';
import type { BattleApp } from '../app';
import { volleyRate } from '../damage';
import { cellMoveCost } from '../movement';
import { Err } from './statusText';

/** 予測などの行。[見出し, 中身] */
type InfoRow = readonly [string, ReactNode];

export default function TerrainWindow({ app }: { app: BattleApp }) {
  const [shown, setShown] = useState<{ cell: HexCell; extra: InfoRow[] } | null>(null);
  useEffect(() => app.on('hover', (cell) => setShown(cell && { cell, extra: forecastRows(app, cell) })), [app]);
  if (!shown) return null;

  const { cell, extra } = shown;
  const terrain = TERRAIN_DEFS[cell.terrain];
  const [r, g, b] = terrain.color.map((v) => Math.round(v * 255));
  const cost = cellMoveCost(cell);
  return (
    <section className="battle-window terrain-info" aria-label="地形">
      <ThinFrame />
      <h2 className="window-title">地形</h2>
      <div className="terrain-head">
        <i className="terrain-swatch" style={{ background: `rgb(${r}, ${g}, ${b})` }} />
        <span className="terrain-name">{terrain.name}</span>
        {cell.feature && <span className="terrain-feature">{FEATURE_DEFS[cell.feature].name}</span>}
        <span className="terrain-coord">
          ({cell.col}, {cell.row})
        </span>
      </div>
      <Rows
        rows={[
          ['標高', `Lv ${cell.elevation}`],
          ['移動', cost === null ? <span className="blocked">通れない</span> : <>行動力 <b>{cost}</b></>],
          ['街道', cell.roads?.length ? `${cell.roads.length} 方向（沿って入ると行動力が半分）` : <span className="none">なし</span>],
        ]}
      />
      {extra.length > 0 && <Rows rows={extra} className="terrain-extra" />}
    </section>
  );
}

function Rows({ rows, className }: { rows: readonly InfoRow[]; className?: string }) {
  return (
    <dl className={className}>
      {rows.map(([k, v]) => (
        <div key={k} className="row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 移動先を選んでいる間はそこまでに使う行動力、攻撃の相手を選んでいる間は結果の予測 */
function forecastRows(app: BattleApp, cell: HexCell): InfoRow[] {
  const rows: InfoRow[] = [];
  const step = app.moveStepAt(cell);
  if (step) {
    rows.push([
      '移動先',
      <>
        行動力 {step.cost}（予約の合計）
        {step.zoc && (
          <>
            <br />
            敵の ZOC: 入るとそれ以上動けない
          </>
        )}
      </>,
    ]);
  }
  const f = app.attackPreviewAt(cell);
  if (f && 'rejected' in f) rows.push(['攻撃', <Err>{f.rejected}</Err>]);
  else if (f) {
    const { direct, encircled, supporters, morale } = f.expected;
    rows.push([
      '攻撃',
      <>
        {supporters > 0 && (
          <>
            一斉攻撃: 味方 {supporters} 隊が加わる（×{volleyRate(supporters)}）
            <br />
          </>
        )}
        敵 {range(f.damage)}
        {encircled && '（包囲 ×1.2）'}
        <br />
        {direct ? `反撃 ${range(f.counter)}` : '反撃なし'}
        <br />
        士気 {signed(morale.attacker)} / 敵の士気 {signed(morale.defender)}（目安）
      </>,
    ]);
  }
  return rows;
}

/** 兵数の減少の幅（-96〜-144） */
function range([min, max]: readonly [number, number]): string {
  return min === max ? `-${min}` : `-${min}〜-${max}`;
}

/** 符号付きの数（+7・-3・±0） */
function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? String(n) : '±0';
}
