# assets

object-editor で取り込み・整えた 3D 素材と、ユニットの 2D 画像、マップ JSON。仕様は [object-editor/SPEC.md](../object-editor/SPEC.md)。

```
sources/<id>/original/   取り込んだ元ファイル（FBX・OBJ・glTF と付属のテクスチャ）   ※ Git LFS
sources/<id>/model.glb   ブラウザで GLB に変換したもの（Mixamo の骨の名前は正規化済み）※ Git LFS
catalog/sources/<id>.json 出典・ライセンス・正規化の変換（回転・原点・スケール）・統計
CREDITS.md               カタログから自動生成する出典一覧（object-editor で保存するたびに更新）
units/<兵種>.png         ユニットの 2D 画像（map-editor・battle-editor が読み込む。置き方は units/README.md）※ Git LFS
maps/<名前>.json         マップ JSON（map-editor が保存し、battle-editor が読み込む。形式は map-runtime/README.md）
maps/road-<ID>-<ID>.json 街道マップ（戦略マップの街道でつながる 2 都市を描いたマップ。nordencult の戦闘で使う）
```

正規化の変換は GLB に焼き込まず JSON に持つ。読み込むときに `@norden/asset-runtime/three` の
`loadSourceAsset` が適用する（p' = scale × (R·p + pivot)）。

## 座標の約束
- Y が上、モデルの正面は +Z、原点は足元の中心
- 長さの単位は map-editor と同じ（hexSize = 1）。基準の寸法は `asset-runtime/src/units.ts`
