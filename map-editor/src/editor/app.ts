import * as THREE from 'three';
import { bridgeAxis, bridgeAxisCandidates, canPlaceFeature, FEATURE_DEFS, type FeatureId } from '../core/features';
import { axialRound, type Offset } from '../core/hex';
import { HexMap, type HexCell, type MapData } from '../core/mapData';
import { buildRoadPaths, clearRoads, RoadIndex, setRoad } from '../core/roads';
import { DEFAULT_TERRAIN_PARAMS, generateTerrain, Heightmap, placeVegetation, type TerrainData, type TerrainParams } from '../core/terrainGen';
import { TERRAIN_DEFS } from '../core/terrainTypes';
import { canPlaceUnit, deployDemoUnits, type TeamId, type UnitType } from '../core/units';
import { createForest, windUniforms } from '../render/foliage';
import { HexOverlay } from '../render/hexOverlay';
import { buildRoadMesh } from '../render/roads';
import { SceneContext } from '../render/scene';
import { buildStructures } from '../render/structures';
import { buildTerrainMeshes, disposeObject, type TerrainMeshes } from '../render/terrainMeshes';
import { UnitLayer } from '../render/units';

export type OverlayMode = 'none' | 'terrain' | 'elevation';

/** クリック時の動作: 選択 / 人工物の配置 / 撤去 / 森の伐採・植林 / 街道（ドラッグ） / ユニットの配置 */
export type EditTool = 'select' | FeatureId | 'erase' | 'forest' | 'road' | 'unit';

export interface DisplayOptions {
  overlayMode: OverlayMode;
  grid: boolean;
  trees: boolean;
  water: boolean;
  structures: boolean;
  roads: boolean;
  units: boolean;
}

export interface GenStats {
  ms: number;
  vertices: number;
  trees: number;
}

const ELEV_COLORS = [0x3f7f5f, 0x7fae4f, 0xc8c35a, 0xd89a4a, 0xb0603a, 0x8a5a4a, 0xf0f0f0].map((c) => new THREE.Color(c));

export class EditorApp {
  readonly ctx: SceneContext;
  readonly overlay = new HexOverlay();
  readonly params: TerrainParams = { ...DEFAULT_TERRAIN_PARAMS };
  readonly display: DisplayOptions = {
    overlayMode: 'none',
    grid: true,
    trees: true,
    water: true,
    structures: true,
    roads: true,
    units: true,
  };
  /** ユニットツールで置くユニット */
  readonly unitBrush: { type: UnitType; team: TeamId } = { type: 'infantry', team: 'blue' };
  readonly units = new UnitLayer();
  map: HexMap | null = null;
  selected: Offset | null = null;
  tool: EditTool = 'select';

  onHover: (cell: HexCell | null) => void = () => {};
  onSelect: (cell: HexCell | null) => void = () => {};
  onGenerated: (stats: GenStats) => void = () => {};
  /** 編集操作の結果メッセージ（配置できない場合など） */
  onMessage: (msg: string) => void = () => {};

  private meshes: TerrainMeshes | null = null;
  private terrainData: TerrainData | null = null;
  /** 木と人工物（地形を作り直さずに差し替えられる部分） */
  private decor: { forest: THREE.Group; structures: THREE.Group; roads: THREE.Group } | null = null;
  /** 街道ツール・撤去ツールでドラッグ中の HEX の並び */
  private drag: { tool: 'road' | 'erase'; path: Offset[] } | null = null;
  private stats: GenStats = { ms: 0, vertices: 0, trees: 0 };
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private pointerDirty = false;
  private downPos: { x: number; y: number } | null = null;
  private gridOpacity = this.overlay.uniforms.uGridOpacity.value;

