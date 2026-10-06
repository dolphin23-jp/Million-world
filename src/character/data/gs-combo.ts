import type { AuthoredAttack } from '../authoring';
import { plane } from './cutting-plane';
import { FROM_STANCE, GS_READY, GS_TWO_HAND } from './greatsword';
import { pose } from './stagger';

/**
 * 大剣の通常攻撃（2 連）。両手持ち（greatsword.ts）。座標の約束は combo1.ts と同じ（胸の座標系。右 = −X、上 = +Y、前 = +Z）。
 * 重く手数が少ない: 片手剣の 1 段目より予備動作が長く（0.3 秒）、振りは大きく、硬直も長い。踏み込みは幅が広く腰を深く沈める。
 * 斬りの面は袈裟（右上 → 左下）と逆袈裟（左下 → 右上）で、片手剣のコンボ（combo1 / combo2）と同じ向き。体のひねり（腰 → 胸 → 腕・剣の順に遅れて動く）で振る。
 */

type V3 = [number, number, number];
/** 斬りの面の傾き（水平から。大剣は握りが胸の中心に近いので、片手剣（38°）より少し立てて、肩から振り下ろす） */
const TILT = 46;

/** 予備動作の頂点: 右へひねって剣を右肩の後ろへ大きく振りかぶる。腰を沈めて後ろ足に体重を乗せる。頂点で一拍止める */
export const WINDUP = {
  hips: { yaw: 20, pitch: -4, z: -0.05, y: -0.12 },
  chest: { yaw: 42, pitch: -8 },
  head: { yaw: 10 },
  grip: [34, 54, 0.36] as V3,
  ...plane(122, TILT),
  roll: -30,
  pole: [-0.6, -0.8, -0.1] as V3,
};

/** 斬りの途中（体の前を通る最高速）: 腰・胸は正面を向き、腕が前へ伸びる。踏み込んだ前足の上に腰が沈む */
export const PASS = {
  hips: { yaw: 0, pitch: 8, z: 0.06, y: -0.2 },
  chest: { yaw: 0, pitch: 12 },
  head: { yaw: 0 },
  grip: [-6, 4, 0.44] as V3,
  ...plane(-15, TILT),
  roll: -180,
  pole: [-0.35, -0.9, -0.1] as V3,
};

/**
 * 振り抜きの終わり: 剣は左の前下に流れ、体は左へひねり切る。切っ先は床の上 0.2m 付近で止まる（刃は長いので、下へ向けすぎると床に刺さる）。
 * 2 段目はこの姿勢（0.56s）から続けて始まる（受付はここから戻りの手前まで続くので、姿勢を保つ）
 */
export const FOLLOW = {
  hips: { yaw: -14, pitch: 10, z: 0.06, y: -0.22 },
  chest: { yaw: -30, pitch: 15 },
  head: { yaw: -10 },
  grip: [-26, -16, 0.44] as V3,
  blade: [0.6, -0.19, 0.77] as V3,
  face: [-0.72, -0.69, 0] as V3,
  roll: -150,
  pole: [-0.5, -0.8, 0] as V3,
};

/**
 * 1 段目: 右上から左下への袈裟斬り。0 → 0.24 右へひねって大きく振りかぶる（0.24〜0.3 は頂点で一拍。後ろ足に体重）/ 0.3 → 0.37 振り下ろす（0.37 に体の前を通る最高速。
 * 左足は 0.37 に着地）/ 0.37 → 0.44 振り抜く / 0.44 → 0.62 姿勢を保って次段を待つ / 0.62 → 0.92 戻り。
 * 踏み込み: 左足が 0.22 に床を離れ、0.37 に腰の 0.34 m 前へ着地する。ルートは 0.2 から加速して 0.37 までに 0.36 m、減速して 0.5 までに 0.7 m（以降は止める）。
 * 着地のとき腰が 0.2 m 沈む。右足は後ろに残り、0.46 に引きつける。
 */
