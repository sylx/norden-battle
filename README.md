# norden-battle

ファンタジー SLG の HEX 戦闘まわりのツール群（npm workspaces）。

| パッケージ | 内容 |
|---|---|
| [map-editor](map-editor/) | HEX マップ JSON → プロシージャル 3D 地形のエディタ |
| [object-editor](object-editor/) | 3D 素材の取り込み・正規化・カタログ管理（仕様: [SPEC.md](object-editor/SPEC.md)） |
| [asset-runtime](asset-runtime/) | アセットカタログの型と three.js での読み込み（各ツール・戦闘デモで共有） |
| [assets](assets/) | 取り込んだ素材とカタログ（元ファイルは Git LFS） |

```sh
npm install
npm run dev:map      # map-editor    http://localhost:5173/
npm run dev:object   # object-editor http://localhost:5174/
npm run typecheck
npm run build
```
