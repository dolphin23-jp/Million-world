# 05. キャラクター資産の自動化パイプライン

**状態**: 検証済み（2026-10-03、パイプライン検証用の仮キャラ 1 体で全工程を通した）。
人手が必要なのは「デザインの好みの判断」だけ。それ以外は AI が単独で回せる。

## 経路（Higgsfield コネクタ経由）

| # | 工程 | ツール / モデル | 費用(クレジット) |
|---|---|---|---|
| 1 | 原案画像（A ポーズ・フラット塗り・白背景） | `generate_image` / `gpt_image_2_5` | 0.25 |
| 2 | 画像→3D（テクスチャ付き GLB） | `generate_3d` / `tripo_h3_1_image_to_3d`（`texture:true, pbr:false, face_limit:40000`）。多視点は `tripo_h3_1_multiview_to_3d`（9） | 9 |
| 3 | リグ＋モーション | `generate_3d` / `3d_rigging`（`model_url` = 2 の結果 URL, `height_meters:1.7`, `enable_animation:true, animation_action_id:<id>`） | リグのみ 5 / モーション 1 本込み 8 |
| 4 | 取り込み | 結果 URL（`d8j0ntlcm91z4.cloudfront.net`）を `curl` でこの環境へ。**取得できることを確認済み** | – |
| 5 | 検査 | `node tools/inspect-glb.mjs raw/<file>.glb`（多方向描画＋統計＋アニメのポーズ列） | – |

1 体を「リグ付き＋モーション 1 本」まで作って約 17.3 クレジット。モーション追加は 1 本あたり約 3（リグ 5→8 の差分から推定）。

## 利用できる戦闘モーション候補（Meshy ライブラリ、ID は `animation_action_id`）

未検証（プレビューを見て選ぶ）。待機 `0` / 走り `16` / 構え `89 Combat_Stance` / 斬り `97 Left_Slash`,
`219 Right_Hand_Sword_Slash`, `99 Reaping_Swing`, `102 Sword_Judgment` / コンボ一体型 `92 Double_Combo_Attack`,
`105 Triple_Combo_Attack` / 回避 `158 Roll_Dodge`（検証済み）, `156 Stand_Dodge` / 被弾 `7 BeHit_FlyUp` / 死亡 `8 Dead` /
魔法 `125〜137`（拡張フェーズ）。

## 検証結果（仮キャラ）

良かった点
- 顔: 正面・斜め・側面とも輪郭は破綻せず、鼻・顎の凹凸がある。目は「描かれた絵」寄りだがアニメ調として許容範囲
- 手: 指は融合気味だが 5 指の形があり、剣を握る用途なら通る
- 三角形 39,872（予算 40k 内）、テクスチャ 2048² 1 枚、メッシュ 1 つ
- リグ: 24 ボーン、名前は Mixamo 系（`Hips` `Spine` `Spine01` `Spine02` `neck` `Head` `LeftShoulder` `LeftArm` `LeftForeArm` `LeftHand` `LeftUpLeg` `LeftLeg` `LeftFoot` `LeftToeBase` と右側）。身長 1.7m に自動スケール。モーション付与も成功（`Roll_Dodge` 1.87 秒）

要対処の点
- **向き**: モデルは +X を向いて出力される。取り込み時に Y 軸回転で +Z 正面へ正規化する
- **スキニング**: 回避の前転ポーズで股・裾まわりに尖った破れ（ウェイトの乱れ）が出る。ゲームのカメラ距離・速度で許容できるかは M1 で判断
- **指ボーンなし**（手は剛体）、**髪・服のボーンなし**（揺れない）。設計で長髪・マント・ロングスカートを避ける方針は正しい
- **ルートモーション**: クリップは腰が並進する。ゲームでは移動をコードで行うので、取り込み時に `Hips` の並進（XZ）を除去する
- 左目付近にテクスチャの乱れ（小さな黒い滲み）。ベースカラーに薄い陰影が含まれて見える（トゥーン着色と重ねたときの影響は M1 で確認）
- クリップごとに別 GLB で返る。同一骨格なので、取り込みスクリプトで 1 ファイルに結合する

## この経路で検証できていないこと

- 多視点入力（3 面図）が単一画像より形状を改善するか
- モーションの質（プレビュー GIF は `cdn.meshy.ai` にあるが未確認）。コンボ 3 段・被弾・死亡の組み合わせで破綻しないか
- 敵（非人型）のリグ。Meshy は人型向けと明記している

## ネットワークと別経路

