# @norden/map-runtime

HEX マップのデータと地形生成（`core/`、three.js 非依存）、three.js での描画（`render/`）、
マップ JSON の読み書き（`mapFiles`）。map-editor と battle-editor で共有する。

```ts
import { HexMap } from '@norden/map-runtime/core/mapData';
import { MapView } from '@norden/map-runtime/render/mapView';
import { SceneContext } from '@norden/map-runtime/render/scene';
import { loadMapFile } from '@norden/map-runtime/mapFiles';

const view = new MapView(new SceneContext(container)); // パラメータは map-editor の初期値
view.setMap(new HexMap(await loadMapFile('fluen.json')));
renderer.setAnimationLoop(() => view.render());
```

画面を離れるときは `view.dispose()`（地形・木・人工物・ユニットの GPU 資源）→ `ctx.dispose()`（レンダラ・コントロール・キャンバス。WebGL のコンテキストも手放す）の順に破棄する。

マップファイルを使うツールは Vite の設定に `mapsPlugin` を入れる（`readOnly: true` で保存を禁止）:

```ts
import { mapsPlugin } from '../map-runtime/server/vite-plugin-maps.ts';
plugins: [mapsPlugin({ mapsDir: fileURLToPath(new URL('../assets/maps', import.meta.url)) })]
```

## 構成

```
src/
  mapFiles.ts      assets/maps/ への読み書き（一覧・読み込み・保存）
  core/            three.js 非依存
    hex.ts           HEX 座標系（オフセット/軸座標/ワールド座標の変換）
    mapData.ts       マップ JSON の型・パース・書き出し
    battleArea.ts    街道マップから戦闘の範囲を切り出す（cropMap・cropBattleArea）
    features.ts      人工物の定義・橋の向き・城/砦の領域判定
    roads.ts         街道の接続データ・中心線（ベジェ曲線）・距離検索
    terrainTypes.ts  地形タイプ定義（色・高さオフセット・木の密度）
    terrainGen.ts    HEX マップ → 高さ/色/木配置の生成、Heightmap 問い合わせ
    randomMap.ts     テスト用ランダムマップ
    noise.ts         シード付き乱数・fBm
  render/          three.js 描画
    hexOverlay.ts    HEX グリッド（シェーダで描画）
    terrainMeshes.ts 地形・水面のメッシュ
    roads.ts         街道のメッシュ（地形に沿う帯、縁をアルファでぼかす）
    structures/      人工物（村・城・砦・橋）。模様（石積み・瓦・板張り・漆喰）はシェーダで描画
    foliage.ts       木・低木（葉カード方式、手続き生成テクスチャ、風揺れ）
    scene.ts         レンダラ・カメラ・ライト
    mapView.ts       上記をまとめてマップ 1 枚を描く（map-editor・battle-editor 共通）
server/
  vite-plugin-maps.ts  assets/maps/ をページの maps/ として配信・保存する Vite プラグイン
```

## マップ JSON (version 1)

```json
{
  "version": 1,
  "name": "フルーエン近郊",
  "seed": 3,
  "grid": { "orientation": "flat", "cols": 24, "rows": 16, "hexSize": 1 },
  "cells": [
    { "col": 0, "row": 0, "terrain": "forest", "elevation": 1 },
    { "col": 5, "row": 3, "terrain": "water", "elevation": 0, "feature": "bridge", "featureDir": 1 },
    { "col": 7, "row": 2, "terrain": "plains", "elevation": 1, "feature": "castle", "roads": [4] }
  ]
}
```

- `orientation`: `flat`（odd-q オフセット）/ `pointy`（odd-r オフセット）
- `terrain`: `deep_water` `water` `plains` `forest` `hills` `mountain` `swamp` `wasteland`
- `elevation`: 整数の標高レベル（0 が水面付近）
- `seed`: 地形ノイズのシード。同じ JSON + 同じシード + 同じパラメータなら同じ地形になる
- `feature`（省略可）: 人工物
  - `bridge` 橋（水域のみ）。`featureDir`（0..5、0 と 3 は同じ軸）で向きを指定、省略時は両岸が陸の向きを自動選択
  - `village` 村 / `fort` 砦 / `castle` 城（陸のみ）。隣接する砦・城は 1 つにつながり、外周に柵・城壁、頂点に塔、1 か所に門ができる
