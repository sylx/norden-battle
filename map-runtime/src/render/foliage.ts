/**
 * 森・木の描画。
 *
 * リアル寄りの見た目にするため、樹冠を「葉のカード」（アルファ抜きの葉テクスチャを貼った板）の
 * 集合で作る。ゲームの植生表現で一般的な手法。
 *   - 葉/針葉のテクスチャは Canvas で手続き生成（外部アセット不要）
 *   - カードの法線は樹冠中心から外向きの球状にして、板っぽさを消しふんわりした陰影にする
 *   - 房の内側にも葉カードを置いて隙間を埋める（ソリッドな芯は使わない）
 *   - 頂点色で AO（下側・内側ほど暗い）を付ける
 *   - 形状バリエーションを複数生成し、InstancedMesh で大量に描く
 *   - 頂点シェーダで風の揺れ
 *   - 深度プリパス: 葉のカードは何枚も重なり、アルファテスト（discard）があると GPU の早期深度テストが
 *     効かないため、重なった全カードで PBR・影の計算が走る（古い GPU ではこれが一番重い）。
 *     先に安いシェーダで葉の深度だけを描き、本描画は深度を書かずに「一番手前と同じ深度」の面だけを塗る。
 *     見た目は変わらず、葉の塗りは 1 画素につきほぼ 1 回になる
 *   - 板絵（インポスター、既定）: カメラが回転しないことを利用し、木の形ごとにカメラの向きから見た姿を
 *     テクスチャに焼いて 1 本 1 枚の板で描く。頂点数も重なりも桁違いに減る（Forest の ForestMode を参照）
 */
import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import { TreeKind, type TreeInstance } from '../core/terrainGen';
import { GeoBuilder } from './geoBuilder';
import { LIGHTS } from './scene';

// ---- 風 -------------------------------------------------------------------

export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
};

/**
 * 遠景で葉が消えないようにするための補正量。
 * アルファテストのテクスチャはミップマップが粗くなるほどアルファが平均されて下がり、
 * しきい値を割って葉が丸ごと消える（幹だけが残る）。ミップレベルに比例してアルファを持ち上げて防ぐ。
 */
export const foliageUniforms = {
  /** 広葉樹・低木（葉の房のテクスチャは面積が大きいので控えめでよい） */
  broadleafMipAlpha: { value: 0.25 },
  /** 針葉樹（細い針葉は遠景で消えやすいので強めに） */
  needleMipAlpha: { value: 0.8 },
};

const MIP_ALPHA_FRAGMENT = /* glsl */ `
#include <map_fragment>
#ifdef USE_MAP
{
  vec2 mipUv = vMapUv * vec2(textureSize(map, 0));
  vec2 mdx = dFdx(mipUv);
  vec2 mdy = dFdy(mipUv);
  float mipLevel = max(0.0, 0.5 * log2(max(dot(mdx, mdx), dot(mdy, mdy))));
  diffuseColor.a *= 1.0 + mipLevel * uMipAlphaScale;
}
#endif
`;

const WIND_VERTEX = /* glsl */ `
#include <begin_vertex>
{
  vec3 windBase = vec3(0.0);
  #ifdef USE_INSTANCING
    windBase = instanceMatrix[3].xyz;
  #endif
  float windPhase = uTime * 1.1 + windBase.x * 0.9 + windBase.z * 0.7;
  float windSway = (sin(windPhase) * 0.6 + sin(windPhase * 2.3 + 1.7) * 0.25) * uWind;
  float windBend = max(transformed.y, 0.0) * 2.5;
  windBend *= windBend;
  transformed.x += windSway * windBend * 0.012;
  transformed.z += windSway * windBend * 0.008;
  #ifdef LEAF_FLUTTER
    transformed += normal * sin(uTime * 5.0 + dot(position, vec3(370.0, 230.0, 410.0))) * 0.002 * uWind;
  #endif
}
`;

