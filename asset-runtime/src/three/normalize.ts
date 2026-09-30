/**
 * カタログの正規化の変換（NormalizeTransform）をモデルに当てる。
 *
 *   NormalizedModel (scale) → pivot (position) → rotation (rotation) → model
 *
 * p' = scale × (R·p + pivot)。GLB は元のままにして、変換だけをカタログで持つ。
 */
import * as THREE from 'three';
import type { NormalizeTransform, Vec3Tuple } from '../catalog';

const DEG = Math.PI / 180;

export class NormalizedModel extends THREE.Group {
  readonly model: THREE.Object3D;
  private readonly pivotNode = new THREE.Group();
  private readonly rotationNode = new THREE.Group();

  constructor(model: THREE.Object3D, t: NormalizeTransform) {
    super();
    this.model = model;
    this.name = `${model.name || 'model'}:normalized`;
    this.rotationNode.add(model);
    this.pivotNode.add(this.rotationNode);
    this.add(this.pivotNode);
    this.setTransform(t);
  }

  setTransform(t: NormalizeTransform): void {
    this.rotationNode.rotation.set(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG, 'XYZ');
    this.pivotNode.position.set(t.pivot[0], t.pivot[1], t.pivot[2]);
    this.scale.setScalar(t.scale);
    this.updateMatrixWorld(true);
  }

  /** 回転だけを当てた（ずらし・スケール前の）座標系でのバウンディングボックス */
  measureRotated(): THREE.Box3 {
    this.updateWorldMatrix(true, true);
    const toPivot = this.pivotNode.matrixWorld.clone().invert();
    return boundsIn(this.model, toPivot);
  }

  /** 足元の中心を原点にする pivot */
  feetPivot(): Vec3Tuple {
    const box = this.measureRotated();
    if (box.isEmpty()) return [0, 0, 0];
    const c = box.getCenter(new THREE.Vector3());
    return [-c.x, -box.min.y, -c.z];
  }
}

const _box = new THREE.Box3();
const _m = new THREE.Matrix4();

const _p = new THREE.Vector3();

/**
 * root 以下のメッシュの頂点範囲と骨の位置を、ワールド → space の行列で移した座標系で求める（スキンはバインドポーズ）。
 * 骨も含めるのは、メッシュを持たないモーションだけのファイル（Mixamo の Without Skin）でも大きさを測れるようにするため。
 */
function boundsIn(root: THREE.Object3D, worldToSpace: THREE.Matrix4): THREE.Box3 {
  const out = new THREE.Box3();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) {
      out.expandByPoint(_p.setFromMatrixPosition(o.matrixWorld).applyMatrix4(worldToSpace));
      return;
    }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox) return;
    _m.multiplyMatrices(worldToSpace, mesh.matrixWorld);
    out.union(_box.copy(g.boundingBox).applyMatrix4(_m));
  });
  return out;
}
