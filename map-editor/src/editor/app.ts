import * as THREE from 'three';
import { HexMap, type HexCell, type MapData } from '../core/mapData';
import type { Offset } from '../core/hex';
import { DEFAULT_TERRAIN_PARAMS, generateTerrain, type TerrainParams } from '../core/terrainGen';
import { TERRAIN_DEFS } from '../core/terrainTypes';
import { HexOverlay } from '../render/hexOverlay';
import { SceneContext } from '../render/scene';
import { windUniforms } from '../render/foliage';
import { buildTerrainMeshes, type TerrainMeshes } from '../render/terrainMeshes';

export type OverlayMode = 'none' | 'terrain' | 'elevation';

export interface DisplayOptions {
  overlayMode: OverlayMode;
  grid: boolean;
  trees: boolean;
  water: boolean;
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
  readonly display: DisplayOptions = { overlayMode: 'none', grid: true, trees: true, water: true };
  map: HexMap | null = null;
  selected: Offset | null = null;

  onHover: (cell: HexCell | null) => void = () => {};
  onSelect: (cell: HexCell | null) => void = () => {};
  onGenerated: (stats: GenStats) => void = () => {};

  private meshes: TerrainMeshes | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private pointerDirty = false;
  private downPos: { x: number; y: number } | null = null;
  private gridOpacity = this.overlay.uniforms.uGridOpacity.value;

  constructor(container: HTMLElement) {
    this.ctx = new SceneContext(container);
    const el = this.ctx.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.setPointer(e));
    el.addEventListener('pointerleave', () => this.setHover(null));
    el.addEventListener('pointerdown', (e) => (this.downPos = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !this.downPos) return;
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      this.downPos = null;
      if (moved > 4) return; // ドラッグ（パン）はクリック扱いしない
      this.setPointer(e);
      this.setSelected(this.pick());
    });
    this.ctx.renderer.setAnimationLoop(() => this.frame());
  }

  loadMap(data: MapData, resetCamera = true): void {
    this.map = new HexMap(data);
    this.overlay.setLayout(this.map.layout);
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
    this.meshes = buildTerrainMeshes(data, this.overlay, this.map.data.seed);
    this.ctx.scene.add(this.meshes.group);
    this.applyDisplay();
    this.ctx.fitTo(
      {
        minX: data.minX,
        minZ: data.minZ,
        maxX: data.minX + (data.nx - 1) * data.step,
        maxZ: data.minZ + (data.nz - 1) * data.step,
      },
      resetCamera,
    );
    this.onGenerated({ ms: data.stats.ms, vertices: data.nx * data.nz, trees: data.trees.length });
  }

  applyDisplay(): void {
    const u = this.overlay.uniforms;
    u.uGridOpacity.value = this.display.grid ? this.gridOpacity : 0;
    if (this.meshes) {
      this.meshes.trees.visible = this.display.trees;
      this.meshes.water.visible = this.display.water;
    }
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
    this.overlay.setCellColors((col, row) => {
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
    const targets: THREE.Object3D[] = [this.meshes.terrain];
    if (this.meshes.water.visible) targets.push(this.meshes.water);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    const o = this.map.layout.worldToOffset(hit.point.x, hit.point.z);
    return this.map.layout.inBounds(o.col, o.row) ? o : null;
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
