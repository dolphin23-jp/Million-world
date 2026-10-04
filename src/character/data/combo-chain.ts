import type { AuthoredAttack } from '../authoring';
import { COMBO1 } from './combo1';
import { COMBO2, FOLLOW as FOLLOW2 } from './combo2';
import { COMBO3 } from './combo3';
import { plane } from './cutting-plane';
import { OFFHAND } from './offhand';
import { pose } from './stagger';

/**
 * 片手剣のコンボの分岐の技（ADR-023）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 受付（前の技の振り抜きの姿勢を保っている間）に、スティックを倒して攻撃を押すと続く。1 段目 → 後ろ: 跳び退き斬り上げ / 2 段目 → 横（ロック中）: 回転斬り / 3 段目 → 前: 打ち上げ。
 * 盾を持つとき（左腕を盾の位置に固定して焼く版）は左手のキーが使われない。
 */

type V3 = [number, number, number];
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

// ---------------------------------------------------------------- 跳び退き斬り上げ（1 段目の受付で後ろへ倒して攻撃）

/** 低い引き込み: 1 段目の振り抜き（左前下）からさらに剣を左の低い所へ引き、腰を沈めて跳ぶ構えに入る */
const HOP_COIL = {
  hips: { yaw: -22, pitch: 10, z: 0.03, y: -0.17 },
  chest: { yaw: -38, pitch: 16 },
  head: { yaw: -14 },
  grip: [-58, -40, 0.4] as V3,
  ...plane(-84),
  roll: -15,
  pole: [-0.5, -0.8, 0] as V3,
  ...OFFHAND.hip,
};

/** 斬り上げの途中（体の前を通る最高速）: 左下から前を通って右上へ。後ろへ跳びながら、体は少し反る */
const HOP_PASS = {
  hips: { yaw: -2, pitch: -6, z: -0.02, y: 0.08 },
  chest: { yaw: 0, pitch: -6 },
  head: { yaw: 0 },
  grip: [6, 10, 0.46] as V3,
  ...plane(6),
  roll: -20,
  pole: [-0.35, -0.9, -0.15] as V3,
  ...OFFHAND.pull,
};

/**
 * 跳び退き斬り上げ（1 段目の受付で、ロック中にスティックを後ろへ倒して攻撃）: 左前下へ振り抜いた剣を引き込み、後ろへ跳びながら左下から右上へ斬り上げる。
 * 間合いを取り直しながら敵を押し返す、安全な逆襲。1 段目の受付時点（0.37s）の姿勢から続けて始まる（continueFrom）。
 * 0 → 0.09 引き込んで沈む / 0.09 → 0.24 跳びながら斬り上げる（0.17 に前を通る最高速）/ 0.24 → 0.3 右上へ抜けて着地 / 0.3 → 0.4 保つ / 0.4 → 0.6 戻り。
 * ルートは 0.09 から 0.32 までに 1.0 m 後ろへ（負）。足は蹴るまで世界に固定 → 跳んでいるあいだ腰にぶら下がる → 着地で世界に固定。
 */
export const COMBO_HOP: AuthoredAttack = {
  name: 'comboHop',
  duration: 0.6,
  continueFrom: { attack: COMBO1, t: 0.37 },
  keys: [
    // ---- ルート（後ろへ。負が後ろ） ----
    { t: 0.09, ease: 'lin', rootZ: 0 },
    { t: 0.15, ease: 'in', rootZ: -0.25 },
    { t: 0.26, ease: 'lin', rootZ: -0.9 },
    { t: 0.32, ease: 'out', rootZ: -1.0 },
    // ---- 足（開始時は 1 段目の終わりの位置: 左足 0、右足 −0.12）----
    { t: 0.09, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: -0.12, lift: 0 } },
    { t: 0.14, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.66, lz: -0.06, knee: 0 }, footR: { rel: 1, lx: -0.11, ly: -0.68, lz: 0, knee: 0 } },
    { t: 0.22, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.72, lz: 0.05, knee: 0 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 0 } },
    { t: 0.28, ease: 'io', footL: { rel: 0, z: -0.9, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: -1.05, x: 0, lift: 0, pitch: 0 } },
    { t: 0.6, ease: 'io', footL: { z: -1.0 }, footR: { z: -1.0 } },
    // ---- 引き込む → 斬り上げる → 抜ける → 保つ → 戻る ----
    ...pose(0.09, 'io', HOP_COIL),
    ...pose(0.17, 'in', HOP_PASS),
    ...pose(0.26, 'out', { ...FOLLOW2, hips: { yaw: 12, pitch: 4, z: 0.02, y: -0.1 } }),
    ...pose(0.4, 'lin', { ...FOLLOW2, hips: { yaw: 12, pitch: 4, z: 0.02, y: -0.1 } }),
    ...pose(0.6, 'io', RETURN),
  ],
};

