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
import { Forest, windUniforms, type ForestMode } from './foliage';
import { HexOverlay, type RangeCell } from './hexOverlay';
import { PathArrow } from './pathArrow';
import { buildRoadMesh } from './roads';
import type { SceneContext } from './scene';
import { buildStructures } from './structures';
import { buildTerrainMeshes, disposeObject, type TerrainMeshes } from './terrainMeshes';
import { BRIDGE_DECK, UnitLayer } from './units';

/** 攻撃の矢印を相手の HEX の中心の手前で止める量（hexSize 比。足元に刺さるように） */
const ATTACK_END_GAP = 0.3;
/** 遠隔攻撃の放物線の高さ（距離比）と、飛び出す高さ（hexSize 比） */
const ATTACK_ARC_RISE = 0.3;
const ATTACK_ARC_LIFT = 0.35;

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
  /** 経路の矢印（移動ルートなど） */
  readonly pathArrow = new PathArrow();
  /** 2 本目の経路の矢印（攻撃の後の移動など、1 本目とつながらない経路） */
  readonly afterPathArrow = new PathArrow();
  /** 攻撃の対象を指す赤い矢印（遠隔攻撃は放物線。ユニットより手前に描く） */
  readonly attackArrow = new PathArrow({ fill: 0xe0402e, stripe: 0xffc8b0, outline: 0x2a0c08, order: 13 });
  /** 攻撃に加わる味方から対象へ伸ばす、細い赤い矢印（一斉攻撃など。何本でも） */
  readonly supportArrow = new PathArrow({ fill: 0xe0402e, stripe: 0xffc8b0, outline: 0x2a0c08, order: 13, width: 0.55 });
  map: HexMap | null = null;

  /** 地形・木・人工物を作り直したとき */
  onGenerated: (stats: GenStats) => void = () => {};

  private meshes: TerrainMeshes | null = null;
  private terrainData: TerrainData | null = null;
  private heightmap: Heightmap | null = null;
  /** 木と人工物（地形を作り直さずに差し替えられる部分） */
  private decor: { forest: Forest; structures: THREE.Group; roads: THREE.Group } | null = null;
  /** decor の森に木を配置したか（木を表示しないときは配置の計算を省く） */
  private decorHasTrees = false;
  private stats: GenStats = { ms: 0, vertices: 0, trees: 0 };
  private gridOpacity = this.overlay.uniforms.uGridOpacity.value;
  private _foliagePrepass = true;
  private _forestMode: ForestMode = 'impostor';

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    ctx.overlay.add(this.units.group, this.pathArrow.group, this.afterPathArrow.group, this.attackArrow.group, this.supportArrow.group);
    ctx.onShadowPass = (active) => this.decor?.forest.setShadowPass(active);
    this.units.art.onChange = () => this.rebuildUnits();
  }

  /** 生成済みの地形データ（マップ未読み込みなら null） */
  get terrain(): TerrainData | null {
    return this.terrainData;
  }

  setMap(map: HexMap, resetCamera = true): void {
    this.map = map;
    this.overlay.setLayout(map.layout);
    this.pathArrow.clear();
    this.afterPathArrow.clear();
    this.attackArrow.clear();
    this.supportArrow.clear();
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
    this.heightmap = new Heightmap(data);
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
      this.ctx.scene.remove(this.decor.forest.group, this.decor.structures, this.decor.roads);
      this.decor.forest.dispose();
      disposeObject(this.decor.structures);
      disposeObject(this.decor.roads);
    }
    const roadPaths = buildRoadPaths(map);
    const roadIndex = new RoadIndex(roadPaths);
    // 木を表示しないなら配置の計算も省く（表示したときに作り直す）
    const trees = this.display.trees ? placeVegetation(map, data, this.params, roadIndex) : [];
    this.decorHasTrees = this.display.trees;
    const roads = new THREE.Group();
    const roadMesh = buildRoadMesh(roadPaths, new Heightmap(data), data.waterLevel, map.layout.size);
    if (roadMesh) roads.add(roadMesh);
    const forest = new Forest(trees, map.data.seed, this.ctx.renderer, {
      mode: this._forestMode,
      prepass: this._foliagePrepass,
      pitch: this.ctx.pitch,
    });
    this.decor = { forest, structures: buildStructures(map, data, roadIndex), roads };
    this.ctx.scene.add(forest.group, this.decor.structures, this.decor.roads);
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
    this.decor?.forest.setPrepass(v);
  }

  /** 森の描き方（既定は板絵。'mesh' で葉のカードの 3D モデル） */
  get forestMode(): ForestMode {
    return this._forestMode;
  }

  set forestMode(v: ForestMode) {
    this._forestMode = v;
    this.decor?.forest.setMode(v, this.ctx.pitch);
  }

  /** display の表示・非表示を反映する */
  applyDisplay(): void {
    if (this.display.trees && this.decor && !this.decorHasTrees) {
      this.rebuildDecor(); // 最後にもう一度 applyDisplay が呼ばれる
      return;
    }
    // 表示を切り替えたものの影も消える・現れるようにする
    this.ctx.invalidateShadows();
    this.overlay.uniforms.uGridOpacity.value = this.display.grid ? this.gridOpacity : 0;
    if (this.meshes) this.meshes.water.visible = this.display.water;
    if (this.decor) {
      this.decor.forest.group.visible = this.display.trees;
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

  /** 選択中のユニットの HEX と画像を脈打つ光で強調し、ほかのユニットを暗くする（null で解除） */
  setFocus(o: Offset | null): void {
    this.overlay.uniforms.uFocus.value.set(o?.col ?? -1, o?.row ?? -1);
    this.units.setFocus(o);
  }

  /** 範囲（移動範囲など）の HEX を塗り、外周を縁取る。mark の付いた HEX には印を付け、weak の HEX は薄く塗る。null で消す */
  setRange(cells: Iterable<RangeCell> | null, color?: THREE.ColorRepresentation, markColor?: THREE.ColorRepresentation): void {
    this.overlay.setRange(cells, color, markColor);
  }

  /**
   * 経路（出発地 → 到着地の HEX）に沿って地面に矢印を出す。null で消す。
   * after は 1 本目とつながらない 2 本目の経路（突撃で飛び出た先からの移動など）。
   */
  setPath(path: readonly Offset[] | null, after: readonly Offset[] | null = null): void {
    if (!this.map) return;
    const groundAt = (x: number, z: number) => this.groundAt(x, z);
    this.pathArrow.set(path, this.map.layout, groundAt);
    this.afterPathArrow.set(after, this.map.layout, groundAt);
  }

  /**
   * from から to のユニットへ攻撃の矢印を出す（null で消す）。
   * arc = false は地面に沿うまっすぐな矢印、true は放物線を描いて飛ぶ矢印（遠隔攻撃）。
   * beyond を渡すと、to を突き抜けて beyond の HEX まで地面に沿って伸ばす（突撃で飛び出る先）。
   */
  setAttack(from: Offset | null, to: Offset | null, arc = false, beyond: Offset | null = null): void {
    const map = this.map;
    if (!map || !from || !to) return this.attackArrow.clear();
    if (beyond) return this.attackArrow.set([from, to, beyond], map.layout, (x, z) => this.groundAt(x, z));
    const a = map.layout.offsetToWorld(from.col, from.row);
    const b = map.layout.offsetToWorld(to.col, to.row);
    const ya = this.groundAt(a.x, a.z);
    const yb = this.groundAt(b.x, b.z);
    const s = map.layout.size;
    const peak = Math.hypot(b.x - a.x, b.z - a.z) * ATTACK_ARC_RISE;
    const heightAt = arc
      ? (_x: number, _z: number, d: number, total: number) => {
          // 両端の地面の高さを結んだ線の上に放物線を乗せる（ユニットの胸の高さから飛び出して足元に落ちる）
          const t = Math.min(Math.max(d / total, 0), 1);
          return ya + (yb - ya) * t + 4 * peak * t * (1 - t) + ATTACK_ARC_LIFT * s * (1 - t);
        }
      : (x: number, z: number) => this.groundAt(x, z);
    this.attackArrow.set([from, to], map.layout, heightAt, ATTACK_END_GAP);
  }

  /** from の各 HEX から to のユニットへ、地面に沿う細い攻撃の矢印を出す（攻撃に加わる味方。空か to が null で消す） */
  setSupportAttacks(from: readonly Offset[], to: Offset | null): void {
    const map = this.map;
    this.supportArrow.clear();
    if (!map || !to) return;
    for (const f of from) this.supportArrow.add([f, to], map.layout, (x, z) => this.groundAt(x, z), ATTACK_END_GAP);
  }

  /** ユニットが立つ地面の高さ。水の上は水面、橋の HEX は橋の上（ユニットの足元と同じ高さ） */
  groundAt(x: number, z: number): number {
    const map = this.map;
    const data = this.terrainData;
    if (!map || !data) return 0;
    const o = map.layout.worldToOffset(x, z);
    const floor = map.get(o.col, o.row)?.feature === 'bridge' ? data.waterLevel + BRIDGE_DECK * map.layout.size : data.waterLevel;
    return Math.max(this.heightmap!.heightAt(x, z), floor);
  }

  /** 地形・木・人工物・ユニット・矢印の GPU 資源を破棄する（SceneContext は呼び出し側で破棄する） */
  dispose(): void {
    if (this.decor) {
      this.ctx.scene.remove(this.decor.forest.group, this.decor.structures, this.decor.roads);
      this.decor.forest.dispose();
      disposeObject(this.decor.structures);
      disposeObject(this.decor.roads);
      this.decor = null;
    }
    if (this.meshes) {
      this.ctx.scene.remove(this.meshes.group);
      this.meshes.dispose();
      this.meshes = null;
    }
    this.ctx.overlay.remove(this.units.group, this.pathArrow.group, this.afterPathArrow.group, this.attackArrow.group, this.supportArrow.group);
    this.units.dispose();
    for (const arrow of [this.pathArrow, this.afterPathArrow, this.attackArrow, this.supportArrow]) arrow.dispose();
    this.overlay.uniforms.uCellTex.value.dispose();
    this.overlay.uniforms.uRangeTex.value.dispose();
    this.ctx.onShadowPass = () => {};
    this.units.art.onChange = () => {};
    this.map = null;
    this.terrainData = null;
    this.heightmap = null;
  }

  /** 毎フレーム呼ぶ（風揺れの時間を進めて描画する） */
  render(): void {
    windUniforms.uTime.value = performance.now() / 1000;
    this.overlay.uniforms.uTime.value = windUniforms.uTime.value;
    this.units.time.value = windUniforms.uTime.value;
    this.pathArrow.time.value = windUniforms.uTime.value;
    this.afterPathArrow.time.value = windUniforms.uTime.value;
    this.attackArrow.time.value = windUniforms.uTime.value;
    this.supportArrow.time.value = windUniforms.uTime.value;
    // 俯角を変えたら板絵を焼き直す
    this.decor?.forest.setPitch(this.ctx.pitch);
    this.ctx.render();
  }
}
