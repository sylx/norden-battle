# Norden Object Editor

ユニット・建物の見た目を作るためのツール。役割は 2 つある。
- Mixamo のモーションや外部の 3D 素材を取り込み、向き・大きさ・原点・出典をそろえてカタログに登録する
- プロシージャル生成（兵士など）のパラメータを動かし、戦闘カメラの距離で見比べる（左パネルの「試作」）

全体の仕様とロードマップは [SPEC.md](SPEC.md)。

```sh
# リポジトリのルートで
npm install
npm run dev:object     # http://localhost:5174/
```

保存は開発サーバーの API（`server/vite-plugin-assets.ts`）が `../assets/` に書き込むので、`npm run dev` で起動したときだけ使える。

## 使い方

1. GLB・glTF・FBX・OBJ をウィンドウにドロップする（テクスチャ・.bin・.mtl も一緒に）
2. 右パネルで ID・名前・カテゴリ、共通の出典とライセンスを入れて「取り込む」
   - ブラウザで読み込んで GLB に変換し、元ファイルと一緒に `assets/sources/<id>/` に保存する
   - Mixamo の骨の名前（`mixamorig:Hips` など）は `mixamorigHips` の形にそろえる
   - 大きさはカテゴリの目安（兵士 0.35、家 0.16 など。`asset-runtime/src/units.ts`）に合わせ、原点は足元の中心にする
3. 左の一覧から開いて調整する
   - 正面は赤い矢印（+Z）。寝ている・横を向いているモデルは「X +90」「Y +90」で起こす
   - 「高さ」かプリセットで大きさを合わせる。青い人形 = 兵士（デフォルメ）、赤い人形 = 等身大の人、足元の六角形 = HEX 1 マス
   - ポリ数・テクスチャが目安を超えると警告が出る
4. 「保存」（Ctrl+S）。`assets/catalog/sources/<id>.json` と `assets/CREDITS.md` が更新される

## Blender なしでキャラクターを動かすには

1. 人型のモデルを用意する（KayKit・Quaternius などの CC0 パック、購入アセット、Meshy・Tripo などの AI 生成）
2. リグが付いていなければ [Mixamo](https://www.mixamo.com/) にアップロードし、あご・手首・ひじ・膝・股にマーカーを置いて自動リグ
3. Mixamo でキャラクターを「FBX / With Skin」、モーションを「FBX / Without Skin / 30fps」でダウンロード
   - 移動系は「In Place」にチェックを入れるとその場で足踏みするモーションになる
4. キャラクターとモーションをまとめてこのツールにドロップする。どれも Mixamo 骨格になるので、モーションはどのキャラにも使い回せる

## 構成

```
server/vite-plugin-assets.ts  開発サーバーの API（カタログの読み書き、ファイル保存、CREDITS.md の生成）
src/
  api.ts            API のクライアント
  import/           取り込み: ファイルの読み込み（loadModel）、GLB への変換（convert）、統計（stats）、初期値（defaults）
  render/scene.ts   プレビューのシーン（HEX 1 マス・グリッド・基準の人形・正面の矢印）
  lab/              兵士の試作場（生成器は asset-runtime/src/three/soldier/）
  editor/           状態（app.ts）と UI（ui.ts・panel.ts）
```

カタログの型と three.js での読み込みは [asset-runtime](../asset-runtime/) にあり、map-editor・戦闘デモからも使う。