// ---------------------------------------------------------------- 回転斬り（2 段目の受付で横へ倒して攻撃）

/** 回転の溜め: 2 段目の振り抜き（右上）からさらに右へ巻き込み、腰を沈める。剣は右へ水平に寝かせる */
const SPIN_COIL = {
  hips: { yaw: 24, pitch: 8, z: 0.02, y: -0.2 },
  chest: { yaw: 48, pitch: 8 },
  head: { yaw: 12 },
  grip: [14, 0, 0.4] as V3,
  ...plane(76, 0),
  roll: -75,
  pole: [-0.6, -0.8, 0.1] as V3,
  ...OFFHAND.guard,
};

/** 回転中の腕と剣（胸の座標で一定）: 剣は体の右前へ水平に伸びる。左へ回るので、剣は正面 → 左 → 後ろ → 右と円を描く（左手は脇） */
const SPIN_ARMS = {
  grip: [6, 2, 0.44] as V3,
  ...plane(62, 0),
  roll: -75,
  pole: [-0.5, -0.8, 0.1] as V3,
  ...OFFHAND.hip,
};

/**
 * 回転斬り（2 段目の受付で、ロック中にスティックを横へ倒して攻撃）: 右上へ振り抜いた体を、そのまま右へ巻き込んで沈み、跳び上がって体ごと左へ 1 回転しながら水平の円を描く。
 * 全方位を薙ぐ（片手剣の広い技）。2 段目の受付時点（0.34s）の姿勢から続けて始まる（continueFrom）。
 * 0 → 0.12 巻き込んで沈む / 0.12 → 0.34 跳び上がって回る（0.16〜0.32 に剣が全周を通る）/ 0.34 → 0.42 着地して沈む / 0.42 → 0.5 保つ / 0.5 → 0.8 戻り。
 * ルートは 0.12 から 0.34 までに 0.5 m 前へ。足は跳ぶまで世界に固定 → 腰に付いて回る → 着地で世界に固定。
 */
export const COMBO_SPIN: AuthoredAttack = {
  name: 'comboSpin',
  duration: 0.8,
  continueFrom: { attack: COMBO2, t: 0.34 },
  keys: [
    // ---- ルート ----
    { t: 0.12, ease: 'lin', rootZ: 0 },
    { t: 0.24, ease: 'in', rootZ: 0.2 },
    { t: 0.34, ease: 'out', rootZ: 0.5 },
    // ---- 足（開始時は 2 段目の終わりの位置: 左足 −0.38、右足 0.2）----
    { t: 0.12, ease: 'lin', footL: { rel: 0, z: -0.38, lift: 0 }, footR: { rel: 0, z: 0.2, lift: 0 } },
    { t: 0.16, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.64, lz: 0.06, knee: 1 }, footR: { rel: 1, lx: -0.11, ly: -0.66, lz: -0.04, knee: 1 } },
    { t: 0.3, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.7, lz: 0.06, knee: 0.4 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 0.4 } },
    { t: 0.36, ease: 'io', footL: { rel: 0, z: 0.55, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 0.4, x: 0, lift: 0, pitch: 0 } },
    { t: 0.8, ease: 'io', footL: { z: 0.5 }, footR: { z: 0.5 } },
    // ---- 腰: 沈む（0.12）→ 跳ぶ → 着地で沈む → 立つ ----
    { t: 0.22, ease: 'out', hips: { y: 0.18 } },
    { t: 0.3, ease: 'lin', hips: { y: 0.14 } },
    { t: 0.38, ease: 'in', hips: { y: -0.18 } },
    { t: 0.5, ease: 'lin', hips: { y: -0.18 } },
    // ---- 体の回転（ヨー。腰・胸が 360° 左へ回る）と腕 ----
    ...pose(0.12, 'io', SPIN_COIL),
    { t: 0.2, ease: 'out', ...SPIN_ARMS },
    { t: 0.32, ease: 'lin', ...SPIN_ARMS, hips: { yaw: -336 }, chest: { yaw: -312 }, head: { yaw: -348 } },
    { t: 0.4, ease: 'out', hips: { yaw: -348, pitch: 10 }, chest: { yaw: -330, pitch: 12 }, head: { yaw: -350 } },
    { t: 0.5, ease: 'lin', hips: { yaw: -348, pitch: 10 }, chest: { yaw: -330, pitch: 12 }, head: { yaw: -350 } },
    // 戻り: 回転は 360° で元の向きに戻っているので、値は 360° 引いたもの
    ...pose(0.8, 'io', { ...RETURN, hips: { yaw: -360, pitch: 0, z: 0, y: 0 }, chest: { yaw: -360, pitch: 0 }, head: { yaw: -360 } }),
  ],
};

// ---------------------------------------------------------------- 打ち上げ（3 段目の突きの受付で前へ倒して攻撃）

