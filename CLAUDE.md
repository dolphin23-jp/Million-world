# million-world — エージェント向け作業指針

iPad（Safari / PWA）で遊ぶ、三人称視点のアニメ調3Dアクションゲーム。個人用途、公開・販売なし。
設計の全体像は `docs/` を正とする（成長・スキル・武器・ステージの今後の方針と順序は `docs/07-progression-and-world.md`）。この文書は「このリポジトリで作業する際の約束事」だけを書く。

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
node tools/motion-sheet.mjs <label> --script '0:{"attackPressed":true}' --end 36   # 手付けクリップの姿勢を 1 枚に並べる（npm run build の後。--cam side|front|back|three|top、--aim x,z、--weapon <装備 id>、--clip <名前> でクリップを直接再生（大きなヨーの回転は映らない。回転は --skill で）、--skill <スキル id> [--skill-level <1〜10>] + --script '0:{"skillPressed":true}' で剣技を実際の連なりとして再生（Lv4・Lv7 で動きが進化。ADR-034）。--mode weights|wsum:<骨>|ybands|normals|wire で重み・服の縁の高さ・法線を見る、--no-outline、--tile 1 で拡大、--track grip|hands|handR|handL|tip で握りなどを追尾して拡大（--dist 0.7〜1.3）。詳細はファイル先頭）
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
src/input/      タッチ（仮想スティック・ボタン・カメラドラッグ）→ 入力意図への変換。スロットボタン（タップで使う・長押しか払いで一覧が同心円（扇）に開き、向きと距離で選ぶ。アイテム欄・スキル欄の共通部品。slot-layout = 配置と選び方の純粋関数 / slot-gesture = 純粋な状態機械 / slot-button = DOM。ADR-030・033）
src/render/     レンダラ初期化、トゥーンマテリアル、輪郭線、ポストプロセス、VFX（トレイル・パーティクル・予告の床表示（帯・円）・飛び道具の鬼火）
src/world/      世界への問い合わせ（world = 円形の境界 + 円柱・箱の障害物。体の押し出し moveCircle・弾や視線の遮り raycast。足の高さ y と障害物の上面 top を引数に持つ。体・弾・出現は半径を直接読まず World を通す。ADR-039）、アリーナ（data/arena-props.ts の表から当たりと見た目を作る）、円どうしの衝突（collision）
src/character/  キャラクター読込、アニメーション状態機械、リターゲット、手付け攻撃アニメ（ik / rig / pose-solver / authoring。ADR-012）、立ち姿の前傾補正（posture。ADR-024）
src/combat/     攻撃データ（フレームデータ）、ヒット判定、ダメージ、ロックオン、演出の数値、操作ガイド・技表の表示内容（move-guide / move-tree。純粋関数）、飛び道具の sim（projectile。ADR-026）・体勢ゲージ（poise。ADR-027）・ミスティカルドッジ（mystical。ジャスト回避で敵の時間を間引く純粋なクラス）・アイテム欄（inventory。数・選択・ドロップの抽選と救済。ADR-030）・スキル（skills。剣技 = 専用モーション（SKILL_ATTACKS。多段ヒットの窓・スーパーアーマー・円の当たり）を中心にした技の連なり。SkillBook = レベル・選択・クールダウン。ADR-031 / 032。第 2 弾の攻撃の数値は data/skill-attacks-ex.ts、クリップは character/data/skill-sword-ex.ts・skill-greatsword-ex.ts の「仕様から作る生成関数」で Lv1/4/7 の 3 本。ADR-038）・成長（growth = 経験値・レベル・ポイント・ステータス・スキルのレベル。modifiers = ステータス等の効果を集計し、戦闘は数値をここからだけ読む。save = セーブの形と版・移行。progress = クリアした敵の段階・選んでいる段階。ADR-033・036）。会心は Modifiers の critRate / critDamage（data/crit.ts。ADR-035）。パッシブ（data/passives.ts = 12 種の表・前提・系統・数値。Growth がレベルを持ち、`modifiersFor(family)` で装備の系統込みの Modifiers を返す。buffs = 闘気（撃破で重なる一時の攻撃力）。イベント効果は Game が行う。ADR-037）
src/ai/         敵の行動（FSM・攻撃権・予告の床表示の幾何 telegraph（帯・円）・距離を取って飛び道具を撃つ遠距離型・ガード不能と体勢ゲージの重装型・攻撃権の重みと周回の群れ・複数の技と段階と召喚のボス。ADR-025〜029）、敵とウェーブの数値（data/）。敵の色違い・強化版の段階（data/tiers.ts = 段階の表、data/enemy-variants.ts = 元の敵から強化版を作る純粋関数 enemyDef(id, tier)。ADR-036）
src/audio/      効果音（WebAudio 合成のレシピと再生。ADR-017）
src/ui/         HUD（DOM）: HP バー・Lv と経験値・ダメージ数字・ロックの枠・リザルト・操作ガイド（下の中央）。一時停止メニュー（pause-menu = タブの入れ物。menu/ = ステータス・スキル・技表・設定のタブ。機能が増えたらタブを足す。いまは ステータス・スキル（剣技とパッシブ）・技表・段階・設定。ADR-033・036・037）
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
