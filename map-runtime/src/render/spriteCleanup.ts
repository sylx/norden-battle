/**
 * 生成 AI などで作ったユニット画像を、スプライトとして使える形に整える。
 *
 * 1. 透過が無い画像は、外周から塗りつぶして単色の背景を抜く（外周の色の中央値を背景色とみなす）
 * 2. 不透明な部分の外接矩形に切り詰める（下端 = 足元になる）
 * 3. 大きすぎる画像は縮小する
 */

/** 背景色とみなす色の差（RGB ユークリッド距離, 0..441）。ここから FEATHER 倍までを半透明にする */
const BG_TOLERANCE = 40;
const FEATHER = 1.6;
/** 切り詰めで「描かれている」とみなす不透明度（0..255） */
const TRIM_ALPHA = 24;
/** 仕上がりの高さの上限（px） */
const MAX_HEIGHT = 512;

export function cleanupSprite(img: HTMLImageElement): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const g = src.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const image = g.getImageData(0, 0, w, h);
  if (!hasTransparency(image.data)) {
    removeBackground(image);
    g.putImageData(image, 0, 0);
  }

  const box = opaqueBounds(image);
  if (!box) return src;
  const scale = Math.min(1, MAX_HEIGHT / box.h);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(box.w * scale));
  out.height = Math.max(1, Math.round(box.h * scale));
  const og = out.getContext('2d')!;
  og.imageSmoothingQuality = 'high';
  og.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
  return out;
}

function hasTransparency(d: Uint8ClampedArray): boolean {
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

/** 外周とつながった背景色の領域を抜く。境目は色の差に応じて半透明にする */
function removeBackground(image: ImageData): void {
  const { width: w, height: h, data: d } = image;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const bg = [0, 1, 2].map((c) => median(border.map((p) => d[p * 4 + c])));
  const dist = (p: number) => Math.hypot(d[p * 4] - bg[0], d[p * 4 + 1] - bg[1], d[p * 4 + 2] - bg[2]);

  const limit = BG_TOLERANCE * FEATHER;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const p of border) {
    if (!seen[p] && dist(p) < limit) {
      seen[p] = 1;
      stack.push(p);
    }
  }
  while (stack.length > 0) {
    const p = stack.pop()!;
    const t = (dist(p) - BG_TOLERANCE) / (limit - BG_TOLERANCE);
    d[p * 4 + 3] = Math.round(255 * Math.min(Math.max(t, 0), 1));
    // 半透明の縁より先へは広げない
    if (t > 0) continue;
    const x = p % w;
    const y = (p - x) / w;
    const next = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const q of next) {
      if (q < 0 || seen[q] || dist(q) >= limit) continue;
      seen[q] = 1;
      stack.push(q);
    }
  }
}

function opaqueBounds(image: ImageData): { x: number; y: number; w: number; h: number } | null {
  const { width: w, height: h, data: d } = image;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] < TRIM_ALPHA) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}
