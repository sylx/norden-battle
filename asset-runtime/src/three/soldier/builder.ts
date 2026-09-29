/**
 * パーツを 1 本の骨に固定する（重みが 1 本だけの）スキンメッシュを組み立てる。
 * パーツは骨格の基準姿勢のモデル座標で置く。頂点カラー + フラットシェーディング。
 */
import * as THREE from 'three';

export class RigidMeshBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly bone: number[] = [];

  get triangles(): number {
    return this.pos.length / 9;
  }

  /** geo は使い捨て（dispose する） */
  add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color, boneIndex: number): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(matrix);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.col.push(color.r, color.g, color.b);
      this.bone.push(boneIndex);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const n = this.bone.length;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = this.bone[i];
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    // インデックスなしなので面ごとの法線になる
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/**
 * 原点 origin、ローカル y = up、ローカル z = fwd（up に直交化）の座標系。
 * ローカル x = y × z（体の正面を z にすると x は体の左）。
 */
export function frame(origin: THREE.Vector3, up: THREE.Vector3, fwd: THREE.Vector3, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _y.copy(up).normalize();
  _z.copy(fwd).addScaledVector(_y, -fwd.dot(_y));
  if (_z.lengthSq() < 1e-10) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  if (_z.lengthSq() < 1e-10) _z.set(1, 0, 0).addScaledVector(_y, -_y.x);
  _z.normalize();
  _x.crossVectors(_y, _z);
  return new THREE.Matrix4().makeBasis(_x, _y, _z).setPosition(origin).scale(new THREE.Vector3(sx, sy, sz));
}

/** a から b への筒。断面の半径 ra → rb、sx / sz で断面を横・前後に伸ばす */
export function tube(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, sides: number, fwd: THREE.Vector3, sx = 1, sz = 1) {
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(rb, ra, len, sides, 1, false, sides === 4 ? Math.PI / 4 : 0);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  return { geo, matrix: frame(mid, b.clone().sub(a), fwd, sx, 1, sz) };
}

export function box(center: THREE.Vector3, up: THREE.Vector3, fwd: THREE.Vector3, w: number, h: number, d: number) {
  return { geo: new THREE.BoxGeometry(w, h, d), matrix: frame(center, up, fwd) };
}

export function ellipsoid(center: THREE.Vector3, up: THREE.Vector3, fwd: THREE.Vector3, rx: number, ry: number, rz: number, detail = 1) {
  return { geo: new THREE.IcosahedronGeometry(1, detail), matrix: frame(center, up, fwd, rx, ry, rz) };
}

/** 上半分の球（底面は開いている） */
export function dome(center: THREE.Vector3, up: THREE.Vector3, fwd: THREE.Vector3, r: number, ry: number, segments = 10) {
  const geo = new THREE.SphereGeometry(1, segments, Math.max(3, segments >> 1), 0, Math.PI * 2, 0, Math.PI / 2);
  return { geo, matrix: frame(center, up, fwd, r, ry, r) };
}

/** 底面の中心 base から up 方向へ高さ h の錐 */
export function cone(base: THREE.Vector3, up: THREE.Vector3, fwd: THREE.Vector3, r: number, h: number, sides: number) {
  const geo = new THREE.CylinderGeometry(0, r, h, sides, 1, false, sides === 4 ? Math.PI / 4 : 0);
  const center = base.clone().addScaledVector(up.clone().normalize(), h / 2);
  return { geo, matrix: frame(center, up, fwd) };
}
