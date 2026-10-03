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

## 結合時の注意（2026-10-03 に判明、`tools/build-character.mjs` が対処済み）

- **自動リグはジョブごとに違う。** 同じメッシュを同じ入力で `3d_rigging` にかけても、関節位置は ≤0.5cm しか違わないが、
  手・肩・足のボーンのロール（軸回り）が 10〜90° 違い、スキンウェイトも違う。ローカル回転をそのまま写すと手足が捻れる
- 対処: 各ボーンについて「バインド姿勢からの世界回転の変化量」 Δ = W_src · inv(B_src) を求め、先リグに Δ · B_dst として写す。
  並進はバインド姿勢のオフセットに固定し、Hips だけ並進アニメを写す（ボーン伸縮の並進アニメは捨てる）
- **土台（メッシュ＋ウェイト）に使うリグで見た目が変わる。** 検証では `Triple_Combo_Attack` のジョブのウェイトが最も素直だった。
  manifest の先頭のクリップが土台になる
- **つま先ボーンが異常に長い**（足首から 39cm）ので回すと靴が刃物のように伸びる。`freezeBones` でバインド姿勢に固定する
- 出力の `hero.glb` は 8 クリップ込みで約 0.8MB（テクスチャ 2048² WebP、meshopt 圧縮）
- 検査: `node tools/inspect-glb.mjs <glb>`（多方向 + 各クリップのポーズ列）、`node tools/pose-sheet.mjs <glb>:<clip>:<label> ...`（固定カメラ比較）
