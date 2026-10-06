import type { AuthoredAttack } from '../authoring';
import { FROM_STANCE, SP_FEET_Z, SP_READY, SP_TWO_HAND } from './spear';
import { pose } from './stagger';

/**
 * 槍の通常攻撃（突き → 二段突き → 薙ぎ払い）。両手持ち・右手が前（spear.ts）。座標の約束は combo1.ts と同じ（胸の座標系。右 = −X、上 = +Y、前 = +Z）。
 * 素早く間合いが長い: 予備動作は短く（0.1 秒）、右手を腰へ引いてから腕を伸ばして突く。腰・胸が前へ倒れるので、刃は胸の座標でやや上向きに書いて、世界では水平に近く突く。
 * 足は右足が前の構え（SP_FEET_Z）。突くときに右足を踏み出して着地し、左足が追って構えへ戻る（技のあいだ、ルートは前へ進む。足の z は技の開始時のルートからの前進量）。
 */

type V3 = [number, number, number];

/** 引き絞り: 右手を腰の右へ引き、体を少し沈めて右へ戻す（体重は後ろ足）。穂先は敵へ向けたまま */
export const DRAW = {
  hips: { yaw: -10, pitch: 2, z: -0.06, y: -0.1 },
  chest: { yaw: -20, pitch: 0 },
  head: { yaw: 12 },
  grip: [-6, -30, 0.26] as V3,
  blade: [-0.36, 0.2, 0.91] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 突き出し: 右腕が前へ伸び、腰・胸が前へ倒れて穂先が体の前を真っ直ぐ貫く（世界では水平） */
export const THRUST = {
  hips: { yaw: -6, pitch: 9, z: 0.08, y: -0.16 },
  chest: { yaw: -14, pitch: 12 },
  head: { yaw: 10 },
  grip: [-5, -8, 0.46] as V3,
  blade: [-0.26, 0.26, 0.93] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.45, -0.85, 0] as V3,
};

/**
 * 1 段目: 突き（0.62s）。0 → 0.1 引き絞る / 0.1 → 0.19 突き出す（0.19 に穂先が最も伸びる。右足は 0.19 に着地）/ 0.19 → 0.3 伸びたまま保つ（次段の受付）/ 0.3 → 0.62 構えへ戻る。
 * ルートは 0.1 から加速して 0.2 までに 0.45m（以降は止める）。
 */
export const SP1: AuthoredAttack = {
  name: 'sp1',
  duration: 0.62,
  twoHanded: SP_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [
    // ---- 下半身 ----
    { t: 0.1, ease: 'lin', rootZ: 0 },
    { t: 0.2, ease: 'out', rootZ: 0.45 },
    { t: 0.06, ease: 'lin', footR: { z: SP_FEET_Z.R } },
    { t: 0.19, ease: 'io', footR: { z: 0.68, arc: 0.12 } },
    { t: 0.34, ease: 'lin', footR: { z: 0.68 } },
    { t: 0.62, ease: 'io', footR: { z: 0.45 + SP_FEET_Z.R, arc: 0.02 } },
    { t: 0.1, ease: 'lin', footL: { z: SP_FEET_Z.L } },
    { t: 0.3, ease: 'io', footL: { z: 0.1, arc: 0.06 } },
    { t: 0.62, ease: 'io', footL: { z: 0.45 + SP_FEET_Z.L, arc: 0.04 } },
    // ---- 引き絞る → 突く → 保つ → 戻る ----
    ...pose(0.1, 'io', DRAW),
    ...pose(0.19, 'in', THRUST),
    ...pose(0.3, 'lin', THRUST),
    ...pose(0.62, 'io', SP_READY),
  ],
};

// ---------------------------------------------------------------- 2 段目: 二段突き

/** 2 段目の引き: 1 段目の突き切った姿勢（右足が前に出たまま）から、右手を腰へ素早く引き戻す。穂先は少し上へ（顔の高さを狙う） */
export const DRAW2 = {
  hips: { yaw: -9, pitch: 3, z: -0.02, y: -0.12 },
  chest: { yaw: -18, pitch: 2 },
  head: { yaw: 12 },
  grip: [-6, -20, 0.28] as V3,
  blade: [-0.34, 0.34, 0.88] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 2 段目の突き出し: 1 段目より高く（上半身を起こし気味に）、腕をいっぱいに伸ばす */
export const THRUST2 = {
  hips: { yaw: -5, pitch: 8, z: 0.06, y: -0.14 },
  chest: { yaw: -12, pitch: 11 },
  head: { yaw: 9 },
  grip: [-5, 4, 0.47] as V3,
  blade: [-0.24, 0.36, 0.9] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.45, -0.85, 0] as V3,
};

/**
 * 2 段目: 二段突き（0.55s）。1 段目の受付時点（0.3s。突き切った姿勢）から続けて始まる。0 → 0.1 引く / 0.1 → 0.17 突き出す（0.17 に最も伸びる）/ 0.17 → 0.27 保つ（次段の受付）/ 0.27 → 0.55 構えへ戻る。
 * 踏み込み: ルートは 0.07 から 0.15 までに 0.32m。右足が弧を描いて前へ着地し（0.17）、左足が追って、構えの足の幅へ戻る。
 */