- `roads`（省略可）: 街道がつながっている方向（0..5）の配列。隣の HEX 側の逆方向は読み込み時に補う。マップ外への方向も可
  - 城・砦の門は道が来ている辺に、橋は道の向きに合わせて架かる。道沿いには木が生えず、村の家は道を避けて建つ
- `cells` に無い HEX は `plains` / `elevation: 0`
- `link`（省略可）: 街道マップの両端の都市 `{ "cities": ["P004", "P012"] }`（nordencult の戦略マップの都市 ID）
- `battleAreas`（省略可）: 街道マップ上の戦闘の範囲の左上の HEX。防衛する都市の ID で引く（下記）
- `origin`（省略可）: 切り出したマップの、元のマップでの左上の HEX（`cropMap` が付ける）
- `deployments`（省略可）: 街道マップの戦闘の初期配置地点。防衛する都市の ID で引く（下記）
- `deploy`（省略可）: 切り出したマップの初期配置地点（`cropBattleArea` が付ける。切り出したマップの座標）

## 街道マップと戦闘の範囲

戦略マップの街道 A–B ごとに、A と B の両方の都市を描いた大きなマップ（街道マップ、`road-<小さい ID>-<大きい ID>.json`）を
1 枚作り、侵攻方向ごとの戦闘の範囲を持たせる。範囲は防衛する都市の ID で引く:
A→B の侵攻では B を含む範囲 `battleAreas.B`、B→A では `battleAreas.A`。

```json
{
  "version": 1,
  "name": "アンバリア–フルーエン",
  "seed": 3,
  "grid": { "orientation": "flat", "cols": 32, "rows": 20, "hexSize": 1 },
  "link": { "cities": ["P004", "P012"] },
  "battleAreas": {
    "P004": { "col": 14, "row": 2 },
    "P012": { "col": 0, "row": 2 }
  },
  "deployments": {
    "P004": {
      "attacker": [{"col":14,"row":6},{"col":14,"row":7}],
      "defender": [{"col":24,"row":8},{"col":25,"row":8}]
    }
  },
  "cells": []
}
```

- 範囲の大きさは `BATTLE_AREA_SIZE`（16×16。`core/mapData.ts`）。範囲はマップに収まっていなければならない
- 範囲の左上は、flat（odd-q）では列を、pointy（odd-r）では行を偶数にする。奇数だと切り出したときに HEX のずれ方が反転する（`isAlignedOrigin`）
- `cropMap(data, area)`（`core/battleArea.ts`）で範囲を切り出す。HEX・人工物・街道・ユニットを新しい座標に移し、範囲の外へ向かう街道の方向は残す。
  切り出したマップには `origin` が付き、地形のノイズ・木の配置・街道の揺らぎ・建物の形を元のマップでの座標で引くので、
  元のマップと同じ見た目になる（範囲の縁だけは、外の HEX が無い分だけ地形の混ざり方が変わる）
- `deployments.<都市>` は、その範囲の戦闘の初期配置地点（ユーザーがユニットを自由に置ける HEX）。`attacker`（攻撃側）・`defender`（防衛側）の HEX の配列で、
  座標は街道マップのもの。範囲の外の HEX は切り出したときに落ちる。1 つの HEX は片方の陣営にだけ属する
- `cropBattleArea(data, city)`（`core/battleArea.ts`）は `battleAreas[city]` を切り出し、`deployments[city]` を切り出したマップの座標にして `deploy` に付ける
- map-editor の「街道マップ」欄で両端の都市と範囲・初期配置地点を設定できる

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
