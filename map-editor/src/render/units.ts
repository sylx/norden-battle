/**
 * ユニットの表示。2D 画像をカメラ正対のスプライトで HEX の中心に立て、
 * 足元に軍の色の円を地面に沿わせて敷く。
 *
 * どちらも深度テストをせず地形・木・建物より手前に描く（森や山の陰でもユニットを見失わないため）。
 * スプライト同士は奥から順に描かれるので、手前のユニットが奥のユニットに重なる。
 */
import * as THREE from 'three';
import type { HexMap } from '../core/mapData';
import { Heightmap, type TerrainData } from '../core/terrainGen';
import { TEAM_DEFS, type UnitData } from '../core/units';
import { UnitArt, type UnitImage } from './unitArt';

/** スプライトの高さ（hexSize 比） */
const UNIT_HEIGHT = 0.95;
/** 足元の円の半径（hexSize 比） */
const RING_RADIUS = 0.5;
/** 橋の上に立つときの足元の高さ（水面から、hexSize 比） */
const BRIDGE_DECK = 0.14;
/** クリック判定で「描かれている」とみなす不透明度 */
const PICK_ALPHA = 0.25;

const RING_ORDER = 9;
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
  private readonly ringTexture = createRingTexture();

  constructor() {
    this.group.name = 'units';
  }

  build(map: HexMap, data: TerrainData): void {
    this.clear();
    const hm = new Heightmap(data);
    const s = map.layout.size;
    for (const unit of map.allUnits()) {
      const cell = map.get(unit.col, unit.row);
      if (!cell) continue;
      const c = map.layout.offsetToWorld(unit.col, unit.row);
      const onBridge = cell.feature === 'bridge';
      const floor = onBridge ? data.waterLevel + BRIDGE_DECK * s : data.waterLevel;
      const y = Math.max(hm.heightAt(c.x, c.z), floor);

      const color = TEAM_DEFS[unit.team].color;
      const ring = new THREE.Mesh(
        ringGeometry(hm, c.x, c.z, RING_RADIUS * s, onBridge ? floor : data.waterLevel),
        new THREE.MeshBasicMaterial({
          map: this.ringTexture,
          color,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          fog: false,
        }),
      );
      ring.renderOrder = RING_ORDER;
      this.group.add(ring);

      const image = this.art.get(unit.type, unit.team, unit.facing ?? 'right');
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
      sprite.scale.set(UNIT_HEIGHT * s * image.aspect, UNIT_HEIGHT * s, 1);
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
    this.ringTexture.dispose();
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
      // テクスチャは UnitArt / ringTexture が持っているのでマテリアルだけ捨てる
      ((child as THREE.Mesh | THREE.Sprite).material as THREE.Material).dispose();
    }
    this.sprites = [];
  }
}

/** 地面に沿わせた円盤（同心円 × 放射状の格子） */
function ringGeometry(hm: Heightmap, cx: number, cz: number, radius: number, floor: number): THREE.BufferGeometry {
  const RINGS = 4;
  const SEGS = 32;
  const lift = 0.015;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const push = (dx: number, dz: number) => {
    const x = cx + dx;
    const z = cz + dz;
    pos.push(x, Math.max(hm.heightAt(x, z), floor) + lift, z);
    uv.push(0.5 + dx / (2 * radius), 0.5 - dz / (2 * radius));
  };
  push(0, 0);
  for (let r = 1; r <= RINGS; r++) {
    const rr = (radius * r) / RINGS;
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

/** 白の円（薄い塗り + くっきりした縁）。マテリアルの color で軍の色に染める */
function createRingTexture(): THREE.Texture {
  const N = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const g = canvas.getContext('2d')!;
  const c = N / 2;
  g.fillStyle = 'rgba(255, 255, 255, 0.3)';
  g.beginPath();
  g.arc(c, c, c * 0.9, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  g.lineWidth = N * 0.1;
  g.beginPath();
  g.arc(c, c, c * 0.87, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255, 255, 255, 1)';
  g.lineWidth = N * 0.06;
  g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
