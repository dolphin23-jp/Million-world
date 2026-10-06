import type { AuthoredAttack } from '../authoring';
import { COMBO_HOP, COMBO_UPPER } from './combo-chain';
import { plane } from './cutting-plane';
import { LAND, TOP } from './heavy';
import { CHAMBER, LUNGE, LUNGE_HOLD_T, THRUST } from './lunge';
import { OFFHAND } from './offhand';
import { pose } from './stagger';
import { FOLLOW as SWEEP_FOLLOW, SWEEP, SWEEP_HOLD_T } from './sweep';

/**
 * 片手剣の連携の続き（ADR-024）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 始動の技（横薙ぎ・踏み込み突き）と分岐の技（跳び退き斬り・打ち上げ）の受付（前の技の振り抜きの姿勢を保っている間）に攻撃を押すと続く:
 *   横薙ぎ → 返し薙ぎ / 踏み込み突き → 抜き払い / 跳び退き斬り上げ →（前）飛び込み突き / 打ち上げ → 落下斬り。
 * どれも前の技の保持の姿勢から続けて始まる（continueFrom）。盾を持つとき（左腕を盾の位置に固定して焼く版）は左手のキーが使われない。
 */

type V3 = [number, number, number];
const H = 0;

const RETURN = {
  hips: { yaw: 0, pitch: 0, z: 0, y: 0 },
  chest: { yaw: 0, pitch: 0 },
  head: { yaw: 0 },
  grip: 'idle',
  blade: 'idle',
  pole: 'idle',
  left: 'idle',
  leftPole: 'idle',
} as const;

// ---------------------------------------------------------------- 返し薙ぎ（横薙ぎの受付で攻撃）

/** 巻き込み: 横薙ぎで左へ抜けた剣を、さらに左へ引き込んで水平に寝かせる */
export const BACK_COIL = {
  hips: { yaw: -26, pitch: 8, z: 0.02, y: -0.16 },
  chest: { yaw: -44, pitch: 10 },
  head: { yaw: -16 },
  grip: [-58, 4, 0.42] as V3,
  ...plane(-80, H),
  roll: -30,
  pole: [-0.5, -0.8, 0] as V3,
  ...OFFHAND.hip,
};

/** 薙ぎの途中（体の前を通る最高速）: 左から前を通って右へ */
export const BACK_PASS = {
  hips: { yaw: 0, pitch: 6, z: 0.05, y: -0.16 },
  chest: { yaw: 0, pitch: 9 },
  head: { yaw: 0 },
  grip: [6, 8, 0.46] as V3,
  ...plane(0, H),
  roll: -30,
  pole: [-0.4, -0.85, 0] as V3,
  ...OFFHAND.pull,
};

/** 振り抜きの終わり: 剣は右へ抜け、体は右へひねり切る（横薙ぎの溜めの姿勢に近い） */
export const BACK_FOLLOW = {
  hips: { yaw: 18, pitch: 8, z: 0.05, y: -0.14 },
  chest: { yaw: 32, pitch: 10 },
  head: { yaw: 14 },
  grip: [44, 6, 0.46] as V3,
  ...plane(66, H),
  roll: -30,
  pole: [-0.6, -0.8, 0.1] as V3,
  ...OFFHAND.guard,
};

/**
 * 返し薙ぎ（横薙ぎの受付で攻撃）: 左へ薙ぎ抜けた剣を、そのまま左から右へ水平に薙ぎ返す。横薙ぎの 2 連目（手数を重ねる軽い技）。
 * 横薙ぎの受付（SWEEP_HOLD_T。振り抜いた姿勢を保っている間）から続けて始まる（continueFrom）。
 * 0 → 0.09 さらに左へ引き込む / 0.09 → 0.18 薙ぎ返す（0.18 に体の前を通る最高速。右足は 0.18 に着地）/ 0.18 → 0.28 右へ振り抜く / 0.28 → 0.4 保つ / 0.4 → 0.58 戻り。
 * 足は世界に固定（足の z はこの技の開始時のルートからの前進量。横薙ぎの終わりは左足 0、右足 −0.15）。ルートは 0.05 から 0.3 までに 0.5 m。
 */
