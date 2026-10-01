/**
 * ユニットの表示。2D 画像をカメラ正対のスプライトで HEX の中心に立て、
 * 足元に横長の楕円の影を地面に沿わせて敷く。
 *
 * どちらも深度テストをせず地形・木・建物より手前に描く（森や山の陰でもユニットを見失わないため）。
 * スプライト同士は奥から順に描かれるので、手前のユニットが奥のユニットに重なる。
 */
import * as THREE from 'three';
import type { Offset } from '../core/hex';
import type { HexMap } from '../core/mapData';
import { Heightmap, type TerrainData } from '../core/terrainGen';
import { unitFacings, type Facing, type UnitData } from '../core/units';
import { UnitArt, type UnitImage } from './unitArt';

/** スプライトの高さ（hexSize 比） */
const UNIT_HEIGHT = 0.95;
/** 影の楕円の横半径（hexSize 比、表示倍率 1 のとき） */
const SHADOW_RX = 0.46;
/** 影の楕円の縦（奥行き）/ 横の比 */
const SHADOW_ASPECT = 0.45;
/** 影を奥（画面の上）へずらす量（hexSize 比、表示倍率 1 のとき） */
const SHADOW_SHIFT = 0.06;
/** 影の中心の濃さ */
const SHADOW_OPACITY = 0.55;
/** 橋の上に立つときの足元の高さ（水面から、hexSize 比） */
export const BRIDGE_DECK = 0.14;
/** クリック判定で「描かれている」とみなす不透明度 */
const PICK_ALPHA = 0.25;

/** 選択中のユニットを囲む光の、画像の外へはみ出す幅（画像の高さ比） */
const GLOW_PAD = 0.1;
/** 光の縁取りの太さ・外側のにじみの広がり（画像の高さ比） */
const GLOW_LINE = 0.018;
const GLOW_SPREAD = 0.07;
const GLOW_COLOR = 0xffc23a;
/** 選択中のユニットがあるとき、ほかのユニットの明るさ */
const DIM = 0.5;

const SHADOW_ORDER = 9;
const SPRITE_ORDER = 10;
/** 選択中のユニットとその光は、ほかのユニットより手前に描く */
const GLOW_ORDER = 11;
const FOCUS_ORDER = 12;

interface UnitSprite {
  sprite: THREE.Sprite;
  shadow: THREE.Mesh;
  image: UnitImage;
  unit: UnitData;
}

export interface UnitPlacement {
  unit: UnitData;
  /** 足元（画像の下端の中央） */
  readonly foot: THREE.Vector3;
  /** 画像の幅と高さ（カメラ正対なので、画面上ではカメラの右・上方向に広がる） */
  width: number;
  height: number;
}

