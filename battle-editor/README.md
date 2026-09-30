# Norden Battle Editor

戦闘画面の UI・演出を試し、演出のパラメータを調整するためのツール。three.js + TypeScript + Vite。

マップの描画は map-editor と同じ [map-runtime](../map-runtime/) の `MapView` を使い、
地形生成などのパラメータは map-editor の初期値のまま。

```sh
npm install
npm run dev          # http://localhost:5175/
npm run build
```

URL パラメータ: `?map=pointy-test.json`（assets/maps/ のファイルを開く）

## マップ

map-editor で保存したマップ（リポジトリ直下の [assets/maps/](../assets/maps/)）を「保存済み」から選んで読み込む。
map-editor で保存し直したら「一覧を更新」で反映される。ローカルの JSON を開く・ドロップすることもできる。
battle-editor からマップは書き換えない。

## 構成

```
src/
  battle/
    app.ts   戦闘画面（MapView・ポインタ操作）。UI・演出はここに積み上げる
    ui.ts    パネル（マップの読み込み・HEX 情報）
```
