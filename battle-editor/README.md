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

## GitHub Pages

main に push すると [.github/workflows/battle-editor-pages.yml](../.github/workflows/battle-editor-pages.yml) がビルドして
GitHub Pages に公開する（battle-editor・map-runtime・assets/maps・assets/units などに変更があったときだけ。Actions の画面から手動でも実行できる）。
初回だけリポジトリの Settings → Pages → Source を「GitHub Actions」にしておく。
Pages 上のマップはビルド時点の assets/maps/ の内容。

## マップ

ツールバーの「マップ」で開くウィンドウから、map-editor で保存したマップ（リポジトリ直下の [assets/maps/](../assets/maps/)）を「保存済み」で選んで読み込む。
map-editor で保存し直したら「一覧を更新」で反映される。ローカルの JSON を開く・ドロップすることもできる。
battle-editor からマップは書き換えない。

## 構成

```
src/
  toolbar.ts         画面の上のツールバー。道具のウィンドウ（マップ・描画負荷）を開く
  battle/
    app.ts           戦闘画面（MapView・ポインタ操作）。UI・演出はここに積み上げる
    ui.ts            画面の部品とつなぐ（マップの読み込み・描画負荷・ステータス行・戦闘ログ・地形）
    terrainInfo.ts   カーソルの HEX の地形のウィンドウ（ゲームの画面で使う）
    battleLog.ts     戦闘ログのウィンドウ
```
