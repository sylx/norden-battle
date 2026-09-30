# norden-battle

ファンタジー SLG の HEX 戦闘まわりのツール群（npm workspaces）。

| パッケージ | 内容 |
|---|---|
| [map-editor](map-editor/) | HEX マップ JSON → プロシージャル 3D 地形のエディタ |
| [battle-editor](battle-editor/) | 戦闘画面の UI・演出の試作と演出パラメータの調整 |
| [map-runtime](map-runtime/) | マップのデータ・地形生成・three.js 描画・マップ JSON の読み書き（map-editor・battle-editor で共有） |
| [object-editor](object-editor/) | 3D 素材の取り込み・正規化・カタログ管理（仕様: [SPEC.md](object-editor/SPEC.md)） |
| [asset-runtime](asset-runtime/) | アセットカタログの型と three.js での読み込み（各ツール・戦闘デモで共有） |
| [assets](assets/) | 取り込んだ素材とカタログ（元ファイルは Git LFS）、マップ JSON（`assets/maps/`） |

```sh
npm install
npm run dev:map      # map-editor    http://localhost:5173/
npm run dev:object   # object-editor http://localhost:5174/
npm run dev:battle   # battle-editor http://localhost:5175/
npm run typecheck
npm run build
```
