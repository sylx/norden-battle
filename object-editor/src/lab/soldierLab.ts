/**
 * プロシージャル兵士の試作場。
 * カタログの Mixamo 骨格のアセットから骨格の雛形とモーションを集め、兵士を 1 体または部隊で並べる。
 * 比較用にカタログのキャラクターを横に置ける。
 */
import type { SourceEntry } from '@norden/asset-runtime';
import {
  buildSoldier,
  canBuildSoldier,
  createSkeletonTemplate,
  DEFAULT_SOLDIER,
  loadSourceAsset,
  type LoadedAsset,
  type SoldierParams,
} from '@norden/asset-runtime/three';
import * as THREE from 'three';
import { SOURCES_URL } from '../api';
import type { ViewerScene } from '../render/scene';

interface Unit {
  object: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  mixer: THREE.AnimationMixer;
  /** アニメーションの開始位置（0..1） */
  phase: number;
}

/** 部隊の並び（4 列 × 3 行） */
const SQUAD_COLS = 4;
const SQUAD_ROWS = 3;
const SQUAD_DX = 0.13;
const SQUAD_DZ = 0.15;

export type LabMode = 'single' | 'squad';

export class SoldierLab {
  readonly group = new THREE.Group();
  params: SoldierParams = { ...DEFAULT_SOLDIER };
  mode: LabMode = 'single';
  /** Mixamo 骨格のアセット */
  sources: SourceEntry[] = [];
  skeletonId = '';
  /** 表示名 → クリップ */
  readonly clips = new Map<string, THREE.AnimationClip>();
  clipName = '';
  speed = 1;
  compareId = '';
  triangles = 0;
  /** パネルを作り直す必要があるとき増える */
  revision = 0;
  private template: THREE.Object3D | null = null;
  private units: Unit[] = [];
  private compare: { asset: LoadedAsset; mixer: THREE.AnimationMixer } | null = null;
  private readonly view: ViewerScene;

  constructor(view: ViewerScene) {
    this.view = view;
    this.group.name = 'soldier-lab';
  }

  get unitCount(): number {
    return this.units.length;
  }

