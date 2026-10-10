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
| [assets](assets/) | 取り込んだ素材とカタログ（元ファイルは Git LFS）、マップ JSON（`assets/maps/`） |

battle-runtime（と battle-editor）は UI の部品に [norden-ui](https://github.com/sylx/norden-ui) のソースを使う。
このリポジトリの隣（`../norden-ui`）に置いておくこと（[nordencult](https://github.com/sylx/nordencult) のサブモジュールの並びのまま。norden-ui 側の `npm install` は要らない）。

```sh
npm install
npm run dev:map      # map-editor    http://localhost:5173/
npm run dev:object   # object-editor http://localhost:5174/
npm run dev:battle   # battle-editor http://localhost:5175/
npm run typecheck
npm run build
```