export class UnitLayer {
  readonly group = new THREE.Group();
  readonly art = new UnitArt();
  private sprites: UnitSprite[] = [];
  private readonly shadowTexture = createShadowTexture();
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({
    map: this.shadowTexture,
    color: 0x000000,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  /** 表示倍率。変えたら build() し直す */
  scale = 1.75;
  /** 選択中のユニットの光の明滅に使う時間（秒）。描画のたびに進める */
  readonly time: THREE.IUniform<number> = { value: 0 };
  private focus: Offset | null = null;
  /** 最後に build したときの地形（moveTo で影を作り直すのに使う） */
  private terrain: { hm: Heightmap; waterLevel: number; size: number } | null = null;
  private readonly glow = createGlowSprite(this.time);

  constructor() {
    this.group.name = 'units';
    this.glow.visible = false;
    this.glow.renderOrder = GLOW_ORDER;
    this.group.add(this.glow);
  }

  /** 選択中のユニットを光で囲み、ほかのユニットを暗くする（null で解除） */
  setFocus(o: Offset | null): void {
    this.focus = o;
    const target = o ? this.sprites.find(({ unit }) => unit.col === o.col && unit.row === o.row) : undefined;
    for (const { sprite } of this.sprites) {
      sprite.material.color.setScalar(target && sprite !== target.sprite ? DIM : 1);
      sprite.renderOrder = sprite === target?.sprite ? FOCUS_ORDER : SPRITE_ORDER;
    }
    this.glow.visible = !!target;
    if (!target) return;
    const { sprite, image } = target;
    const w = sprite.scale.x;
    const h = sprite.scale.y;
    const pad = GLOW_PAD * h;
    const u = this.glow.material.userData.uniforms as GlowUniforms;
    this.glow.material.map = image.texture;
    u.uGlowSize.value.set(w, h);
    u.uGlowPad.value = pad;
    u.uGlowWidth.value.set(GLOW_LINE * h, GLOW_SPREAD * h);
    u.uGlowFlip.value = image.texture.repeat.x < 0 ? 1 : 0;
    this.glow.position.copy(sprite.position);
    this.glow.scale.set(w + 2 * pad, h + 2 * pad, 1);
    // 画像の足元とそろえる（光は足元の下にも少しはみ出す）
    this.glow.center.set(0.5, pad / (h + 2 * pad));
  }

  build(map: HexMap, data: TerrainData): void {
    this.clear();
    const hm = new Heightmap(data);
    const s = map.layout.size;
    this.terrain = { hm, waterLevel: data.waterLevel, size: s };
    const facings = unitFacings(map);
    for (const unit of map.allUnits()) {
      const cell = map.get(unit.col, unit.row);
      if (!cell) continue;
      const c = map.layout.offsetToWorld(unit.col, unit.row);
      const onBridge = cell.feature === 'bridge';
      const floor = onBridge ? data.waterLevel + BRIDGE_DECK * s : data.waterLevel;
      const y = Math.max(hm.heightAt(c.x, c.z), floor);

      const shadow = new THREE.Mesh(this.shadowGeometry(c.x, c.z, onBridge ? floor : data.waterLevel), this.shadowMaterial);
      shadow.renderOrder = SHADOW_ORDER;
      this.group.add(shadow);

      const image = this.art.get(unit.type, unit.team, facings.get(unit) ?? 'right');
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: image.texture,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          fog: false,
        }),
      );
      sprite.center.set(0.5, 0);
      sprite.position.set(c.x, y, c.z);
      const h = UNIT_HEIGHT * this.scale * s;
      sprite.scale.set(h * image.aspect, h, 1);
      sprite.renderOrder = SPRITE_ORDER;
      this.group.add(sprite);
      this.sprites.push({ sprite, shadow, image, unit });
    }
    this.setFocus(this.focus);
  }

  /**
   * ユニットの絵と影を foot（足元のワールド座標）へ動かす（移動のアニメーション用）。
   * facing を渡すと絵の向きも変える。配置どおりに戻すときは build し直す。
   */
  moveTo(unit: UnitData, foot: THREE.Vector3, facing?: Facing): void {
    const u = this.sprites.find((x) => x.unit === unit);
    const t = this.terrain;
    if (!u || !t) return;
    u.sprite.position.copy(foot);
    if (facing) {
      const image = this.art.get(unit.type, unit.team, facing);
      if (image !== u.image) {
        u.image = image;
        u.sprite.material.map = image.texture;
        u.sprite.scale.x = u.sprite.scale.y * image.aspect;
      }
    }
    // 足元が地面より上なら橋の上なので、影もその高さに敷く
    const floor = foot.y > t.hm.heightAt(foot.x, foot.z) + 1e-3 ? foot.y : t.waterLevel;
    u.shadow.geometry.dispose();
    u.shadow.geometry = this.shadowGeometry(foot.x, foot.z, floor);
    this.setFocus(this.focus);
  }

  /** 足元 (x, z) の影の楕円盤 */
  private shadowGeometry(x: number, z: number, floor: number): THREE.BufferGeometry {
    const { hm, size } = this.terrain!;
    const rx = SHADOW_RX * this.scale * size;
    return shadowGeometry(hm, x, z - SHADOW_SHIFT * this.scale * size, rx, rx * SHADOW_ASPECT, floor);
  }

  /** 置いたユニットの画像の位置と大きさ（足元のワールド座標・ワールド単位の幅と高さ）。画面上に情報を重ねる用 */
  placements(): readonly UnitPlacement[] {
    return this.sprites.map(({ sprite, unit }) => ({ unit, foot: sprite.position, width: sprite.scale.x, height: sprite.scale.y }));
  }

  /** レイの先で描かれているユニット（手前優先）。画像の透明部分は素通りする */
  pick(raycaster: THREE.Raycaster): UnitData | null {
    if (!this.group.visible) return null;
    const hits = raycaster.intersectObjects(
      this.sprites.map((u) => u.sprite),
      false,
    );
    for (const hit of hits) {
      const u = this.sprites.find((x) => x.sprite === hit.object);
      if (u && hit.uv && u.image.alphaAt(hit.uv.x, hit.uv.y) >= PICK_ALPHA) return u.unit;
    }
    return null;
  }

  dispose(): void {
    this.clear();
    this.art.dispose();
    this.shadowTexture.dispose();
    this.shadowMaterial.dispose();
    this.glow.material.dispose();
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      if (child === this.glow) continue;
      this.group.remove(child);
      // 影のマテリアルとテクスチャは共有なので、捨てるのは影のジオメトリとスプライトのマテリアルだけ
      if (child instanceof THREE.Mesh) child.geometry.dispose();
      else if (child instanceof THREE.Sprite) child.material.dispose();
    }
    this.sprites = [];
  }
}

