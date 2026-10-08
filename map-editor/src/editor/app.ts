import * as THREE from 'three';
import { BATTLE_AREA_SIZE, cropBattleArea, snapBattleArea } from '@norden/map-runtime/core/battleArea';
import { bridgeAxis, bridgeAxisCandidates, canPlaceFeature, castleWard, FEATURE_DEFS, isFeatureId, type FeatureId } from '@norden/map-runtime/core/features';
import { axialRound, type Offset } from '@norden/map-runtime/core/hex';
import { HexMap, type BattleDeployment, type DeploySide, type HexCell, type MapData } from '@norden/map-runtime/core/mapData';
import { clearRoads, setRoad } from '@norden/map-runtime/core/roads';
import type { TerrainParams } from '@norden/map-runtime/core/terrainGen';
import { TERRAIN_DEFS } from '@norden/map-runtime/core/terrainTypes';
import { canPlaceUnit } from '@norden/map-runtime/core/units';
import type { HexOverlay } from '@norden/map-runtime/render/hexOverlay';
import { MapView, type GenStats, type MapDisplay } from '@norden/map-runtime/render/mapView';
import { SceneContext } from '@norden/map-runtime/render/scene';
import {
  applyEdits,
  autoCastleWards,
  clearTerrain,
  distanceField,
  elevationEdits,
  rectCells,
  riverEdits,
  terrainEdits,
  type CellEdits,
  type ClearOptions,
  type ElevationBrush,
  type RiverBrush,
  type TerrainBrush,
} from './terrainTools';

export type { GenStats };

export type OverlayMode = 'none' | 'terrain' | 'elevation';

/**
 * クリック・ドラッグ時の動作:
 * 選択 / 人工物の配置 / 撤去 / 街道（ドラッグ） / 標高ブラシ / 地形の塗り / 川 /
 * 戦闘の範囲（ドラッグ） / 攻撃側・防衛側の初期配置地点
 */
export type EditTool =
  | 'select'
  | FeatureId
  | 'erase'
  | 'road'
  | 'elevation'
  | 'terrain'
  | 'river'
  | 'area'
  | 'deploy-attacker'
  | 'deploy-defender';

/** ドラッグでなぞるツール（城はなぞって塗れる。1 HEX だけならクリック扱い） */
type StrokeTool = 'road' | 'erase' | 'castle' | 'elevation' | 'terrain' | 'river' | 'deploy-attacker' | 'deploy-defender';
const STROKE_TOOLS = new Set<EditTool>(['road', 'erase', 'castle', 'elevation', 'terrain', 'river', 'deploy-attacker', 'deploy-defender']);

interface Stroke {
  tool: StrokeTool;
  /** なぞった HEX の並び（隣り合う HEX でつながる） */
  path: Offset[];
  /** 'flatten' の目標の高さ（なぞり始めた HEX の高さ） */
  startElevation: number;
  /** 初期配置: 足すか消すか（なぞり始めた HEX が配置地点でなければ足す） */
  add: boolean;
}

/** 街道マップの戦闘の範囲の枠の色 */
const AREA_COLOR = 0xffb040;
/** 初期配置地点の色 */
export const DEPLOY_COLORS: Record<DeploySide, number> = { attacker: 0xd8442e, defender: 0x2e7ad8 };
/** ブラシの範囲（カーソル位置）の色 */
const BRUSH_COLOR = 0xfff0c0;

/** 中ボタンのドラッグでカメラの俯角を変えるときの、1 ピクセルあたりの角度（度）と範囲 */
const PITCH_PER_PIXEL = 0.25;
export const PITCH_RANGE = { min: 20, max: 85 } as const;

/** 元に戻せる回数 */
const UNDO_LIMIT = 100;

/** 軽量表示で下げる地形の頂点密度 */
const LITE_RESOLUTION = 5;

export const ELEV_COLORS = [0x3f7f5f, 0x7fae4f, 0xc8c35a, 0xd89a4a, 0xb0603a, 0x8a5a4a, 0xd8d0c8, 0xf0f0f0, 0xffffff].map(
  (c) => new THREE.Color(c),
);

