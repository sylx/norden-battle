/**
 * ドロップされたファイルを three.js で読み込む。
 * GLB / glTF / FBX / OBJ に対応し、一緒にドロップされたテクスチャ・.bin・.mtl はファイル名で解決する。
 */
import type { SkeletonKind } from '@norden/asset-runtime';
import { normalizeSkeleton } from '@norden/asset-runtime/three';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export const MODEL_EXTS = ['glb', 'gltf', 'fbx', 'obj'] as const;

export interface ParsedModel {
  file: File;
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
  skeleton: SkeletonKind;
  /** 取り込み元として一緒に保存するファイル（モデル本体 + 実際に参照された付属ファイル） */
  originals: File[];
  /** 見つからなかったテクスチャなど */
  warnings: string[];
}

export const extOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
export const baseName = (name: string) => name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

export function splitFiles(files: File[]): { models: File[]; resources: File[] } {
  const isModel = (f: File) => (MODEL_EXTS as readonly string[]).includes(extOf(f.name));
  return { models: files.filter(isModel), resources: files.filter((f) => !isModel(f)) };
}

export async function parseModel(file: File, resources: File[]): Promise<ParsedModel> {
  const byName = new Map(resources.map((f) => [f.name.toLowerCase(), f]));
  const used = new Set<File>();
  const warnings: string[] = [];
  const urls: string[] = [];
  const blobUrl = (f: File) => {
    const u = URL.createObjectURL(f);
    urls.push(u);
    return u;
  };

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('data:')) return url;
    const name = decodeURIComponent(url.split('?')[0].split(/[\\/]/).pop() ?? '').toLowerCase();
    const f = byName.get(name);
    if (!f) return url;
    used.add(f);
    return blobUrl(f);
  });
  manager.onError = (url) => {
    const name = decodeURIComponent(url.split('?')[0].split(/[\\/]/).pop() ?? url);
    warnings.push(`「${name}」が見つかりません。モデルと一緒に選択（ドロップ）してください`);
  };
  // テクスチャは本体より後に読み込まれる（FBX など）ので、すべて終わるまで待つ
  const idle = new Promise<void>((resolve) => (manager.onLoad = resolve));

  try {
    const url = blobUrl(file);
    let root: THREE.Object3D;
    let animations: THREE.AnimationClip[];
    switch (extOf(file.name)) {
      case 'glb':
      case 'gltf': {
        const gltf = await new GLTFLoader(manager).loadAsync(url);
        root = gltf.scene;
        animations = gltf.animations;
        break;
      }
      case 'fbx': {
        const group = await new FBXLoader(manager).loadAsync(url);
        root = group;
        animations = group.animations;
        group.animations = [];
        break;
      }
      case 'obj': {
        const loader = new OBJLoader(manager);
        const mtls = resources.filter((f) => extOf(f.name) === 'mtl');
        const mtl = mtls.find((f) => baseName(f.name) === baseName(file.name)) ?? mtls[0];
        if (mtl) {
          used.add(mtl);
          const materials = new MTLLoader(manager).parse(await mtl.text(), '');
          materials.preload();
          loader.setMaterials(materials);
        }
        root = await loader.loadAsync(url);
        animations = [];
        break;
      }
      default:
        throw new Error(`未対応の形式です: ${file.name}`);
    }
    await idle;

    root.name = root.name || baseName(file.name);
    renameGenericClips(animations, baseName(file.name));
    const skeleton = normalizeSkeleton(root, animations);
    root.updateMatrixWorld(true);
    return { file, root, animations, skeleton, originals: [file, ...used], warnings };
  } finally {
    for (const u of urls) URL.revokeObjectURL(u);
  }
}

/** Mixamo の "mixamo.com" などの意味のないクリップ名をファイル名に置き換える */
function renameGenericClips(clips: THREE.AnimationClip[], base: string): void {
  const generic = (n: string) => n === '' || n === 'mixamo.com' || /^Take \d+$/.test(n) || n === 'Armature|mixamo.com';
  const targets = clips.filter((c) => generic(c.name));
  targets.forEach((c, i) => (c.name = targets.length === 1 ? base : `${base}-${i + 1}`));
}