export const SP2: AuthoredAttack = {
  name: 'sp2',
  duration: 0.55,
  twoHanded: SP_TWO_HAND,
  continueFrom: { attack: SP1, t: 0.3 },
  keys: [
    // ---- 下半身（足の z はこの技の開始時のルートからの前進量。1 段目の保持の終わりは右足 0.23、左足 −0.35） ----
    { t: 0.07, ease: 'lin', rootZ: 0 },
    { t: 0.15, ease: 'out', rootZ: 0.32 },
    { t: 0.06, ease: 'lin', footR: { z: 0.23 } },
    { t: 0.17, ease: 'io', footR: { z: 0.55, arc: 0.1 } },
    { t: 0.33, ease: 'lin', footR: { z: 0.55 } },
    { t: 0.55, ease: 'io', footR: { z: 0.32 + SP_FEET_Z.R, arc: 0.02 } },
    { t: 0.08, ease: 'lin', footL: { z: -0.35 } },
    { t: 0.27, ease: 'io', footL: { z: -0.05, arc: 0.06 } },
    { t: 0.55, ease: 'io', footL: { z: 0.32 + SP_FEET_Z.L, arc: 0.04 } },
    // ---- 引く → 突く → 保つ → 戻る ----
    ...pose(0.1, 'io', DRAW2),
    ...pose(0.17, 'in', THRUST2),
    ...pose(0.27, 'lin', THRUST2),
    ...pose(0.55, 'io', SP_READY),
  ],
};

// ---------------------------------------------------------------- 3 段目: 薙ぎ払い

/**
 * 薙ぎ払いの腕: 槍は胸の正面へ水平に伸ばしたまま（胸の座標で一定）。体を左から右へひねり回すことで、世界では穂先が体の前を左 → 右へ大きく払う。
 * 右手が前・左手が後ろなので、穂先が右へ回るときも左手は体の左側に収まる（左 → 右の向きなら、後ろの手が右手より内側へ交差しない）。
 */
const SWEEP_ARMS = {
  grip: [-8, -6, 0.38] as V3,
  blade: [-0.04, 0.1, 0.99] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 巻き込み: 体を左へ大きくひねって（穂先は左前へ向く）、腰を沈めて溜める */
export const SWEEP_COIL = {
  hips: { yaw: -30, pitch: 4, z: -0.04, y: -0.14 },
  chest: { yaw: -50, pitch: 4 },
  head: { yaw: 30 },
  ...SWEEP_ARMS,
};

/** 払いの途中（体の正面を通る最高速）: 腰・胸は正面を向き、穂先が体の前を通る */
export const SWEEP_PASS = {
  hips: { yaw: -2, pitch: 6, z: 0.04, y: -0.18 },
  chest: { yaw: -2, pitch: 8 },
  head: { yaw: 2 },
  ...SWEEP_ARMS,
};

/** 払い切り: 体は右へひねり切り、穂先は右前へ流れる */
export const SWEEP_END = {
  hips: { yaw: 24, pitch: 8, z: 0.05, y: -0.16 },
  chest: { yaw: 46, pitch: 8 },
  head: { yaw: -22 },
  ...SWEEP_ARMS,
};

/**
 * 3 段目: 薙ぎ払い（0.82s）。2 段目の受付時点（0.27s）の姿勢から続けて始まる。0 → 0.18 左へ巻き込んで沈む / 0.18 → 0.3 体を回して払う（0.24 に穂先が体の前を通る最高速。左足は 0.24 に着地）/
 * 0.3 → 0.4 右へ払い切る / 0.4 → 0.5 保つ / 0.5 → 0.82 構えへ戻る（コンボの終わり。硬直は長め）。
 * 踏み込み: ルートは 0.1 から 0.24 までに 0.35m。左足が前へ踏み込んで着地し、右足は構えの位置へ寄る。
 */
export const SP3: AuthoredAttack = {
  name: 'sp3',
  duration: 0.82,
  twoHanded: SP_TWO_HAND,
  continueFrom: { attack: SP2, t: 0.27 },
  keys: [
    // ---- 下半身（2 段目の保持の終わりは右足 0.23、左足 −0.37） ----
    { t: 0.1, ease: 'lin', rootZ: 0 },
    { t: 0.24, ease: 'out', rootZ: 0.35 },
    { t: 0.3, ease: 'lin', footR: { z: 0.23 } },
    { t: 0.82, ease: 'io', footR: { z: 0.35 + SP_FEET_Z.R, arc: 0.03 } },
    { t: 0.1, ease: 'lin', footL: { z: -0.37 } },
    { t: 0.24, ease: 'io', footL: { z: 0.35, arc: 0.14 } },
    { t: 0.5, ease: 'lin', footL: { z: 0.35 } },
    { t: 0.82, ease: 'io', footL: { z: 0.35 + SP_FEET_Z.L, arc: 0.04 } },
    // ---- 巻き込む → 払う → 払い切る → 保つ → 戻る ----
    ...pose(0.18, 'io', SWEEP_COIL),
    ...pose(0.24, 'in', SWEEP_PASS),
    ...pose(0.32, 'out', SWEEP_END),
    ...pose(0.5, 'lin', SWEEP_END),
    ...pose(0.82, 'io', SP_READY),
  ],
};