export const SWEEP_BACK: AuthoredAttack = {
  name: 'sweepBack',
  duration: 0.58,
  continueFrom: { attack: SWEEP, t: SWEEP_HOLD_T },
  keys: [
    // ---- 下半身: 後ろにいた右足が前へ踏み込む。左足は残って、あとで引きつける ----
    { t: 0.05, ease: 'lin', rootZ: 0 },
    { t: 0.18, ease: 'in', rootZ: 0.28 },
    { t: 0.3, ease: 'out', rootZ: 0.5 },
    { t: 0.05, ease: 'lin', footR: { arc: 0 } }, // 前の技から受け取った位置のまま、踏み出すまで動かさない（arc だけのキー = 前の値を保つ）
    { t: 0.18, ease: 'io', footR: { z: 0.42, arc: 0.12 } },
    { t: 0.4, ease: 'lin', footR: { z: 0.42 } },
    { t: 0.58, ease: 'io', footR: { z: 0.5, arc: 0.05 } },
    { t: 0.16, ease: 'lin', footL: { arc: 0 } },
    { t: 0.3, ease: 'out', footL: { z: 0.22, arc: 0.06 } },
    { t: 0.4, ease: 'lin', footL: { z: 0.22 } },
    { t: 0.58, ease: 'io', footL: { z: 0.5, arc: 0.1 } },
    // ---- 引き込む → 薙ぎ返す → 振り抜く → 保つ → 戻る ----
    ...pose(0.09, 'io', BACK_COIL),
    ...pose(0.18, 'in', BACK_PASS),
    ...pose(0.28, 'out', BACK_FOLLOW),
    ...pose(0.4, 'lin', BACK_FOLLOW),
    ...pose(0.58, 'io', RETURN),
  ],
};

// ---------------------------------------------------------------- 抜き払い（踏み込み突きの受付で攻撃）

/** 引き寄せ: 突き切った剣を右腰へ引いて、体を右へひねる（足は深く踏み込んだまま） */
export const SLASH_COIL = {
  hips: { yaw: 20, pitch: 4, z: -0.03, y: -0.18 },
  chest: { yaw: 36, pitch: 4 },
  head: { yaw: 10 },
  grip: [60, 0, 0.36] as V3,
  ...plane(76, H),
  roll: -30,
  pole: [-0.6, -0.8, 0.1] as V3,
  ...OFFHAND.guard,
};

export const SLASH_PASS = {
  hips: { yaw: 0, pitch: 6, z: 0.05, y: -0.18 },
  chest: { yaw: 0, pitch: 9 },
  head: { yaw: 0 },
  grip: [6, 8, 0.46] as V3,
  ...plane(0, H),
  roll: -30,
  pole: [-0.4, -0.85, 0] as V3,
  ...OFFHAND.pull,
};

/**
 * 抜き払い（踏み込み突きの受付で攻撃）: 突き切った剣を右腰へ引き戻しながら、左足を大きく踏み抜けて、右から左へ水平に払う。突いて、すり抜けながら斬る。
 * 踏み込み突きの受付（LUNGE_HOLD_T。突き切った姿勢を保っている間）から続けて始まる（continueFrom）。
 * 0 → 0.1 引き寄せてひねる / 0.1 → 0.19 払う（0.19 に前を通る最高速。左足は 0.2 に着地）/ 0.19 → 0.3 左へ振り抜く / 0.3 → 0.4 保つ / 0.4 → 0.6 戻り。
 * 足は世界に固定（突きの終わりは右足 −0.15、左足 −0.55）。ルートは 0.08 から 0.3 までに 0.6 m。
 */
export const LUNGE_SLASH: AuthoredAttack = {
  name: 'lungeSlash',
  duration: 0.6,
  continueFrom: { attack: LUNGE, t: LUNGE_HOLD_T },
  keys: [
    // ---- 下半身: 後ろにいた左足が弧を描いて前へ踏み抜ける。右足は残って、あとで引きつける ----
    { t: 0.08, ease: 'lin', rootZ: 0 },
    { t: 0.19, ease: 'in', rootZ: 0.3 },
    { t: 0.3, ease: 'out', rootZ: 0.6 },
    { t: 0.08, ease: 'lin', footL: { arc: 0 } },
    { t: 0.2, ease: 'io', footL: { z: 0.42, arc: 0.14 } },
    { t: 0.4, ease: 'lin', footL: { z: 0.42 } },
    { t: 0.6, ease: 'io', footL: { z: 0.6, arc: 0.05 } },
    { t: 0.2, ease: 'lin', footR: { arc: 0 } },
    { t: 0.32, ease: 'out', footR: { z: 0.2, arc: 0.06 } },
    { t: 0.4, ease: 'lin', footR: { z: 0.2 } },
    { t: 0.6, ease: 'io', footR: { z: 0.6, arc: 0.1 } },
    // ---- 引き寄せる → 払う → 振り抜く → 保つ → 戻る ----
    ...pose(0.1, 'io', SLASH_COIL),
    ...pose(0.19, 'in', SLASH_PASS),
    ...pose(0.3, 'out', SWEEP_FOLLOW),
    ...pose(0.4, 'lin', SWEEP_FOLLOW),
    ...pose(0.6, 'io', RETURN),
  ],
};

