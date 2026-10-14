# Norden Battle Editor

戦闘画面の UI・演出を試し、演出のパラメータを調整するためのツール。three.js + React + TypeScript + Vite。

戦闘画面は [battle-runtime](../battle-runtime/) の `BattleScreen`（ゲーム本体と同じもの）で、ここではその上にエディタの道具
（ツールバー・マップ・描画負荷・セリフ）を重ねるだけ。マップの描画は map-editor と同じ [map-runtime](../map-runtime/) の `MapView` を使い、
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
街道マップ（`battleAreas` のあるマップ）は「戦闘の範囲」で防衛する都市の範囲を選んで切り出す（既定は初期配置地点のある最初の範囲）。
切り出したマップは初期配置地点に部隊を置く配備から始まる。「最初から」で同じマップを読み込み直して配備からやり直せる。
battle-editor からマップは書き換えない。

## セリフ

ツールバーの「セリフ」で、喋る場面で必ず喋らせたり、選択中のユニットに場面ごとのセリフを言わせたりできる。言ったセリフは下に記録される。

norden-battle を nordencult のサブモジュールとして置いているときは、ゲームのセリフのデータ（`../../src/data/voiceLines.json`。
norden-data のセリフエディタで書く）と騎士（`characterData.json`）を読み、騎士の口調・性格に合わせて喋る（[src/gameVoices.ts](src/gameVoices.ts)）。
ユニットごとに喋る騎士を選べる（決めていなければ口調のある騎士を順に割り当てる。吹き出しの顔は表示確認用の顔のまま）。
norden-data でセリフを保存すると、開いている battle-editor にもそのまま反映される。
ゲームが無いとき（GitHub Pages など）は表示確認用の決まったセリフで喋る。

## 退却・捕縛

ツールバーの「退却・捕縛」で、軍ごとにダミーの退却先の拠点を渡すかどうかを切り替える（渡さない軍のユニットは退却を選べない。
既定は両軍とも渡す）。退却に失敗する確率と殲滅されて捕縛される確率の表と、退却・殲滅の結果（捕虜になったか）の記録も出す。

## 決着

どちらかの陣営の部隊がすべて殲滅・退却するか、攻撃側のユニットが防衛拠点（範囲を切り出したマップの `stronghold`。地面が金色）に入ると決着し、
攻撃側をプレイヤーとした勝利・敗北のカットイン（`battle-win`・`battle-lose`）の後に決着のウィンドウを出す。その「最初から」で同じマップを読み込み直す。

## 構成

```
src/
  main.tsx         入口
  EditorApp.tsx    BattleScreen にツールバーと道具のウィンドウ（マップ・描画負荷・セリフ・退却・捕縛）を重ねる。JSON のドロップ
  gameVoices.ts    ゲームのセリフのデータと騎士（あれば）。ユニットに喋らせる騎士の割り当て
  style.css        ツールバーと道具のウィンドウ
```

戦闘のルール・戦闘画面の UI（地形・戦闘記録・行動メニュー）は [battle-runtime](../battle-runtime/) にある。
