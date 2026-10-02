# million-world — エージェント向け作業指針

iPad（Safari / PWA）で遊ぶ、三人称視点のアニメ調3Dアクションゲーム。個人用途、公開・販売なし。
設計の全体像は `docs/` を正とする。この文書は「このリポジトリで作業する際の約束事」だけを書く。

## 最優先原則

1. **デモ完成が最優先。** `docs/02-milestones.md` の M3 を越えるまで、新システム（武器種追加・魔法・成長要素・ステージ分岐など）には着手しない。思いついたら `docs/02-milestones.md` の「拡張フェーズ候補」に書き足すだけにする。
2. **常に遊べる状態を保つ。** `main` は常にビルドが通り、GitHub Pages で iPad から開けること。壊れた状態でコミットしない。
3. **見た目は最初から整える。** プレースホルダーでもトゥーン着色・輪郭線・影・ポストプロセスの枠組みの中に置く。「後で綺麗にする」を前提にしない。
4. **設計判断は記録する。** 技術選択を変える・追加するときは `docs/01-decisions.md` に ADR を追記する（置き換えではなく追記し、旧 ADR に「superseded by」を書く）。

## 技術スタック（詳細と理由は docs/01-decisions.md）

- Three.js（WebGL2）+ TypeScript（strict）+ Vite
- 物理エンジンなし（XZ平面のカプセル衝突 + 地面高さ）。必要になったら Rapier を検討
- UI は DOM/CSS。React 等のフレームワークは入れない
- テスト: vitest（戦闘ロジック・状態機械などの純粋関数）、Playwright（描画スクリーンショット）
- 配信: GitHub Actions → GitHub Pages（`BASE_PATH=/Million-world/` でビルド）。Vercel 等に載せる場合は既定の `/`

## コマンド

```
npm install
npm run dev          # ローカル開発（LAN公開: npm run dev -- --host）
npm run typecheck
npm test             # vitest
npm run build
npm run shot         # Playwright でヘッドレス描画してスクリーンショットを artifacts/ に出力（目視検証用）
```

## ディレクトリ

```
src/core/       ゲームループ（固定タイムステップ）、時間（ヒットストップ用スケール）、入力抽象化
src/input/      タッチ（仮想スティック・ボタン・カメラドラッグ）→ 入力意図への変換
src/render/     レンダラ初期化、トゥーンマテリアル、輪郭線、ポストプロセス、VFX（トレイル・パーティクル）
src/world/      アリーナ、衝突、環境オブジェクト
src/character/  キャラクター読込、アニメーション状態機械、リターゲット
src/combat/     攻撃データ（フレームデータ）、ヒット判定、ダメージ
src/ai/         敵の行動（FSM）
src/ui/         HUD（DOM）
src/game/       上記を束ねるシーン・エンティティ管理
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
