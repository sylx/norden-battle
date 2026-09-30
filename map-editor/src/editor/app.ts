import * as THREE from 'three';
import { bridgeAxis, bridgeAxisCandidates, canPlaceFeature, FEATURE_DEFS, type FeatureId } from '@norden/map-runtime/core/features';
import { axialRound, type Offset } from '@norden/map-runtime/core/hex';
import { HexMap, type HexCell, type MapData } from '@norden/map-runtime/core/mapData';
import { clearRoads, setRoad } from '@norden/map-runtime/core/roads';
import type { TerrainParams } from '@norden/map-runtime/core/terrainGen';
import { TERRAIN_DEFS } from '@norden/map-runtime/core/terrainTypes';
import { canPlaceUnit, deployDemoUnits, type TeamId, type UnitType } from '@norden/map-runtime/core/units';
import type { HexOverlay } from '@norden/map-runtime/render/hexOverlay';
import { MapView, type GenStats, type MapDisplay } from '@norden/map-runtime/render/mapView';
import { SceneContext } from '@norden/map-runtime/render/scene';
import type { UnitLayer } from '@norden/map-runtime/render/units';

export type { GenStats };

export type OverlayMode = 'none' | 'terrain' | 'elevation';

/** クリック時の動作: 選択 / 人工物の配置 / 撤去 / 森の伐採・植林 / 街道（ドラッグ） / ユニットの配置 */
export type EditTool = 'select' | FeatureId | 'erase' | 'forest' | 'road' | 'unit';

const ELEV_COLORS = [0x3f7f5f, 0x7fae4f, 0xc8c35a, 0xd89a4a, 0xb0603a, 0x8a5a4a, 0xf0f0f0].map((c) => new THREE.Color(c));

export class EditorApp {
  readonly ctx: SceneContext;
  /** マップの描画（地形・木・人工物・ユニット） */
  readonly view: MapView;
  /** HEX の塗り分け */
  overlayMode: OverlayMode = 'none';
  /** ユニットツールで置くユニット */
  readonly unitBrush: { type: UnitType; team: TeamId } = { type: 'infantry', team: 'blue' };
  selected: Offset | null = null;
  tool: EditTool = 'select';

  onHover: (cell: HexCell | null) => void = () => {};
  onSelect: (cell: HexCell | null) => void = () => {};
  onGenerated: (stats: GenStats) => void = () => {};
  /** 編集操作の結果メッセージ（配置できない場合など） */
  onMessage: (msg: string) => void = () => {};

  /** 街道ツール・撤去ツールでドラッグ中の HEX の並び */
  private drag: { tool: 'road' | 'erase'; path: Offset[] } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private pointerDirty = false;
  private downPos: { x: number; y: number } | null = null;

  constructor(container: HTMLElement) {
    this.ctx = new SceneContext(container);
    this.view = new MapView(this.ctx);
    this.view.onGenerated = (stats) => {
      this.updateCellColors();
      this.onGenerated(stats);
    };
    const el = this.ctx.renderer.domElement;
    el.addEventListener('pointermove', (e) => {
      this.setPointer(e);
      if (this.drag) this.extendDrag();
    });
    el.addEventListener('pointerleave', () => this.setHover(null));
    // capture で MapControls より先に受け取り、なぞり描き中はパンさせない
    el.addEventListener(
      'pointerdown',
      (e) => {
        this.downPos = { x: e.clientX, y: e.clientY };
        if (e.button !== 0 || (this.tool !== 'road' && this.tool !== 'erase')) return;
        this.setPointer(e);
        const o = this.pick();
        if (!o) return;
        this.drag = { tool: this.tool, path: [o] };
        this.ctx.controls.enabled = false;
        el.setPointerCapture(e.pointerId);
        this.previewDrag();
      },
      { capture: true },
    );
    el.addEventListener('pointerup', (e) => {
      if (this.drag) {
        this.finishDrag();
        this.downPos = null;
        return;
      }
      if (e.button !== 0 || !this.downPos) return;
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      this.downPos = null;
      if (moved > 4) return; // ドラッグ（パン）はクリック扱いしない
      this.setPointer(e);
      this.applyTool(this.pick());
    });
    this.ctx.renderer.setAnimationLoop(() => this.frame());
  }