  constructor(container: HTMLElement) {
    this.ctx = new SceneContext(container);
    this.ctx.overlay.add(this.units.group);
    this.units.art.onChange = () => this.rebuildUnits();
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

  loadMap(data: MapData, resetCamera = true): void {
    this.map = new HexMap(data);
    this.overlay.setLayout(this.map.layout);
    this.ctx.parchment.uniforms.uPaperScale.value = this.map.layout.size;
    this.selected = null;
    this.onSelect(null);
    this.regenerate(resetCamera);
  }

  regenerate(resetCamera = false): void {
    if (!this.map) return;
    const data = generateTerrain(this.map, this.params);
    if (this.meshes) {
      this.ctx.scene.remove(this.meshes.group);
      this.meshes.dispose();
    }
    this.meshes = buildTerrainMeshes(data, this.overlay);
    this.ctx.scene.add(this.meshes.group);
    this.terrainData = data;
    this.stats = { ms: data.stats.ms, vertices: data.nx * data.nz, trees: 0 };
    this.rebuildDecor();
    this.ctx.fitTo(
      {
        minX: data.minX,
        minZ: data.minZ,
        maxX: data.minX + (data.nx - 1) * data.step,
        maxZ: data.minZ + (data.nz - 1) * data.step,
      },
      resetCamera,
    );
  }

  /** 木と人工物だけを作り直す（人工物の配置変更時） */
  rebuildDecor(): void {
    const map = this.map;
    const data = this.terrainData;
    if (!map || !data) return;
    const t0 = performance.now();
    if (this.decor) {
      this.ctx.scene.remove(this.decor.forest, this.decor.structures, this.decor.roads);
      disposeObject(this.decor.forest);
      disposeObject(this.decor.structures);
      disposeObject(this.decor.roads);
    }
    const roadPaths = buildRoadPaths(map);
    const roadIndex = new RoadIndex(roadPaths);
    const trees = placeVegetation(map, data, this.params, roadIndex);
    const roads = new THREE.Group();
    const roadMesh = buildRoadMesh(roadPaths, new Heightmap(data), data.waterLevel, map.layout.size);
    if (roadMesh) roads.add(roadMesh);
    this.decor = { forest: createForest(trees, map.data.seed), structures: buildStructures(map, data, roadIndex), roads };
    this.ctx.scene.add(this.decor.forest, this.decor.structures, this.decor.roads);
    // 橋の有無で足元の高さが変わるのでユニットも置き直す
    this.rebuildUnits();
    this.applyDisplay();
    this.onGenerated({ ...this.stats, ms: this.stats.ms + performance.now() - t0, trees: trees.length });
  }

  rebuildUnits(): void {
    if (this.map && this.terrainData) this.units.build(this.map, this.terrainData);
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
    const u = this.overlay.uniforms;
    u.uGridOpacity.value = this.display.grid ? this.gridOpacity : 0;
    if (this.meshes) this.meshes.water.visible = this.display.water;
    if (this.decor) {
      this.decor.forest.visible = this.display.trees;
      this.decor.structures.visible = this.display.structures;
      this.decor.roads.visible = this.display.roads;
    }
    this.units.group.visible = this.display.units;
    this.updateCellColors();
  }

  setGridOpacity(v: number): void {
    this.gridOpacity = v;
    this.applyDisplay();
  }

  updateCellColors(): void {
    const map = this.map;
    if (!map) return;
    const mode = this.display.overlayMode;
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
    if (!this.meshes || !this.map) return null;
    this.raycaster.setFromCamera(this.pointer, this.ctx.camera);
    // ユニットは地形より手前に描いているので、画像に重なっていればそのユニットの HEX を指す
    // （街道のなぞり描き中は地面だけを見る）
    if (!this.drag && this.tool !== 'road') {
      const unit = this.units.pick(this.raycaster);
      if (unit) return { col: unit.col, row: unit.row };
    }
    const targets: THREE.Object3D[] = [this.meshes.terrain];
    if (this.meshes.water.visible) targets.push(this.meshes.water);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    const o = this.map.layout.worldToOffset(hit.point.x, hit.point.z);
    return this.map.layout.inBounds(o.col, o.row) ? o : null;
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
    this.overlay.uniforms.uHover.value.set(o?.col ?? -1, o?.row ?? -1);
    this.onHover(o && this.map ? this.map.get(o.col, o.row)! : null);
  }

  private setSelected(o: Offset | null): void {
    this.selected = o;
    this.overlay.uniforms.uSelected.value.set(o?.col ?? -1, o?.row ?? -1);
    this.onSelect(o && this.map ? this.map.get(o.col, o.row)! : null);
  }

  private frame(): void {
    windUniforms.uTime.value = performance.now() / 1000;
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.setHover(this.pick());
    }
    this.ctx.render();
  }
}
