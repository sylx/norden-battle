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