  get map(): HexMap | null {
    return this.view.map;
  }

  get params(): TerrainParams {
    return this.view.params;
  }

  get display(): MapDisplay {
    return this.view.display;
  }

  get overlay(): HexOverlay {
    return this.view.overlay;
  }

  get units(): UnitLayer {
    return this.view.units;
  }

  loadMap(data: MapData, resetCamera = true): void {
    this.view.setMap(new HexMap(data), resetCamera);
    this.setSelected(null);
  }

  regenerate(resetCamera = false): void {
    this.view.regenerate(resetCamera);
  }

  /** 木と人工物だけを作り直す（人工物の配置変更時） */
  rebuildDecor(): void {
    this.view.rebuildDecor();
  }

  rebuildUnits(): void {
    this.view.rebuildUnits();
  }

  /** 表示確認用に 2 軍を並べる（既存のユニットは置き換える） */
  deployDemoUnits(): void {
    if (!this.map) return;
    this.map.replaceUnits(deployDemoUnits(this.map));
    this.rebuildUnits();
  }

  clearUnits(): void {
    if (!this.map) return;
    this.map.replaceUnits([]);
    this.rebuildUnits();
  }

  applyDisplay(): void {
    this.view.applyDisplay();
    this.updateCellColors();
  }

  setGridOpacity(v: number): void {
    this.view.setGridOpacity(v);
  }

  updateCellColors(): void {
    const map = this.map;
    if (!map) return;
    const mode = this.overlayMode;
    const tmp = new THREE.Color();
    const dragged = new Set(this.drag?.path.map((o) => `${o.col},${o.row}`) ?? []);
    const dragColor = this.drag?.tool === 'erase' ? 0xd04a3a : 0xe0b060;
    this.overlay.setCellColors((col, row) => {
      if (dragged.has(`${col},${row}`)) return tmp.set(dragColor);
      const cell = map.get(col, row)!;
      if (mode === 'terrain') return tmp.set(TERRAIN_DEFS[cell.terrain].overlay);
      if (mode === 'elevation') return tmp.copy(ELEV_COLORS[Math.min(Math.max(cell.elevation, 0), ELEV_COLORS.length - 1)]);
      return null;
    });
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.pointerDirty = true;
  }

  private pick(): Offset | null {
    this.raycaster.setFromCamera(this.pointer, this.ctx.camera);
    // 街道のなぞり描き中は地面だけを見る
    return this.view.pick(this.raycaster, !this.drag && this.tool !== 'road');
  }

  private applyTool(o: Offset | null): void {
    const map = this.map;
    const tool = this.tool;
    if (tool === 'select' || !o || !map) {
      this.setSelected(o);
      return;
    }
    const cell = map.get(o.col, o.row)!;
    if (tool === 'forest') {
      // 森は地表の色・起伏にも効くので地形ごと作り直す
      if (cell.terrain === 'forest') map.setTerrain(o.col, o.row, 'plains');
      else if (cell.terrain === 'plains') map.setTerrain(o.col, o.row, 'forest');
      else {
        this.onMessage('森と草原の間でだけ切り替えられます');
        return;
      }
      this.regenerate(false);
      this.setSelected(o);
      return;
    }
    if (tool === 'road') {
      this.onMessage('街道は HEX をドラッグでなぞって引きます');
      return;
    }
    if (tool === 'unit') {
      this.placeUnit(o);
      return;
    }
    if (tool === 'erase' && map.unitAt(o.col, o.row)) {
      // ユニットがいれば人工物・街道より先に撤去
      map.removeUnit(o.col, o.row);
      this.rebuildUnits();
      this.setSelected(o);
      return;
    }
    if (tool === 'erase') {
      // 人工物があればそれを、無ければ街道を撤去
      if (cell.feature) map.setFeature(o.col, o.row, null);
      else if (cell.roads) clearRoads(map, o);
      else return;
    } else if (!canPlaceFeature(cell, tool)) {
      const def = FEATURE_DEFS[tool];
      this.onMessage(`${def.name}は${def.onWater ? '水域' : '陸地'}にしか置けません`);
      return;
    } else if (cell.feature === tool) {
      if (tool === 'bridge') {
        // 同じ橋をもう一度クリックすると向きを変える
        const cands = bridgeAxisCandidates(map, o.col, o.row);
        const cur = bridgeAxis(map, cell);
        const list = cands.length > 0 ? cands : [0, 1, 2];
        const next = list[(list.indexOf(cur) + 1) % list.length];
        map.setFeature(o.col, o.row, 'bridge', next);
      } else {
        map.setFeature(o.col, o.row, null);
      }
    } else {
      map.setFeature(o.col, o.row, tool);
    }
    this.rebuildDecor();
    this.setSelected(o);
  }