// ---------------------------------------------------------------- 飛び込み突き（跳び退き斬り上げの受付で前へ倒して攻撃）

/** 跳び退き斬り上げの受付の時刻（着地して、右上へ抜けた姿勢を 0.26〜0.4 で保つ。ルートは 0.32 で止まる）。AttackDef.cancelAt と同じ */
const HOP_HOLD_T = 0.32;

/**
 * 飛び込み突き（跳び退き斬り上げの受付で、スティックを前へ倒して攻撃）: 後ろへ跳んで取り直した間合いを、右足から大きく飛び込んで体ごと突き返す（ヒット・アンド・アウェイの「ヒット」）。
 * 踏み込み突き（lunge）の動きで、より遠くへ（1.5 m）。跳び退き斬り上げの受付（HOP_HOLD_T）から続けて始まる（continueFrom）。
 * 0 → 0.12 右腰へ引き絞る（0.12〜0.15 は頂点で一拍）/ 0.15 → 0.22 突き出す（0.22 に最高速。右足は 0.22 に着地）/ 0.22 → 0.32 伸び切る / 0.32 → 0.44 余韻 / 0.44 → 0.66 戻り。
 * 足は世界に固定。ルートは 0.06 から 0.22 までに 0.85 m、減速して 0.36 までに 1.5 m。
 */
export const HOP_THRUST: AuthoredAttack = {
  name: 'hopThrust',
  duration: 0.66,
  continueFrom: { attack: COMBO_HOP, t: HOP_HOLD_T },
  keys: [
    // ---- 下半身: 右足が大きく飛び込む。左足は残って、突いたあと引き寄せて追いつく ----
    { t: 0.06, ease: 'lin', rootZ: 0 },
    { t: 0.14, ease: 'in', rootZ: 0.2 },
    { t: 0.22, ease: 'lin', rootZ: 0.85 },
    { t: 0.36, ease: 'out', rootZ: 1.5 },
    { t: 0.08, ease: 'lin', footR: { arc: 0 } },
    { t: 0.22, ease: 'io', footR: { z: 1.3, arc: 0.16 } },
    { t: 0.46, ease: 'lin', footR: { z: 1.3 } },
    { t: 0.66, ease: 'io', footR: { z: 1.5, arc: 0.04 } },
    { t: 0.17, ease: 'lin', footL: { arc: 0 } },
    { t: 0.36, ease: 'out', footL: { z: 0.9, arc: 0.07 } },
    { t: 0.46, ease: 'lin', footL: { z: 0.9 } },
    { t: 0.66, ease: 'io', footL: { z: 1.5, arc: 0.1 } },
    // ---- 引き絞る → 突く → 伸び切る → 余韻 → 戻る ----
    ...pose(0.12, 'io', CHAMBER),
    ...pose(0.15, 'lin', CHAMBER),
    ...pose(0.22, 'in', THRUST),
    ...pose(0.32, 'out', { ...THRUST, ...OFFHAND.hip }),
    ...pose(0.44, 'out', { ...THRUST, hips: { yaw: -10, pitch: 8, z: 0.08, y: -0.14 }, ...OFFHAND.hip }),
    ...pose(0.66, 'io', RETURN),
  ],
};

// ---------------------------------------------------------------- 落下斬り（打ち上げの受付で攻撃）

/** 打ち上げの受付の時刻（着地して剣を頭上〜後ろへ掲げた姿勢を 0.42〜0.52 で保つ）。AttackDef.cancelAt と同じ */
const UPPER_HOLD_T = 0.42;