function applyFoliageShader(
  mat: THREE.Material,
  opts: { flutter: boolean; sphericalNormals: boolean; mipAlpha: THREE.IUniform<number> },
): void {
  if (opts.flutter) {
    mat.defines ??= {};
    mat.defines.LEAF_FLUTTER = '';
  }
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windUniforms.uTime;
    sh.uniforms.uWind = windUniforms.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', WIND_VERTEX);
    sh.uniforms.uMipAlphaScale = opts.mipAlpha;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uMipAlphaScale;')
      .replace('#include <map_fragment>', MIP_ALPHA_FRAGMENT);
    if (opts.sphericalNormals) {
      // 両面描画でも裏面で法線を反転させない（球状法線で樹冠全体を一つの塊として照らす）
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''),
      );
    }
  };
  mat.customProgramCacheKey = () => `foliage-${opts.flutter ? 1 : 0}${opts.sphericalNormals ? 1 : 0}`;
}

// ---- テクスチャ -----------------------------------------------------------

let leafTex: THREE.Texture | null = null;
let needleTex: THREE.Texture | null = null;

function finishTexture(canvas: HTMLCanvasElement): THREE.Texture {
  // 透明ピクセルの RGB を葉の平均色で埋める（アルファブリード）。
  // Canvas のままだと透明部分が黒になり、ミップマップで葉の縁や遠景が黒ずむ。
  const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
    n++;
  }
  if (n > 0) {
    r /= n;
    g /= n;
    b /= n;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== 0) continue;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
  }
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** 広葉樹の葉の房（円形に葉が集まったもの） */
function getLeafTexture(): THREE.Texture {
  if (leafTex) return leafTex;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d')!;
  const rng = mulberry32(4242);
  const R = S * 0.45;

  // 小枝
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    g.strokeStyle = `hsl(30, 30%, ${18 + rng() * 10}%)`;
    g.lineWidth = 2.5 - i * 0.2;
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    g.lineTo(S / 2 + Math.cos(a) * R * 0.8, S / 2 + Math.sin(a) * R * 0.8);
    g.stroke();
  }

  // 葉（内側を先に暗く、外側を後から明るく描く）
  const leaves: { r: number; a: number }[] = [];
  for (let i = 0; i < 260; i++) leaves.push({ r: Math.sqrt(rng()) * R, a: rng() * Math.PI * 2 });
  leaves.sort((p, q) => p.r - q.r);
  for (const { r, a } of leaves) {
    const t = r / R;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    const len = 11 + rng() * 9;
    const wid = len * (0.38 + rng() * 0.12);
    const hue = 70 + rng() * 30;
    const sat = 18 + rng() * 14;
    const lig = 16 + t * 20 + rng() * 12;
    g.save();
    g.translate(x, y);
    g.rotate(a + (rng() - 0.5) * 1.4);
    g.fillStyle = `hsl(${hue}, ${sat}%, ${lig}%)`;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(len * 0.45, -wid, len, 0);
    g.quadraticCurveTo(len * 0.45, wid, 0, 0);
    g.fill();
    // 葉脈とハイライト
    g.strokeStyle = `hsla(${hue - 10}, ${sat}%, ${lig + 14}%, 0.7)`;
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(1, 0);
    g.lineTo(len * 0.85, 0);
    g.stroke();
    g.restore();
  }
  leafTex = finishTexture(canvas);
  return leafTex;
}

/** 針葉樹の枝（横長。u = 幹→枝先, v = 0.5 が枝の軸） */
function getNeedleTexture(): THREE.Texture {
  if (needleTex) return needleTex;
  const W = 256;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const rng = mulberry32(777);
  g.lineCap = 'round';

  const drawSprig = (x0: number, y0: number, x1: number, y1: number, maxLen: number, density: number) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L = Math.hypot(dx, dy);
    const ux = dx / L;
    const uy = dy / L;
    g.strokeStyle = 'hsl(30, 25%, 20%)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    for (let d = 2; d < L; d += density) {
      const t = d / L;
      const px = x0 + ux * d;
      const py = y0 + uy * d;
      const len = maxLen * (1 - t * 0.55) * (0.75 + rng() * 0.4);
      for (const side of [-1, 1]) {
        const ang = side * (0.75 + rng() * 0.35);
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const nx = ux * c - uy * s;
        const ny = ux * s + uy * c;
        g.strokeStyle = `hsl(${120 + rng() * 25}, ${14 + rng() * 12}%, ${13 + rng() * 17 + t * 6}%)`;
        g.lineWidth = 1.1 + rng() * 0.6;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + nx * len, py + ny * len);
        g.stroke();
      }
    }
  };

  const cy = H / 2;
  // 脇枝
  for (let i = 0; i < 6; i++) {
    const x = 30 + i * 36 + rng() * 10;
    const side = i % 2 === 0 ? -1 : 1;
    const len = (1 - x / W) * 70 + 20;
    drawSprig(x, cy, x + len * 0.8, cy + side * len * 0.5, 20 * (1 - x / W) + 8, 2.4);
  }
  // 主軸
  drawSprig(6, cy, W - 6, cy, 30, 2.2);

  needleTex = finishTexture(canvas);
  return needleTex;
}

