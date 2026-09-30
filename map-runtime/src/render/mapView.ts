/**
 * HEX マップの描画一式（地形・水面・木・人工物・街道・ユニット）。
 * map-editor と battle-editor で同じ見た目になるよう、生成の手順はここにまとめる。
 * パラメータ（params・overlay のユニフォームなど）は map-editor の初期値で始まる。
 */
import * as THREE from 'three';
import type { Offset } from '../core/hex';
import type { HexMap } from '../core/mapData';
import { buildRoadPaths, RoadIndex } from '../core/roads';
import { DEFAULT_TERRAIN_PARAMS, generateTerrain, Heightmap, placeVegetation, type TerrainData, type TerrainParams } from '../core/terrainGen';
import { createForest, setFoliagePrepass, windUniforms } from './foliage';
import { HexOverlay } from './hexOverlay';
import { buildRoadMesh } from './roads';
import type { SceneContext } from './scene';
import { buildStructures } from './structures';
import { buildTerrainMeshes, disposeObject, type TerrainMeshes } from './terrainMeshes';
import { UnitLayer } from './units';

export interface MapDisplay {
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

export class MapView {
  readonly ctx: SceneContext;
  readonly overlay = new HexOverlay();
  readonly params: TerrainParams = { ...DEFAULT_TERRAIN_PARAMS };
  readonly display: MapDisplay = {
    grid: true,
    trees: true,
    water: true,
    structures: true,
    roads: true,
    units: true,
  };
  readonly units = new UnitLayer();
  map: HexMap | null = null;

  /** 地形・木・人工物を作り直したとき */
  onGenerated: (stats: GenStats) => void = () => {};

  private meshes: TerrainMeshes | null = null;
  private terrainData: TerrainData | null = null;
  /** 木と人工物（地形を作り直さずに差し替えられる部分） */
  private decor: { forest: THREE.Group; structures: THREE.Group; roads: THREE.Group } | null = null;
  private stats: GenStats = { ms: 0, vertices: 0, trees: 0 };
  private gridOpacity = this.overlay.uniforms.uGridOpacity.value;
  private _foliagePrepass = true;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    ctx.overlay.add(this.units.group);
    this.units.art.onChange = () => this.rebuildUnits();
  }

  /** 生成済みの地形データ（マップ未読み込みなら null） */
  get terrain(): TerrainData | null {
    return this.terrainData;
  }

  setMap(map: HexMap, resetCamera = true): void {
    this.map = map;
    this.overlay.setLayout(map.layout);
    this.ctx.parchment.uniforms.uPaperScale.value = map.layout.size;
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
    this.ctx.invalidateShadows();
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
    const forest = createForest(trees, map.data.seed);
    setFoliagePrepass(forest, this.foliagePrepass);
    this.decor = { forest, structures: buildStructures(map, data, roadIndex), roads };
    this.ctx.scene.add(this.decor.forest, this.decor.structures, this.decor.roads);
    this.ctx.invalidateShadows();
    // 橋の有無で足元の高さが変わるのでユニットも置き直す
    this.rebuildUnits();
    this.applyDisplay();
    this.onGenerated({ ...this.stats, ms: this.stats.ms + performance.now() - t0, trees: trees.length });
  }

  rebuildUnits(): void {
    if (this.map && this.terrainData) this.units.build(this.map, this.terrainData);
  }

  /** 森の深度プリパス（葉の重なりを 1 回だけ塗る）を使うか */
  get foliagePrepass(): boolean {
    return this._foliagePrepass;
  }

  set foliagePrepass(v: boolean) {
    this._foliagePrepass = v;
    if (this.decor) setFoliagePrepass(this.decor.forest, v);
  }

  /** display の表示・非表示を反映する */
  applyDisplay(): void {
    // 表示を切り替えたものの影も消える・現れるようにする
    this.ctx.invalidateShadows();
    this.overlay.uniforms.uGridOpacity.value = this.display.grid ? this.gridOpacity : 0;
    if (this.meshes) this.meshes.water.visible = this.display.water;
    if (this.decor) {
      this.decor.forest.visible = this.display.trees;
      this.decor.structures.visible = this.display.structures;
      this.decor.roads.visible = this.display.roads;
    }
    this.units.group.visible = this.display.units;
  }

  setGridOpacity(v: number): void {
    this.gridOpacity = v;
    this.applyDisplay();
  }

  /**
   * レイの先の HEX。units = true なら、ユニットの画像に重なっていればそのユニットの HEX を指す
   * （ユニットは地形より手前に描いているため）。
   */
  pick(raycaster: THREE.Raycaster, units = true): Offset | null {
    if (!this.meshes || !this.map) return null;
    if (units) {
      const unit = this.units.pick(raycaster);
      if (unit) return { col: unit.col, row: unit.row };
    }
    const targets: THREE.Object3D[] = [this.meshes.terrain];
    if (this.meshes.water.visible) targets.push(this.meshes.water);
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    const o = this.map.layout.worldToOffset(hit.point.x, hit.point.z);
    return this.map.layout.inBounds(o.col, o.row) ? o : null;
  }

  setHover(o: Offset | null): void {
    this.overlay.uniforms.uHover.value.set(o?.col ?? -1, o?.row ?? -1);
  }

  setSelected(o: Offset | null): void {
    this.overlay.uniforms.uSelected.value.set(o?.col ?? -1, o?.row ?? -1);
  }

  /** 毎フレーム呼ぶ（風揺れの時間を進めて描画する） */
  render(): void {
    windUniforms.uTime.value = performance.now() / 1000;
    this.ctx.render();
  }
}
