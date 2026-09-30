import * as THREE from 'three';

/**
 * 手続き的にメッシュを組み立てるための頂点バッファ。
 * withPattern = true のときは頂点ごとの模様 ID（aPattern 属性）も持つ（建物用）。
 */
export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private pat: number[] = [];
  private idx: number[] = [];
  private readonly withPattern: boolean;

  constructor(withPattern = false) {
    this.withPattern = withPattern;
  }

  get count(): number {
    return this.pos.length / 3;
  }

  vertex(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: THREE.Color, pattern = 0): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    if (this.withPattern) this.pat.push(pattern);
    return this.count - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** 既存ジオメトリを色付けして追加する（g は破棄される） */
  append(g: THREE.BufferGeometry, color: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color, pattern = 0): void {
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const base = this.count;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i);
      n.fromBufferAttribute(N, i);
      this.vertex(p, n, 0, 0, color(p, n), pattern);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    g.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.withPattern) g.setAttribute('aPattern', new THREE.Float32BufferAttribute(this.pat, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