// ---- ジオメトリ構築 ---------------------------------------------------------

type Rng = () => number;

const UP = new THREE.Vector3(0, 1, 0);
const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const BARK = srgb(0.3, 0.22, 0.15);

function randomUnit(rng: Rng, out = new THREE.Vector3()): THREE.Vector3 {
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** a → b の先細りの円柱 */
function addTube(b: GeoBuilder, from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, segs = 6): void {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(from.x, from.y, from.z);
  b.append(g, (p) => BARK.clone().multiplyScalar(0.7 + 0.3 * smooth(0, 0.2, p.y)));
}

interface Cluster {
  c: THREE.Vector3;
  r: number;
}

/** 葉の房の集合で樹冠を作る */
function addCrown(leaves: GeoBuilder, clusters: Cluster[], rng: Rng, cardsPerCluster: number): void {
  const center = new THREE.Vector3();
  let minY = Infinity;
  let maxY = -Infinity;
  for (const cl of clusters) {
    center.add(cl.c);
    minY = Math.min(minY, cl.c.y - cl.r);
    maxY = Math.max(maxY, cl.c.y + cl.r);
  }
  center.divideScalar(clusters.length);
  const spread = Math.max(...clusters.map((cl) => cl.c.distanceTo(center) + cl.r));
  const ao = (p: THREE.Vector3) => {
    const h = smooth(minY, maxY, p.y);
    const out = Math.min(p.distanceTo(center) / spread, 1);
    return (0.42 + 0.58 * h) * (0.55 + 0.45 * out);
  };

  const tmp = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const corners = [
    [-1, -1, 0, 0],
    [1, -1, 1, 0],
    [1, 1, 1, 1],
    [-1, 1, 0, 1],
  ];

  for (const cl of clusters) {
    for (let i = 0; i < cardsPerCluster; i++) {
      // 3 割は房の内側に置いて隙間を埋める（AO で暗くなる）
      const depth = i < cardsPerCluster * 0.3 ? rng() * 0.25 : 0.3 + rng() * 0.35;
      const pc = randomUnit(rng, tmp).multiplyScalar(cl.r * depth).add(cl.c);
      const half = cl.r * (0.7 + rng() * 0.35);
      q.setFromEuler(e.set(rng() * Math.PI, rng() * Math.PI * 2, rng() * Math.PI));
      const ids: number[] = [];
      for (const [cx, cy, u, v] of corners) {
        const p = new THREE.Vector3(cx * half, cy * half, 0).applyQuaternion(q).add(pc);
        // 樹冠全体の中心から外向き + 少し上向き の法線
        const n = p.clone().sub(center).normalize().multiplyScalar(0.8).add(p.clone().sub(cl.c).normalize().multiplyScalar(0.2));
        n.y += 0.35;
        n.normalize();
        const a = ao(p);
        ids.push(leaves.vertex(p, n, u, v, new THREE.Color(a, a, a)));
      }
      leaves.tri(ids[0], ids[1], ids[2]);
      leaves.tri(ids[0], ids[2], ids[3]);
    }
  }
}

interface TreeParts {
  /** 幹・枝（低木は無し） */
  solid: THREE.BufferGeometry | null;
  leaves: THREE.BufferGeometry;
}

function buildBroadleaf(rng: Rng): TreeParts {
  const solid = new GeoBuilder();
  const leaves = new GeoBuilder();
  const trunkH = 0.12 + rng() * 0.05;
  const top = new THREE.Vector3((rng() - 0.5) * 0.04, trunkH, (rng() - 0.5) * 0.04);
  addTube(solid, new THREE.Vector3(0, -0.03, 0), top, 0.02, 0.012);

  const R = 0.1 + rng() * 0.03;
  const crownC = top.clone().add(new THREE.Vector3(0, R * 0.8, 0));
  const clusters: Cluster[] = [{ c: crownC.clone().add(new THREE.Vector3(0, R * 0.25, 0)), r: R * 0.65 }];
  const n = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.8;
    const dir = new THREE.Vector3(Math.cos(a), -0.15 + rng() * 0.6, Math.sin(a)).normalize();
    const c = crownC.clone().add(dir.multiplyScalar(R * (0.5 + rng() * 0.2)));
    clusters.push({ c, r: R * (0.45 + rng() * 0.2) });
    // 枝
    addTube(solid, top, top.clone().lerp(c, 0.75), 0.008, 0.004, 4);
  }
  addCrown(leaves, clusters, rng, 16);
  return { solid: solid.build(), leaves: leaves.build() };
}

