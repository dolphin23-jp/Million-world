# million-world — エージェント向け作業指針

iPad（Safari / PWA）で遊ぶ、三人称視点のアニメ調3Dアクションゲーム。個人用途、公開・販売なし。
設計の全体像は `docs/` を正とする。この文書は「このリポジトリで作業する際の約束事」だけを書く。

## 最優先原則

1. **デモ完成が最優先。** `docs/02-milestones.md` の M3 を越えるまで、新システム（武器種追加・魔法・成長要素・ステージ分岐など）には着手しない。思いついたら `docs/02-milestones.md` の「拡張フェーズ候補」に書き足すだけにする。
2. **常に遊べる状態を保つ。** `main` は常にビルドが通り、Vercel の本番 URL で iPad から開けること。壊れた状態でコミットしない。
3. **見た目は最初から整える。** プレースホルダーでもトゥーン着色・輪郭線・影・ポストプロセスの枠組みの中に置く。「後で綺麗にする」を前提にしない。
4. **設計判断は記録する。** 技術選択を変える・追加するときは `docs/01-decisions.md` に ADR を追記する（置き換えではなく追記し、旧 ADR に「superseded by」を書く）。

## 技術スタック（詳細と理由は docs/01-decisions.md）

- Three.js（WebGL2）+ TypeScript（strict）+ Vite
- 物理エンジンなし（XZ平面のカプセル衝突 + 地面高さ）。必要になったら Rapier を検討
- UI は DOM/CSS。React 等のフレームワークは入れない
- テスト: vitest（戦闘ロジック・状態機械などの純粋関数）、Playwright（描画スクリーンショット）
- 配信: Vercel（リポジトリ連携、push で自動デプロイ）。GitHub Actions は CI（typecheck/test/build）のみ

## コマンド

```
npm install
npm run dev          # ローカル開発（LAN公開: npm run dev -- --host）
npm run typecheck
npm test             # vitest
npm run build
npm run shot         # Playwright でヘッドレス描画してスクリーンショットを artifacts/ に出力（目視検証用）
node tools/skin-stress.mjs <glb>    # キャラ資産の変形破綻を数値検査（採用前に必須。docs/05 参照）
node tools/mesh-check.mjs <glb>     # メッシュ自体の欠陥（穴・裏返り・浮き島・UV 密度）を数値検査（採用前に必須）
node tools/build-character.mjs <manifest.json>   # クリップ結合・リターゲット・接地補正
python3 tools/clean-texture.py <glb> <tex.png> <out.png>   # 生成テクスチャの描き崩れ（腰まわり）を塗り直す。docs/05 参照
node tools/clip-arm-height.mjs <glb>   # クリップごとの腕の挙上角（脇の破綻の目安）
node tools/sfx-check.mjs   # 効果音を書き出して数値検査し、artifacts/audio/*.wav を出す（先に npm run build）
node tools/motion-sheet.mjs <label> --script '0:{"attackPressed":true}' --end 36   # 手付けクリップの姿勢を 1 枚に並べる（npm run build の後。--cam side|front|back|three|top、--aim x,z、--weapon <装備 id>、--clip <名前> でクリップを直接再生。--mode weights|wsum:<骨>|ybands|normals|wire で重み・服の縁の高さ・法線を見る、--no-outline、--tile 1 で拡大、--track grip|hands|handR|handL|tip で握りなどを追尾して拡大（--dist 0.7〜1.3）。詳細はファイル先頭）
node tools/motion-check.mjs <clip> | --stats | --trace <clip>   # 手付けクリップの数値検査: 骨の床からの高さ・剣先の速さ / 全クリップの焼き込み統計 / フレームごとの腕・手首
node tools/grip-check.mjs [--weapon greatsword] [--worst] [--check] [クリップ名 …]   # 両手が柄を握れているか（手のひらの中心が柄の軸の上か・握りの向きが合うか）を実際の骨でフレームごとに測る。握り・リグ・両手持ちの IK を触ったら（先に npm run build。ADR-023）
node tools/measure-hand-axes.mjs <glb>   # 両手のメッシュの座標系（指・親指側・手の甲側）を頂点から測る（HERO.handFrames の元。手のメッシュを替えたとき）
node tools/waist-stress.mjs [--check] [--worst N]   # 全クリップで胴（腰・胸）の変形の崩れ度（辺の伸び・断面・ひねり）を three.js のスキニングで測る。--check でしきい値超過なら終了コード 2。骨・重みを触ったら必ず（先に npm run build）
node tools/measure-joint-centers.mjs <glb>   # 骨がメッシュの断面の中心を通っているかを測る（補正済みなら差が ±0.1cm）
node tools/recenter-skeleton.mjs <in.glb> <mid.glb> && node tools/reskin-torso.mjs <mid.glb> <out.glb>   # 骨を体の中心へ寄せる → 胴の重みを作り直す（ADR-022。補正前の資産にかける。hero.glb の生成の手順は ADR-022）
（?motionlab=1 を付けて開くと window.__mw.motionLab が使え、ページ内で実リグに対して AuthoredAttack を焼いて統計を返す。手首のねじれを減らす roll の探索用。motion-check は --weapon <装備 id> で大剣などを装備して測る）
```

