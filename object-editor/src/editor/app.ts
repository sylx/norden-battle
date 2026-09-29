/**
 * object-editor の状態。カタログの一覧と、開いているアセット（編集中のコピー）を持つ。
 */
import {
  CATALOG_VERSION,
  isValidAssetId,
  slugifyAssetId,
  sourceWarnings,
  stringifySourceEntry,
  validateSourceEntry,
  type CategoryId,
  type LicenseId,
  type NormalizeTransform,
  type SourceEntry,
  type SourceOrigin,
} from '@norden/asset-runtime';
import { loadSourceAsset, type LoadedAsset } from '@norden/asset-runtime/three';
import * as THREE from 'three';
import { deleteSourceEntry, fetchCatalog, putSourceEntry, putSourceFile, SOURCES_URL } from '../api';
import { exportGlb } from '../import/convert';
import { guessCategory, initialTransform, roundScale } from '../import/defaults';
import { baseName, parseModel, splitFiles, type ParsedModel } from '../import/loadModel';
import { computeStats } from '../import/stats';
import { ViewerScene } from '../render/scene';

export interface OpenAsset {
  /** 編集中のコピー */
  entry: SourceEntry;
  /** 最後に保存した内容（変更の判定用） */
  savedJson: string;
  loaded: LoadedAsset;
  mixer: THREE.AnimationMixer;
  action: THREE.AnimationAction | null;
  skeletonHelper: THREE.SkeletonHelper | null;
}

/** 取り込み待ちのモデル 1 つ */
export interface PendingImport {
  parsed: ParsedModel;
  id: string;
  name: string;
  category: CategoryId;
}

/** 取り込みで共通に指定するもの */
export interface ImportCommon {
  license: LicenseId;
  origin: SourceOrigin;
  tags: string[];
}

export interface DisplayOptions {
  references: boolean;
  skeleton: boolean;
  wireframe: boolean;
}

type Listener = () => void;

export class ObjectEditorApp {
  readonly view: ViewerScene;
  entries: SourceEntry[] = [];
  catalogErrors: string[] = [];
  current: OpenAsset | null = null;
  pending: PendingImport[] = [];
  readonly display: DisplayOptions = { references: true, skeleton: false, wireframe: false };
  private readonly clock = new THREE.Clock();
  private readonly listeners = new Set<Listener>();

  constructor(container: HTMLElement) {
    this.view = new ViewerScene(container);
    const loop = () => {
      requestAnimationFrame(loop);
      this.current?.mixer.update(this.clock.getDelta());
      this.view.render();
    };
    loop();
  }

  /** 状態が変わったら呼ばれる（UI の再描画用） */
  onChange(fn: Listener): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get dirty(): boolean {
    return !!this.current && stringifySourceEntry(this.current.entry) !== this.current.savedJson;
  }

  get errors(): string[] {
    return this.current ? validateSourceEntry(this.current.entry) : [];
  }

  get warnings(): string[] {
    return this.current ? sourceWarnings(this.current.entry) : [];
  }

  async refreshCatalog(): Promise<void> {
    const { sources, errors } = await fetchCatalog();
    this.entries = sources;
    this.catalogErrors = errors;
    this.emit();
  }

  // --- 開く・閉じる ---