/** 針葉樹の枝 1 本（幹から外へ垂れ下がる台形のカード） */
function addNeedleBranch(leaves: GeoBuilder, y: number, a: number, len: number, droop: number, tilt: number, ao: number): void {
  const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
  const across = side.multiplyScalar(Math.cos(tilt)).addScaledVector(UP, Math.sin(tilt));
  const inner = new THREE.Vector3(0, y + 0.01, 0).addScaledVector(dir, 0.004);
  const outer = new THREE.Vector3(0, y - len * droop, 0).addScaledVector(dir, len);
  const wIn = len * 0.18;
  const wOut = len * 0.42;
  const pts: [THREE.Vector3, number, number, number][] = [
    [inner.clone().addScaledVector(across, -wIn), 0, 0, 0.7],
    [outer.clone().addScaledVector(across, -wOut), 1, 0, 1],
    [outer.clone().addScaledVector(across, wOut), 1, 1, 1],
    [inner.clone().addScaledVector(across, wIn), 0, 1, 0.7],
  ];
  const ids = pts.map(([p, u, v, inAo]) => {
    const n = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(0.75);
    n.y += 0.65;
    n.normalize();
    const c = ao * inAo;
    return leaves.vertex(p, n, u, v, new THREE.Color(c, c, c));
  });
  leaves.tri(ids[0], ids[1], ids[2]);
  leaves.tri(ids[0], ids[2], ids[3]);
}

function buildConifer(rng: Rng): TreeParts {
  const solid = new GeoBuilder();
  const leaves = new GeoBuilder();
  const H = 0.4 + rng() * 0.1;
  const baseY = 0.05 + rng() * 0.02;
  addTube(solid, new THREE.Vector3(0, -0.03, 0), new THREE.Vector3(0, H * 0.97, 0), 0.016, 0.003);

  const tiers = 9 + Math.floor(rng() * 3);
  const baseR = 0.1 + rng() * 0.02;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const y = baseY + t * (H - baseY) * 0.93;
    const radius = baseR * Math.pow(1 - t * 0.93, 0.9) + 0.012;
    const m = Math.max(5, Math.round(11 * (1 - t * 0.45)));
    const tierAo = 0.45 + 0.55 * t;
    // 外側の枝と、その間を埋める短く暗い内側の枝の 2 層
    for (const layer of [0, 1]) {
      for (let j = 0; j < m; j++) {
        const a = k * 2.4 + ((j + layer * 0.5) / m) * Math.PI * 2 + (rng() - 0.5) * 0.5;
        const lenScale = layer === 0 ? 0.85 + rng() * 0.3 : 0.5 + rng() * 0.15;
        const droop = layer === 0 ? 0.25 + rng() * 0.2 : 0.05 + rng() * 0.15;
        addNeedleBranch(leaves, y, a, radius * lenScale, droop, (rng() - 0.5) * 0.9, tierAo * (layer === 0 ? 1 : 0.7));
      }
    }
  }
  return { solid: solid.build(), leaves: leaves.build() };
}