/** 引き込み: 突き切った剣を、右腰の低い所へ引き戻す（切っ先は前下がり）。腰を沈めて、跳び上がる構え */
const UPPER_COIL = {
  hips: { yaw: 16, pitch: 8, z: 0.0, y: -0.2 },
  chest: { yaw: 28, pitch: 12 },
  head: { yaw: 8 },
  grip: [30, -38, 0.38] as V3,
  blade: [0.1, -0.2, 0.97] as V3,
  face: [0, 1, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.85, -0.1] as V3,
  ...OFFHAND.guard,
};

/** 打ち上げの最高点: 縦の面で剣が頭上を越えて後ろへ。体は大きく反って、跳び上がっている */
const UPPER_TOP = {
  hips: { yaw: 0, pitch: -10, z: -0.02, y: 0.16 },
  chest: { yaw: 0, pitch: -16 },
  head: { yaw: 0 },
  grip: [-4, 62, 0.4] as V3,
  ...plane(118, 90),
  roll: 0,
  pole: [-0.5, -0.8, -0.2] as V3,
  ...OFFHAND.pull,
};

/**
 * 打ち上げ（3 段目の突きの受付で、スティックを前へ倒して攻撃）: 突き切った剣を右腰へ引き戻して沈み、跳び上がりながら下から縦に斬り上げる。敵を高く打ち上げるような強い一撃。
 * 3 段目の受付時点（0.34s）の姿勢から続けて始まる（continueFrom）。
 * 0 → 0.12 引き戻して沈む / 0.12 → 0.24 跳び上がって斬り上げる（0.2 に前を通る最高速）/ 0.24 → 0.3 頭上へ抜ける / 0.3 → 0.42 滞空して着地 / 0.42 → 0.52 保つ / 0.52 → 0.78 戻り。
 * ルートは 0.12 から 0.3 までに 0.6 m 前へ。足は蹴るまで世界に固定 → 跳んでいるあいだ腰にぶら下がる → 着地で世界に固定。
 */
export const COMBO_UPPER: AuthoredAttack = {
  name: 'comboUpper',
  duration: 0.78,
  continueFrom: { attack: COMBO3, t: 0.34 },
  keys: [
    // ---- ルート ----
    { t: 0.12, ease: 'lin', rootZ: 0 },
    { t: 0.2, ease: 'in', rootZ: 0.2 },
    { t: 0.34, ease: 'out', rootZ: 0.6 },
    // ---- 足（開始時は 3 段目の終わりの位置: 右足 0.24、左足 −0.4）----
    { t: 0.12, ease: 'lin', footL: { rel: 0, z: -0.4, lift: 0 }, footR: { rel: 0, z: 0.24, lift: 0 } },
    { t: 0.17, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.7, lz: -0.04, knee: 0.3 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: 0.06, knee: 0.3 } },
    { t: 0.3, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.72, lz: 0.02, knee: 0.1 }, footR: { rel: 1, lx: -0.11, ly: -0.72, lz: 0.04, knee: 0.1 } },
    { t: 0.38, ease: 'io', footL: { rel: 0, z: 0.4, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 0.85, x: 0, lift: 0, pitch: 0 } },
    { t: 0.78, ease: 'io', footL: { z: 0.6 }, footR: { z: 0.6 } },
    // ---- 腰: 沈む（0.12）→ 跳ぶ → 着地で沈む → 立つ ----
    { t: 0.22, ease: 'out', hips: { y: 0.16 } },
    { t: 0.3, ease: 'lin', hips: { y: 0.16 } },
    { t: 0.4, ease: 'in', hips: { y: -0.16 } },
    { t: 0.52, ease: 'lin', hips: { y: -0.16 } },
    // ---- 引き戻す → 斬り上げる → 頭上へ抜ける → 保つ → 戻る ----
    ...pose(0.12, 'io', UPPER_COIL),
    ...pose(0.2, 'in', {
      hips: { yaw: 0, pitch: 4, z: 0.04, y: 0.1 },
      chest: { yaw: 0, pitch: 4 },
      head: { yaw: 0 },
      grip: [4, 14, 0.46],
      ...plane(30, 90),
      roll: 0,
      pole: [-0.4, -0.9, -0.1],
      ...OFFHAND.pull,
    }),
    ...pose(0.3, 'out', UPPER_TOP),
    ...pose(0.42, 'io', { ...UPPER_TOP, hips: { yaw: 0, pitch: 4, z: 0.02, y: -0.14 }, chest: { yaw: 0, pitch: 6 }, grip: [-4, 48, 0.4] }),
    ...pose(0.52, 'lin', { ...UPPER_TOP, hips: { yaw: 0, pitch: 4, z: 0.02, y: -0.16 }, chest: { yaw: 0, pitch: 6 }, grip: [-4, 48, 0.4] }),
    ...pose(0.78, 'io', RETURN),
  ],
};
