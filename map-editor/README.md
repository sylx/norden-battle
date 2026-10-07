# Norden Map Editor

HEX マップデータ (JSON) からプロシージャルな 3D 地形を生成し、HEX グリッドを重ねて表示・編集するツール。
three.js + TypeScript + Vite。地形生成・描画は [map-runtime](../map-runtime/) にあり、battle-editor と共有している。

```sh
npm install
npm run dev          # http://localhost:5173/
npm run gen:samples  # assets/maps/ のサンプルを再生成（同名のファイルは上書き）
npm run build
```

URL パラメータ: `?map=pointy-test.json`（assets/maps/ のファイルを開く）、`?seed=5`（ランダムマップ）

## マップの保存先

マップはリポジトリ直下の [assets/maps/](../assets/maps/) に置く。「マップ」欄の「保存済み」から開き、
「保存」でファイル名欄の名前で書き込む（開発サーバー経由。`npm run build` した静的版では保存できない）。
battle-editor は同じ場所から読み込む。ローカルの JSON を開く・ダウンロードすることもできる。
形式は [map-runtime の README](../map-runtime/README.md#マップ-json-version-1) を参照。

## 操作

エディタでは「人工物の配置」のボタンを選んで HEX をクリックすると配置できる（同じものを再クリックで撤去、橋は向きを変更。Esc で選択ツールに戻る）。「森↔草原」ツールで森の伐採・植林、「街道」ツールで HEX をドラッグでなぞって街道を引ける（「撤去」ツールでなぞると消える）。

## 街道マップ

nordencult の戦略マップの街道でつながる 2 都市を 1 枚に描いたマップ（`road-<小さい ID>-<大きい ID>.json`、例 `road-P004-P012.json`）では、
「街道マップ」欄で両端の都市 ID と、防衛する都市ごとの戦闘の範囲（16×16）を設定する。

- 都市 A・B を入れると、それぞれの範囲の行が出る。行を選ぶとその範囲の枠（橙）を表示する
- 「範囲を配置」でマップをクリック・ドラッグすると、その HEX を中心に範囲が動く（flat は列、pointy は行を偶数に寄せ、マップに収める）
- 「範囲だけ表示」で、ゲームの戦闘で使う切り出し後のマップを表示する（その間は編集できない。保存は元のマップ）

形式は [map-runtime の README](../map-runtime/README.md#街道マップと戦闘の範囲) を参照。