function buildBush(rng: Rng): TreeParts {
  const leaves = new GeoBuilder();
  const R = 0.045 + rng() * 0.02;
  const clusters: Cluster[] = [];
  const n = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const d = i === 0 ? 0 : R * (0.6 + rng() * 0.4);
    const r = R * (0.6 + rng() * 0.35);
    clusters.push({ c: new THREE.Vector3(Math.cos(a) * d, r * 0.55, Math.sin(a) * d), r });
  }
  addCrown(leaves, clusters, rng, 11);
  return { solid: null, leaves: leaves.build() };
}

// ---- 森全体 ---------------------------------------------------------------

const VARIANTS: Record<TreeKind, { count: number; build: (rng: Rng) => TreeParts; needle: boolean }> = {
  [TreeKind.Conifer]: { count: 4, build: buildConifer, needle: true },
  [TreeKind.Broadleaf]: { count: 4, build: buildBroadleaf, needle: false },
  [TreeKind.Bush]: { count: 3, build: buildBush, needle: false },
};

function foliageMaterials(needle: boolean) {
  const map = needle ? getNeedleTexture() : getLeafTexture();
  const mipAlpha = needle ? foliageUniforms.needleMipAlpha : foliageUniforms.broadleafMipAlpha;
  const leavesParams: THREE.MeshStandardMaterialParameters = {
    map,
    vertexColors: true,
    alphaTest: 0.5,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.82,
    metalness: 0,
  };
  const leaves = new THREE.MeshStandardMaterial(leavesParams);
  applyFoliageShader(leaves, { flutter: true, sphericalNormals: true, mipAlpha });
  const leavesDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
  applyFoliageShader(leavesDepth, { flutter: true, sphericalNormals: false, mipAlpha });

  // 深度プリパス用（色は書かない）。本描画とわずかな計算誤差があっても本描画が深度テストで
  // 落ちないよう、深度を少し奥へずらしておく
  const leavesPrepass = new THREE.MeshBasicMaterial({
    map,
    alphaTest: 0.5,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    colorWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  applyFoliageShader(leavesPrepass, { flutter: true, sphericalNormals: false, mipAlpha });

  // 板絵を焼く用。マルチサンプルの無い描画先に焼くので alphaToCoverage は使わず、
  // 深度プリパスの設定にも左右されないよう本描画とは別に持つ
  const leavesBake = new THREE.MeshStandardMaterial({ ...leavesParams, alphaToCoverage: false });
  applyFoliageShader(leavesBake, { flutter: false, sphericalNormals: true, mipAlpha: { value: 0 } });

  const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  applyFoliageShader(solid, { flutter: false, sphericalNormals: false, mipAlpha });
  const solidDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  applyFoliageShader(solidDepth, { flutter: false, sphericalNormals: false, mipAlpha });
  return { mipAlpha, leaves, leavesDepth, leavesPrepass, leavesBake, solid, solidDepth };
}

type FoliageMaterials = ReturnType<typeof foliageMaterials>;

const PREPASS_ORDER = 1;
const LEAVES_ORDER = 2;

/**
 * 森の描き方。
 * - mesh: 葉のカードの 3D モデル（重い）
 * - impostor: 木の形ごとに、固定カメラの向きから見た姿を板絵（テクスチャ）に焼いておき、1 本を 1 枚の板で描く。
 *   カメラは回転しないので見た目はほぼ同じで、頂点数・重なりが桁違いに減る。
 *   影は 3D モデルのまま（シャドウマップを描くときだけ 3D モデルを出す）
 */
export type ForestMode = 'mesh' | 'impostor';

/** 板絵の高さ（ピクセル）。最大ズームで木 1 本が 200px 強なので、それより少し大きく */
const IMPOSTOR_PX = 256;
/** 板絵を焼く向きの数（木ごとの回転を何方向に丸めるか） */
const IMPOSTOR_ROTATIONS = 3;
/** 板絵の透明部分の色（縮小したときに縁が黒ずまないよう、葉の暗い色にしておく。リニア） */
const IMPOSTOR_BLEED = new THREE.Color(0.03, 0.045, 0.02);

interface Impostor {
  rotation: number;
  trees: TreeInstance[];
  target: THREE.WebGLRenderTarget | null;
  mesh: THREE.InstancedMesh | null;
}

interface Variant {
  parts: TreeParts;
  mats: FoliageMaterials;
  leaves: THREE.InstancedMesh;
  solid: THREE.InstancedMesh | null;
  prepass: THREE.InstancedMesh;
  impostors: Impostor[];
}

/** 木の配置データから作る森（3D モデルと板絵の両方を持ち、切り替えられる） */
export class Forest {
  readonly group = new THREE.Group();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly variants: Variant[] = [];
  private readonly materials: FoliageMaterials[] = [];
  private mode: ForestMode;
  private prepass: boolean;
  /** 板絵を焼いたときのカメラの俯角（度） */
  private bakedPitch = NaN;

  constructor(
    trees: readonly TreeInstance[],
    seed: number,
    renderer: THREE.WebGLRenderer,
    opts: { mode: ForestMode; prepass: boolean; pitch: number },
  ) {
    this.renderer = renderer;
    this.mode = opts.mode;
    this.prepass = opts.prepass;
    this.group.name = 'trees';
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const tint = new THREE.Color();

    for (const kind of [TreeKind.Conifer, TreeKind.Broadleaf, TreeKind.Bush]) {
      const spec = VARIANTS[kind];
      const mats = foliageMaterials(spec.needle);
      this.materials.push(mats);
      const rng = mulberry32(seed * 31 + kind * 1013 + 5);
      for (let v = 0; v < spec.count; v++) {
        const list = trees.filter((t) => t.kind === kind && Math.floor(t.variant * spec.count) === v);
        if (list.length === 0) continue;
        const parts = spec.build(rng);
        const leaves = new THREE.InstancedMesh(parts.leaves, mats.leaves, list.length);
        leaves.customDepthMaterial = mats.leavesDepth;
        leaves.renderOrder = LEAVES_ORDER;
        const meshes: THREE.InstancedMesh[] = [leaves];
        let solid: THREE.InstancedMesh | null = null;
        if (parts.solid) {
          solid = new THREE.InstancedMesh(parts.solid, mats.solid, list.length);
          solid.customDepthMaterial = mats.solidDepth;
          meshes.push(solid);
        }

        list.forEach((t, i) => {
          q.setFromAxisAngle(UP, t.rot);
          pos.set(t.x, t.y, t.z);
          scl.set(t.scale * treeSquash(t), t.scale, t.scale * treeSquash(t));
          mat.compose(pos, q, scl);
          treeTint(t, tint);
          for (const m of meshes) {
            m.setMatrixAt(i, mat);
            m.setColorAt(i, tint);
          }
        });
        for (const m of meshes) {
          m.instanceMatrix.needsUpdate = true;
          if (m.instanceColor) m.instanceColor.needsUpdate = true;
          m.castShadow = true;
          m.receiveShadow = true;
          m.computeBoundingSphere();
          this.group.add(m);
        }

        // 深度プリパス（同じジオメトリ・配置を共有し、葉の本描画より先に描く）
        const prepass = new THREE.InstancedMesh(parts.leaves, mats.leavesPrepass, list.length);
        prepass.instanceMatrix = leaves.instanceMatrix;
        prepass.boundingSphere = leaves.boundingSphere;
        prepass.renderOrder = PREPASS_ORDER;
        this.group.add(prepass);

        // 板絵は向きごとに分ける（焼くのは板絵の表示に切り替えたときの初回）
        const impostors: Impostor[] = [];
        for (let r = 0; r < IMPOSTOR_ROTATIONS; r++) {
          const rotation = ((r + 0.5) / IMPOSTOR_ROTATIONS) * Math.PI * 2;
          const sub = list.filter((t) => rotationBin(t.rot) === r);
          if (sub.length > 0) impostors.push({ rotation, trees: sub, target: null, mesh: null });
        }
        this.variants.push({ parts, mats, leaves, solid, prepass, impostors });
      }
    }
    this.setPitch(opts.pitch);
    this.applyVisibility();
  }

  setMode(mode: ForestMode, pitch: number): void {
    this.mode = mode;
    this.setPitch(pitch);
    this.applyVisibility();
  }

  setPrepass(on: boolean): void {
    this.prepass = on;
    for (const v of this.variants) v.mats.leaves.depthWrite = !on;
    this.applyVisibility();
  }

  /** カメラの俯角が変わったら板絵を焼き直す（板絵の表示中のみ。同じ角度なら何もしない） */
  setPitch(pitch: number): void {
    if (this.mode !== 'impostor' || pitch === this.bakedPitch) return;
    this.bakedPitch = pitch;
    const baker = new ImpostorBaker(this.renderer, pitch);
    // 板は視線に垂直に立てる（上端を奥へ俯角ぶん倒す）
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -THREE.MathUtils.degToRad(pitch));
    const mat = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const tint = new THREE.Color();
    for (const v of this.variants) {
      for (const imp of v.impostors) {
        const baked = baker.bake(v, imp.rotation, imp.target);
        imp.target = baked.target;
        if (imp.mesh) {
          this.group.remove(imp.mesh);
          imp.mesh.geometry.dispose();
          (imp.mesh.material as THREE.Material).dispose();
          imp.mesh.dispose();
        }
        const mesh = new THREE.InstancedMesh(baked.geometry, impostorMaterial(v.mats.mipAlpha, baked.target.texture), imp.trees.length);
        imp.trees.forEach((t, i) => {
          pos.set(t.x, t.y, t.z);
          scl.set(t.scale * treeSquash(t), t.scale, 1);
          mat.compose(pos, tilt, scl);
          mesh.setMatrixAt(i, mat);
          mesh.setColorAt(i, treeTint(t, tint));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
        mesh.computeBoundingSphere();
        imp.mesh = mesh;
        this.group.add(mesh);
      }
    }
    baker.dispose();
    this.applyVisibility();
  }

  /** シャドウマップを描く間だけ、板絵表示でも 3D モデルを出す（影は 3D モデルのまま落とす） */
  setShadowPass(active: boolean): void {
    if (this.mode !== 'impostor') return;
    for (const v of this.variants) {
      v.leaves.visible = active;
      if (v.solid) v.solid.visible = active;
    }
  }

  dispose(): void {
    for (const v of this.variants) {
      v.parts.leaves.dispose();
      v.parts.solid?.dispose();
      for (const imp of v.impostors) {
        imp.target?.dispose();
        imp.mesh?.geometry.dispose();
        (imp.mesh?.material as THREE.Material | undefined)?.dispose();
        imp.mesh?.dispose();
      }
      v.leaves.dispose();
      v.solid?.dispose();
      v.prepass.dispose();
    }
    for (const m of this.materials) {
      for (const k of ['leaves', 'leavesDepth', 'leavesPrepass', 'leavesBake', 'solid', 'solidDepth'] as const) m[k].dispose();
    }
  }

  private applyVisibility(): void {
    const mesh = this.mode === 'mesh';
    for (const v of this.variants) {
      v.leaves.visible = mesh;
      if (v.solid) v.solid.visible = mesh;
      v.prepass.visible = mesh && this.prepass;
      for (const imp of v.impostors) if (imp.mesh) imp.mesh.visible = !mesh;
    }
  }
}

/** 横方向のばらつき（3D モデルと板絵で共通） */
function treeSquash(t: TreeInstance): number {
  return 0.9 + ((t.tint * 13.7) % 1) * 0.2;
}

/** 色味: 明るさと黄味/青味のばらつき */
function treeTint(t: TreeInstance, out: THREE.Color): THREE.Color {
  const bright = 0.78 + t.tint * 0.42;
  const hue = (t.tint * 7.31) % 1;
  return out.setRGB(bright * (0.9 + 0.2 * hue), bright, bright * (0.88 + 0.14 * (1 - hue)));
}

function rotationBin(rot: number): number {
  const a = ((rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.min(Math.floor((a / (Math.PI * 2)) * IMPOSTOR_ROTATIONS), IMPOSTOR_ROTATIONS - 1);
}

/** 板絵の材質。焼いた色（光・木自身の影込み）をそのまま出し、インスタンスの色味を掛ける */
function impostorMaterial(mipAlpha: THREE.IUniform<number>, map: THREE.Texture): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, alphaToCoverage: true });
  applyFoliageShader(mat, { flutter: false, sphericalNormals: false, mipAlpha });
  return mat;
}

/**
 * 木 1 本を、固定カメラの向き（北向き・俯角 pitch）から正射影で板絵に焼く。
 * 光は本番と同じ半球光 + 太陽で、木自身の影も焼き込む。
 *
 * 板は「木の根元を通り、視線に垂直な面」に置く（地面に埋もれず、手前の地形には正しく隠れる）。
 * 板のローカル座標は x = 画面の右、y = 画面の上（根元が原点）。
 */
class ImpostorBaker {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly sun: THREE.DirectionalLight;
  private readonly camera = new THREE.OrthographicCamera();
  private readonly right = new THREE.Vector3(1, 0, 0);
  private readonly up: THREE.Vector3;
  private readonly back: THREE.Vector3;

  constructor(renderer: THREE.WebGLRenderer, pitchDeg: number) {
    this.renderer = renderer;
    const p = THREE.MathUtils.degToRad(pitchDeg);
    this.up = new THREE.Vector3(0, Math.cos(p), -Math.sin(p));
    this.back = new THREE.Vector3(0, Math.sin(p), Math.cos(p));
    this.scene.add(new THREE.HemisphereLight(LIGHTS.hemiSky, LIGHTS.hemiGround, LIGHTS.hemiIntensity));
    this.sun = new THREE.DirectionalLight(LIGHTS.sunColor, LIGHTS.sunIntensity);
    this.sun.position.copy(LIGHTS.sunDirection).multiplyScalar(2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.004;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -0.45;
    sc.right = sc.top = 0.45;
    sc.near = 0.5;
    sc.far = 3.5;
    this.scene.add(this.sun, this.sun.target);
    this.sun.target.position.set(0, 0.2, 0);
  }

  bake(v: Variant, rotation: number, reuse: THREE.WebGLRenderTarget | null): { target: THREE.WebGLRenderTarget; geometry: THREE.BufferGeometry } {
    const tree = new THREE.Group();
    tree.rotation.y = rotation;
    const leaves = new THREE.Mesh(v.parts.leaves, v.mats.leavesBake);
    leaves.customDepthMaterial = v.mats.leavesDepth;
    tree.add(leaves);
    if (v.parts.solid) {
      const solid = new THREE.Mesh(v.parts.solid, v.mats.solid);
      solid.customDepthMaterial = v.mats.solidDepth;
      tree.add(solid);
    }
    for (const m of tree.children as THREE.Mesh[]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    this.scene.add(tree);
    tree.updateMatrixWorld(true);

    // 画面上の範囲（風で揺れる分の余白を足す）
    const box = new THREE.Box3().setFromObject(tree).expandByScalar(0.02);
    let l = Infinity;
    let r = -Infinity;
    let b = Infinity;
    let t = -Infinity;
    const c = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      const x = c.dot(this.right);
      const y = c.dot(this.up);
      l = Math.min(l, x);
      r = Math.max(r, x);
      b = Math.min(b, y);
      t = Math.max(t, y);
    }
    const cam = this.camera;
    cam.left = l;
    cam.right = r;
    cam.bottom = b;
    cam.top = t;
    cam.near = 0.01;
    cam.far = 4;
    cam.position.copy(this.back).multiplyScalar(2);
    cam.up.copy(this.up);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();

    const height = IMPOSTOR_PX;
    const width = Math.max(8, Math.ceil((IMPOSTOR_PX * (r - l)) / (t - b)));
    const target =
      reuse ??
      new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
      });
    target.setSize(width, height);
    target.texture.anisotropy = 4;

    const rd = this.renderer;
    const prevTarget = rd.getRenderTarget();
    const prevClear = rd.getClearColor(new THREE.Color());
    const prevAlpha = rd.getClearAlpha();
    const sm = rd.shadowMap;
    const prevAuto = sm.autoUpdate;
    const prevNeeds = sm.needsUpdate;
    rd.setRenderTarget(target);
    rd.setClearColor(IMPOSTOR_BLEED, 0);
    sm.autoUpdate = false;
    sm.needsUpdate = true;
    rd.render(this.scene, cam);
    sm.autoUpdate = prevAuto;
    sm.needsUpdate = prevNeeds;
    rd.setClearColor(prevClear, prevAlpha);
    rd.setRenderTarget(prevTarget);
    this.scene.remove(tree);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([l, b, 0, r, b, 0, r, t, 0, l, t, 0], 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    return { target, geometry };
  }

  dispose(): void {
    this.sun.shadow.dispose();
  }
}
