/**
 * ユニット画像の用意。リポジトリ直下の assets/units/ に画像があればそれを読み込み、
 * 無ければ（または読み込みに失敗したら）Canvas でプレースホルダーを描く。
 *
 * - ファイル名は兵種 ID（infantry.png など）。軍ごとに変えたいときは infantry_red.png のように軍 ID を付ける。
 * - 読み込んだ画像は spriteCleanup で背景を抜き、余白を切り詰めてから使う。
 * - プレースホルダーは 100×100 の座標系で右向きに描き、下端（y = 100）が足元。軍ごとに服の色を変える。
 */
import * as THREE from 'three';
import { TEAM_DEFS, type Facing, type TeamId, type UnitType } from '../core/units';
import { cleanupSprite } from './spriteCleanup';

const CANVAS_SIZE = 256;

/** assets/units/ の画像。ファイル名（拡張子なし）→ URL */
const IMAGE_URLS = new Map(
  Object.entries(
    import.meta.glob<string>('../../../assets/units/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }),
  ).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1).replace(/\.\w+$/, ''), url]),
);

export interface UnitImage {
  texture: THREE.Texture;
  /** 幅 / 高さ */
  aspect: number;
  /** クリック判定用の不透明度（uv は画像そのものの向き） */
  alphaAt(u: number, v: number): number;
}

/** 読み込み・描画済みの画像を種類・軍・向きごとに使い回す */
export class UnitArt {
  /** 画像の読み込みが終わって差し替えが必要になったとき */
  onChange: () => void = () => {};

  private readonly cache = new Map<string, UnitImage>();
  /** URL → 整えた画像 */
  private readonly loaded = new Map<string, HTMLCanvasElement | 'loading' | 'failed'>();

  get(type: UnitType, team: TeamId, facing: Facing): UnitImage {
    const url = IMAGE_URLS.get(`${type}_${team}`) ?? IMAGE_URLS.get(type);
    const canvas = url ? this.image(url, type) : null;
    const key = canvas ? `${url}:${facing}` : `${type}:${team}:${facing}`;
    let out = this.cache.get(key);
    if (!out) {
      out = makeUnitImage(canvas ?? drawPlaceholder(type, TEAM_DEFS[team].color), facing === 'left');
      this.cache.set(key, out);
    }
    return out;
  }

  dispose(): void {
    for (const v of this.cache.values()) v.texture.dispose();
    this.cache.clear();
  }

  private image(url: string, type: UnitType): HTMLCanvasElement | null {
    const state = this.loaded.get(url);
    if (state instanceof HTMLCanvasElement) return state;
    if (state) return null;
    this.loaded.set(url, 'loading');
    const img = new Image();
    img.onload = () => {
      this.loaded.set(url, cleanupSprite(img));
      // プレースホルダーを捨てて描き直してもらう
      for (const [k, v] of this.cache) {
        if (!k.startsWith(`${type}:`)) continue;
        v.texture.dispose();
        this.cache.delete(k);
      }
      this.onChange();
    };
    img.onerror = () => {
      this.loaded.set(url, 'failed');
      console.warn(`ユニット画像を読み込めません: ${url}（プレースホルダーで表示します）`);
    };
    img.src = url;
    return null;
  }
}

function makeUnitImage(canvas: HTMLCanvasElement, flip: boolean): UnitImage {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (flip) {
    texture.repeat.x = -1;
    texture.offset.x = 1;
  }
  const { width: w, height: h } = canvas;
  const alpha = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  return {
    texture,
    aspect: w / h,
    alphaAt(u, v) {
      const x = Math.min(Math.max(Math.floor((flip ? 1 - u : u) * w), 0), w - 1);
      const y = Math.min(Math.max(Math.floor((1 - v) * h), 0), h - 1);
      return alpha[(y * w + x) * 4 + 3] / 255;
    },
  };
}

// ---- プレースホルダー ----

const OUTLINE = '#1c140c';
const SKIN = '#e8b98a';
const STEEL = '#b8bec6';
const LEATHER = '#6a4a2e';
const CLOTH_DARK = '#3a2e24';

type Ctx = CanvasRenderingContext2D;

function drawPlaceholder(type: UnitType, teamColor: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CANVAS_SIZE;
  const g = canvas.getContext('2d')!;
  g.scale(CANVAS_SIZE / 100, CANVAS_SIZE / 100);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = OUTLINE;
  g.lineWidth = 2.2;
  const team = teamColor;
  const teamDark = shade(teamColor, -0.35);
  if (type === 'infantry') drawInfantry(g, team, teamDark);
  else if (type === 'archer') drawArcher(g, team, teamDark);
  else if (type === 'cavalry') drawCavalry(g, team, teamDark);
  else drawMage(g, team, teamDark);
  return canvas;
}

