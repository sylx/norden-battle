# @norden/battle-runtime

戦闘のルールと戦闘画面。three.js の戦闘画面（`BattleApp`。マップ・ユニット・入力・演出）と、
その上に重ねる React の UI（`BattleScreen`）。battle-editor とゲーム本体（nordencult の戦闘のシーン）で共有する。

UI の部品は [norden-ui](https://github.com/sylx/norden-ui) を使う（地形・騎士・戦闘記録・配備の枠は題名の札付きの `ThinFrameWithTitle`、
行動メニュー・ターン表示の枠は `ThinFrame` の細いベゼル、ターン終了は `Button`）。norden-ui はリポジトリの隣（`../../norden-ui`）のソースを
そのまま読み込むので、使う側の Vite・TypeScript の設定に別名を入れる（battle-editor の vite.config.ts・tsconfig.json を参照）。

```tsx
import { BattleScreen } from '@norden/battle-runtime';

// 親の要素いっぱいに広がる。map を変えると読み込み直す
<BattleScreen map={mapData} statuses={makeStatuses} troops={makeTroops} onApp={setApp} notice={error}>
  {/* 上に重ねるもの（エディタの道具・ゲームの見出しなど） */}
</BattleScreen>
```

- `map`: 戦場のマップ（`MapData`）。null の間は何も載せない。街道マップから `cropBattleArea` で切り出すと、
  初期配置地点（`deploy`）が付いて配備フェーズから始まる。
- `troops`: 配備フェーズで置く部隊（`Troop`: 陣営・兵種・戦闘中の状態）を配る関数。省略すると表示確認用の仮の部隊（`demoTroops`。陣営ごとに 8 部隊）。
  ゲームでは騎士・兵の数から作って渡す。
- `statuses`: マップに最初から置いてあるユニット（`units`）に戦闘中の状態（兵士数・士気・行動力・指揮官）を配る関数。
  省略すると表示確認用の仮の値（`demoStatuses`）。
- `onApp`: `BattleApp` を作った・破棄した（null）とき。描画の設定（解像度・森の描き方など）を変えるときに使う。
- `cutInTexts`: 戦闘開始・ターンのカットインの文字（`{ start: (map) => ({ text, subText }), turn: (turn, team) => ({ text, subText }) }`）。
  省略すると「戦闘開始」とマップの名前、「赤軍のターン」と「TURN  1」。ゲームでは戦場と日付・勢力の名前を渡す。
- `barks`: 何を喋るか（`BarkSource`。場面ごとのセリフ `line` と一斉攻撃の掛け合い `exchange`）。
  省略すると表示確認用の決まったセリフ（`demoBarks`）。ゲームでは騎士の口調・性格から会話データを引くものを渡す。
- `notice`: ステータス行に出す知らせ（マップを読めないときなど）。

## 戦闘の流れ

0. 戦闘開始のカットイン（norden-ui の `CUTIN_TEMPLATES['battle-start']`）。マップを読み込むたびに出し、終わるまで配備のウィンドウ・ターン表示を出さない。
   画面を押すと飛ばせる。カットインの書体（Shippori Mincho B1・Cinzel・Cinzel Decorative・Noto Serif JP）は使う側の HTML で読み込む
   （battle-editor の index.html を参照）。
1. 配備フェーズ（マップに `deploy` があるとき）: 防衛側（赤軍）→ 攻撃側（青軍）の順に、配備のウィンドウの一覧から部隊を選び、
   軍の色で塗った配置地点をクリックして置く。置いた部隊はクリックで選び直して動かせる（部隊の上に置くと入れ替え）。
   「自動配置」で空いている配置地点へ順に置ける。「配備完了」で次の陣営へ。置かなかった部隊は戦闘に出ない。
   1 つの陣営が置けるのは 6 部隊まで（`MAX_DEPLOY`）。
2. 戦闘: 軍ごとの交互のターン（赤軍 → 青軍。`TURN_ORDER`）。軍の番が変わるたびに、ターンのカットイン（`CUTIN_TEMPLATES['turn']`）を出す。いまの番の軍のユニットだけを選んで行動させられる。
   相手方のユニットは暗く描き、クリックすると次の番に動ける範囲（青）と攻撃できる範囲（赤）を出す。
   もう移動・攻撃・迎撃・鼓舞のどれもできないユニットは、絵を暗くして右上に E の印を付ける。
   行動力が余ったら「待機」（行動力 0）で行動を終えられる（待機・迎撃で行動を終えた後は選べない）。指揮官のスキル「鼓舞」（行動力 2）は自分の士気を 10〜20 回復する。
   画面の上の中央の戦況のパネルに、軍ごとの兵数の合計の比を帯で出す。
   「ターン終了」で次の軍の番になり、その軍の行動力が戻る。両軍が 1 回ずつ行動したらターンの数が進む。
   いまはどちらの軍も人が操作する（CPU の操作はまだ無い）。
3. セリフ: 次の場面で、ユニットの頭上に指揮官の顔付きの吹き出しを出す（`barks.ts`・`speechBubbles.ts`）。
   （ランダム）の場面は確率（`BARK_CHANCE`・`EXCHANGE_CHANCE`）で喋らないこともある。

   | 場面 | いつ | 確率 |
   |---|---|---|
   | `attack` | 攻撃の演出でカメラが寄ったところ。読み終えてから攻撃する | ランダム |
   | 一斉攻撃の掛け合い | 一斉攻撃の前。攻撃するユニットと加わる味方が 1 行ずつ（掛け合いが無ければ `attack`） | ランダム |
   | `intercept` | 迎撃の構えの間接ユニット（弓兵・魔術師）が射程に入った敵を撃つ前（構えをとったときは喋らない） | 必ず |
   | `rally` | 鼓舞で士気を回復したとき | 必ず |
   | `wiped_out` | 兵数が 0 になったとき（攻撃・反撃・迎撃）。吹き出しは消えたユニットの場所に残る | 必ず |
   | `enemy_eliminated` | `wiped_out` の後に、討ち取ったユニットが | ランダム |
   | `retreat` | 退却を選んだとき（退却の処理はまだ無い） | 必ず |

   殲滅のセリフは読み終えるまでカメラを寄せたままにする。吹き出しの調子は場面で変わる（`BARK_TONE`。
   叫ぶ: 太い字で弾んで出る、弱々しい: くすんだ吹き出しでゆっくり出る）。喋ると `app.on('bark', …)` で知らせる。

`BattleApp` は React なしでも使える（`new BattleApp(container)` → `loadMap(data)`、画面を離れるときは `dispose()`）。
起きたことは `app.on('execute', (report) => …)` のように受け取る（`BattleEvents`）。行動メニューは DOM を持たない
`app.menu`（`ActionMenuModel`）で、描画は `ui/ActionMenu.tsx`。

## 構成

```
src/
  index.ts         公開するもの
  app.ts           戦闘画面の本体（MapView・ポインタ操作・配備と交互のターン・予約と実行のアニメーション）。BattleEvents で知らせる
  deployment.ts    配備フェーズ（配備する部隊・配置地点への置き方・陣営の順）
  menuModel.ts     行動メニューの状態（中身・2 階層目・毎フレームの位置の基準）
  actions.ts       行動の定義と行動メニューの項目の組み立て
  combat.ts        攻撃の種類・射程・相手・結果
  damage.ts        ダメージの計算
  morale.ts        士気の増減
  movement.ts      移動の範囲・経路・ZOC
  unitStatus.ts    ユニットの戦闘中の状態（と表示確認用の仮の値）
  unitTags.ts      ユニットの頭上の情報札（HTML。毎フレーム置き直す）
  popups.ts        兵数の減少などを頭上に出す
  barks.ts         セリフの場面・確率・吹き出しの調子と、何を喋るか（BarkSource。表示確認用の demoBarks）
  speechBubbles.ts セリフの吹き出し（頭上に出してユニットに付いていく。1 字ずつ出す）
  interceptFx.ts   迎撃の構えのユニットの足元の光の輪
  ui/
    BattleScreen.tsx     戦闘画面（BattleApp を置き、下の部品とカットインを重ねる）
    ActionMenu.tsx       行動メニュー（ユニットの横に毎フレーム追いかける）
    DeployWindow.tsx     配備のウィンドウ（部隊の一覧・自動配置・配備完了）
    SituationPanel.tsx   戦況のパネル（画面の上の中央。軍ごとの兵数の合計の比の帯）
    UnitInfoWindow.tsx   騎士のウィンドウ（地形の右に固定。カーソルの下・選択中のユニットの顔・兵数・士気・行動力・能力）
    StatusCard.tsx       情報札と同じ中身（騎士・配備のウィンドウで使う）
    TerrainWindow.tsx    カーソルの HEX の地形のウィンドウ（移動・攻撃の予測も出す）
    BattleLogWindow.tsx  戦闘記録のウィンドウ（畳む・ドラッグで動かす）
    statusText.tsx       ステータス行の案内
    battle.css           戦闘画面のスタイル（すべて .battle-screen の中）
```