  /** カタログから骨格とモーションを集める */
  async init(entries: SourceEntry[]): Promise<void> {
    this.sources = entries.filter((e) => e.skeleton === 'mixamo');
    if (this.sources.length === 0)
      throw new Error('Mixamo 骨格のアセットがありません。先に Mixamo のキャラかモーションを取り込んでください');
    for (const e of this.sources) {
      const a = await loadSourceAsset(e, SOURCES_URL);
      for (const clip of a.animations) {
        const label = a.animations.length === 1 ? e.name : `${e.name} / ${clip.name}`;
        this.clips.set(label, clip);
      }
      a.object.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const labels = [...this.clips.keys()];
    this.clipName = labels.find((l) => /idle/i.test(l)) ?? labels[0] ?? '';
    // キャラクターの基準姿勢の方が確実なので優先する
    const first = this.sources.find((e) => e.category === 'character') ?? this.sources[0];
    await this.setSkeleton(first.id);
  }

  async setSkeleton(id: string): Promise<void> {
    const entry = this.sources.find((e) => e.id === id);
    if (!entry) return;
    const a = await loadSourceAsset(entry, SOURCES_URL);
    const tpl = createSkeletonTemplate(a.object.model);
    if (!tpl || !canBuildSoldier(tpl)) throw new Error(`${entry.name}: 兵士に必要な骨がそろっていません`);
    this.template = tpl;
    this.skeletonId = id;
    this.rebuild();
    this.revision++;
  }

  /** パラメータから兵士を作り直す */
  rebuild(): void {
    if (!this.template) return;
    for (const u of this.units) {
      u.mixer.stopAllAction();
      u.object.removeFromParent();
      u.mesh.geometry.dispose();
      u.mesh.skeleton.dispose();
    }
    this.units = [];
    const n = this.mode === 'squad' ? SQUAD_COLS * SQUAD_ROWS : 1;
    this.triangles = 0;
    for (let i = 0; i < n; i++) {
      const params = n === 1 ? this.params : { ...this.params, seed: this.params.seed * 1000 + i };
      const s = buildSoldier(this.template, params);
      if (n > 1) {
        const col = i % SQUAD_COLS;
        const row = Math.floor(i / SQUAD_COLS);
        // -1..1 のばらつき
        const j = (k: number) => (Math.sin(params.seed * 12.9898 + k * 78.233) * 43758.5453) % 1;
        s.object.position.set((col - (SQUAD_COLS - 1) / 2) * SQUAD_DX + j(1) * 0.015, 0, (row - (SQUAD_ROWS - 1) / 2) * SQUAD_DZ + j(2) * 0.012);
        s.object.rotation.y = j(3) * 0.12;
      }
      this.group.add(s.object);
      this.units.push({ object: s.object, mesh: s.mesh, mixer: new THREE.AnimationMixer(s.object.model), phase: n > 1 ? (i * 0.37) % 1 : 0 });
      this.triangles += s.triangles;
    }
    this.placeCompare();
    this.play();
  }

  setClip(name: string): void {
    this.clipName = name;
    this.play();
  }

  private play(): void {
    const clip = this.clips.get(this.clipName);
    const start = (mixer: THREE.AnimationMixer, phase: number) => {
      mixer.stopAllAction();
      if (!clip) return;
      const action = mixer.clipAction(clip);
      action.reset().play();
      action.time = phase * clip.duration;
    };
    for (const u of this.units) start(u.mixer, u.phase);
    if (this.compare) start(this.compare.mixer, 0);
  }

  async setCompare(id: string): Promise<void> {
    if (this.compare) {
      this.compare.mixer.stopAllAction();
      this.compare.asset.object.removeFromParent();
      this.compare = null;
    }
    this.compareId = id;
    if (id) {
      // 比較できるのはカタログ全体のキャラクター（Mixamo 以外の骨格ならモーションは再生されない）
      const entry = this.compareCandidates.find((e) => e.id === id);
      if (!entry) return;
      const asset = await loadSourceAsset(entry, SOURCES_URL);
      asset.object.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
      });
      this.compare = { asset, mixer: new THREE.AnimationMixer(asset.object.model) };
      this.group.add(asset.object);
      this.placeCompare();
      this.play();
    }
  }

  compareCandidates: SourceEntry[] = [];

  private placeCompare(): void {
    if (!this.compare) return;
    const x = this.mode === 'squad' ? (SQUAD_COLS / 2) * SQUAD_DX + 0.15 : 0.16;
    this.compare.asset.object.position.set(x, 0, 0);
  }

  update(dt: number): void {
    const d = dt * this.speed;
    for (const u of this.units) u.mixer.update(d);
    this.compare?.mixer.update(d);
  }

  /** 1 体に寄る */
  frameClose(): void {
    const box = new THREE.Box3();
    if (this.units[0]) box.setFromObject(this.units[0].object);
    this.view.frame(box);
  }

  /**
   * 戦闘中に見る距離から見下ろす。
   * 画面の縦が dist×0.69 ほどの範囲になる（fov 38°）。dist = 5 なら HEX がおよそ 2 つ並ぶくらい
   */
  battleView(dist: number): void {
    const target = new THREE.Vector3(this.mode === 'squad' && this.compare ? 0.1 : 0, 0.05, 0);
    const pitch = THREE.MathUtils.degToRad(52);
    this.view.controls.target.copy(target);
    const dir = new THREE.Vector3(0.2, Math.sin(pitch), Math.cos(pitch)).normalize();
    this.view.camera.position.copy(target).addScaledVector(dir, dist);
    this.view.controls.update();
    this.view.setShadowRange(1.2);
  }

  dispose(): void {
    for (const u of this.units) {
      u.mixer.stopAllAction();
      u.mesh.geometry.dispose();
      u.mesh.skeleton.dispose();
    }
    this.units = [];
    if (this.compare) this.compare.mixer.stopAllAction();
    this.compare = null;
    this.group.removeFromParent();
    this.group.clear();
  }
}