export const GS1: AuthoredAttack = {
  name: 'gs1',
  duration: 0.92,
  twoHanded: GS_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [
    // ---- 下半身 ----
    { t: 0.2, ease: 'lin', rootZ: 0 },
    { t: 0.37, ease: 'in', rootZ: 0.36 },
    { t: 0.5, ease: 'out', rootZ: 0.7 },
    { t: 0.22, ease: 'lin', footL: { z: 0 } },
    { t: 0.37, ease: 'io', footL: { z: 0.7, arc: 0.15 } },
    { t: 0.62, ease: 'lin', footL: { z: 0.7 } },
    { t: 0.92, ease: 'io', footL: { z: 0.7, arc: 0.02 } },
    { t: 0.3, ease: 'lin', footR: { z: 0 } },
    { t: 0.46, ease: 'io', footR: { z: 0.5, arc: 0.07 } },
    { t: 0.62, ease: 'lin', footR: { z: 0.5 } },
    { t: 0.92, ease: 'io', footR: { z: 0.7, arc: 0.05 } },
    // ---- 振りかぶる（頂点で一拍止める）→ 振り下ろす → 振り抜く → 保つ → 戻る ----
    ...pose(0.24, 'io', WINDUP),
    ...pose(0.3, 'lin', WINDUP),
    ...pose(0.37, 'in', PASS),
    ...pose(0.44, 'out', FOLLOW),
    ...pose(0.62, 'lin', FOLLOW),
    ...pose(0.92, 'io', GS_READY),
  ],
};

/** 2 段目の溜め: 1 段目の振り抜き（左の前下）からさらに左へ引き込んで腰を沈め、体を左へ巻く。剣は左へ水平に近く寝かせる（切っ先は床の上） */
export const COIL2 = {
  hips: { yaw: -22, pitch: 8, z: 0.03, y: -0.24 },
  chest: { yaw: -44, pitch: 12 },
  head: { yaw: -14 },
  grip: [-30, -24, 0.42] as V3,
  ...plane(-88, 12),
  roll: -180,
  pole: [-0.5, -0.8, 0] as V3,
};

/** 逆袈裟の途中（体の前を通る最高速）: 左下から上へ。腰・胸は正面に戻り、剣が前を通る */
export const PASS2 = {
  hips: { yaw: 0, pitch: 7, z: 0.05, y: -0.2 },
  chest: { yaw: 2, pitch: 10 },
  head: { yaw: 0 },
  grip: [-2, 8, 0.44] as V3,
  ...plane(4, 40),
  roll: -165,
  pole: [-0.35, -0.9, -0.15] as V3,
};

/** 振り上げの終わり: 剣は右上へ抜け、体は右へひねり切って反る */
export const FINISH2 = {
  hips: { yaw: 14, pitch: 2, z: 0.04, y: -0.14 },
  chest: { yaw: 30, pitch: 0 },
  head: { yaw: 10 },
  grip: [30, 32, 0.42] as V3,
  ...plane(100, 40),
  roll: -75,
  pole: [-0.55, -0.8, -0.1] as V3,
};

/**
 * 2 段目: 左下から右上への逆袈裟（斬り上げ）。1 段目の受付時点（0.56s）の姿勢から続けて始まる（continueFrom）。
 * 0 → 0.14 左へ巻き込んで腰を沈める / 0.14 → 0.21 斬り上げる（0.21 に体の前を通る最高速。右足は 0.21 に着地）/ 0.21 → 0.31 右上へ振り抜く /
 * 0.31 → 0.46 姿勢を保つ / 0.46 → 0.86 戻り（コンボの終わり。硬直は長い）。
 * 踏み込み: 後ろにいた右足が弧を描いて腰の 0.32 m 前へ着地する。ルートは 0.06 から加速して 0.21 までに 0.3 m、減速して 0.34 までに 0.6 m（以降は止める）。
 */
export const GS2: AuthoredAttack = {
  name: 'gs2',
  duration: 0.86,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS1, t: 0.56 },
  keys: [
    // ---- 下半身（足の z はこの技の開始時のルートからの前進量。1 段目の終わりは左足 0、右足 −0.2） ----
    { t: 0.06, ease: 'lin', rootZ: 0 },
    { t: 0.21, ease: 'in', rootZ: 0.3 },
    { t: 0.34, ease: 'out', rootZ: 0.6 },
    { t: 0.06, ease: 'lin', footR: { z: -0.2 } },
    { t: 0.21, ease: 'io', footR: { z: 0.62, arc: 0.14 } },
    { t: 0.5, ease: 'lin', footR: { z: 0.62 } },
    { t: 0.86, ease: 'io', footR: { z: 0.6, arc: 0.03 } },
    { t: 0.2, ease: 'lin', footL: { z: 0 } },
    { t: 0.34, ease: 'out', footL: { z: 0.25, arc: 0.06 } },
    { t: 0.5, ease: 'lin', footL: { z: 0.25 } },
    { t: 0.86, ease: 'io', footL: { z: 0.6, arc: 0.1 } },
    // ---- 巻き込む → 斬り上げる → 振り抜く → 保つ → 戻る ----
    ...pose(0.14, 'io', COIL2),
    ...pose(0.21, 'in', PASS2),
    ...pose(0.31, 'out', FINISH2),
    ...pose(0.46, 'lin', FINISH2),
    ...pose(0.86, 'io', GS_READY),
  ],
};