export class EditorApp {
  readonly ctx: SceneContext;
  /** マップの描画（地形・木・人工物） */
  readonly view: MapView;
  /** HEX の塗り分け */
  overlayMode: OverlayMode = 'none';
  readonly elevationBrush: ElevationBrush = {
    mode: 'raise',
    amount: 1,
    level: 1,
    radius: 0,
    smooth: true,
    shapeTerrain: false,
    keepWater: true,
  };
  readonly terrainBrush: TerrainBrush = { terrain: 'forest', shape: 'rect', radius: 1, protect: true };
  readonly riverBrush: RiverBrush = { mode: 'draw', deep: false, carveBanks: true };
  /** 城ツールで置く郭の段（1 = 外郭。数字が大きいほど内側） */
  castleWard = 1;
  selected: Offset | null = null;
  tool: EditTool = 'select';
  /** 枠を表示し、範囲ツール・初期配置ツールで編集する戦闘の範囲（battleAreas のキー = 防衛する都市の ID） */
  areaCity: string | null = null;

  onHover: (cell: HexCell | null) => void = () => {};
  onSelect: (cell: HexCell | null) => void = () => {};
  onGenerated: (stats: GenStats) => void = () => {};
  /** 編集操作の結果メッセージ（配置できない場合など） */
  onMessage: (msg: string) => void = () => {};
  /** マップを編集したとき（元に戻したときも） */
  onEdit: () => void = () => {};

  /** 範囲だけのプレビュー中の、元のマップ（編集と保存はこちら） */
  private previewSource: HexMap | null = null;
  /** 範囲ツールでドラッグ中（ドラッグ前のマップ。動かしたら元に戻す履歴に積む） */
  private areaDrag: { before: MapData; moved: boolean } | null = null;
  private stroke: Stroke | null = null;
  /** stroke の編集結果（プレビュー用のキャッシュ） */
  private strokeEdits: CellEdits | null = null;
  private hovered: Offset | null = null;
  private readonly undoStack: MapData[] = [];
  private readonly redoStack: MapData[] = [];
  /** 軽量表示の前の設定（軽量表示中だけ） */
  private liteSaved: { pixelRatio: number; parchment: boolean; shadows: boolean; trees: boolean; resolution: number } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private pointerDirty = false;
  private downPos: { x: number; y: number } | null = null;
  /** 中ボタンで俯角を変えている間（押した位置の Y と、そのときの俯角） */
  private pitchDrag: { y: number; pitch: number } | null = null;

