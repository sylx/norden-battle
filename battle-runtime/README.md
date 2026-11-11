# @norden/battle-runtime

戦闘のルールと戦闘画面。three.js の戦闘画面（`BattleApp`。マップ・ユニット・入力・演出）と、
その上に重ねる React の UI（`BattleScreen`）。battle-editor とゲーム本体（nordencult の戦闘のシーン）で共有する。

UI の部品は [norden-ui](https://github.com/sylx/norden-ui) を使う（地形・騎士・戦闘記録・配備の枠は題名の札付きの `ThinFrameWithTitle`、
行動メニュー・ターン表示の枠は `ThinFrame` の細いベゼル、ターン終了は `Button`）。norden-ui はリポジトリの隣（`../../norden-ui`）のソースを
そのまま読み込むので、使う側の Vite・TypeScript の設定に別名を入れる（battle-editor の vite.config.ts・tsconfig.json を参照）。
効果音も norden-ui の `playSound(name)` で名前を伝えるだけで、鳴らすのは使う側（nordencult が `setSoundPlayer` で渡す。battle-editor では鳴らない）。
UI のクリック音は norden-ui の `installClickSound` がまとめて鳴らすので、ボタン以外でクリックする要素（行動メニュー・配備の一覧の項目）に `data-sound="click"` を付ける。

```tsx
import { BattleScreen } from '@norden/battle-runtime';

// 親の要素いっぱいに広がる。map を変えると読み込み直す
<BattleScreen map={mapData} statuses={makeStatuses} troops={makeTroops} retreats={retreats} onRetreat={onRetreat} onEnd={onEnd} onApp={setApp} notice={error}>
  {/* 上に重ねるもの（エディタの道具・ゲームの見出しなど） */}
</BattleScreen>
```

- `map`: 戦場のマップ（`MapData`）。null の間は何も載せない。街道マップから `cropBattleArea` で切り出すと、
  初期配置地点（`deploy`）が付いて配備フェーズから始まる。
- `troops`: 配備フェーズで置く部隊（`Troop`: 陣営・兵種・戦闘中の状態）を配る関数。省略すると表示確認用の仮の部隊（`demoTroops`。陣営ごとに 8 部隊で、先頭の部隊が軍団長）。
  ゲームでは騎士・兵の数から作って渡す。
- `factions`: 攻撃側・防衛側の勢力（`BattleFactions`: `{ attacker: { name }, defender: { name } }`）。画面では軍を色（赤・青）ではなく
  勢力の名前で呼ぶ（ターン表示・カットイン・戦況・配備・騎士・戦闘記録・ステータス行・決着）。省略すると表示確認用の仮の勢力（`demoFactions`）。
  攻撃側・防衛側のどちらでもない軍は「第三勢力」（`OTHER_FACTION_NAME`）。ゲームでは戦闘する勢力の名前を渡す。
- `statuses`: マップに最初から置いてあるユニット（`units`）に戦闘中の状態（兵士数・士気・行動力・指揮官）を配る関数。
  省略すると表示確認用の仮の値（`demoStatuses`。軍ごとに最初のユニットが軍団長）。
- `onApp`: `BattleApp` を作った・破棄した（null）とき。描画の設定（解像度・森の描き方など）を変えるときに使う。
- `cutInTexts`: 戦闘開始・ターンのカットインの文字（`{ start: (map) => ({ text, subText }), turn: (turn, team) => ({ text, subText }) }`）。
  省略すると「戦闘開始」とマップの名前、「（勢力の名前）のターン」と「TURN  1」。ゲームでは戦場の名前を渡す。
- `barks`: 何を喋るか（`BarkSource`。場面ごとのセリフ `line` と一斉攻撃の掛け合い `exchange`）。
  省略すると表示確認用の決まったセリフ（`demoBarks`）。ゲームでは騎士の口調・性格からセリフのデータ（nordencult の `src/data/voiceLines.json`）を引くものを
  `lineBarks` で作って渡す。データの場面の ID は `battle.` + 場面（`lineSituationId`）。一斉攻撃の掛け合いは、攻撃する部隊の
  `battle.exchange_lead`（呼びかけ）に、加わる味方が 2 部隊まで `battle.exchange_reply`（応じる）で応じる。
- `retreats`: 軍ごとの退却先の拠点（`RetreatDestinations`。`{ red: [{ id, name }, …], blue: […] }`）。無い軍のユニットは退却を選べない。
  省略するとどの軍も退却できない。ゲームでは戦場の拠点に街道でつながる自勢力の拠点（nordencult の `retreatCities`）を、
  battle-editor ではダミーの拠点を渡す。
- `onRetreat`: ユニットが退却した・退却に失敗して捕虜になったとき（`RetreatReport`: ユニット・配備した部隊の ID `troopId`・
  退却したときの状態・退却先・隣接していた敵の数・失敗する確率・捕虜になったか `captured`）。この戦闘の分は `app.retreated` にも残る。
  ゲームは部隊の ID（騎士の ID で作る）から騎士を引いて、戦後処理に渡す。捕虜をどう扱うかは使う側が決める。
- `onWipeout`: ユニットが殲滅されたとき（`WipeoutReport`: ユニット・`troopId`・殲滅されたときの状態・殲滅したユニット・
  隣接していた敵の数・捕縛される確率・指揮官が捕縛されたか `captured`）。この戦闘の分は `app.wipedOut` にも残る。
  ゲームは退却と同じく騎士を引いて戦後処理に渡す。
- `onEnd`: 決着のウィンドウのボタンを押したとき（`BattleOutcome`: 勝った陣営 `winner`・決着の理由 `reason`・ターン・入城したユニット・戦場に残った部隊 `remaining`（部隊の ID `troopId` と兵士数などの状態 `status`。退却・殲滅した部隊は含まない））。
  渡さなければボタンを出さない。ボタンの文字は `endLabel`（既定は「戦闘を終える」）。決着そのものは `app.on('end', …)`・`app.outcome` でも受け取れる。
  ゲームは勝った陣営と退却の結果を戦後処理に渡して結果の画面へ進む。
- `playerSide`: プレイヤーの陣営（`'attacker'`・`'defender'`）。決着のカットインを、勝てば `CUTIN_TEMPLATES['battle-win']`（勝利）、
  負ければ `battle-lose`（敗北）にする（文字はテンプレートのまま）。プレイヤーが戦闘にいないなら省略し、そのときは `battle-win`（battle-editor は攻撃側をプレイヤーとして渡す）。
- `cpu`: 軍ごとの CPU の打ち手（`{ red: cpuPlayer({ difficulty: 'normal' }) }` など。無い軍は人が操作する）。戦闘の途中でも変えられる。
  CPU の軍の配備（兵種に合わせて前後を考える）・番・強制退却は CPU が進め、その間は人の操作を受け付けない。CPU の番のターン表示には「早送り」（演出をさらに
  `CPU_FAST_FORWARD` 倍に）と「スキップ」（番の残りを演出なしで進める。セリフ・頭上の数字は出さず、戦闘記録には載せる）を出す。
- `speed`: 演出の速度の倍率（既定 1。歩く・攻撃・カメラ・セリフ・頭上の数字・施設の射撃に掛かる。プレイヤーの行動にも効き、戦闘の途中でも変えられる）。
- `notice`: ステータス行に出す知らせ（マップを読めないときなど）。

## 戦闘の流れ

0. 戦闘開始のカットイン（norden-ui の `CUTIN_TEMPLATES['battle-start']`）。マップを読み込むたびに出し、終わるまで配備のウィンドウ・ターン表示を出さない。
   画面を押すと飛ばせる。カットインの書体（Shippori Mincho B1・Cinzel・Cinzel Decorative・Noto Serif JP）は使う側の HTML で読み込む
   （battle-editor の index.html を参照）。
1. 配備フェーズ（マップに `deploy` があるとき）: 防衛側 → 攻撃側の順に、配備のウィンドウの一覧から部隊を選び、
   軍の色で塗った配置地点をクリックして置く。置いた部隊はクリックで選び直して動かせる（部隊の上に置くと入れ替え）。
   「自動配置」で空いている配置地点へ順に置ける。「配備完了」で次の陣営へ。置かなかった部隊は戦闘に出ない。
   1 つの陣営が置けるのは 6 部隊まで（`MAX_DEPLOY`）。
2. 戦闘: 軍ごとの交互のターン（防衛側 → 攻撃側。`TURN_ORDER`）。軍の番が変わるたびに、ターンのカットイン（`CUTIN_TEMPLATES['turn']`）を出す。いまの番の軍のユニットだけを選んで行動させられる。
   相手方のユニットは暗く描き、クリックすると次のターンに動ける範囲（青）と攻撃できる範囲（赤）を出す。
   もう移動・攻撃・迎撃・鼓舞のどれもできないユニットは、絵を暗くして右上に E の印を付ける。
   行動力が余ったら「待機」（行動力 0）で行動を終えられる（待機・迎撃で行動を終えた後は選べない）。指揮官のスキル「鼓舞」（行動力 2）は自分の士気を 10〜20 回復する。
   「特殊」の「退却」（ターンの初めだけ。行動力は使わない）は、行動メニューに退却先の拠点の一覧と失敗する確率を出し、拠点を選ぶと退却する
   （退却先が無い軍のユニット・ターンの初めでないときは選べない。2 階層目にはそのときも灰色で残し、理由を title に持たせる）。隣接している敵ユニットの数で失敗することがあり（0: 1%・1: 10%・2: 25%・3 以上: 50%。`RETREAT_FAIL_CHANCE`）、
   失敗すると捕虜になる。どちらでもそのユニットは戦場から消える（成功は敵から離れる向きへ下がりながら、失敗は下がりかけて止められてから）。
   兵数が 0 になった（殲滅された）ユニットの指揮官は、そのとき隣接している敵ユニットの数で捕縛され捕虜になる
   （0: 10%・1: 30%・2: 50%・3 以上: 75%。`WIPEOUT_CAPTURE_CHANCE`。相討ちの相手は数えない）。捕縛されなければ落ち延びる。
   `uncapturable` の部隊（`TroopInit`・`UnitStatus`。ゲームの傭兵）は捕縛されない: 退却の失敗も殲滅の捕縛も 0% で、行動メニューの表示も 0% になる。
   頭上の数字・戦闘記録に「捕縛」と出す。
   画面の上の中央の戦況のパネルに、軍ごとの兵数の合計の比を帯で出す。
   「ターン終了」で次の軍の番になり、その軍の行動力が戻る。両軍が 1 回ずつ行動したらターンの数が進む。
   軍ごとに CPU に任せられる（`cpu`。下の「CPU」）。
3. 決着（`victory.ts`）: 行動を実行し終えるたびと、軍の番を終えるときに調べる。
   - 攻撃側: すべての部隊が殲滅または退却した（捕虜になったものも含む）ら負け
   - 防衛側: すべての部隊が殲滅または退却したら負け。防衛拠点（マップの `stronghold`。地面を金色に塗り、地形のウィンドウに「防衛拠点」の札）に
     攻撃側のユニットが行動を終えたら負け（入城）。行動を終えるのは、実行し終えてもう行動できなくなった（E の印が付いた）ときと、
     拠点にいるまま軍の番を終えたとき（行動力が残っていて拠点から動けば入城しない。通り過ぎただけでも入城しない）
   - 両軍が同時にいなくなったら防衛側の勝ち。戦闘が始まったときに部隊のいなかった陣営は、いなくなっても負けにしない

   決着すると決着のカットイン（プレイヤーの勝ち: `CUTIN_TEMPLATES['battle-win']`、負け: `battle-lose`。`playerSide` が無ければ `battle-win`）の後に、
   画面の中央に決着のウィンドウを出す。
   決着した後はユニットを選べず、ターンも終えられない。
4. セリフ: 次の場面で、ユニットの頭上に指揮官の顔付きの吹き出しを出す（`barks.ts`・`speechBubbles.ts`）。
   （ランダム）の場面は確率（`BARK_CHANCE`・`EXCHANGE_CHANCE`）で喋らないこともある。

   | 場面 | いつ | 確率 |
   |---|---|---|
   | `attack` | 攻撃の演出でカメラが寄ったところ。読み終えてから攻撃する | ランダム |
   | 一斉攻撃の掛け合い | 一斉攻撃の前。攻撃するユニットと加わる味方が 1 行ずつ（掛け合いが無ければ `attack`） | ランダム |
   | `intercept` | 迎撃の構えの間接ユニット（弓兵・魔術師）が射程に入った敵を撃つ前（構えをとったときは喋らない） | 必ず |
   | `rally` | 鼓舞で士気を回復したとき | 必ず |
   | `wiped_out` | 兵数が 0 になったとき（攻撃・反撃・迎撃）。吹き出しは消えたユニットの場所に残る | 必ず |
   | `enemy_eliminated` | `wiped_out` の後に、討ち取ったユニットが | ランダム |
   | `retreat` | 退却先の拠点を選んで退却し始めるとき（読み終えてから下がる） | 必ず |

   殲滅のセリフは読み終えるまでカメラを寄せたままにする。吹き出しの調子は場面で変わる（`BARK_TONE`。
   叫ぶ: 太い字で弾んで出る、弱々しい: くすんだ吹き出しでゆっくり出る）。喋ると `app.on('bark', …)` で知らせる。

`BattleApp` は React なしでも使える（`new BattleApp(container)` → `loadMap(data)`、画面を離れるときは `dispose()`）。

## CPU

CPU の思考は `src/cpu/`（three.js を読み込まない。`@norden/battle-runtime/cpu`）。`cpuPlayer({ difficulty })` が engine の打ち手（`Player`）を作り、
`BattleApp`（`setCpu`・BattleScreen の `cpu`）と描画なしの対戦シミュレータの両方で同じものを使う。

- 1 手読み（`decide.ts`）: 部隊ごとに、行動の候補（移動先 × 攻撃 × 狙う HEX、移動だけ、その場で待機、迎撃の構え・鼓舞・退却）を並べて点数を付け、
  一番いいものを選ぶ。重みは `weights.ts`
  - 攻撃: 予測（`attackForecast` の期待値）から、与えるダメージ − 受ける反撃、殲滅・壊滅の見込み、士気の差、範囲の巻き添え（味方を壊滅させるならさらに引く）、
    状態異常（凍結・混乱で相手の番を止める）、耕す（敵のいる HEX の守りを下げる・城壁を崩す）。兵数は兵種の力で重みを付け、軍団長の部隊は重く見る（`worth.ts`）。
    地点を狙う攻撃（メテオ・アーススパイク）・自分が中心の攻撃（乱撃）も候補にする。クールタイムのある攻撃は、クールタイムの番の数だけ得る点数を割り引く
  - 位置: 敵への近さ（射程のある兵種は射程の端）、攻撃側は防衛拠点への近さ・防衛側は拠点の周り、地形の守り、
    危険（`danger.ts`。次の敵の番に受けそうなダメージ。敵の届く範囲は `threat.ts`、要塞砲も。軍団長の部隊は敵が狙いを集めるので割り引かない）。
    移動の途中で迎撃の構えの間接ユニットに撃たれる・足止めされる見込みも数える
  - 構え: 間接の兵種の迎撃の構え（射程に入ってきそうな敵を撃つ見込み）、近接の兵種の迎撃の構え（受けるダメージが減る分）、鼓舞（上がる士気の分）
  - 退却: 軍団長でない部隊は、兵が減って、どこへ動いても殲滅されそうで、殲滅できる相手もおらず、軍が数で勝っていなければ退却する
- 軍の作戦（`strategy.ts`。番の初めに立てる）: 攻撃側は防衛拠点で行動を終えて入城を狙う。防衛側は拠点の守りの部隊を 1 つ決めて拠点に置き、
  拠点の隣の敵を重く狙い、拠点が空いて隣に敵が来たら塞ぐ。軍団長の部隊は前に出しすぎない。弱った相手に狙いを集める。
  負けを認める: 数で大きく劣り（敵が 4 倍以上・味方が戦闘の初めの 3 割以下）、軍団長の部隊がどこへ動いても殲滅されそうか、戦況が 3 番動かなければ、
  軍団長の部隊が退却して戦闘を終える（捕縛を避ける）
- 配備（`deploy.ts`）: 前に出る兵種を敵の側の列に、射程のある兵種（射程の短い兵種ほど前）をそのすぐ後ろに、軍団長の部隊をその後ろの守りの良い HEX に置く
- 兵力の比: 受けるダメージ・危険の重みに「敵の兵力 ÷ 味方の兵力」を掛け、敵に近づく重みにはその逆数を掛ける（数で勝る側が押し込む）
- 膠着: 戦況が動かない番が続いたら慎重さ（殲滅されそうな HEX を避ける重み・構えの見込みも）を下げて前に出る。
  往復しない: 攻撃せずに前の番の初めにいた HEX へ戻る手は減点する
- 動かす順（`player.ts`）: 前に出る兵種 → 射程のある兵種 → 軍団長の部隊。同じ組では敵に近い部隊から（負けを認めるなら軍団長の部隊が最初）。
  連携（難しい）では、1 部隊動かすごとに、その場で待つより一番得をする部隊を選ぶ
- 性格（`temper.ts`）: 部隊を率いる騎士の性格（`UnitStatus.personality`。ゲームの騎士の「行動・戦闘スタイル」の軸）で、その部隊の重みとしきい値に倍率を掛ける。
  猛進は前に出て危険を軽く見て退却しない、慎重は危険と地形の守りを重く見て構え・鼓舞を好み早めに退く、勇敢は相手の軍団長・強い相手を狙い弱った味方の前に立つ、
  実利は殲滅できる相手・弱った相手を狙い効率の悪い攻撃を嫌う。軍の作戦（全軍の前に出る度合い・拠点の周りの広さ・軍団長の出方・負けを認めるしきい値）は軍団長の性格で変わる。
  軍団長の部隊と拠点の守りの部隊は、性格の効きを半分にする（役目を先にする）。性格の無い部隊は標準
- 難易度（`types.ts` の `DIFFICULTY_PROFILES`。CPU 側の数値は変えない）: 難しいはすべての要素（連携: 殲滅・壊滅の見込みをダメージの幅から確率で見る・
  まだ動いていない味方と合わせて殲滅できる相手を先に削る・動かす順を選ぶ）でノイズ無し、普通は連携を切って小さいノイズ（10 点）、
  易しいは危険な HEX（数だけ見る）・狙いの集中・連携を切って大きいノイズ（40 点）。ノイズは候補の点数に 0〜ノイズの乱数（打ち手の乱数）を足して選ぶので、
  一番いい手からノイズより悪い手は選ばない
- 考える要素は `CpuFeatures`（`allAttacks`・`danger`・`stances`・`strategy`・`focus`・`teamwork`・`personality`・`deploy`）で切れる。
  すべて切ると段階 1 の CPU（`BASIC_FEATURES`。シミュレータの `basic`）

`BattleApp` の CPU の番: 番の初めのカットインが終わったら（`holdCpu`）、部隊を 1 つ選んで行動を決め、予約（移動の矢印・攻撃の矢印）を少し見せてから
プレイヤーと同じ演出で実行する。行動できる部隊がいなくなったら番を終える。`skipCpuTurn()` で番の残りを演出なしで進め、終わったら絵を作り直す。

## 演出の速度

演出の時刻はすべて `fxClock.ts` の時計で測る（歩く・攻撃・迎撃・退却のアニメーション、カメラ、攻撃の演出、頭上の数字、セリフの吹き出し、施設の射撃）。
`BattleApp` が毎フレーム、`speed`（設定。`new BattleApp(container, { speed })` か BattleScreen の `speed`）と CPU の番の早送り（`fastForward`）を掛けて進める。
途中で速度を変えても、残りの時間の進み方が変わるだけで演出は途切れない。足元の輪・状態の印のような繰り返すだけの演出は実時間のまま。

## engine（描画なしの戦闘のルール）

戦闘のルールで状態を書き換える処理（行動の実行・番の始まりと終わり・施設・決着）は `src/engine/` にあり、three.js・React・DOM を読み込まない。
`@norden/battle-runtime/engine` で読み込めるので、Node（対戦シミュレータ・テスト）からも使える。`BattleApp` は演出の拍子（歩き着いた・当たった瞬間など）で
engine の関数を呼び、返った結果で頭上の数字・セリフ・イベントを出す。戦闘の状態は `app.state`（`BattleState`）。

- 乱数: ルールの乱数（ダメージのブレ・退却の失敗・殲滅の捕縛・状態異常・鼓舞・混乱の移動先・施設の目標）はすべて `Rng` から引く。
  `app.rng` の既定は `mathRng`（`Math.random`）で、`seededRng(seed)` を入れるとシードで再現できる。引く順番は演出ありでも描画なしでも同じなので、
  同じシードなら同じ結果になる。セリフ・演出の乱数は `Math.random` のまま。
- 行動の実行（`action.ts`）: `beginAction` → (`nextPhase` → 段階の処理)* → `finishAction` → `judge`（`turn.ts`）。段階の処理は、歩き着いたら `commitMove`、
  攻撃が当たったら `resolveStrike`（演出の後に `afterStrike`）、迎撃が当たったら `resolveIntercept`（演出の後に `afterIntercept`）。描画なしでは `runAction` で順に呼ぶ。
- 番と決着（`turn.ts`）: `startBattle`・`startTeamTurn`・`confusedPlan`・`endTeamTurn`・`firingFacilities`・`facilityTarget`・`fireFacility`・`passTurn`・`judge`・`nextRoutUnit`・`endBattle`。
- 予約（`plan.ts`）: `Plan` を作る・読む関数（`newPlan`・`addLeg`・`setAttack`・`planPos`・`menuContext`・`isDone` など）。
- 描画なしで回す（`sim.ts`）: `runBattle(state, { players, rng, playerRng })` が、軍ごとの打ち手（`Player`: 部隊の次の行動を返す `decide`、
  番の初めの `beginTurn`、動かす順の `order`、強制退却の退却先の `routTo`）で決着かターンの上限まで回す。`randomPlayer` はランダムに行動する仮の打ち手。
  `onAction`・`onFacility` で行動・施設の射撃を受け取れる（シミュレータの集計）。
- three.js を読み込まないルールの口（部隊の状態・配備・攻撃の定義・勢力）は `@norden/battle-runtime/rules`。

```ts
import { createBattleState, randomPlayer, runBattle, seededRng } from '@norden/battle-runtime/engine';

const state = createBattleState(map, statuses, { stronghold, retreats, facilities });
const result = runBattle(state, { players: { red: randomPlayer, blue: randomPlayer }, rng: seededRng(1), playerRng: seededRng(2) });
```
起きたことは `app.on('execute', (report) => …)` のように受け取る（`BattleEvents`）。行動メニューは DOM を持たない
`app.menu`（`ActionMenuModel`）で、描画は `ui/ActionMenu.tsx`。

## 構成

```
src/
  index.ts         公開するもの
  app.ts           戦闘画面の本体（MapView・ポインタ操作・配備と交互のターン・予約と実行のアニメーション）。状態は engine の関数で書き換え、BattleEvents で知らせる
  engine/
    rng.ts         ルールの乱数の口（Rng・seededRng・mathRng）
    state.ts       戦闘の状態（BattleState）と、状態を読む小さな関数（TURN_ORDER・入城の決まり・施設の射程など）
    plan.ts        行動の予約（Plan）を作る・読む関数（行動メニューの状況・行動済みの判定）
    action.ts      予約した行動の実行（移動の確定・迎撃・攻撃・巻き添え・耕す・状態異常・殲滅と捕縛・退却・鼓舞・行動の終わり）
    turn.ts        番の始まりと終わり（クールタイム・状態・入城の決まりの印・混乱の移動・施設の射撃・次の軍）と決着・強制退却
    sim.ts         描画なしで戦闘を回す（runBattle・打ち手 Player・ランダムな打ち手）
    index.ts       engine の公開するもの（'@norden/battle-runtime/engine'）
  cpu/
    decide.ts      1 手読み（候補の列挙と点数・兵力の比・膠着・往復しない・構え・鼓舞・退却）
    threat.ts      次の敵の番に敵が動ける HEX・攻撃できる HEX
    danger.ts      危険な HEX（次の敵の番に受けそうなダメージ・要塞砲・移動の途中の迎撃）
    strategy.ts    軍の作戦（拠点の守り・入城・負けを認める・兵力）
    deploy.ts      CPU の配備（兵種に合わせて前後を考える）
    player.ts      CPU の打ち手（cpuPlayer。配備・動かす順・番の初めの様子）
    worth.ts       兵 1 人の重さ
    weights.ts     点数の重み
    temper.ts      性格（部隊の気質・軍団長で決まる軍の気質）
    types.ts       難易度（考える要素とノイズ）・考える要素（CpuFeatures）・CPU の設定
    index.ts       CPU の公開するもの（'@norden/battle-runtime/cpu'）
  rules.ts         three.js を読み込まないルールの口（'@norden/battle-runtime/rules'。部隊の状態・配備・攻撃の定義・勢力）
  fxClock.ts       演出の時計（速度の倍率を掛けて進める。演出の時刻はすべてこれで測る）
  deployment.ts    配備フェーズ（配備する部隊・配置地点への置き方・陣営の順）
  menuModel.ts     行動メニューの状態（中身・2 階層目・毎フレームの位置の基準）
  actions.ts       行動の定義と行動メニューの項目の組み立て（攻撃の項目は兵種の攻撃の一覧から）
  attacks.ts       攻撃の定義（倍率・狙い方・射程・当たる範囲・巻き添え・クールタイム・付く状態・演出）
  conditions.ts    ユニットに付く状態（混乱・凍結。名前と印、残りターンの数え方。効果は app.ts・actions.ts・combat.ts）とクールタイムの数え方
  facilities.ts    拠点の施設（要塞砲・ガンシップ・バリスタ・魔導台）。撃つ間隔・仮の撃つ部隊・射程が伸びる量
  combat.ts        兵種ごとの攻撃（COMBAT_DEFS）、攻撃の定義の補完（resolveAttack）・狙える HEX・当たる範囲・巻き添え・結果と予測
  damage.ts        ダメージの計算（ユニットそのものの力と戦う状況の倍率。基本攻撃力・基本防御力）
  morale.ts        士気の増減
  movement.ts      移動の範囲・経路・ZOC・入城の決まり（攻撃側は番の初めに城の HEX の中かそのとなりにいたときだけ城の HEX へ入れる）
  retreat.ts       退却（退却先の拠点の型・失敗する確率・結果の RetreatReport）
  wipeout.ts       殲滅されたときの指揮官の捕縛（捕縛される確率・結果の WipeoutReport）
  victory.ts       勝敗（全滅・退却と入城の判定。決着の BattleOutcome）
  unitStatus.ts    ユニットの戦闘中の状態（と表示確認用の仮の値）
  factions.ts      陣営ごとの勢力（軍を勢力の名前で呼ぶ teamName と、表示確認用の demoFactions）
  unitTags.ts      ユニットの頭上の情報札（HTML。毎フレーム置き直す）
  popups.ts        兵数の減少などを頭上に出す
  barks.ts         セリフの場面・確率・吹き出しの調子と、何を喋るか（BarkSource。セリフのデータから選ぶ lineBarks、表示確認用の demoBarks）
  speechBubbles.ts セリフの吹き出し（頭上に出してユニットに付いていく。1 字ずつ出す）
  interceptFx.ts   迎撃の構えのユニットの足元の光の輪
  breathFx.ts      範囲の端まで吹く炎の粒（ドラゴンのブレス・フレイムランス）。ドラゴンのクロウは slashFx.ts の 3 本の爪
  areaFx.ts        地面の衝撃（殴り・氷・岩・爆発）、溜めて放つ光線（ベヒーモス）、空から落ちる光の柱（メテオフォール）
  ui/
    BattleScreen.tsx     戦闘画面（BattleApp を置き、下の部品とカットインを重ねる）
    ActionMenu.tsx       行動メニュー（ユニットの横に毎フレーム追いかける。退却を選んだ後は退却先の拠点の一覧）
    DeployWindow.tsx     配備のウィンドウ（部隊の一覧・自動配置・配備完了）
    BattleEndWindow.tsx  決着のウィンドウ（画面の中央。勝った陣営・決着の理由・戦闘を終えるボタン）
    SituationPanel.tsx   戦況のパネル（画面の上の中央。軍ごとの兵数の合計の比の帯）
    UnitInfoWindow.tsx   騎士のウィンドウ（地形の右に固定。カーソルの下・選択中のユニットの顔・兵数・士気・行動力・能力）
    StatusCard.tsx       情報札と同じ中身（騎士・配備のウィンドウで使う）
    TerrainWindow.tsx    カーソルの HEX の地形のウィンドウ（移動・攻撃の予測も出す）
    BattleLogWindow.tsx  戦闘記録のウィンドウ（畳む・ドラッグで動かす）
    statusText.tsx       ステータス行の案内
    factionsContext.ts   BattleScreen に渡された勢力を中の UI に配る（useTeamName）
    battle.css           戦闘画面のスタイル（すべて .battle-screen の中）
  test/fixtures.ts       ルールの単体テストの道具（three.js を使わない平地のマップ・ユニット・状態）
  test/engine.ts         engine のテストの道具（決まった値を順に返す乱数・戦闘の状態・予約の作り方）
  test/scenario.ts       描画なしの戦闘のテストの場面（兵種を混ぜた両軍・拠点・城・要塞砲・退却先）
  *.test.ts              ルールの単体テスト（vitest。combat.test.ts のダメージの表はスナップショットで、ルールを作り替えても値が変わらないことを確かめる。
                         engine/engine.test.ts は行動・番・決着の決まりを決まった乱数で、engine/sim.test.ts は描画なしの 1 戦の結果をシードごとのスナップショットで固定する。
                         cpu/cpu.test.ts は CPU がランダムな打ち手・段階 1 の CPU に勝ち越すこと・CPU どうしで最後まで戦えること・
                         範囲攻撃・入城・拠点の守り・迎撃の構え・鼓舞・退却・負けを認める・移動の途中の迎撃・配備）
```