- この環境から **届く**: `api.tripo3d.ai`（認証前に 401 を返すのを確認）、Higgsfield の結果 CDN
- この環境から **届かない**: `chatgpt.com`（403）、`api.openai.com`（421）。ChatGPT / Codex のサブスクは使えない
- computer use / ブラウザ操作: このセッションには PC もブラウザも繋がっていない（ツールなし）。UI 自動操作は最も脆い経路
- Tripo を直接叩く場合は API キーが要る。**Web 版クレジットと API クレジットが同一かは未確認**（公式ドキュメントを取得できなかった）。
  キーはチャットやコミットに載せず、必要になったら GitHub Actions の Secret 経由にする（リポジトリは public）

## 原案画像のプロンプト雛形（人型）

`docs/03-asset-pipeline.md` の仕様に従う。検証で使った文面:

> Anime character design reference, full body, single <キャラの説明> standing straight facing the camera in a neutral A-pose
> (arms angled about 30 degrees away from the body, fingers slightly spread, feet shoulder width apart). <髪・表情・服>,
> no cape, no scarf, no ribbons, no long or loose accessories, no weapon in hands. Flat cel-shaded anime coloring with clean
> dark outlines, even flat lighting, no cast shadows, no gradients or baked shading, plain pure white background, entire body
> visible from head to feet, centered.

## 確定した取り込み手順（2026-10-03、2 体目で確立）

```
3面図(front/side/back, A ポーズ)  →  tripo_h3_1_multiview_to_3d (quad:true, detailed)  → FBX
  → tools/fbx2glb.mjs（三角形化・テクスチャ埋込）→ 正規化（足裏原点・身長・+Z 正面・JPEG2048）
  → Higgsfield に file としてアップロード（公開 URL）
  → 3d_rigging(+animation) × クリップ数（毎回リグし直される。8 クレジット/本）
  → 土台: 1 本目の出力を tools/weld-by-position.mjs（三角形スープ→連結メッシュ）
          → tools/smooth-weights.mjs（隣接平滑化 0.5×3、4 本制限）
  → tools/build-character.mjs（manifest.base に土台、clips に各出力）
       リターゲット（バインド差分）・ルートモーション除去・接地補正・WebP 2048
  → tools/skin-stress.mjs で全クリップの伸び率を数値検査
  → tools/pose-sheet.mjs / tools/inspect-glb.mjs で目視
```

### 検査基準（`tools/skin-stress.mjs`）

全フレームで「メッシュの辺の長さ ÷ バインド時の長さ」を three.js と同じスキニングで計算する。
- 採用: **1.8 倍超の辺が 1% 未満、p99 < 1.9**（2 体目: 0.26〜1.1%、p99 1.42〜1.86）
- 不採用: 1 体目は 11〜15%、p99 8〜11（Meshy から返った直後でも同値 → リグのウェイト自体が破綻）
- `max` は数 mm の辺 1 本で跳ねるので単独では判定に使わない（脇の下の 4〜7mm の辺が 10 倍前後になる）
- `minJointY` は足の床貫通の検出。接地補正後は常にバインド時の足の高さ（≈0.06〜0.10m）になる

### 分かったこと

- **衣装と体型が最大の要因。** 裾の広い服・長髪は自動リグのウェイトが破綻する。タイトな服、露出した四肢、短髪なら安定する
- **四角メッシュ（Tripo `quad`）は FBX で返る**。glTF は四角を表現できないため。FBX→GLB は three.js の FBXLoader で三角形化すればよい
- FBXLoader 経由のメッシュは**三角形ごとに頂点が分かれている**（177,960 頂点 = 59,320 三角形 × 3）。Meshy はそのままリグするが、
  ウェイトの平滑化や検査には位置で結合した連結メッシュが要る（`tools/weld-by-position.mjs`）
- **Meshy の自動リグはジョブごとに違う**（関節 ≤0.5cm、ロール最大 90°、ウェイトも別物）。クリップはボーンの「バインド姿勢からの世界回転差分」で写す
- Meshy のクリップは別体格向けの並進アニメ（ボーン伸縮）を含む。ボーン長を固定すると足が床を貫く（1 体目で最大 26cm）ので**接地補正**が必須
- Blender（`bpy` 5.2、pip で入る）のボーンヒート自動ウェイトは、AI 生成メッシュ（1,000 以上の小片、非多様体辺多数）では解が出ず失敗。
  Blender でのウェイト平滑化は効くが、再エクスポートで法線がノイズ化（斑点）したため、自前の `smooth-weights.mjs` を使う
- 支配ボーンから遠いボーンの影響を機械的に落とす掃除は、隣接頂点との不連続を生んで悪化した（既定で無効）
- `meshopt`/量子化は使わない（IBM に逆変換が畳み込まれ検査と切り分けが難しくなる）。2 体目の `hero.glb` は 8 クリップ込みで 3.6MB

### 費用実績

- 1 体目（検証用）: 画像 0.25 + 3D 9 + リグ+モーション 8×8 = 約 73
- 2 体目（本採用）: 3D 19.5 + リグ+モーション 8×8 = 83.5