  constructor(container: HTMLElement) {
    this.ctx = new SceneContext(container);
    this.view = new MapView(this.ctx);
    // ユニットはエディタでは扱わない（マップに入っているユニットは保存時にそのまま残す）
    this.view.display.units = false;
    // 左ドラッグは編集ツールで使うので、右ドラッグでもパンできるようにする
    this.ctx.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.view.onGenerated = (stats) => {
      this.updateCellColors();
      this.onGenerated(stats);
    };
    const el = this.ctx.renderer.domElement;
    el.addEventListener('pointermove', (e) => {
      if (this.pitchDrag) {
        // 上へドラッグで水平に近く、下へで真上から見下ろす向きに（1 度刻みにして、木の板絵の焼き直しを抑える）
        const pitch = this.pitchDrag.pitch + (e.clientY - this.pitchDrag.y) * PITCH_PER_PIXEL;
        this.ctx.setPitch(Math.round(Math.min(Math.max(pitch, PITCH_RANGE.min), PITCH_RANGE.max)));
      }
      this.setPointer(e);
      if (this.stroke) this.extendStroke();
      if (this.areaDrag) this.moveArea(this.pick());
    });
    el.addEventListener('pointerleave', () => this.setHover(null));
    // capture で MapControls より先に受け取り、なぞり描き中はパンさせない
    el.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button === 1) {
          // 中ボタンのドラッグは俯角の変更（MapControls のズームには渡さない）
          e.preventDefault();
          e.stopImmediatePropagation();
          this.pitchDrag = { y: e.clientY, pitch: this.ctx.pitch };
          el.setPointerCapture(e.pointerId);
          return;
        }
        this.downPos = { x: e.clientX, y: e.clientY };
        if (e.button !== 0 || this.previewSource) return;
        if (this.tool === 'area') {
          this.setPointer(e);
          const before = this.map?.toJSON();
          if (!before) return;
          this.areaDrag = { before, moved: false };
          if (!this.moveArea(this.pick())) {
            this.areaDrag = null;
            return;
          }
          this.ctx.controls.enabled = false;
          el.setPointerCapture(e.pointerId);
          return;
        }
        if (!STROKE_TOOLS.has(this.tool)) return;
        this.setPointer(e);
        const o = this.pick();
        if (!o) return;
        if (!this.beginStroke(this.tool as StrokeTool, o)) return;
        this.ctx.controls.enabled = false;
        el.setPointerCapture(e.pointerId);
      },
      { capture: true },
    );
    // 中ボタンの自動スクロールを出さない
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    // 中ボタンを離さずにキャプチャが外れたとき（pointercancel など）も俯角の変更を終える
    el.addEventListener('lostpointercapture', () => (this.pitchDrag = null));
    el.addEventListener('pointerup', (e) => {
      if (e.button === 1 && this.pitchDrag) {
        this.pitchDrag = null;
        return;
      }
      if (this.areaDrag) {
        const { before, moved } = this.areaDrag;
        this.areaDrag = null;
        if (moved) {
          this.pushUndo(before);
          this.onEdit();
        }
        this.ctx.controls.enabled = true;
        this.downPos = null;
        return;
      }
      if (this.stroke) {
        this.finishStroke();
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

  /** 編集中のマップ（範囲のプレビュー中も元のマップ） */
  get map(): HexMap | null {
    return this.previewSource ?? this.view.map;
  }

  /** 表示中のマップ（範囲のプレビュー中は切り出したマップ） */
  get shownMap(): HexMap | null {
    return this.view.map;
  }

  /** カーソルの HEX（表示中のマップ。マップの外なら null） */
  get hoveredCell(): HexCell | null {
    const o = this.hovered;
    return o && this.shownMap ? this.shownMap.get(o.col, o.row)! : null;
  }

  get previewing(): boolean {
    return this.previewSource !== null;
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

  get canUndo(): boolean {
    return this.undoStack.length > 0 && !this.previewSource;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0 && !this.previewSource;
  }

  loadMap(data: MapData, resetCamera = true): void {
    this.previewSource = null;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.view.setMap(new HexMap(data), resetCamera);
    this.setSelected(null);
    this.showArea();
  }

  // --- 元に戻す・やり直す ---

  /** これから編集する（今のマップを元に戻す履歴に積む）。UI から直接 data を書き換える前に呼ぶ */
  checkpoint(): void {
    if (this.map) this.pushUndo(this.map.toJSON());
  }

  private pushUndo(snapshot: MapData): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): void {
    this.stepHistory(this.undoStack, this.redoStack);
  }

  redo(): void {
    this.stepHistory(this.redoStack, this.undoStack);
  }

  private stepHistory(from: MapData[], to: MapData[]): void {
    const map = this.map;
    if (!map || this.previewSource || this.stroke || this.areaDrag) return;
    const snapshot = from.pop();
    if (!snapshot) return;
    to.push(map.toJSON());
    const selected = this.selected;
    this.view.setMap(new HexMap(snapshot), false);
    this.setSelected(selected);
    this.showArea();
    this.onEdit();
  }

  /** 地形を作り直して、編集を知らせる */
  private edited(terrain: boolean): void {
    if (terrain) this.regenerate(false);
    else this.rebuildDecor();
    this.onEdit();
  }

  // --- 戦闘の範囲・初期配置地点 ---

  /**
   * 戦闘の範囲を設定する（o は左上。偶数の列・行に寄せ、マップに収める）。null で削除（初期配置地点は残す）。
   * マップが範囲より小さければ何もしない。
   */
  setBattleArea(city: string, o: Offset | null): void {
    const map = this.map;
    if (!map || this.previewSource) return;
    const data = map.data;
    if (o === null) {
      if (!data.battleAreas?.[city]) return;
      this.checkpoint();
      delete data.battleAreas[city];
      if (Object.keys(data.battleAreas).length === 0) delete data.battleAreas;
    } else {
      if (data.grid.cols < BATTLE_AREA_SIZE.cols || data.grid.rows < BATTLE_AREA_SIZE.rows) {
        this.onMessage(`マップが戦闘の範囲（${BATTLE_AREA_SIZE.cols}×${BATTLE_AREA_SIZE.rows}）より小さいため置けません`);
        return;
      }
      if (!this.areaDrag) this.checkpoint();
      data.battleAreas = { ...data.battleAreas, [city]: snapBattleArea(data, o) };
    }
    this.showArea();
    this.onEdit();
  }

  /** 範囲ツール: カーソルの HEX が中央に来るように動かす */
  private moveArea(o: Offset | null): boolean {
    const city = this.areaCity;
    if (!o || !city) {
      if (!city) this.onMessage('「街道マップ」欄で範囲を動かす都市を選んでください');
      return false;
    }
    const cur = this.map?.data.battleAreas?.[city];
    const next = snapBattleArea(this.map!.data, {
      col: o.col - Math.floor(BATTLE_AREA_SIZE.cols / 2),
      row: o.row - Math.floor(BATTLE_AREA_SIZE.rows / 2),
    });
    if (cur && cur.col === next.col && cur.row === next.row) return true;
    if (this.areaDrag) this.areaDrag.moved = true;
    else this.checkpoint();
    this.map!.data.battleAreas = { ...this.map!.data.battleAreas, [city]: next };
    this.showArea();
    this.updateCellColors();
    this.onEdit();
    return true;
  }

  /** areaCity の初期配置地点（無ければ空） */
  deploymentOf(city: string | null): BattleDeployment {
    return (city && this.map?.data.deployments?.[city]) || { attacker: [], defender: [] };
  }

  /** areaCity の初期配置地点を消す */
  clearDeployment(): void {
    const data = this.map?.data;
    const city = this.areaCity;
    if (!data || !city || !data.deployments?.[city] || this.previewSource) return;
    this.checkpoint();
    delete data.deployments[city];
    if (Object.keys(data.deployments).length === 0) delete data.deployments;
    this.updateCellColors();
    this.onEdit();
  }

  /** o が areaCity の範囲の中か */
  private inArea(o: Offset): boolean {
    const area = this.areaCity ? this.map?.data.battleAreas?.[this.areaCity] : undefined;
    return (
      !!area && o.col >= area.col && o.row >= area.row && o.col < area.col + BATTLE_AREA_SIZE.cols && o.row < area.row + BATTLE_AREA_SIZE.rows
    );
  }

  /** 初期配置地点を足す・消す。範囲の外と、ユニットの立てない HEX（水域）には足さない */
  private applyDeploy(path: readonly Offset[], side: DeploySide, add: boolean): boolean {
    const map = this.map!;
    const city = this.areaCity!;
    const data = map.data;
    const dep: BattleDeployment = data.deployments?.[city] ?? { attacker: [], defender: [] };
    const key = (o: Offset) => `${o.col},${o.row}`;
    const targets = new Set(path.map(key));
    let changed = false;
    let skipped = '';
    if (add) {
      for (const o of path) {
        if (!this.inArea(o)) skipped = '範囲の外には置けません';
        else if (!canPlaceUnit(map.get(o.col, o.row)!)) skipped = '水域には置けません（橋の上は置けます）';
      }
      for (const s of ['attacker', 'defender'] as const) {
        const n = dep[s].length;
        dep[s] = dep[s].filter((o) => !targets.has(key(o)) || (s === side && this.canDeploy(o)));
        changed ||= dep[s].length !== n;
      }
      const have = new Set(dep[side].map(key));
      for (const o of path) {
        if (have.has(key(o)) || !this.canDeploy(o)) continue;
        have.add(key(o));
        dep[side].push({ col: o.col, row: o.row });
        changed = true;
      }
      dep[side].sort((a, b) => a.row - b.row || a.col - b.col);
    } else {
      const n = dep[side].length;
      dep[side] = dep[side].filter((o) => !targets.has(key(o)));
      changed = dep[side].length !== n;
    }
    if (skipped) this.onMessage(skipped);
    if (!changed) return false;
    if (dep.attacker.length === 0 && dep.defender.length === 0) {
      if (data.deployments) delete data.deployments[city];
      if (data.deployments && Object.keys(data.deployments).length === 0) delete data.deployments;
    } else {
      data.deployments = { ...data.deployments, [city]: dep };
    }
    return true;
  }

  private canDeploy(o: Offset): boolean {
    return this.inArea(o) && canPlaceUnit(this.map!.get(o.col, o.row)!);
  }

  /** areaCity の範囲の枠を出す（プレビュー中・範囲が無いときは消す） */
  showArea(): void {
    const area = this.areaCity ? this.map?.data.battleAreas?.[this.areaCity] : undefined;
    if (!area || this.previewSource) {
      this.view.setRange(null);
      this.updateCellColors();
      return;
    }
    const cells: { col: number; row: number; weak: boolean }[] = [];
    for (let row = area.row; row < area.row + BATTLE_AREA_SIZE.rows; row++) {
      for (let col = area.col; col < area.col + BATTLE_AREA_SIZE.cols; col++) cells.push({ col, row, weak: true });
    }
    this.view.setRange(cells, AREA_COLOR);
    this.updateCellColors();
  }

  /** city の範囲だけを切り出して表示する（ゲームの戦闘で使う形）。null で元のマップに戻す。プレビュー中は編集できない */
  previewArea(city: string | null): void {
    const source = this.map;
    if (!source) return;
    const area = city ? source.data.battleAreas?.[city] : undefined;
    if (city && !area) return;
    this.previewSource = null;
    if (city && area) {
      this.view.setMap(new HexMap(cropBattleArea(source.toJSON(), city)), true);
      this.previewSource = source;
    } else {
      this.view.setMap(source, true);
    }
    this.setSelected(null);
    this.showArea();
  }

  // --- 地形 ---

  /** 全 HEX を 1 つの地形にする */
  clearTerrain(opt: ClearOptions): void {
    const map = this.map;
    if (!map || this.previewSource) return;
    this.checkpoint();
    clearTerrain(map, opt);
    this.edited(true);
  }

  /** 城の郭の段を外周から max まで振る（二重・三重の城壁） */
  autoCastleWards(max: number): void {
    const map = this.map;
    if (!map || this.previewSource) return;
    if (!map.allCells().some((c) => c.feature === 'castle')) {
      this.onMessage('城がありません');
      return;
    }
    const before = map.toJSON();
    if (!autoCastleWards(map, max)) {
      this.onMessage('郭の段は変わりませんでした（内側の段を作るには城を広げてください）');
      return;
    }
    this.pushUndo(before);
    this.edited(false);
  }

  regenerate(resetCamera = false): void {
    this.view.regenerate(resetCamera);
  }

  /** 木と人工物だけを作り直す（人工物の配置変更時） */
  rebuildDecor(): void {
    this.view.rebuildDecor();
  }

  applyDisplay(): void {
    this.view.applyDisplay();
    this.updateCellColors();
  }

  setGridOpacity(v: number): void {
    this.view.setGridOpacity(v);
  }

  // --- 軽量表示 ---

  get lite(): boolean {
    return this.liteSaved !== null;
  }

  /**
   * 軽量表示: 描画解像度を 1 倍まで、地形の頂点密度を下げ、木・影・羊皮紙風の後処理を止める。
   * 地形を作り直すのも速くなる。切ると元の設定に戻す。
   */
  setLite(on: boolean): void {
    if (on === this.lite) return;
    const ctx = this.ctx;
    if (on) {
      this.liteSaved = {
        pixelRatio: ctx.pixelRatio,
        parchment: ctx.parchment.enabled,
        shadows: ctx.sun.castShadow,
        trees: this.display.trees,
        resolution: this.params.resolution,
      };
      ctx.pixelRatio = Math.min(ctx.pixelRatio, 1);
      ctx.parchment.enabled = false;
      ctx.sun.castShadow = false;
      this.display.trees = false;
      this.params.resolution = Math.min(this.params.resolution, LITE_RESOLUTION);
    } else {
      const s = this.liteSaved!;
      this.liteSaved = null;
      ctx.pixelRatio = s.pixelRatio;
      ctx.parchment.enabled = s.parchment;
      ctx.sun.castShadow = s.shadows;
      this.display.trees = s.trees;
      this.params.resolution = s.resolution;
    }
    ctx.invalidateShadows();
    this.regenerate(false);
  }

  // --- HEX の塗り（オーバーレイ・ブラシ・プレビュー・初期配置地点） ---

  updateCellColors(): void {
    const map = this.shownMap;
    if (!map) return;
    const mode = this.overlayMode;
    const tmp = new THREE.Color();
    const { cols } = map.layout;
    const stroke = this.stroke;
    const edits = this.strokeEdits;

    // なぞった HEX（街道・撤去・初期配置）
    const pathKeys = new Set<number>();
    let pathColor = 0xe0b060;
    if (stroke && !edits) {
      for (const o of stroke.path) pathKeys.add(o.row * cols + o.col);
      if (stroke.tool === 'erase') pathColor = 0xd04a3a;
      else if (stroke.tool === 'castle') pathColor = 0xc8c0b0;
      else if (stroke.tool === 'deploy-attacker' || stroke.tool === 'deploy-defender') {
        pathColor = stroke.add ? DEPLOY_COLORS[stroke.tool === 'deploy-attacker' ? 'attacker' : 'defender'] : 0x777777;
      }
    }
    // ブラシの範囲
    const brush = !stroke && this.hovered && !this.previewSource ? this.brushFootprint(this.hovered) : null;
    // 初期配置地点（プレビュー中は切り出したマップの deploy）
    const deploy = new Map<number, number>();
    const dep = this.previewSource ? map.data.deploy : this.areaCity ? map.data.deployments?.[this.areaCity] : undefined;
    for (const side of ['attacker', 'defender'] as const) {
      for (const o of dep?.[side] ?? []) deploy.set(o.row * cols + o.col, DEPLOY_COLORS[side]);
    }

    this.overlay.setCellColors((col, row) => {
      const k = row * cols + col;
      if (pathKeys.has(k)) return tmp.set(pathColor);
      const edit = edits?.get(k);
      if (edit) {
        // 地形が変わる HEX は地形の色、標高だけ変わる HEX は標高の色
        if (stroke?.tool === 'elevation' || edit.terrain === map.get(col, row)!.terrain) return tmp.copy(elevColor(edit.elevation));
        return tmp.set(TERRAIN_DEFS[edit.terrain].overlay);
      }
      if (brush?.has(k)) return tmp.set(BRUSH_COLOR);
      const d = deploy.get(k);
      if (d !== undefined) return tmp.set(d);
      const cell = map.get(col, row)!;
      if (mode === 'terrain') return tmp.set(TERRAIN_DEFS[cell.terrain].overlay);
      if (mode === 'elevation') return tmp.copy(elevColor(cell.elevation));
      return null;
    });
  }

  /** カーソル位置でブラシが効く HEX（ブラシのツールでなければ null） */
  private brushFootprint(o: Offset): Set<number> | null {
    const map = this.map!;
    if (this.tool === 'elevation') return new Set(distanceField(map, [o], this.elevationBrush.radius).keys());
    if (this.tool === 'terrain' && this.terrainBrush.shape === 'brush') return new Set(distanceField(map, [o], this.terrainBrush.radius).keys());
    if (this.tool === 'river') return new Set([o.row * map.layout.cols + o.col]);
    return null;
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.pointerDirty = true;
  }

  private pick(): Offset | null {
    this.raycaster.setFromCamera(this.pointer, this.ctx.camera);
    // ユニットは扱わないので地面（と水面）だけを見る
    return this.view.pick(this.raycaster, false);
  }

  private applyTool(o: Offset | null): void {
    const map = this.map;
    const tool = this.tool;
    if (tool === 'select' || !o || !map || this.previewSource) {
      if (tool !== 'select' && this.previewSource) this.onMessage('範囲のプレビュー中は編集できません');
      this.setSelected(o);
      return;
    }
    if (tool !== 'erase' && !isFeatureId(tool)) {
      if (tool === 'road') this.onMessage('街道は HEX をドラッグでなぞって引きます');
      return;
    }
    // ここに来るのは撤去（クリック）と人工物の配置
    const cell = map.get(o.col, o.row)!;
    const before = map.toJSON();
    if (tool === 'erase') {
      // 人工物があればそれを、無ければ街道を撤去
      if (cell.feature) map.setFeature(o.col, o.row, null);
      else if (cell.roads) clearRoads(map, o);
      else return;
    } else if (!canPlaceFeature(cell, tool)) {
      const def = FEATURE_DEFS[tool];
      this.onMessage(`${def.name}は${def.onWater ? '水域' : '陸地'}にしか置けません`);
      return;
    } else if (tool === 'castle' && cell.feature === 'castle' && castleWard(cell) !== this.castleWard) {
      // 郭の段の違う城をクリックすると段を変える
      map.setFeature(o.col, o.row, 'castle', undefined, this.castleWard);
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
      map.setFeature(o.col, o.row, tool, undefined, tool === 'castle' ? this.castleWard : undefined);
    }
    this.pushUndo(before);
    this.edited(false);
    this.setSelected(o);
  }

  // --- なぞり描き ---

  private beginStroke(tool: StrokeTool, o: Offset): boolean {
    const map = this.map!;
    let add = true;
    if (tool === 'deploy-attacker' || tool === 'deploy-defender') {
      if (!this.areaCity || !map.data.battleAreas?.[this.areaCity]) {
        this.onMessage('「街道マップ」欄で都市を選び、先に範囲を配置してください');
        return false;
      }
      const side: DeploySide = tool === 'deploy-attacker' ? 'attacker' : 'defender';
      add = !this.deploymentOf(this.areaCity)[side].some((p) => p.col === o.col && p.row === o.row);
    }
    this.stroke = { tool, path: [o], startElevation: map.get(o.col, o.row)!.elevation, add };
    this.updateStrokePreview();
    return true;
  }

  /** ドラッグ中のカーソル位置まで HEX の並びを伸ばす（飛んだ分は直線で補間） */
  private extendStroke(): void {
    const stroke = this.stroke;
    const map = this.map;
    if (!stroke || !map) return;
    const o = this.pick();
    if (!o) return;
    const last = stroke.path[stroke.path.length - 1];
    if (last.col === o.col && last.row === o.row) return;
    const layout = map.layout;
    const a = layout.offsetToAxial(last.col, last.row);
    const b = layout.offsetToAxial(o.col, o.row);
    const n = (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
    // 街道・川は一歩戻ったら取り消し扱い（ブラシは塗り重ねるだけ）
    const backtrack = stroke.tool === 'road' || (stroke.tool === 'river' && this.riverBrush.mode === 'draw');
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      // 境界上で丸めが揺れないよう少しずらす
      const r = axialRound(a.q + (b.q - a.q) * t + 1e-6, a.r + (b.r - a.r) * t + 2e-6);
      const p = layout.axialToOffset(r.q, r.r);
      const prev = stroke.path[stroke.path.length - 1];
      if (p.col === prev.col && p.row === prev.row) continue;
      const back = stroke.path[stroke.path.length - 2];
      if (backtrack && back && back.col === p.col && back.row === p.row) stroke.path.pop();
      else stroke.path.push(p);
    }
    this.updateStrokePreview();
  }

  /** なぞった結果の地形の編集（地形を変えるツールでなければ null） */
  private computeStrokeEdits(stroke: Stroke): CellEdits | null {
    const map = this.map!;
    switch (stroke.tool) {
      case 'elevation':
        return elevationEdits(map, stroke.path, this.elevationBrush, stroke.startElevation);
      case 'terrain': {
        const b = this.terrainBrush;
        const cells =
          b.shape === 'rect' ? rectCells(map, stroke.path[0], stroke.path[stroke.path.length - 1]) : distanceField(map, stroke.path, b.radius).keys();
        return terrainEdits(map, cells, b);
      }
      case 'river':
        return riverEdits(map, stroke.path, this.riverBrush);
      default:
        return null;
    }
  }

  private updateStrokePreview(): void {
    this.strokeEdits = this.stroke ? this.computeStrokeEdits(this.stroke) : null;
    this.updateCellColors();
  }

  private finishStroke(): void {
    const stroke = this.stroke;
    const map = this.map;
    const edits = this.strokeEdits;
    this.stroke = null;
    this.strokeEdits = null;
    this.ctx.controls.enabled = true;
    if (!stroke || !map) return;
    const last = stroke.path[stroke.path.length - 1];
    if (edits) {
      if (edits.size === 0) {
        this.updateCellColors();
        return;
      }
      this.pushUndo(map.toJSON());
      applyEdits(map, edits);
      this.edited(true);
      this.setSelected(last);
      return;
    }
    if (stroke.tool === 'deploy-attacker' || stroke.tool === 'deploy-defender') {
      const before = map.toJSON();
      if (this.applyDeploy(stroke.path, stroke.tool === 'deploy-attacker' ? 'attacker' : 'defender', stroke.add)) {
        this.pushUndo(before);
        this.onEdit();
      }
      this.updateCellColors();
      return;
    }
    // 街道・撤去・城: 1 HEX だけならクリック扱い
    if (stroke.path.length === 1) {
      this.updateCellColors();
      this.applyTool(stroke.path[0]);
      return;
    }
    if (stroke.tool === 'castle') {
      // なぞった陸の HEX を、選んでいる郭の段の城にする
      const before = map.toJSON();
      let changed = false;
      let water = false;
      for (const o of stroke.path) {
        const cell = map.get(o.col, o.row)!;
        if (!canPlaceFeature(cell, 'castle')) {
          water = true;
          continue;
        }
        if (castleWard(cell) === this.castleWard) continue;
        map.setFeature(o.col, o.row, 'castle', undefined, this.castleWard);
        changed = true;
      }
      if (water) this.onMessage('城は陸地にしか置けません（水域の HEX は飛ばしました）');
      if (!changed) {
        this.updateCellColors();
        return;
      }
      this.pushUndo(before);
      this.edited(false);
      this.setSelected(last);
      return;
    }
    if (stroke.tool === 'erase') {
      // なぞった HEX の人工物と街道をすべて撤去する
      const before = map.toJSON();
      let changed = false;
      for (const o of stroke.path) {
        const cell = map.get(o.col, o.row)!;
        if (!cell.feature && !cell.roads) continue;
        map.setFeature(o.col, o.row, null);
        clearRoads(map, o);
        changed = true;
      }
      if (!changed) {
        this.updateCellColors();
        return;
      }
      this.pushUndo(before);
      this.edited(false);
      this.setSelected(last);
      return;
    }
    this.pushUndo(map.toJSON());
    for (let i = 0; i < stroke.path.length - 1; i++) setRoad(map, stroke.path[i], stroke.path[i + 1], stroke.tool === 'road');
    this.edited(false);
    this.setSelected(last);
  }

  private setHover(o: Offset | null): void {
    const prev = this.hovered;
    this.hovered = o;
    this.view.setHover(o);
    this.onHover(this.hoveredCell);
    if (!this.stroke && (prev?.col !== o?.col || prev?.row !== o?.row) && this.brushFootprintVisible()) this.updateCellColors();
  }

  /** ブラシの範囲を出すツールか（範囲の消し忘れが無いよう、ブラシを離れたときも描き直す） */
  private brushFootprintVisible(): boolean {
    return this.tool === 'elevation' || this.tool === 'terrain' || this.tool === 'river';
  }

  /** ツールを切り替える（ブラシの範囲の表示を更新する） */
  setTool(tool: EditTool): void {
    this.tool = tool;
    this.updateCellColors();
  }

  private setSelected(o: Offset | null): void {
    this.selected = o;
    this.view.setSelected(o);
    this.onSelect(o && this.shownMap ? this.shownMap.get(o.col, o.row)! : null);
  }

  private frame(): void {
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.setHover(this.pick());
    }
    this.view.render();
  }
}

function elevColor(e: number): THREE.Color {
  return ELEV_COLORS[Math.min(Math.max(e, 0), ELEV_COLORS.length - 1)];
}
