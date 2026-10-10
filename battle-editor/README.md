# Norden Battle Editor

戦闘画面の UI・演出を試し、演出のパラメータを調整するためのツール。three.js + React + TypeScript + Vite。

戦闘画面は [battle-runtime](../battle-runtime/) の `BattleScreen`（ゲーム本体と同じもの）で、ここではその上にエディタの道具
（ツールバー・マップ・描画負荷）を重ねるだけ。マップの描画は map-editor と同じ [map-runtime](../map-runtime/) の `MapView` を使い、
地形生成などのパラメータは map-editor の初期値のまま。UI の部品は [norden-ui](https://github.com/sylx/norden-ui)（リポジトリの隣の `../../norden-ui`）。

```sh
npm install
npm run dev          # http://localhost:5175/
npm run build
```

URL パラメータ: `?map=pointy-test.json`（assets/maps/ のファイルを開く）

## GitHub Pages

main に push すると [.github/workflows/battle-editor-pages.yml](../.github/workflows/battle-editor-pages.yml) がビルドして
GitHub Pages に公開する（battle-editor・battle-runtime・map-runtime・assets/maps・assets/units などに変更があったときだけ。Actions の画面から手動でも実行できる）。
norden-ui はビルドのときに main の最新を隣に取ってくる（norden-ui だけを更新したときは手動で実行する）。
初回だけリポジトリの Settings → Pages → Source を「GitHub Actions」にしておく。
Pages 上のマップはビルド時点の assets/maps/ の内容。

## マップ

ツールバーの「マップ」で開くウィンドウから、map-editor で保存したマップ（リポジトリ直下の [assets/maps/](../assets/maps/)）を「保存済み」で選んで読み込む。
map-editor で保存し直したら「一覧を更新」で反映される。ローカルの JSON を開く・ドロップすることもできる。
battle-editor からマップは書き換えない。

## 構成

```
src/
  main.tsx         入口
  EditorApp.tsx    BattleScreen にツールバーと道具のウィンドウ（マップ・描画負荷）を重ねる。JSON のドロップ
  style.css        ツールバーと道具のウィンドウ
```

戦闘のルール・戦闘画面の UI（地形・戦闘記録・行動メニュー）は [battle-runtime](../battle-runtime/) にある。
