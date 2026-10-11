import type { AuthoredAttack } from '../authoring';
import { FROM_STANCE, SP_DODGE, SP_DODGE_BACK, SP_FEET_Z, SP_READY, SP_TWO_HAND } from './spear';
import { pose } from './stagger';

/**
 * 槍の特殊な攻撃（スティックの向き・回避直後で出る）。両手持ち・右手が前（spear.ts）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 槍は長い（穂先が握りから 1.85m）ので、腰・胸が前へ倒れていると、前を向いた槍は下へ傾く（世界の仰角 ≒ 胸の座標の仰角 − 前傾）。前傾の分だけ穂先を上げて書く。
 * 足の z は技の開始時のルートからの前進量（構えは右足 +0.2・左足 −0.1。SP_FEET_Z）。
 */

type V3 = [number, number, number];

// ---------------------------------------------------------------- 踏み込み突き（スティック前）

/** 深い引き絞り: 腰を落として右手を腰の右へ大きく引く（体重は後ろ足）。穂先は敵へ向けたまま */
export const LUNGE_DRAW = {
  hips: { yaw: -12, pitch: 4, z: -0.08, y: -0.22 },
  chest: { yaw: -24, pitch: 2 },
  head: { yaw: 14 },
  grip: [-8, -34, 0.24] as V3,
  blade: [-0.4, 0.22, 0.89] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 突き切り: 体ごと飛び込んで、両腕を伸ばし、深く前へ倒れる（腰が低い）。穂先は胸の高さ */
export const LUNGE_THRUST = {
  hips: { yaw: -4, pitch: 12, z: 0.12, y: -0.22 },
  chest: { yaw: -10, pitch: 16 },
  head: { yaw: 8 },
  grip: [-4, -8, 0.47] as V3,
  blade: [-0.17, 0.3, 0.94] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.4, -0.9, 0] as V3,
};

/**
 * 踏み込み突き（スティック前 + 攻撃）: 腰を落として槍を引き絞り（0.2〜0.27 は一拍）、体ごと大きく踏み込んで貫く。槍の間合いのいちばん長い技（穂先は始点から 3.9m）。
 * 0 → 0.2 引き絞る / 0.27 → 0.36 飛び込んで突く（0.36 に最高速。右足は 0.36 に着地）/ 0.36 → 0.5 伸び切る / 0.5 → 0.66 保つ（次段の受付）/ 0.66 → 0.98 戻り。
 * 踏み込み: ルートは 0.2 から加速して 0.36 までに 1.2m、減速して 0.5 までに 1.5m。
 */
export const SP_LUNGE_HOLD_T = 0.5;

export const SP_LUNGE: AuthoredAttack = {
  name: 'spLunge',
  duration: 0.98,
  twoHanded: SP_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [
    // ---- 下半身 ----
    { t: 0.2, ease: 'lin', rootZ: 0 },
    { t: 0.36, ease: 'in', rootZ: 1.2 },
    { t: 0.5, ease: 'out', rootZ: 1.5 },
    { t: 0.2, ease: 'lin', footR: { z: SP_FEET_Z.R } },
    { t: 0.36, ease: 'io', footR: { z: 1.42, arc: 0.16 } },
    { t: 0.66, ease: 'lin', footR: { z: 1.42 } },
    { t: 0.98, ease: 'io', footR: { z: 1.5 + SP_FEET_Z.R, arc: 0.03 } },
    { t: 0.2, ease: 'lin', footL: { z: SP_FEET_Z.L } },
    { t: 0.36, ease: 'io', footL: { z: 0.62, arc: 0.1 } },
    { t: 0.5, ease: 'out', footL: { z: 1.05, arc: 0.06 } },
    { t: 0.66, ease: 'lin', footL: { z: 1.05 } },
    { t: 0.98, ease: 'io', footL: { z: 1.5 + SP_FEET_Z.L, arc: 0.08 } },
    // ---- 引き絞る → 突く → 伸び切る → 保つ → 戻る ----
    ...pose(0.2, 'io', LUNGE_DRAW),
    ...pose(0.27, 'lin', LUNGE_DRAW),
    ...pose(0.36, 'in', LUNGE_THRUST),
    ...pose(0.5, 'out', { ...LUNGE_THRUST, hips: { yaw: -5, pitch: 10, z: 0.1, y: -0.2 } }),
    ...pose(0.66, 'lin', { ...LUNGE_THRUST, hips: { yaw: -5, pitch: 10, z: 0.1, y: -0.2 } }),
    ...pose(0.98, 'io', SP_READY),
  ],
};

