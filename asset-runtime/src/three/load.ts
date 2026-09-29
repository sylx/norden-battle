/**
 * カタログのアセットを読み込む。
 */
import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SourceEntry } from '../catalog';
import { NormalizedModel } from './normalize';
import { promoteAnimatedNodesToBones } from './skeleton';

export interface LoadedAsset {
  entry: SourceEntry;
  object: NormalizedModel;
  animations: THREE.AnimationClip[];
}

let sharedLoader: GLTFLoader | null = null;

/**
 * assets/sources/<id>/<files.model> を読み込み、正規化の変換を当てて返す。
 * @param sourcesUrl assets/sources/ を指す URL（末尾の / は不要）
 */
export async function loadSourceAsset(entry: SourceEntry, sourcesUrl: string, loader?: GLTFLoader): Promise<LoadedAsset> {
  const l = loader ?? (sharedLoader ??= new GLTFLoader());
  const gltf = await l.loadAsync(`${sourcesUrl}/${entry.id}/${entry.files.model}`);
  let skinned = false;
  gltf.scene.traverse((o) => (skinned ||= (o as THREE.SkinnedMesh).isSkinnedMesh === true));
  if (!skinned && entry.skeleton !== 'none') promoteAnimatedNodesToBones(gltf.scene, gltf.animations);
  return {
    entry,
    object: new NormalizedModel(gltf.scene, entry.transform),
    animations: gltf.animations,
  };
}
