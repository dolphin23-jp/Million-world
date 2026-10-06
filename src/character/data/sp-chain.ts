import type { AuthoredAttack } from '../authoring';
import { SP1, SP3, SWEEP_COIL, SWEEP_END, SWEEP_PASS } from './sp-combo';
import { LUNGE_THRUST } from './sp-moves';
import { SP_FEET_Z, SP_READY, SP_TWO_HAND } from './spear';
import { pose } from './stagger';

/**
 * 槍の連携の続き（ADR-049）。座標の約束は combo1.ts と同じ（胸の座標系）。どの技も、前の技の受付時点の姿勢から続けて始まる（continueFrom）。
 *  - sp1 の受付で横へ倒して押す → 払い上げ（spUpper）
 *  - sp3（薙ぎ払い）の受付で前へ倒して押す → 貫き突き（spPierce）→ 続けて押すと 回し払い（spTwirl）。突き → 二段突き → 薙ぎ払い → 貫き突き → 回し払いで 5 連
 * 足の z は技の開始時のルートからの前進量。突き（sp1）の保持の終わりは右足 +0.23・左足 −0.35（左が後ろに残る幅広い構え）。薙ぎ払い（sp3）の受付の時刻（0.5s）は両足がそろう（右 −0.014・左 0）。
 */

type V3 = [number, number, number];

// ---------------------------------------------------------------- 払い上げ（1 段目の受付で横）