// ---------------------------------------------------------------- 跳び退き突き（ロック中にスティック後ろ）

/** 退く前の沈み: 腰を落として槍を体へ引き寄せ、突きの準備をする */
export const RETREAT_COIL = {
  hips: { yaw: -10, pitch: 4, z: -0.06, y: -0.2 },
  chest: { yaw: -20, pitch: 2 },
  head: { yaw: 12 },
  grip: [-6, -30, 0.26] as V3,
  blade: [-0.36, 0.24, 0.9] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 跳びながらの突き: 腰が浮いて体はほぼ起きたまま、腕を伸ばして穂先を前へ突き出す */
export const RETREAT_THRUST = {
  hips: { yaw: -4, pitch: 2, z: 0.04, y: 0.04 },
  chest: { yaw: -10, pitch: 4 },
  head: { yaw: 8 },
  grip: [-4, -4, 0.47] as V3,
  blade: [-0.17, 0.12, 0.98] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.4, -0.9, 0] as V3,
};

/**
 * 跳び退き突き（ロック中に後ろ + 攻撃）: 後ろへ 1.3m 跳びながら、穂先を前へ突き出して敵を押し返す（距離を取り直しながら間合いの外から当てる）。
 * 後ろステップ（dodge.ts の DODGE_BACK）と同じ足の作り（跳んでいるあいだ足は腰に付いてぶら下がり、着地で世界に固定）。
 * 0 → 0.12 沈む / 0.12 → 0.3 跳びながら突く（0.24 に穂先が最も伸びる）/ 0.3 → 0.38 着地 / 0.38 → 0.5 保つ / 0.5 → 0.82 戻り。ルートは 0.12 から 0.4 までに 1.3m 後ろへ（負）。
 */
export const SP_RETREAT_HOLD_T = 0.4;

export const SP_RETREAT: AuthoredAttack = {
  name: 'spRetreat',
  duration: 0.82,
  twoHanded: SP_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [
    // ---- ルート（後ろへ。負が後ろ） ----
    { t: 0.12, ease: 'lin', rootZ: 0 },
    { t: 0.18, ease: 'in', rootZ: -0.35 },
    { t: 0.32, ease: 'lin', rootZ: -1.18 },
    { t: 0.4, ease: 'out', rootZ: -1.3 },
    // ---- 足: 蹴るまで構えの位置 → 跳んでいるあいだは腰にぶら下がる → 着地で世界に固定（右足が前の構えへ） ----
    { t: 0.12, ease: 'lin', footL: { rel: 0, z: SP_FEET_Z.L, lift: 0 }, footR: { rel: 0, z: SP_FEET_Z.R, lift: 0 } },
    { t: 0.17, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.66, lz: -0.08, knee: 0 }, footR: { rel: 1, lx: -0.11, ly: -0.68, lz: 0, knee: 0 } },
    { t: 0.3, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.72, lz: 0.05, knee: 0 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 0 } },
    { t: 0.36, ease: 'io', footL: { rel: 0, z: -1.3 + SP_FEET_Z.L, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: -1.3 + SP_FEET_Z.R, x: 0, lift: 0, pitch: 0 } },
    { t: 0.82, ease: 'io', footL: { z: -1.3 + SP_FEET_Z.L }, footR: { z: -1.3 + SP_FEET_Z.R } },
    // ---- 体と槍: 沈む → 跳びながら突く → 着地 → 保つ → 戻る ----
    ...pose(0.12, 'io', RETREAT_COIL),
    ...pose(0.24, 'out', RETREAT_THRUST),
    ...pose(0.38, 'io', { ...RETREAT_THRUST, hips: { yaw: -5, pitch: 8, z: 0.06, y: -0.16 }, chest: { yaw: -10, pitch: 10 }, blade: [-0.17, 0.26, 0.95] }),
    ...pose(0.5, 'lin', { ...RETREAT_THRUST, hips: { yaw: -5, pitch: 8, z: 0.06, y: -0.16 }, chest: { yaw: -10, pitch: 10 }, blade: [-0.17, 0.26, 0.95] }),
    ...pose(0.82, 'io', SP_READY),
  ],
};

