> [!NOTE]
> このリポジトリは 2026-11-14 に [nordencult](https://github.com/sylx/nordencult) の [`norden-battle/`](https://github.com/sylx/nordencult/tree/main/norden-battle) に移りました（履歴もそのまま取り込んであります）。ここは更新しません。

# norden-battle

ファンタジー SLG の HEX 戦闘まわりのツール群（npm workspaces）。

| パッケージ | 内容 |
|---|---|
| [map-editor](map-editor/) | HEX マップ JSON → プロシージャル 3D 地形のエディタ |
| [battle-editor](battle-editor/) | 戦闘画面の UI・演出の試作と演出パラメータの調整（battle-runtime の画面にエディタの道具を重ねたもの） |
| [battle-runtime](battle-runtime/) | 戦闘のルールと戦闘画面（three.js + React の `BattleScreen`。battle-editor とゲーム本体で共有） |
| [map-runtime](map-runtime/) | マップのデータ・地形生成・three.js 描画・マップ JSON の読み書き（map-editor・battle-editor・battle-runtime で共有） |
| [object-editor](object-editor/) | 3D 素材の取り込み・正規化・カタログ管理（仕様: [SPEC.md](object-editor/SPEC.md)） |
| [asset-runtime](asset-runtime/) | アセットカタログの型と three.js での読み込み（各ツール・戦闘デモで共有） |
| [assets](assets/) | 取り込んだ素材のカタログ（素材本体は Git 管理外）、ユニット画像（`assets/units/`）、マップ JSON（`assets/maps/`） |

battle-runtime（と battle-editor）は UI の部品に [norden-ui](https://github.com/sylx/norden-ui) のソースを使う。
このリポジトリの隣（`../norden-ui`）に置いておくこと（[nordencult](https://github.com/sylx/nordencult) のサブモジュールの並びのまま。norden-ui 側の `npm install` は要らない）。

```sh
npm install
npm run dev:map      # map-editor    http://localhost:5173/
npm run dev:object   # object-editor http://localhost:5174/
npm run dev:battle   # battle-editor http://localhost:5175/
npm run typecheck
npm run build
npm test             # battle-runtime のルールの単体テスト（vitest。engine の行動・番・決着と、描画なしの 1 戦、CPU も）
npm run sim -- --runs 20   # 対戦シミュレータ（描画なしで CPU どうしを戦わせて勝率などを出す。battle-editor/sim/）
```