/** 巻き込み: 体を左へ大きくひねり、穂先を左前の低い所へ向ける（払い上げの溜め） */
const UPPER_COIL = {
  hips: { yaw: -26, pitch: 8, z: -0.02, y: -0.22 },
  chest: { yaw: -44, pitch: 8 },
  head: { yaw: 26 },
  grip: [-6, -24, 0.34] as V3,
  blade: [0, -0.28, 0.96] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 払い上げの途中（体の正面を通る最高速）: 腰・胸は正面を向き、穂先が体の前を下から上へ通る */
const UPPER_PASS = {
  hips: { yaw: -2, pitch: 6, z: 0.04, y: -0.18 },
  chest: { yaw: -2, pitch: 6 },
  head: { yaw: 2 },
  grip: [-8, -6, 0.42] as V3,
  blade: [-0.05, 0.12, 1] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 払い上げの終わり: 体は右へひねり切って反り、穂先は右前の上へ抜ける */
const UPPER_END = {
  hips: { yaw: 22, pitch: -4, z: 0.04, y: -0.14 },
  chest: { yaw: 40, pitch: -6 },
  head: { yaw: -20 },
  grip: [-8, 18, 0.4] as V3,
  blade: [-0.2, 0.55, 0.8] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.45, -0.85, 0] as V3,
};

/**
 * 払い上げ（1 段目の受付で横へ倒して攻撃）: 左へ巻き込んだ穂先を、体を回しながら下から右上へすくい上げる。1 段目の突き切った姿勢（0.3s）から続けて始まる（continueFrom）。
 * 0 → 0.2 巻き込んで沈む / 0.2 → 0.3 払い上げる（0.26 に穂先が体の前を通る最高速。左足は 0.26 に着地）/ 0.3 → 0.4 右上へ抜ける / 0.4 → 0.52 保つ / 0.52 → 0.84 戻り。
 * ルートは 0.12 から 0.26 までに 0.3m。
 */
export const SP_UPPER: AuthoredAttack = {
  name: 'spUpper',
  duration: 0.84,
  twoHanded: SP_TWO_HAND,
  continueFrom: { attack: SP1, t: 0.3 },
  keys: [
    // ---- 下半身（1 段目の保持の終わりは右足 0.23、左足 −0.35。ルートは 0.45m 進んでいる） ----
    { t: 0.12, ease: 'lin', rootZ: 0 },
    { t: 0.26, ease: 'out', rootZ: 0.3 },
    { t: 0.3, ease: 'lin', footR: { z: 0.23 } },
    { t: 0.84, ease: 'io', footR: { z: 0.3 + SP_FEET_Z.R, arc: 0.03 } },
    { t: 0.12, ease: 'lin', footL: { z: -0.35 } },
    { t: 0.26, ease: 'io', footL: { z: 0.3, arc: 0.14 } },
    { t: 0.52, ease: 'lin', footL: { z: 0.3 } },
    { t: 0.84, ease: 'io', footL: { z: 0.3 + SP_FEET_Z.L, arc: 0.04 } },
    // ---- 巻き込む → 払い上げる → 抜ける → 保つ → 戻る ----
    ...pose(0.2, 'io', UPPER_COIL),
    ...pose(0.26, 'in', UPPER_PASS),
    ...pose(0.34, 'out', UPPER_END),
    ...pose(0.52, 'lin', UPPER_END),
    ...pose(0.84, 'io', SP_READY),
  ],
};

// ---------------------------------------------------------------- 貫き突き（2 段目の受付で前）

/** 貫き突きの引き: 薙ぎ払いを払い切った姿勢（右へひねり切り）から、右手を腰の後ろまで深く引いて体を左へ戻し、沈める（次の一撃のための溜め） */
const PIERCE_DRAW = {
  hips: { yaw: -10, pitch: 4, z: -0.08, y: -0.22 },
  chest: { yaw: -22, pitch: 2 },
  head: { yaw: 14 },
  grip: [-8, -34, 0.24] as V3,
  blade: [-0.4, 0.22, 0.89] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 貫き突きの保持（突き切った姿勢）。次段（回し払い）の受付の姿勢 */
const PIERCE_HOLD = { ...LUNGE_THRUST, hips: { yaw: -5, pitch: 10, z: 0.1, y: -0.2 } };

/** 貫き突きが次段を受け付ける時刻（突き切った姿勢を保つ 0.36〜0.46。AttackDef.cancelAt と同じ） */
export const SP_PIERCE_HOLD_T = 0.36;

/**
 * 貫き突き（3 段目の受付で前へ倒して攻撃）: 薙ぎ払いのあと、深く引き絞って体ごと踏み込み、全体重を乗せて貫く。3 段目の払い切った姿勢（0.5s）から続けて始まる（continueFrom）。
 * 0 → 0.14 深く引き絞る / 0.14 → 0.23 踏み込んで突く（0.23 に最高速。右足は 0.23 に着地）/ 0.23 → 0.36 伸び切る / 0.36 → 0.46 保つ（次段の受付）/ 0.46 → 0.8 戻り。
 * ルートは 0.08 から加速して 0.23 までに 0.75m、減速して 0.32 までに 0.9m。
 */
export const SP_PIERCE: AuthoredAttack = {
  name: 'spPierce',
  duration: 0.8,
  twoHanded: SP_TWO_HAND,
  continueFrom: { attack: SP3, t: 0.5 },
  keys: [
    // ---- 下半身（3 段目の受付の時刻は両足がそろう: 右 −0.014、左 0） ----
    { t: 0.08, ease: 'lin', rootZ: 0 },
    { t: 0.23, ease: 'in', rootZ: 0.75 },
    { t: 0.32, ease: 'out', rootZ: 0.9 },
    { t: 0.1, ease: 'lin', footR: { z: -0.014 } },
    { t: 0.23, ease: 'io', footR: { z: 0.95, arc: 0.14 } },
    { t: 0.46, ease: 'lin', footR: { z: 0.95 } },
    { t: 0.8, ease: 'io', footR: { z: 0.9 + SP_FEET_Z.R, arc: 0.03 } },
    { t: 0.1, ease: 'lin', footL: { z: 0 } },
    { t: 0.32, ease: 'io', footL: { z: 0.35, arc: 0.1 } },
    { t: 0.46, ease: 'lin', footL: { z: 0.35 } },
    { t: 0.8, ease: 'io', footL: { z: 0.9 + SP_FEET_Z.L, arc: 0.08 } },
    // ---- 引き絞る → 突く → 伸び切る → 保つ → 戻る ----
    ...pose(0.14, 'io', PIERCE_DRAW),
    ...pose(0.23, 'in', LUNGE_THRUST),
    ...pose(0.36, 'out', PIERCE_HOLD),
    ...pose(0.46, 'lin', PIERCE_HOLD),
    ...pose(0.8, 'io', SP_READY),
  ],
};

// ---------------------------------------------------------------- 回し払い（貫き突きの受付）

/**
 * 回し払い（貫き突きの受付で攻撃）: 突き切った槍を引き戻しながら体を左へひねり、そのまま右へ速く薙ぎ払う。貫き突きの姿勢（0.36s）から続けて始まる（continueFrom）。
 * 0 → 0.14 引き戻して左へ巻く / 0.14 → 0.2 払う（0.18 に穂先が体の前を通る最高速）/ 0.2 → 0.28 右へ抜ける / 0.28 → 0.36 保つ / 0.36 → 0.7 戻り（コンボの終わり）。
 * ルートは 0.06 から 0.18 までに 0.25m。左足が前へ着地する。
 */
export const SP_TWIRL: AuthoredAttack = {
  name: 'spTwirl',
  duration: 0.7,
  twoHanded: SP_TWO_HAND,
  continueFrom: { attack: SP_PIERCE, t: SP_PIERCE_HOLD_T },
  keys: [
    // ---- 下半身（貫き突きの保持の終わりは右足 0.05、左足 −0.55。ルートは 0.9m 進んでいる） ----
    { t: 0.06, ease: 'lin', rootZ: 0 },
    { t: 0.18, ease: 'out', rootZ: 0.25 },
    { t: 0.24, ease: 'lin', footR: { z: 0.05 } },
    { t: 0.7, ease: 'io', footR: { z: 0.25 + SP_FEET_Z.R, arc: 0.03 } },
    { t: 0.06, ease: 'lin', footL: { z: -0.55 } },
    { t: 0.18, ease: 'io', footL: { z: 0.25, arc: 0.14 } },
    { t: 0.36, ease: 'lin', footL: { z: 0.25 } },
    { t: 0.7, ease: 'io', footL: { z: 0.25 + SP_FEET_Z.L, arc: 0.04 } },
    // ---- 引き戻して巻く → 払う → 抜ける → 保つ → 戻る ----
    ...pose(0.14, 'io', { ...SWEEP_COIL, hips: { yaw: -22, pitch: 6, z: -0.02, y: -0.16 }, chest: { yaw: -40, pitch: 6 }, head: { yaw: 24 } }),
    ...pose(0.18, 'in', SWEEP_PASS),
    ...pose(0.24, 'out', { ...SWEEP_END, hips: { yaw: 18, pitch: 8, z: 0.05, y: -0.16 }, chest: { yaw: 36, pitch: 8 }, head: { yaw: -18 } }),
    ...pose(0.36, 'lin', { ...SWEEP_END, hips: { yaw: 18, pitch: 8, z: 0.05, y: -0.16 }, chest: { yaw: 36, pitch: 8 }, head: { yaw: -18 } }),
    ...pose(0.7, 'io', SP_READY),
  ],
};