// ---------------------------------------------------------------- 回転薙ぎ（ロック中にスティック横）

/** 回転に入る前の巻き込み: 体を左へ大きくひねり、槍を左の後ろへ寝かせる。腰を深く沈める（跳び上がる前の溜め） */
export const SPIN_COIL = {
  hips: { yaw: -34, pitch: 8, z: 0, y: -0.26 },
  chest: { yaw: -60, pitch: 8 },
  head: { yaw: 18 },
  grip: [-8, -6, 0.38] as V3,
  blade: [-0.04, 0.06, 1] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 回転中の腕と槍（胸の座標で一定）: 槍は胸の正面へ水平に伸びる。体が回るあいだ、世界では穂先が水平の円を描く */
export const SPIN_ARMS = {
  grip: [-8, -4, 0.4] as V3,
  blade: [-0.04, 0.06, 1] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/**
 * 回転薙ぎ（ロック中に横 + 攻撃）: 腰を沈めて左へ巻き込み、跳び上がりながら体ごと右へ 1 回転して、槍で水平の円を描く（全方位を薙ぐ）。
 * 回転は腰・胸のヨーを 360° 回して作り、腕と槍は胸に対して一定（足は跳んでいるあいだ腰に付いて回る）。
 * 0 → 0.2 巻き込んで沈む / 0.2 → 0.46 跳び上がって回る（0.23〜0.43 に穂先が全周を通る）/ 0.46 → 0.56 着地して沈む / 0.56 → 0.64 保つ / 0.64 → 0.98 戻り。
 * ルートは 0.2 から 0.46 までに 0.5m 前へ。
 */
export const SP_SPIN: AuthoredAttack = {
  name: 'spSpin',
  duration: 0.98,
  twoHanded: SP_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [
    // ---- ルート ----
    { t: 0.2, ease: 'lin', rootZ: 0 },
    { t: 0.32, ease: 'in', rootZ: 0.2 },
    { t: 0.46, ease: 'out', rootZ: 0.5 },
    // ---- 足: 跳ぶまで構えの位置 → 腰に付いて回る（膝を曲げてぶら下がる）→ 着地で世界に固定 ----
    { t: 0.2, ease: 'lin', footL: { rel: 0, z: SP_FEET_Z.L, lift: 0 }, footR: { rel: 0, z: SP_FEET_Z.R, lift: 0 } },
    { t: 0.25, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.64, lz: 0.08, knee: 1 }, footR: { rel: 1, lx: -0.11, ly: -0.66, lz: -0.04, knee: 1 } },
    { t: 0.42, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.7, lz: 0.06, knee: 0.4 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 0.4 } },
    { t: 0.48, ease: 'io', footL: { rel: 0, z: 0.5 + SP_FEET_Z.L, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 0.5 + SP_FEET_Z.R, x: 0, lift: 0, pitch: 0 } },
    { t: 0.98, ease: 'io', footL: { z: 0.5 + SP_FEET_Z.L }, footR: { z: 0.5 + SP_FEET_Z.R } },
    // ---- 腰: 沈む（0.2 まで。巻き込みの姿勢）→ 跳ぶ → 着地で沈む → 立つ ----
    { t: 0.3, ease: 'out', hips: { y: 0.2 } },
    { t: 0.4, ease: 'lin', hips: { y: 0.16 } },
    { t: 0.5, ease: 'in', hips: { y: -0.2 } },
    { t: 0.64, ease: 'lin', hips: { y: -0.2 } },
    // ---- 体の回転（ヨー。腰・胸が右へ 360° 回る）と腕 ----
    ...pose(0.2, 'io', SPIN_COIL),
    { t: 0.3, ease: 'out', ...SPIN_ARMS },
    { t: 0.4, ease: 'lin', ...SPIN_ARMS, hips: { yaw: 326 }, chest: { yaw: 300 }, head: { yaw: 378 } },
    { t: 0.5, ease: 'out', hips: { yaw: 338, pitch: 10 }, chest: { yaw: 312, pitch: 12 }, head: { yaw: 372 } },
    { t: 0.64, ease: 'lin', hips: { yaw: 338, pitch: 10 }, chest: { yaw: 312, pitch: 12 }, head: { yaw: 372 } },
    // 戻り: 回転は 360° で元の向きに戻っているので、構えの姿勢の値は 360° 足したもの
    ...pose(0.98, 'io', { ...SP_READY, hips: { ...SP_READY.hips, yaw: SP_READY.hips.yaw + 360 }, chest: { ...SP_READY.chest, yaw: SP_READY.chest.yaw + 360 }, head: { yaw: SP_READY.head.yaw + 360 } }),
  ],
};

