# Norden Map Editor

HEX マップデータ (JSON) からプロシージャルな 3D 地形を生成し、HEX グリッドを重ねて表示するツール。
three.js + TypeScript + Vite。

```sh
npm install
npm run dev          # http://localhost:5173/
npm run gen:samples  # public/maps/ のサンプルを再生成
npm run build
```

URL パラメータ: `?map=pointy-test.json`（public/maps/ のファイルを開く）、`?seed=5`（ランダムマップ）

## 構成

```
src/
  core/            three.js 非依存（戦闘デモなどでも再利用する想定）
    hex.ts           HEX 座標系（オフセット/軸座標/ワールド座標の変換）
    mapData.ts       マップ JSON の型・パース・書き出し
    terrainTypes.ts  地形タイプ定義（色・高さオフセット・木の密度）
    terrainGen.ts    HEX マップ → 高さ/色/木配置の生成、Heightmap 問い合わせ
    randomMap.ts     テスト用ランダムマップ
    noise.ts         シード付き乱数・fBm
  render/          three.js 描画
    hexOverlay.ts    HEX グリッド（シェーダで描画）
    terrainMeshes.ts 地形・水面のメッシュ
    foliage.ts       木・低木（葉カード方式、手続き生成テクスチャ、風揺れ）
    scene.ts         レンダラ・カメラ・ライト
  editor/          エディタ UI
```

## マップ JSON (version 1)

```json
{
  "version": 1,
  "name": "フルーエン近郊",
  "seed": 3,
  "grid": { "orientation": "flat", "cols": 24, "rows": 16, "hexSize": 1 },
  "cells": [
    { "col": 0, "row": 0, "terrain": "forest", "elevation": 1 }
  ]
}
```

- `orientation`: `flat`（odd-q オフセット）/ `pointy`（odd-r オフセット）
- `terrain`: `deep_water` `water` `plains` `forest` `hills` `mountain` `swamp` `wasteland`
- `elevation`: 整数の標高レベル（0 が水面付近）
- `seed`: 地形ノイズのシード。同じ JSON + 同じシード + 同じパラメータなら同じ地形になる
- `cells` に無い HEX は `plains` / `elevation: 0`

## 地形生成の仕組み

1. **HEX 重みカーネル**: 各頂点で近傍 7 HEX の中心からの距離に応じた重みを計算する。
   中心付近はその HEX の値だけ（平坦な台地）、辺に近づくと隣と滑らかに混ざる。
   辺の中点では 2 HEX が 1:1、頂点では 3 HEX が 1:1:1 になるので、境界はどこでも連続。
2. **ドメインワープ**: 重みを求める前に座標をノイズで歪める。
   地形の境目は HEX の直線ではなく自然な形になるが、HEX グリッド自体は規則的なまま。
3. **合成**: 標高レベル × 段の高さ + 地形ごとのオフセット（高さにノイズは乗せない）。
   色も同じ重みで混ぜ、斜面は岩・高所は雪・水際は砂にする。
4. **グリッド表示**: 地形マテリアルのフラグメントシェーダでワールド XZ から HEX を逆算して線を描く。
   起伏に完全に沿い、ホバー/選択/HEX ごとの塗り（DataTexture）もシェーダで行う。

「HEX 中心付近の地形はその HEX の値にほぼ一致する」ことが保証されるので、
ゲームロジックは JSON の値（地形タイプ・標高レベル）だけを見ればよく、見た目の地形とずれない。