  /** 空き HEX には置き、違うユニットがいれば置き換える（向きは配置から自動で決まる） */
  private placeUnit(o: Offset): void {
    const map = this.map!;
    const cell = map.get(o.col, o.row)!;
    const { type, team } = this.unitBrush;
    const cur = map.unitAt(o.col, o.row);
    if (cur && cur.type === type && cur.team === team) {
      this.setSelected(o);
      return;
    }
    if (!canPlaceUnit(cell)) {
      this.onMessage('ユニットは陸か橋の上にしか置けません');
      return;
    }
    map.setUnit({ col: o.col, row: o.row, type, team });
    this.rebuildUnits();
    this.setSelected(o);
  }

  /** ドラッグ中のカーソル位置まで HEX の並びを伸ばす（飛んだ分は直線で補間） */
  private extendDrag(): void {
    const drag = this.drag;
    const map = this.map;
    if (!drag || !map) return;
    const o = this.pick();
    if (!o) return;
    const last = drag.path[drag.path.length - 1];
    if (last.col === o.col && last.row === o.row) return;
    const layout = map.layout;
    const a = layout.offsetToAxial(last.col, last.row);
    const b = layout.offsetToAxial(o.col, o.row);
    const n = (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      // 境界上で丸めが揺れないよう少しずらす
      const r = axialRound(a.q + (b.q - a.q) * t + 1e-6, a.r + (b.r - a.r) * t + 2e-6);
      const p = layout.axialToOffset(r.q, r.r);
      const prev = drag.path[drag.path.length - 1];
      if (p.col === prev.col && p.row === prev.row) continue;
      // 一歩戻ったら取り消し扱い
      const back = drag.path[drag.path.length - 2];
      if (back && back.col === p.col && back.row === p.row) drag.path.pop();
      else drag.path.push(p);
    }
    this.previewDrag();
  }

  private previewDrag(): void {
    this.updateCellColors();
  }

  private finishDrag(): void {
    const drag = this.drag;
    const map = this.map;
    this.drag = null;
    this.ctx.controls.enabled = true;
    if (!drag || !map) return;
    if (drag.path.length === 1) {
      this.updateCellColors();
      this.applyTool(drag.path[0]);
      return;
    }
    for (let i = 0; i < drag.path.length - 1; i++) setRoad(map, drag.path[i], drag.path[i + 1], drag.tool === 'road');
    this.rebuildDecor();
    this.setSelected(drag.path[drag.path.length - 1]);
  }

  private setHover(o: Offset | null): void {
    this.view.setHover(o);
    this.onHover(o && this.map ? this.map.get(o.col, o.row)! : null);
  }

  private setSelected(o: Offset | null): void {
    this.selected = o;
    this.view.setSelected(o);
    this.onSelect(o && this.map ? this.map.get(o.col, o.row)! : null);
  }

  private frame(): void {
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.setHover(this.pick());
    }
    this.view.render();
  }
}