/** 地面に沿わせた楕円盤（同心楕円 × 放射状の格子） */
function shadowGeometry(hm: Heightmap, cx: number, cz: number, rx: number, rz: number, floor: number): THREE.BufferGeometry {
  const RINGS = 4;
  const SEGS = 32;
  const lift = 0.015;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  // (u, v) は単位円上の座標
  const push = (u: number, v: number) => {
    const x = cx + u * rx;
    const z = cz + v * rz;
    pos.push(x, Math.max(hm.heightAt(x, z), floor) + lift, z);
    uv.push(0.5 + u / 2, 0.5 - v / 2);
  };
  push(0, 0);
  for (let r = 1; r <= RINGS; r++) {
    const rr = r / RINGS;
    for (let i = 0; i < SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      push(rr * Math.cos(a), rr * Math.sin(a));
    }
  }
  for (let i = 0; i < SEGS; i++) idx.push(0, 1 + ((i + 1) % SEGS), 1 + i);
  for (let r = 1; r < RINGS; r++) {
    const a0 = 1 + (r - 1) * SEGS;
    const b0 = 1 + r * SEGS;
    for (let i = 0; i < SEGS; i++) {
      const j = (i + 1) % SEGS;
      idx.push(a0 + i, a0 + j, b0 + i, a0 + j, b0 + j, b0 + i);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/** 中心が濃く縁へ柔らかく消える円（楕円はジオメトリ側で作る）。色はマテリアルの color（黒） */
function createShadowTexture(): THREE.Texture {
  const N = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const g = canvas.getContext('2d')!;
  const c = N / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    // 中心付近は平らに濃く、外側 6 割で滑らかに 0 へ
    const k = Math.min(Math.max((t - 0.4) / 0.6, 0), 1);
    const a = SHADOW_OPACITY * (1 - k * k * (3 - 2 * k));
    grad.addColorStop(t, `rgba(255, 255, 255, ${a.toFixed(4)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, N, N);
  return new THREE.CanvasTexture(canvas);
}

interface GlowUniforms {
  [name: string]: THREE.IUniform;
  /** 光で囲む画像の幅と高さ（ワールド単位） */
  uGlowSize: THREE.IUniform<THREE.Vector2>;
  /** 画像の外へはみ出す幅（ワールド単位） */
  uGlowPad: THREE.IUniform<number>;
  /** x = 縁取りの太さ、y = にじみの広がり（ワールド単位） */
  uGlowWidth: THREE.IUniform<THREE.Vector2>;
  /** 画像を左右反転して使っているか */
  uGlowFlip: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
}

/**
 * 選択中のユニットの画像を囲む光。画像より一回り大きいスプライトで、
 * 画像の不透明部分を周囲から拾って太らせた形を、脈打つ光の色で塗る（本体はこの上に重ねて描く）。
 */
function createGlowSprite(time: THREE.IUniform<number>): THREE.Sprite {
  const uniforms: GlowUniforms = {
    uGlowSize: { value: new THREE.Vector2(1, 1) },
    uGlowPad: { value: 0 },
    uGlowWidth: { value: new THREE.Vector2() },
    uGlowFlip: { value: 0 },
    uTime: time,
  };
  const material = new THREE.SpriteMaterial({
    // map は選択中のユニットの画像に差し替える（シェーダで map を使うため最初から何か入れておく）
    map: new THREE.Texture(),
    color: GLOW_COLOR,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGlowUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGlowUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        /* glsl */ `#include <map_pars_fragment>
varying vec2 vGlowUv;
uniform vec2 uGlowSize;
uniform float uGlowPad;
uniform vec2 uGlowWidth;
uniform int uGlowFlip;
uniform float uTime;
float glowAlpha(vec2 q) {
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return 0.0;
  if (uGlowFlip == 1) q.x = 1.0 - q.x;
  return texture2D(map, q).a;
}`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
// このスプライト上の位置 → 画像の uv
vec2 gq = (vGlowUv * (uGlowSize + 2.0 * uGlowPad) - uGlowPad) / uGlowSize;
float gLine = 0.0;
float gSpread = 0.0;
for (int i = 0; i < 16; i++) {
  float ang = float(i) * 0.39269908;
  vec2 d = vec2(cos(ang), sin(ang)) / uGlowSize;
  gLine = max(gLine, glowAlpha(gq + d * uGlowWidth.x));
  gSpread += glowAlpha(gq + d * uGlowWidth.y) + glowAlpha(gq + d * uGlowWidth.y * 0.5);
}
gSpread = min(gSpread / 16.0, 1.0);
float gPulse = 0.5 + 0.5 * sin(uTime * 4.0);
float gA = max(gLine, gSpread * (0.45 + 0.45 * gPulse));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.97, 0.85), gLine * gPulse);
diffuseColor.a *= gA;
`,
      );
  };
  material.customProgramCacheKey = () => 'unit-glow';
  return new THREE.Sprite(material);
}
