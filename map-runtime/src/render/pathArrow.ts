/**
 * 経路の矢印（移動ルートの表示など）。HEX の中心を結んだ折れ線の角を丸め、
 * 地面（水面・橋の上）に沿う太い帯と、先端の矢じりを 1 本の帯として作る。
 *
 * ユニットと同じく深度テストをせずに地形・木より手前に描き、ユニット（影・絵）よりは奥に描く。
 * 縁取り用に一回り大きい帯を後ろに重ね、本体には進む向きへ流れる山形の縞を付ける。
 */
import * as THREE from 'three';
import type { HexLayout, Offset, Vec2 } from '../core/hex';
import { Polyline, smoothPath } from '../core/polyline';

/** 帯の半幅・矢じりの半幅・矢じりの長さ・出発点の HEX 中心からの離し（hexSize 比） */
const SHAFT_HALF = 0.11;
const HEAD_HALF = 0.27;
const HEAD_LEN = 0.4;
const START_GAP = 0.18;
/** 縁取りの太さ（hexSize 比） */
const OUTLINE = 0.035;
/** 地面に沿わせるための刻み（hexSize 比）と、横方向の分割数 */
const STEP = 0.05;
const ACROSS = 6;
/** 地面から浮かせる量（hexSize 比） */
const LIFT = 0.01;

const FILL_COLOR = 0xffd451;
const STRIPE_COLOR = 0xfff6d8;
const OUTLINE_COLOR = 0x2a1a0c;

/** 縁取り・本体の描画順（ユニットの影 9・絵 10 より奥） */
const OUTLINE_ORDER = 7;
const FILL_ORDER = 8;

export class PathArrow {
  readonly group = new THREE.Group();
  /** 縞を流す時間（秒）。描画のたびに進める */
  readonly time: THREE.IUniform<number> = { value: 0 };
  private readonly fill: THREE.ShaderMaterial;
  private readonly outline: THREE.ShaderMaterial;

  constructor() {
    this.group.name = 'path-arrow';
    this.fill = arrowMaterial(FILL_COLOR, this.time, true);
    this.outline = arrowMaterial(OUTLINE_COLOR, this.time, false);
  }

  /**
   * path（出発地 → 到着地の HEX）に沿って矢印を作る。null か 2 HEX 未満なら消す。
   * groundAt はその位置の地面（水面・橋の上を含む）の高さ。
   */
  set(path: readonly Offset[] | null, layout: HexLayout, groundAt: (x: number, z: number) => number): void {
    this.clear();
    if (!path || path.length < 2) return;
    const s = layout.size;
    this.fill.uniforms.uHexSize.value = s;
    const line = smoothPath(path.map((o) => layout.offsetToWorld(o.col, o.row)));
    const outline = OUTLINE * s;
    const back = new THREE.Mesh(
      arrowGeometry(line, s, groundAt, { shaft: SHAFT_HALF * s + outline, head: HEAD_HALF * s + outline * 1.8, extend: outline * 1.6 }),
      this.outline,
    );
    back.renderOrder = OUTLINE_ORDER;
    const front = new THREE.Mesh(arrowGeometry(line, s, groundAt, { shaft: SHAFT_HALF * s, head: HEAD_HALF * s, extend: 0 }), this.fill);
    front.renderOrder = FILL_ORDER;
    this.group.add(back, front);
  }

  dispose(): void {
    this.clear();
    this.fill.dispose();
    this.outline.dispose();
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
  }
}

/**
 * 矢印の帯。横断方向の列を進む向きに並べ、幅は帯の部分で shaft、矢じりの付け根で head に広げて先端で 0 にする。
 * extend は縁取り用に両端と矢じりを伸ばす量。
 */
function arrowGeometry(
  pts: Vec2[],
  s: number,
  groundAt: (x: number, z: number) => number,
  w: { shaft: number; head: number; extend: number },
): THREE.BufferGeometry {
  const line = new Polyline(pts);
  const total = line.length;
  const start = Math.min(START_GAP * s, total * 0.3) - w.extend;
  // 経路が短いときは矢じりを縮める
  const headLen = Math.min(HEAD_LEN * s, (total - START_GAP * s) * 0.6) + w.extend * 1.5;
  const tip = total + w.extend;
  const headBase = tip - headLen;

  // 進む向きの刻み（矢じりの付け根は帯の幅と矢じりの幅の 2 列を同じ位置に置く）
  const rows: { d: number; half: number }[] = [];
  const n = Math.max(1, Math.ceil((headBase - start) / (STEP * s)));
  for (let i = 0; i <= n; i++) rows.push({ d: start + ((headBase - start) * i) / n, half: w.shaft });
  const m = Math.max(2, Math.ceil(headLen / (STEP * s)));
  for (let i = 0; i <= m; i++) rows.push({ d: headBase + (headLen * i) / m, half: w.head * (1 - i / m) });

  const pos: number[] = [];
  const along: number[] = [];
  const across: number[] = [];
  const idx: number[] = [];
  const lift = LIFT * s;
  rows.forEach((row, r) => {
    // 縁取りの先端は経路の先へはみ出すので、向きは最後の区間のまま延ばす
    const p = line.at(Math.min(Math.max(row.d, 0), total));
    const over = row.d - Math.min(Math.max(row.d, 0), total);
    const cx = p.x + p.tx * over;
    const cz = p.z + p.tz * over;
    for (let k = 0; k <= ACROSS; k++) {
      const u = (k / ACROSS) * 2 - 1;
      const x = cx - p.tz * u * row.half;
      const z = cz + p.tx * u * row.half;
      pos.push(x, groundAt(x, z) + lift, z);
      along.push(row.d);
      across.push(u * row.half);
    }
    if (r > 0) {
      const a = (r - 1) * (ACROSS + 1);
      const b = r * (ACROSS + 1);
      for (let k = 0; k < ACROSS; k++) idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function arrowMaterial(color: number, time: THREE.IUniform<number>, stripes: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStripe: { value: new THREE.Color(STRIPE_COLOR) },
      uTime: time,
      uHexSize: { value: 1 },
    },
    defines: stripes ? { STRIPES: '' } : {},
    vertexShader: /* glsl */ `
      attribute float aAlong;
      attribute float aAcross;
      varying float vAlong;
      varying float vAcross;
      void main() {
        vAlong = aAlong;
        vAcross = aAcross;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uStripe;
      uniform float uTime;
      uniform float uHexSize;
      varying float vAlong;
      varying float vAcross;
      void main() {
        vec3 c = uColor;
        float a = 1.0;
      #ifdef STRIPES
        // 進む向きを指す山形の縞を流す（中心より縁を後ろへずらして、先が前を向く山形にする）
        float f = fract((vAlong + abs(vAcross) * 1.2) / uHexSize * 2.2 - uTime * 1.4);
        float stripe = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.38, 0.46, f));
        c = mix(c, uStripe, stripe * 0.55);
      #else
        a = 0.85;
      #endif
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}