function shade(hex: string, t: number): string {
  const c = new THREE.Color(hex);
  const target = t < 0 ? new THREE.Color(0, 0, 0) : new THREE.Color(1, 1, 1);
  return '#' + c.lerp(target, Math.abs(t)).getHexString();
}

function shape(g: Ctx, fill: string, path: () => void, stroke = true): void {
  g.beginPath();
  path();
  g.fillStyle = fill;
  g.fill();
  if (stroke) g.stroke();
}

function poly(g: Ctx, pts: number[]): void {
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
}

function line(g: Ctx, color: string, width: number, pts: number[]): void {
  g.save();
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  // 縁取りしてから本体を引く
  g.strokeStyle = OUTLINE;
  g.lineWidth = width + 2.2;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
  g.restore();
}

function ellipse(g: Ctx, fill: string, x: number, y: number, rx: number, ry: number, rot = 0): void {
  shape(g, fill, () => g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2));
}

/** 立ち姿の脚と胴。x は体の中心 */
function body(g: Ctx, x: number, tunic: string, belt: string): void {
  // 脚とブーツ
  shape(g, CLOTH_DARK, () => poly(g, [x - 8, 70, x - 1, 70, x - 2, 92, x - 9, 92]));
  shape(g, CLOTH_DARK, () => poly(g, [x + 1, 70, x + 8, 70, x + 10, 92, x + 3, 92]));
  shape(g, LEATHER, () => poly(g, [x - 10, 90, x - 1, 90, x + 1, 98, x - 11, 98]));
  shape(g, LEATHER, () => poly(g, [x + 2, 90, x + 11, 90, x + 14, 98, x + 2, 98]));
  // 胴（チュニック）
  shape(g, tunic, () => poly(g, [x - 10, 42, x + 10, 42, x + 13, 74, x - 13, 74]));
  shape(g, belt, () => poly(g, [x - 11.5, 60, x + 11.5, 60, x + 11.8, 64, x - 11.8, 64]));
}

function head(g: Ctx, x: number, y: number): void {
  ellipse(g, SKIN, x, y, 8, 8.5);
  // 右向きの目
  g.fillStyle = OUTLINE;
  g.beginPath();
  g.arc(x + 4, y, 1.1, 0, Math.PI * 2);
  g.fill();
}

function helmet(g: Ctx, x: number, y: number): void {
  shape(g, STEEL, () => {
    g.arc(x, y - 1, 9, Math.PI, 0);
    g.lineTo(x + 9, y + 1);
    g.lineTo(x - 9, y + 1);
    g.closePath();
  });
  line(g, STEEL, 2, [x + 5, y, x + 5, y + 6]);
}

function drawInfantry(g: Ctx, team: string, teamDark: string): void {
  // 背中側に振り上げた剣
  line(g, STEEL, 3, [36, 50, 22, 14]);
  line(g, LEATHER, 3.5, [38, 54, 35, 48]);
  line(g, '#c8a040', 3, [31, 50, 40, 46]);
  body(g, 48, team, LEATHER);
  // 剣を持つ腕
  line(g, teamDark, 6, [42, 46, 36, 52]);
  head(g, 48, 32);
  helmet(g, 48, 32);
  // 盾（体の前）
  shape(g, team, () => {
    g.moveTo(56, 44);
    g.lineTo(76, 44);
    g.quadraticCurveTo(77, 68, 66, 80);
    g.quadraticCurveTo(55, 68, 56, 44);
    g.closePath();
  });
  shape(g, '#f0e6c8', () => poly(g, [64.5, 48, 67.5, 48, 67.5, 56, 73, 56, 73, 59, 67.5, 59, 67.5, 72, 64.5, 72, 64.5, 59, 59, 59, 59, 56, 64.5, 56]), false);
}

