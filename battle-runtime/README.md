# @norden/battle-runtime

戦闘のルールと戦闘画面。three.js の戦闘画面（`BattleApp`。マップ・ユニット・入力・演出）と、
その上に重ねる React の UI（`BattleScreen`）。battle-editor とゲーム本体（nordencult の戦闘のシーン）で共有する。

UI の部品は [norden-ui](https://github.com/sylx/norden-ui) を使う（地形・戦闘記録・行動メニュー・ターン表示の枠は
`ThinFrame` の細いベゼル、ターン終了は `Button`）。norden-ui はリポジトリの隣（`../../norden-ui`）のソースを
そのまま読み込むので、使う側の Vite・TypeScript の設定に別名を入れる（battle-editor の vite.config.ts・tsconfig.json を参照）。

```tsx
import { BattleScreen } from '@norden/battle-runtime';

// 親の要素いっぱいに広がる。map を変えると読み込み直す
<BattleScreen map={mapData} statuses={makeStatuses} onApp={setApp} notice={error}>
  {/* 上に重ねるもの（エディタの道具・ゲームの見出しなど） */}
</BattleScreen>
```

- `map`: 戦場のマップ（`MapData`）。null の間は何も載せない。
- `statuses`: マップのユニットに戦闘中の状態（兵士数・士気・行動力・指揮官）を配る関数。省略すると表示確認用の仮の値（`demoStatuses`）。
  ゲームでは騎士・兵の数から作って渡す（ユニットはマップの `units` に置く）。
- `onApp`: `BattleApp` を作った・破棄した（null）とき。描画の設定（解像度・森の描き方など）を変えるときに使う。
- `notice`: ステータス行に出す知らせ（マップを読めないときなど）。

`BattleApp` は React なしでも使える（`new BattleApp(container)` → `loadMap(data)`、画面を離れるときは `dispose()`）。
起きたことは `app.on('execute', (report) => …)` のように受け取る（`BattleEvents`）。行動メニューは DOM を持たない
`app.menu`（`ActionMenuModel`）で、描画は `ui/ActionMenu.tsx`。

## 構成

```
src/
  index.ts         公開するもの
  app.ts           戦闘画面の本体（MapView・ポインタ操作・予約と実行のアニメーション）。BattleEvents で知らせる
  menuModel.ts     行動メニューの状態（中身・2 階層目・毎フレームの位置の基準）
  actions.ts       行動の定義と行動メニューの項目の組み立て
  combat.ts        攻撃の種類・射程・相手・結果
  damage.ts        ダメージの計算
  morale.ts        士気の増減
  movement.ts      移動の範囲・経路・ZOC
  unitStatus.ts    ユニットの戦闘中の状態（と表示確認用の仮の値）
  unitTags.ts      ユニットの頭上の情報札（HTML。毎フレーム置き直す）
  popups.ts        兵数の減少などを頭上に出す
  interceptFx.ts   迎撃の構えのユニットの足元の光の輪
  ui/
    BattleScreen.tsx     戦闘画面（BattleApp を置き、下の部品を重ねる）
    ActionMenu.tsx       行動メニュー（ユニットの横に毎フレーム追いかける）
    TerrainWindow.tsx    カーソルの HEX の地形のウィンドウ（移動・攻撃の予測も出す）
    BattleLogWindow.tsx  戦闘記録のウィンドウ（畳む・ドラッグで動かす）
    statusText.tsx       ステータス行の案内
    battle.css           戦闘画面のスタイル（すべて .battle-screen の中）
```