/** 跳ぶ前の溜め: 頭上の剣を右肩の後ろへ引いて、膝を曲げる */
const SLAM_GATHER = {
  hips: { yaw: 8, pitch: 4, z: -0.04, y: -0.24 },
  chest: { yaw: 14, pitch: 4 },
  head: { yaw: 4 },
  grip: [20, 50, 0.36] as V3,
  ...plane(122, 80),
  roll: 0,
  pole: [-0.6, -0.8, -0.15] as V3,
  ...OFFHAND.guard,
};

/** 空中: 剣を頭上へ高く掲げる（体は反る） */
const SLAM_AIR = {
  ...TOP,
  hips: { yaw: 4, pitch: -6, z: -0.04, y: 0.1 },
  chest: { yaw: 6, pitch: -12 },
};

/** 振り下ろしの途中（体の前を通る最高速）: 頭上から前へ。剣が水平に近づき、体が前へ倒れ始める */
const SLAM_PASS = {
  hips: { yaw: 0, pitch: 10, z: 0.06, y: -0.04 },
  chest: { yaw: 0, pitch: 14 },
  head: { yaw: 0 },
  grip: [6, 8, 0.46] as V3,
  ...plane(0, 90),
  roll: 0,
  pole: [-0.45, -0.85, -0.15] as V3,
  ...OFFHAND.pull,
};

/** 着地と叩きつけ: 深く沈んで前へ倒れ、剣先が体の前の低い所で止まる（heavy の叩きつけより少し深い） */
const SLAM_LAND = {
  ...LAND,
  hips: { yaw: 0, pitch: 14, z: 0.1, y: -0.22 },
  chest: { yaw: 0, pitch: 24 },
  grip: [4, -22, 0.46] as V3,
};

/** 落下斬りの受付の時刻（着地して剣を叩きつけた姿勢を 0.28〜0.42 で保つ）。AttackDef.cancelAt と同じ。地擦り斬り上げ（slamRip。ADR-047）がこの姿勢から続く */
export const SLAM_HOLD_T = 0.34;

/**
 * 落下斬り（打ち上げの受付で攻撃）: 打ち上げで頭上へ抜けた剣を引き直し、もう一度跳び上がって、体重を乗せて真上から叩きつける。打ち上げた敵を追い打ちする重い一撃。
 * 着地で剣が床を叩く（小さな衝撃の輪）。打ち上げの受付（UPPER_HOLD_T）から続けて始まる（continueFrom）。
 * 0 → 0.1 膝を曲げて剣を引く / 0.1 → 0.18 跳び上がって頭上へ掲げる / 0.18 → 0.26 叩きつけて両足で着地（0.24 に最高速、0.26 に床を叩く）/ 0.26 → 0.42 保つ / 0.42 → 0.64 戻り。
 * ルートは 0.1 から 0.26 までに 0.9 m 前へ（跳び込み）。足は蹴るまで世界に固定 → 跳んでいるあいだ腰にぶら下がる → 両足で着地。
 */
export const COMBO_SLAM: AuthoredAttack = {
  name: 'comboSlam',
  duration: 0.64,
  continueFrom: { attack: COMBO_UPPER, t: UPPER_HOLD_T },
  keys: [
    // ---- ルート ----
    { t: 0.1, ease: 'lin', rootZ: 0 },
    { t: 0.18, ease: 'in', rootZ: 0.3 },
    { t: 0.26, ease: 'out', rootZ: 0.9 },
    { t: 0.1, ease: 'lin', footL: { arc: 0 }, footR: { arc: 0 } },
    { t: 0.14, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.7, lz: -0.02, knee: 0.4 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: 0.04, knee: 0.4 } },
    { t: 0.2, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.72, lz: 0.02, knee: 0.2 }, footR: { rel: 1, lx: -0.11, ly: -0.72, lz: 0.04, knee: 0.2 } },
    { t: 0.26, ease: 'io', footL: { rel: 0, z: 0.75, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 1.1, x: 0, lift: 0, pitch: 0 } },
    { t: 0.64, ease: 'io', footL: { z: 0.9 }, footR: { z: 0.9 } },
    // ---- 引く → 跳んで掲げる → 叩きつける → 保つ → 戻る ----
    ...pose(0.1, 'io', SLAM_GATHER),
    ...pose(0.17, 'out', SLAM_AIR),
    ...pose(0.23, 'in', SLAM_PASS),
    ...pose(0.28, 'out', SLAM_LAND),
    ...pose(0.42, 'lin', SLAM_LAND),
    ...pose(0.64, 'io', RETURN),
  ],
};