// ---------------------------------------------------------------- ロール直後の跳び突き

/** 跳ぶ前の溜め（ロールの着地から立ち上がりながら）: 槍を右肩の前へ引き上げる */
export const LEAP_GATHER = {
  hips: { yaw: -8, pitch: 6, z: -0.02, y: -0.26 },
  chest: { yaw: -16, pitch: 8 },
  head: { yaw: 10 },
  grip: [-8, 4, 0.34] as V3,
  blade: [-0.3, 0.1, 0.92] as V3,
  face: [-1, 0, 0] as V3,
  roll: -30,
  pole: [-0.55, -0.8, -0.1] as V3,
};

/** 空中: 槍を肩の高さへ構え、穂先を前下がりに敵へ向ける。体は反る（握りを肩より高く上げると手首が曲がりすぎるので、肩の高さまで） */
export const LEAP_TOP = {
  hips: { yaw: -10, pitch: -2, z: -0.02, y: 0.1 },
  chest: { yaw: -16, pitch: -6 },
  head: { yaw: 8 },
  grip: [-8, 10, 0.38] as V3,
  blade: [-0.27, -0.15, 0.9] as V3,
  face: [-1, 0, 0] as V3,
  roll: -60,
  pole: [-0.6, -0.78, -0.15] as V3,
};

/** 着地と突き下ろし: 深く沈んで前へ倒れ、穂先が体の前の低い所（斜め下）を貫く */
export const LEAP_STAB = {
  hips: { yaw: -4, pitch: 16, z: 0.1, y: -0.28 },
  chest: { yaw: -10, pitch: 24 },
  head: { yaw: 8 },
  grip: [-4, -6, 0.47] as V3,
  blade: [-0.1, 0.05, 1] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.4, -0.9, -0.1] as V3,
};

/**
 * 跳び突き（ロール直後に攻撃）: 転がって着地した低い姿勢から、槍を引き上げて前へ高く跳び、体重を乗せて斜め下へ突き刺す。ロールで間合いを詰めて一撃を入れる技。
 * ロールの着地の姿勢（0.43s）から続けて始まる（continueFrom）。
 * 0 → 0.15 立ち上がりながら引き上げる / 0.15 → 0.3 跳んで構える / 0.3 → 0.36 突き下ろして両足で着地（0.34 に最高速。当たりは 0.3〜0.4）/ 0.36 → 0.56 保つ / 0.56 → 0.92 戻り。
 * ルートは 0.15 から 0.36 までに 1.5m 前へ（跳び込み）。
 */
export const SP_DASH: AuthoredAttack = {
  name: 'spDash',
  duration: 0.92,
  twoHanded: SP_TWO_HAND,
  continueFrom: { attack: SP_DODGE, t: 0.43 },
  keys: [
    // ---- ルート ----
    { t: 0.15, ease: 'lin', rootZ: 0 },
    { t: 0.25, ease: 'in', rootZ: 0.5 },
    { t: 0.36, ease: 'out', rootZ: 1.5 },
    // ---- 足: ロールの着地の位置 → 跳ぶあいだは腰にぶら下がる → 両足で着地（右足が前の構えへ） ----
    { t: 0.15, ease: 'lin', footL: { rel: 0, z: 0.2, lift: 0 }, footR: { rel: 0, z: -0.05, lift: 0 } },
    { t: 0.2, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.66, lz: 0.06, knee: 0.6 }, footR: { rel: 1, lx: -0.11, ly: -0.68, lz: -0.04, knee: 0.6 } },
    { t: 0.3, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.74, lz: 0.1, knee: 0.1 }, footR: { rel: 1, lx: -0.11, ly: -0.72, lz: 0, knee: 0.1 } },
    { t: 0.36, ease: 'io', footL: { rel: 0, z: 1.5 + SP_FEET_Z.L, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 1.5 + SP_FEET_Z.R + 0.1, x: 0, lift: 0, pitch: 0 } },
    { t: 0.92, ease: 'io', footL: { z: 1.5 + SP_FEET_Z.L }, footR: { z: 1.5 + SP_FEET_Z.R } },
    // ---- 引き上げる → 跳んで構える → 突き下ろす → 保つ → 戻る ----
    ...pose(0.15, 'io', LEAP_GATHER),
    ...pose(0.28, 'out', LEAP_TOP),
    ...pose(0.36, 'in', LEAP_STAB),
    ...pose(0.56, 'lin', LEAP_STAB),
    ...pose(0.92, 'io', SP_READY),
  ],
};