## ディレクトリ

```
src/core/       ゲームループ（固定タイムステップ）、時間（ヒットストップ用スケール）、入力抽象化
src/input/      タッチ（仮想スティック・ボタン・カメラドラッグ）→ 入力意図への変換
src/render/     レンダラ初期化、トゥーンマテリアル、輪郭線、ポストプロセス、VFX（トレイル・パーティクル・予告の床表示）
src/world/      アリーナ、衝突、環境オブジェクト
src/character/  キャラクター読込、アニメーション状態機械、リターゲット、手付け攻撃アニメ（ik / rig / pose-solver / authoring。ADR-012）、立ち姿の前傾補正（posture。ADR-024）
src/combat/     攻撃データ（フレームデータ）、ヒット判定、ダメージ、ロックオン、演出の数値、操作ガイド・技表の表示内容（move-guide / move-tree。純粋関数）
src/ai/         敵の行動（FSM・攻撃権・予告の床表示の幾何 telegraph。ADR-025）、敵とウェーブの数値（data/）
src/audio/      効果音（WebAudio 合成のレシピと再生。ADR-017）
src/ui/         HUD（DOM）: HP バー・ダメージ数字・ロックの枠・リザルト・操作ガイド（下の中央）・技表
src/game/       上記を束ねるシーン・エンティティ管理
src/debug/      開発用フック（?sfxlab=1 / ?perf=1 / ?motionlab=1。通常起動では読み込まない）
public/assets/  実行時に読む資産（GLB, テクスチャ, 音）
tools/          資産変換スクリプト（キャラ GLB の正規化・削減など）
docs/           設計文書
artifacts/      スクリーンショット等の生成物（git 管理外）
```

## コーディング規約

- 1フレームごとに `new Vector3()` 等を生成しない。モジュールスコープの一時オブジェクトを再利用する
- シミュレーションは `step(dt)`（固定 1/60 秒）、描画は `render(alpha)`。ゲームロジックから `requestAnimationFrame` の実時間に依存しない
- 攻撃・武器・敵の数値はコードに埋め込まず `src/**/data/*.ts` に定義する
- Safari 固有の対処（タッチ抑止・音声解放・コンテキストロスト）は `src/platform/` に集約し、コメントで理由を書く
- 外部依存を増やすときは理由を ADR か PR 説明に書く。依存は最小に保つ

## 検証の手順（コミット前）

1. `npm run typecheck && npm test && npm run build` が通る
2. `npm run shot` でスクリーンショットを確認し、描画が崩れていない（ヘッドレスは SwiftShader なので性能は見ない。見た目だけ）
3. 入力・性能の最終確認は本人が iPad 実機で行う。実機でしか分からない問題は Issue か `docs/02-milestones.md` の既知問題に書く

## コミット

- 日本語か英語どちらでも可。1コミット1目的
- `main` に直接コミットしてよい（個人プロジェクト）。大きな変更はブランチ + PR でも可
