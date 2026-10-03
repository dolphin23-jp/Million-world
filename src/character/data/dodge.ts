import type { AuthoredAttack, AuthoredKey } from '../authoring';
import { OFFHAND } from './offhand';

/**
 * 回避（ロール）。手付け（ADR-012）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 回避の向きはキャラの向きを入力方向へ合わせてから始まるので、アニメは常に「前」へ転がる。
 *
 * 旧版（低く前傾して 2 歩で駆け抜けるダッシュ）は、実機で「モーションが崩れている」。側面から見ると、足が 1.5m 開く大股の飛び出しを 2 回繰り返し、
 * 剣は体の横へ針のように突き出ていて、回避というより大股のダッシュに見えた（モーションシート tools/motion-sheet.mjs で確認）。ソウルライク系の前転に作り直した。
 *
 * 作り:
 *  - 体を丸めて、腰・胸・頭のピッチを 0 → 360° 回す（腰の座標系の足 = footL/R.rel と膝の追従 = knee を使う。pose-solver.ts）。
 *    回転しているあいだ、足は腰に付いて回る（丸めた脚が体に追従する）。着地で世界に固定し直す
 *  - 剣は回転軸（体の左右）と平行に、体の右へ水平に寝かせる。そうすると転がっても刃先は同じ高さのままで、床に刺さらない
 *  - 転がる球の半径（腰の高さ ≒ 0.6m）に合わせて、ルートは 0.14 → 0.40 の間に約 2.1m 進む（転がり距離 ≒ 球の周 × 回転数）
 *
 * 時間: 0 → 0.08 しゃがんで前へ倒れる / 0.08 → 0.14 蹴り出して丸める / 0.14 → 0.40 転がる（ピッチ 95° → 350°） / 0.40 → 0.46 足から着地して前へ潰れる / 0.46 → 0.58 立ち上がる。
 * 無敵は 3〜22f（Player 側 DODGE.invulnStart / invulnEnd）。ルートの前進は合計 2.95m（旧版 3.1m）。
 */
const DEG_TUCK = { lx: 0.1, ly: -0.2, lz: 0.12 };

/** 回転中の腰・胸・頭のピッチ（度）。腰を基準に、胸を丸め（curl）、頭を顎を引く（chin） */
const roll = (hips: number, curl: number, chin = 14): Pick<AuthoredKey, 'hips' | 'chest' | 'head'> => ({
  hips: { pitch: hips },
  chest: { pitch: hips + curl },
  head: { pitch: hips + curl + chin },
});

/** 転がるあいだの腕: 剣は体の右へ水平（回転軸と平行）、右手は腰の前、左手は胸の前へ丸める */
const TUCKED_ARMS = {
  grip: [62, -12, 0.3] as [number, number, number],
  blade: [-1, 0.05, 0.1] as [number, number, number],
  face: [0, 1, 0] as [number, number, number],
  roll: 0,
  pole: [-0.5, -0.8, 0.2] as [number, number, number],
  left: [-30, -22, 0.26] as [number, number, number],
  leftPole: [0.5, -0.8, 0.2] as [number, number, number],
};

export const DODGE_CLIP: AuthoredAttack = {
  name: 'dodge',
  duration: 0.58,
  keys: [
    // ---- ルート（球が転がる）: 蹴り出しから加速、着地で減速 ----
    { t: 0.08, ease: 'lin', rootZ: 0.04 },
    { t: 0.14, ease: 'in', rootZ: 0.42 },
    { t: 0.4, ease: 'lin', rootZ: 2.5 },
    { t: 0.5, ease: 'out', rootZ: 2.85 },
    { t: 0.58, ease: 'out', rootZ: 2.95 },

    // ---- 腰の高さ（hips.y は立ちの 0.985m からの差）。しゃがみ → 丸めて低く → 着地で潰れ → 立つ。
    //      転がるあいだは回転角に合わせて上下させる: 頭が下に来る（逆さ、ピッチ 180° 付近）ときは頭が床に着かないよう腰を高く（0.65〜0.68m）、
    //      体が水平になる（90° / 270°）ときは背中や腹が床すれすれになるよう低く。頭の骨は頭の下寄りにあるので、逆さのとき頭の骨を 0.22m 以上に保つ（頭の上端が床に入らない）。実測は tools/motion-check.mjs ----
    { t: 0.08, ease: 'io', hips: { y: -0.22, z: 0.05 } },
    { t: 0.14, ease: 'out', hips: { y: -0.52, z: 0 } },
    { t: 0.175, ease: 'lin', hips: { y: -0.36, z: 0 } },
    { t: 0.2, ease: 'lin', hips: { y: -0.31, z: 0 } },
    { t: 0.235, ease: 'lin', hips: { y: -0.33, z: 0 } },
    { t: 0.27, ease: 'lin', hips: { y: -0.45, z: 0 } },
    { t: 0.31, ease: 'lin', hips: { y: -0.64, z: 0 } },
    { t: 0.35, ease: 'lin', hips: { y: -0.55, z: 0 } },
    { t: 0.4, ease: 'lin', hips: { y: -0.4, z: 0 } },
    { t: 0.46, ease: 'io', hips: { y: -0.3, z: 0.03 } },
    { t: 0.58, ease: 'io', hips: { y: 0, z: 0 } },

    // ---- 体の回転（ピッチ。腰を基準に胸と頭が丸まる。丸め（curl）を強めて頭を腰に近づけると、腰を低くできる） ----
    { t: 0.08, ease: 'io', ...roll(28, 20, 10) },
    { t: 0.14, ease: 'lin', ...roll(95, 55, 16) },
    { t: 0.27, ease: 'lin', ...roll(230, 62, 16) },
    { t: 0.4, ease: 'lin', ...roll(350, 38, 10) },
    { t: 0.46, ease: 'io', ...roll(374, 14, 6) },
    { t: 0.58, ease: 'io', hips: { pitch: 360 }, chest: { pitch: 360 }, head: { pitch: 360 } },

    // ---- 腕と剣 ----
    { t: 0.06, ease: 'io', ...TUCKED_ARMS },
    { t: 0.4, ease: 'lin', ...TUCKED_ARMS },
    { t: 0.5, ease: 'io', grip: [30, -20, 0.38], blade: [-0.55, -0.1, 0.8], face: [0, 1, 0], roll: 0, pole: [-0.5, -0.8, 0], left: [-20, -45, 0.35], leftPole: [0.5, -0.8, 0] },
    { t: 0.58, ease: 'io', grip: 'idle', blade: 'idle', pole: 'idle', left: 'idle', leftPole: 'idle' },

    // ---- 足: 蹴り出すまで世界に固定 → 腰に付いて回る（丸める）→ 着地で世界に固定し直す → 立ち上がりで両足がルートの真下に揃う ----
    { t: 0.08, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: 0, lift: 0 } },
    {
      t: 0.15,
      ease: 'io',
      footL: { rel: 1, ...DEG_TUCK, lx: DEG_TUCK.lx, knee: 1 },
      footR: { rel: 1, ...DEG_TUCK, lx: -DEG_TUCK.lx, knee: 1 },
    },
    { t: 0.14, ease: 'lin', footL: { pitch: 100 }, footR: { pitch: 100 } },
    { t: 0.27, ease: 'lin', footL: { pitch: 235 }, footR: { pitch: 235 } },
    { t: 0.36, ease: 'lin', footL: { pitch: 330, rel: 1, knee: 1 }, footR: { pitch: 330, rel: 1, knee: 1 } },
    // 着地: 左足が先、右足が少し遅れて、ルートの 0.3m 前後に置く
    { t: 0.43, ease: 'io', footL: { rel: 0, knee: 0, x: 0, z: 2.8, lift: 0, pitch: 360 }, footR: { rel: 0, knee: 0, x: 0, z: 2.55, lift: 0, pitch: 360 } },
    { t: 0.58, ease: 'io', footL: { z: 2.95 }, footR: { z: 2.95 } },
  ],
};

