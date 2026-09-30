/**
 * ユニットの表示。2D 画像をカメラ正対のスプライトで HEX の中心に立て、
 * 足元に横長の楕円の影を地面に沿わせて敷く。
 *
 * どちらも深度テストをせず地形・木・建物より手前に描く（森や山の陰でもユニットを見失わないため）。
 * スプライト同士は奥から順に描かれるので、手前のユニットが奥のユニットに重なる。
 */
import * as THREE from 'three';
import type { HexMap } from '../core/mapData';
import { Heightmap, type TerrainData } from '../core/terrainGen';
import { unitFacings, type UnitData } from '../core/units';
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
const BRIDGE_DECK = 0.14;
/** クリック判定で「描かれている」とみなす不透明度 */
const PICK_ALPHA = 0.25;

const SHADOW_ORDER = 9;
const SPRITE_ORDER = 10;

interface UnitSprite {
  sprite: THREE.Sprite;
  image: UnitImage;
  unit: UnitData;
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

  constructor() {
    this.group.name = 'units';
  }

  build(map: HexMap, data: TerrainData): void {
    this.clear();
    const hm = new Heightmap(data);
    const s = map.layout.size;
    const facings = unitFacings(map);
    for (const unit of map.allUnits()) {
      const cell = map.get(unit.col, unit.row);
      if (!cell) continue;
      const c = map.layout.offsetToWorld(unit.col, unit.row);
      const onBridge = cell.feature === 'bridge';
      const floor = onBridge ? data.waterLevel + BRIDGE_DECK * s : data.waterLevel;
      const y = Math.max(hm.heightAt(c.x, c.z), floor);

      const rx = SHADOW_RX * this.scale * s;
      const shadow = new THREE.Mesh(
        shadowGeometry(hm, c.x, c.z - SHADOW_SHIFT * this.scale * s, rx, rx * SHADOW_ASPECT, onBridge ? floor : data.waterLevel),
        this.shadowMaterial,
      );
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
      this.sprites.push({ sprite, image, unit });
    }
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
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
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
