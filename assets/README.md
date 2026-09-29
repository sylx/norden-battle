# assets

object-editor で取り込み・整えた 3D 素材。仕様は [object-editor/SPEC.md](../object-editor/SPEC.md)。

```
sources/<id>/original/   取り込んだ元ファイル（FBX・OBJ・glTF と付属のテクスチャ）   ※ Git LFS
sources/<id>/model.glb   ブラウザで GLB に変換したもの（Mixamo の骨の名前は正規化済み）※ Git LFS
catalog/sources/<id>.json 出典・ライセンス・正規化の変換（回転・原点・スケール）・統計
CREDITS.md               カタログから自動生成する出典一覧（object-editor で保存するたびに更新）
```

正規化の変換は GLB に焼き込まず JSON に持つ。読み込むときに `@norden/asset-runtime/three` の
`loadSourceAsset` が適用する（p' = scale × (R·p + pivot)）。

## 座標の約束
- Y が上、モデルの正面は +Z、原点は足元の中心
- 長さの単位は map-editor と同じ（hexSize = 1）。基準の寸法は `asset-runtime/src/units.ts`