/**
 * 回避（後ろステップ）。向きを保ったまま後ろへ跳んで間合いを取る。入力なし、またはロック中に対象から離れる向きへ倒したときに出る。
 * 前転と違い、敵（正面）から目を離さない。ルートは負の向き（後ろ）へ 2.0m。足は跳んでいるあいだ腰に付いて（rel）ぶら下がり、着地で世界に固定する。
 *
 * 時間: 0 → 0.07 沈んで蹴る構え / 0.07 → 0.12 蹴り出し / 0.12 → 0.27 空中（腰が少し上がり、体を少し反らす）/ 0.27 → 0.33 着地で沈む / 0.33 → 0.46 立ち上がる。
 * 無敵は 2〜16f（Player 側）。剣は idle のまま（正面へ向けたまま）、左手は構え手。
 */
export const DODGE_BACK: AuthoredAttack = {
  name: 'dodgeBack',
  duration: 0.46,
  keys: [
    // ---- ルート（後ろへ。負が後ろ）: 蹴り出しで加速、着地で減速 ----
    { t: 0.07, ease: 'lin', rootZ: 0 },
    { t: 0.14, ease: 'in', rootZ: -0.5 },
    { t: 0.27, ease: 'lin', rootZ: -1.78 },
    { t: 0.36, ease: 'out', rootZ: -2.0 },

    // ---- 腰: 沈む → 蹴って上がる → 着地で沈む → 立つ ----
    { t: 0.07, ease: 'io', hips: { pitch: 8, y: -0.17, z: 0.03 }, chest: { pitch: 10 }, head: { pitch: 0 } },
    { t: 0.17, ease: 'out', hips: { pitch: -10, y: 0.15, z: -0.03 }, chest: { pitch: -8 }, head: { pitch: -3 } },
    { t: 0.25, ease: 'io', hips: { pitch: -4, y: 0.06, z: 0 }, chest: { pitch: -2 }, head: { pitch: 0 } },
    { t: 0.31, ease: 'io', hips: { pitch: 10, y: -0.19, z: 0.04 }, chest: { pitch: 12 }, head: { pitch: 0 } },
    { t: 0.46, ease: 'io', hips: { pitch: 0, y: 0, z: 0 }, chest: { pitch: 0 }, head: { pitch: 0 } },

    // ---- 腕: 左手は構え手。右（剣）は idle のまま ----
    { t: 0.07, ease: 'io', ...OFFHAND.guard },
    { t: 0.17, ease: 'out', left: [-45, -10, 0.42], leftPole: [0.6, -0.6, -0.1] },
    { t: 0.31, ease: 'io', ...OFFHAND.guard },
    { t: 0.46, ease: 'io', left: 'idle', leftPole: 'idle' },

    // ---- 足: 蹴るまで世界に固定 → 腰に付いてぶら下がる（跳んでいる）→ 着地で世界に固定 → ルートの真下へ ----
    { t: 0.07, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: 0, lift: 0 } },
    { t: 0.13, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.64, lz: -0.1, knee: 0 }, footR: { rel: 1, lx: -0.11, ly: -0.67, lz: -0.02, knee: 0 } },
    { t: 0.25, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.72, lz: 0.06, knee: 0 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 0 } },
    { t: 0.3, ease: 'io', footL: { rel: 0, z: -1.9, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: -2.1, x: 0, lift: 0, pitch: 0 } },
    { t: 0.46, ease: 'io', footL: { z: -2.0 }, footR: { z: -2.0 } },
  ],
};