function drawArcher(g: Ctx, team: string, teamDark: string): void {
  // 背中の矢筒
  shape(g, LEATHER, () => poly(g, [30, 40, 37, 37, 44, 64, 37, 67]));
  line(g, '#e8e0d0', 1.6, [31, 38, 28, 30]);
  line(g, '#e8e0d0', 1.6, [34, 37, 33, 29]);
  body(g, 46, team, LEATHER);
  // フード付きの頭
  head(g, 47, 32);
  shape(g, teamDark, () => {
    g.moveTo(38, 38);
    g.quadraticCurveTo(36, 20, 48, 21);
    g.quadraticCurveTo(58, 22, 55, 30);
    g.lineTo(50, 28);
    g.quadraticCurveTo(43, 30, 44, 42);
    g.closePath();
  });
  // 弓と弦
  g.save();
  g.lineWidth = 4.2;
  g.beginPath();
  g.arc(58, 52, 28, -1.15, 1.15);
  g.stroke();
  g.strokeStyle = '#8a5a2a';
  g.lineWidth = 2.4;
  g.stroke();
  g.restore();
  const top = [58 + 28 * Math.cos(-1.15), 52 + 28 * Math.sin(-1.15)];
  const bottom = [58 + 28 * Math.cos(1.15), 52 + 28 * Math.sin(1.15)];
  g.save();
  g.strokeStyle = '#e8e0d0';
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(top[0], top[1]);
  g.lineTo(52, 50);
  g.lineTo(bottom[0], bottom[1]);
  g.stroke();
  g.restore();
  // 弓を持つ腕と弦を引く腕
  line(g, teamDark, 5.5, [50, 46, 83, 50]);
  line(g, teamDark, 5.5, [44, 47, 52, 50]);
}

function drawCavalry(g: Ctx, team: string, teamDark: string): void {
  const horse = '#8a5a3a';
  const horseDark = '#5e3a24';
  // 奥側の脚
  line(g, horseDark, 5, [30, 74, 26, 96]);
  line(g, horseDark, 5, [66, 74, 72, 96]);
  // 尾
  line(g, '#3a2418', 4, [20, 64, 12, 82]);
  // 胴・首・頭
  ellipse(g, horse, 46, 66, 28, 12);
  shape(g, horse, () => poly(g, [62, 62, 72, 42, 80, 44, 76, 66]));
  ellipse(g, horse, 82, 47, 9, 5.5, 0.45);
  shape(g, '#3a2418', () => poly(g, [70, 44, 76, 40, 66, 58]), false);
  // 手前の脚
  line(g, horse, 5.5, [36, 74, 38, 97]);
  line(g, horse, 5.5, [60, 74, 58, 97]);
  // 鞍掛け（軍の色）
  shape(g, team, () => poly(g, [34, 56, 58, 56, 60, 74, 32, 74]));
  line(g, '#e8d890', 1.5, [33, 71, 59, 71]);
  // 騎手
  shape(g, teamDark, () => poly(g, [42, 56, 50, 56, 52, 70, 44, 70]));
  shape(g, team, () => poly(g, [38, 30, 52, 30, 54, 58, 38, 58]));
  head(g, 45, 22);
  helmet(g, 45, 22);
  // 槍と小旗
  line(g, '#8a6a40', 2.6, [30, 62, 96, 14]);
  shape(g, team, () => poly(g, [88, 20, 99, 22, 94, 27]));
  line(g, teamDark, 5.5, [46, 36, 56, 45]);
}

function drawMage(g: Ctx, team: string, teamDark: string): void {
  // 杖
  line(g, '#6a4a2e', 3, [68, 20, 70, 98]);
  const orb = g.createRadialGradient(67, 17, 1, 67, 17, 10);
  orb.addColorStop(0, '#ffffff');
  orb.addColorStop(0.35, '#8ae8ff');
  orb.addColorStop(1, 'rgba(80, 180, 255, 0)');
  g.fillStyle = orb;
  g.beginPath();
  g.arc(67, 17, 10, 0, Math.PI * 2);
  g.fill();
  // ローブ
  shape(g, team, () => {
    g.moveTo(40, 40);
    g.lineTo(56, 40);
    g.quadraticCurveTo(62, 70, 66, 98);
    g.lineTo(30, 98);
    g.quadraticCurveTo(34, 70, 40, 40);
    g.closePath();
  });
  line(g, '#e8d890', 1.6, [48, 42, 48, 97]);
  head(g, 48, 32);
  // ひげ
  shape(g, '#eeeae0', () => poly(g, [44, 35, 56, 35, 52, 50, 48, 46]));
  // とんがり帽子
  shape(g, teamDark, () => poly(g, [36, 28, 60, 28, 44, 4]));
  shape(g, teamDark, () => g.ellipse(48, 28, 14, 3, 0, 0, Math.PI * 2));
  // 杖を持つ腕
  line(g, teamDark, 6, [52, 44, 67, 50]);
}
