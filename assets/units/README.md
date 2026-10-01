# ユニット画像

map-editor のユニット（2D スプライト）の画像を置く場所。ここに置くだけで読み込まれる（開発サーバーの再起動は不要）。
置いていない兵種は、コードで描いたプレースホルダーで表示される。

## ファイル名
| ファイル | 使われる場面 |
|---|---|
| `<兵種>.png` | その兵種の全軍 |
| `<兵種>_<軍>.png` | その軍だけ（あれば `<兵種>.png` より優先） |

- 兵種: `infantry`（歩兵）・`archer`（弓兵）・`cavalry`（騎兵）・`mage`（魔術師）
- 軍: `blue`・`red`・`green`
- 形式: PNG・WebP・JPEG

兵種と軍の一覧は `map-runtime/src/core/units.ts`。

## 画像の約束
- **右向き** で描く（左向きは反転して表示する）。
- **カメラの俯角（既定 50°）から見下ろした** 姿にする。俯角は map-editor の「カメラ → 俯角」で変えられる。
- **足元が画像の下端** になる。足元に影や地面を描くと、その分だけ浮いて見える。
- 軍の色は足元の円で示すので、画像は軍で共通でよい。
- 光は北西（画面の左奥）から当たっている。陰影はそれに合わせる。

## 読み込み時の自動処理
Midjourney などの画像をそのまま置けるように、読み込むときに次の処理をする（元のファイルは変えない）。

1. **背景を抜く**（透過の無い画像だけ）: 画像の外周の色を背景色とみなし、外周からつながった同じような色の部分を透明にする。
   背景は **人物と違う色の無地** にしておく（例: プロンプトに `plain white background` や `solid green background`）。
   人物の服や武器が背景と似た色で外周に接していると、そこも抜けてしまう。
2. **余白を切り詰める**: 不透明な部分だけを残す。画像の縦横比がそのまま表示の縦横比になる。
3. **縮小する**: 高さ 512px を超えるものは 512px に縮める。

透過 PNG を用意した場合は 1 を飛ばす（自分で背景を抜いた画像をそのまま使える）。

## Midjourney のプロンプトの例
```
fantasy medieval foot soldier with sword and shield, full body, facing right,
seen from above at 50 degrees, miniature figure, plain white background, no shadow --ar 1:1
```

画像ファイルは Git LFS で管理する（`.gitattributes`）。

## 指揮官の顔（battle-editor）
`character_face.webp` は指揮官の顔画像。1 枚に 3×3 で顔を並べたもので（1 マス 256×256）、
左上から行ごとに 0..8 の番号で参照し、円に切り抜いてユニットの情報札に表示する（`battle-editor/src/battle/unitStatus.ts`）。