// ---------------------------------------------------------------- 後ろステップ直後の突き上げ

/** 低く構えた引き絞り（着地した低い姿勢から）: 槍を腰の右の低い所へ引き、穂先を前下がりに向ける */
export const RISE_COIL = {
  hips: { yaw: -10, pitch: 12, z: -0.02, y: -0.28 },
  chest: { yaw: -22, pitch: 14 },
  head: { yaw: 12 },
  grip: [-8, -46, 0.28] as V3,
  blade: [-0.3, -0.12, 0.95] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.55, -0.8, -0.1] as V3,
};

/** 突き上げの終わり: 体は反り、槍は斜め上（前上がり 45° 前後）へ伸びる */
export const RISE_END = {
  hips: { yaw: -4, pitch: -6, z: 0.05, y: -0.1 },
  chest: { yaw: -10, pitch: -8 },
  head: { yaw: 8 },
  grip: [-6, 14, 0.47] as V3,
  blade: [-0.26, 0.72, 0.64] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.4, -0.85, 0] as V3,
};

/**
 * 突き上げ（後ろステップ直後に攻撃）: 下がって間合いを取ったあと、低い姿勢から踏み込んで、槍を下から斜め上へ突き上げる。逆襲の技。
 * 後ろステップの着地の姿勢（0.36s）から続けて始まる（continueFrom）。
 * 0 → 0.14 低く引き絞る / 0.14 → 0.23 突き上げる（0.23 に穂先が最も伸びる。右足は 0.23 に着地）/ 0.23 → 0.34 伸び切る / 0.34 → 0.5 保つ / 0.5 → 0.86 戻り。
 * ルートは 0.06 から 0.23 までに 0.6m、減速して 0.38 までに 1.0m。
 */
export const SP_RISE_HOLD_T = 0.38;

export const SP_RISE: AuthoredAttack = {
  name: 'spRise',
  duration: 0.86,
  twoHanded: SP_TWO_HAND,
  continueFrom: { attack: SP_DODGE_BACK, t: 0.36 },
  keys: [
    // ---- 下半身 ----
    { t: 0.06, ease: 'lin', rootZ: 0 },
    { t: 0.23, ease: 'in', rootZ: 0.6 },
    { t: 0.38, ease: 'out', rootZ: 1.0 },
    { t: 0.05, ease: 'lin', footR: { z: 0 } },
    { t: 0.23, ease: 'io', footR: { z: 0.95, arc: 0.14 } },
    { t: 0.5, ease: 'lin', footR: { z: 0.95 } },
    { t: 0.86, ease: 'io', footR: { z: 1.0 + SP_FEET_Z.R, arc: 0.03 } },
    { t: 0.2, ease: 'lin', footL: { z: 0 } },
    { t: 0.38, ease: 'out', footL: { z: 0.55, arc: 0.07 } },
    { t: 0.5, ease: 'lin', footL: { z: 0.55 } },
    { t: 0.86, ease: 'io', footL: { z: 1.0 + SP_FEET_Z.L, arc: 0.1 } },
    // ---- 引き絞る → 突き上げる → 伸び切る → 保つ → 戻る ----
    ...pose(0.14, 'io', RISE_COIL),
    ...pose(0.23, 'in', RISE_END),
    ...pose(0.34, 'out', RISE_END),
    ...pose(0.5, 'lin', RISE_END),
    ...pose(0.86, 'io', SP_READY),
  ],
};