  async open(id: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) throw new Error(`見つかりません: ${id}`);
    const loaded = await loadSourceAsset(structuredClone(entry), SOURCES_URL);
    this.close();
    loaded.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.view.stage.add(loaded.object);
    this.current = {
      entry: loaded.entry,
      savedJson: stringifySourceEntry(entry),
      loaded,
      mixer: new THREE.AnimationMixer(loaded.object.model),
      action: null,
      skeletonHelper: null,
    };
    this.applyDisplay();
    this.frame();
    this.emit();
  }

  close(): void {
    const c = this.current;
    if (!c) return;
    c.mixer.stopAllAction();
    c.skeletonHelper?.removeFromParent();
    c.skeletonHelper?.dispose();
    c.loaded.object.removeFromParent();
    c.loaded.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
    });
    this.current = null;
    this.emit();
  }

  frame(): void {
    if (!this.current) return;
    this.view.frame(new THREE.Box3().setFromObject(this.current.loaded.object));
  }

  // --- 編集 ---

  /** 変換以外の項目を書き換える */
  edit(fn: (e: SourceEntry) => void): void {
    if (!this.current) return;
    fn(this.current.entry);
    this.emit();
  }

  setTransform(t: NormalizeTransform, autoPivot: boolean): void {
    const c = this.current;
    if (!c) return;
    c.loaded.object.setTransform(t);
    if (autoPivot) {
      t = { ...t, pivot: c.loaded.object.feetPivot().map(round4) as NormalizeTransform['pivot'] };
      c.loaded.object.setTransform(t);
    }
    c.entry.transform = t;
    this.emit();
  }

  /** 回転後の（スケール前の）高さ */
  rotatedHeight(): number {
    const box = this.current?.loaded.object.measureRotated();
    return box && !box.isEmpty() ? box.max.y - box.min.y : 0;
  }

  /** 正規化後の高さが h になるようにスケールを決める */
  fitHeight(h: number, autoPivot: boolean): void {
    const c = this.current;
    const raw = this.rotatedHeight();
    if (!c || raw <= 0 || !(h > 0)) return;
    this.setTransform({ ...c.entry.transform, scale: roundScale(h / raw) }, autoPivot);
  }

  revert(): void {
    const c = this.current;
    if (!c) return;
    const saved = this.entries.find((e) => e.id === c.entry.id);
    if (!saved) return;
    c.entry = structuredClone(saved);
    c.loaded.object.setTransform(c.entry.transform);
    this.emit();
  }

  async save(): Promise<void> {
    const c = this.current;
    if (!c) return;
    const errs = validateSourceEntry(c.entry);
    if (errs.length > 0) throw new Error(errs.join(' / '));
    const saved = await putSourceEntry(c.entry);
    c.savedJson = stringifySourceEntry(saved);
    this.entries = this.entries.map((e) => (e.id === saved.id ? saved : e));
    this.emit();
  }

  async remove(): Promise<void> {
    const c = this.current;
    if (!c) return;
    await deleteSourceEntry(c.entry.id);
    this.close();
    await this.refreshCatalog();
  }

  // --- アニメーション・表示 ---

  play(clipName: string | null): void {
    const c = this.current;
    if (!c) return;
    c.action?.stop();
    c.action = null;
    const clip = clipName ? c.loaded.animations.find((a) => a.name === clipName) : undefined;
    if (clip) {
      c.action = c.mixer.clipAction(clip);
      c.action.reset().play();
    } else {
      // バインドポーズに戻す
      c.mixer.stopAllAction();
      c.loaded.object.model.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.pose();
      });
    }
    this.emit();
  }

  applyDisplay(): void {
    const d = this.display;
    this.view.references.visible = d.references;
    const c = this.current;
    if (!c) return;
    const hasBones = c.entry.stats.bones > 0;
    // メッシュのないモーションは骨を見せないと何も映らない
    const showSkeleton = hasBones && (d.skeleton || c.entry.stats.meshes === 0);
    if (showSkeleton && !c.skeletonHelper) {
      c.skeletonHelper = new THREE.SkeletonHelper(c.loaded.object.model);
      (c.skeletonHelper.material as THREE.LineBasicMaterial).depthTest = false;
      this.view.scene.add(c.skeletonHelper);
    }
    if (c.skeletonHelper) c.skeletonHelper.visible = showSkeleton;
    c.loaded.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = d.wireframe;
      }
    });
  }

  // --- 取り込み ---

  /** ドロップされたファイルを読み込んで取り込み待ちにする */
  async stageImport(files: File[]): Promise<string[]> {
    const { models, resources } = splitFiles(files);
    if (models.length === 0) throw new Error('モデルファイル（.glb .gltf .fbx .obj）が含まれていません');
    const taken = new Set([...this.entries.map((e) => e.id), ...this.pending.map((p) => p.id)]);
    const warnings: string[] = [];
    for (const file of models) {
      try {
        const parsed = await parseModel(file, resources);
        warnings.push(...parsed.warnings.map((w) => `${file.name}: ${w}`));
        const id = uniqueId(slugifyAssetId(file.name), taken);
        taken.add(id);
        this.pending.push({ parsed, id, name: baseName(file.name), category: guessCategory(parsed) });
      } catch (e) {
        warnings.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.emit();
    return warnings;
  }

  cancelImport(): void {
    this.pending = [];
    this.emit();
  }

  /** 取り込み待ちのものを変換・保存する。最後に取り込んだものを開く */
  async commitImport(common: ImportCommon, onProgress: (msg: string) => void): Promise<void> {
    const taken = new Set(this.entries.map((e) => e.id));
    for (const p of this.pending) {
      if (!isValidAssetId(p.id)) throw new Error(`ID が不正です: "${p.id}"（英小文字・数字・- _）`);
      if (taken.has(p.id)) throw new Error(`ID が重複しています: ${p.id}`);
      taken.add(p.id);
    }
    let last: string | null = null;
    while (this.pending.length > 0) {
      const p = this.pending[0];
      onProgress(`取り込み中: ${p.parsed.file.name}`);
      const { root, animations } = p.parsed;
      const entry: SourceEntry = {
        version: CATALOG_VERSION,
        kind: 'source',
        id: p.id,
        name: p.name || p.id,
        category: p.category,
        tags: [...common.tags],
        license: common.license,
        origin: { ...common.origin },
        files: { original: p.parsed.originals.map((f) => `original/${f.name}`), model: 'model.glb' },
        skeleton: p.parsed.skeleton,
        transform: initialTransform(root, p.category),
        stats: computeStats(root, animations),
        importedAt: new Date().toISOString(),
      };
      const errs = validateSourceEntry(entry);
      if (errs.length > 0) throw new Error(errs.join(' / '));

      const glb = await exportGlb(root, animations);
      for (const f of p.parsed.originals) await putSourceFile(p.id, `original/${f.name}`, f);
      await putSourceFile(p.id, 'model.glb', glb);
      await putSourceEntry(entry);
      this.pending.shift();
      last = p.id;
      this.emit();
    }
    await this.refreshCatalog();
    if (last) await this.open(last);
  }
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  base = base.slice(0, 56);
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}
