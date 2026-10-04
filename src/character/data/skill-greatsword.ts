import type { AuthoredAttack } from '../authoring';
import { plane } from './cutting-plane';
import { FROM_STANCE, GS_READY, GS_TWO_HAND } from './greatsword';
import { PASS as SMASH_PASS } from './gs-heavy';
import { IMPACT, RAISE, REBOUND, SETTLE } from './gs-smash';
import { SWEEP_COIL } from './gs-moves';
import { pose } from './stagger';

/**
 * 大剣の剣技（ADR-031）の専用モーション。両手持ち（greatsword.ts）。座標の約束は combo1.ts と同じ（胸の座標系。右 = −X、上 = +Y、前 = +Z）。
 *
 *  - 剣技「崩山」: 右からの払い（GSK_SWEEP1）→ 左からの払い（GSK_SWEEP2）→ **頭上から地面へ叩きつけ、衝撃波が地面と周囲へ広がる**（GSK_SLAM）。
 *  - 剣技「一閃」（GSK_ISSEN）: 剣を後ろへ引いて少し溜め → **ほぼ一瞬で前へ踏み込み（ダッシュ）→ 水平に大きく斬る**（広く、遠く、1 回）。
 */

type V3 = [number, number, number];

// ================================================================= 崩山 1: 右からの払い

/** 払い切り（左）: 剣は左へ水平に抜け、体は左へひねり切る。次の払い（左からの払い）はこの姿勢から続く */
const SWEEP_END_L = {
  hips: { yaw: -16, pitch: 8, z: 0.03, y: -0.18 },
  chest: { yaw: -30, pitch: 10 },
  head: { yaw: -12 },
  grip: [-26, 6, 0.42] as V3,
  ...plane(-62, 0),
  roll: -180,
  pole: [-0.5, -0.8, 0] as V3,
};

/** 薙ぎの途中（体の前を通る最高速）: 前へ踏み込んで体は沈む。右からも左からも、剣が体の前を水平に通る */
const SWEEP_PASS = {
  hips: { yaw: -4, pitch: 6, z: 0.04, y: -0.2 },
  chest: { yaw: -4, pitch: 8 },
  head: { yaw: -2 },
  grip: [-4, 4, 0.44] as V3,
  ...plane(0, 0),
  roll: -180,
  pole: [-0.4, -0.9, 0] as V3,
};

/** 右からの払いが次を受け付ける時刻（払い切った姿勢を保つ 0.4〜0.5。AttackDef.cancelAt と同じ） */
export const GSK_SWEEP1_HOLD_T = 0.44;

/**
 * 右からの払い（剣技「崩山」の 1 段目）: 構えから右へ巻き込んで沈み、左足を踏み込んで、剣を右から左へ水平に薙ぎ払う。
 * 0 → 0.17 右へ巻き込む（0.17〜0.2 は一拍）/ 0.2 → 0.28 薙ぐ（0.28 に前を通る最高速。左足は 0.28 に着地）/ 0.28 → 0.38 左へ払い切る / 0.38 → 0.5 保つ（次段の受付）/ 0.5 → 0.9 戻り。
 * ルートは 0.06 から 0.28 までに 0.34 m、減速して 0.42 までに 0.7 m。足は世界に固定（左足が弧を描いて前へ。右足は残って引き寄せる）。
 */
export const GSK_SWEEP1: AuthoredAttack = {
  name: 'gskSweep1',
  duration: 0.9,
  twoHanded: GS_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [
    // ---- 下半身 ----
    { t: 0.06, ease: 'lin', rootZ: 0 },
    { t: 0.28, ease: 'in', rootZ: 0.34 },
    { t: 0.42, ease: 'out', rootZ: 0.7 },
    { t: 0.1, ease: 'lin', footL: { z: 0 } },
    { t: 0.28, ease: 'io', footL: { z: 0.62, arc: 0.15 } },
    { t: 0.5, ease: 'lin', footL: { z: 0.62 } },
    { t: 0.9, ease: 'io', footL: { z: 0.7, arc: 0.02 } },
    { t: 0.18, ease: 'lin', footR: { z: 0 } },
    { t: 0.42, ease: 'io', footR: { z: 0.4, arc: 0.07 } },
    { t: 0.5, ease: 'lin', footR: { z: 0.4 } },
    { t: 0.9, ease: 'io', footR: { z: 0.7, arc: 0.1 } },
    // ---- 巻き込む → 薙ぐ → 払い切る → 保つ → 戻る ----
    ...pose(0.17, 'io', { ...SWEEP_COIL, hips: { yaw: 18, pitch: 6, z: 0.02, y: -0.2 } }),
    ...pose(0.2, 'lin', { ...SWEEP_COIL, hips: { yaw: 18, pitch: 6, z: 0.02, y: -0.2 } }),
    ...pose(0.28, 'in', SWEEP_PASS),
    ...pose(0.38, 'out', SWEEP_END_L),
    ...pose(0.5, 'lin', SWEEP_END_L),
    ...pose(0.9, 'io', GS_READY),
  ],
};

// ================================================================= 崩山 2: 左からの払い

/** 引き込み: 払い切った剣をさらに左へ引いて、腰を沈める */
const SWEEP2_COIL = {
  hips: { yaw: -22, pitch: 8, z: 0.02, y: -0.22 },
  chest: { yaw: -42, pitch: 10 },
  head: { yaw: -14 },
  grip: [-28, 4, 0.4] as V3,
  ...plane(-80, 0),
  roll: -180,
  pole: [-0.5, -0.8, 0] as V3,
};

/** 払い切り（右）: 剣は右へ水平に抜け、体は右へひねり切る。次の叩きつけはこの姿勢から剣を頭上へ振りかぶる */
const SWEEP_END_R = {
  hips: { yaw: 18, pitch: 8, z: 0.03, y: -0.2 },
  chest: { yaw: 36, pitch: 10 },
  head: { yaw: 10 },
  grip: [16, 2, 0.4] as V3,
  ...plane(76, 0),
  roll: -60,
  pole: [-0.6, -0.8, 0.1] as V3,
};

/** 左からの払いが次を受け付ける時刻（払い切った姿勢を保つ 0.36〜0.46） */
export const GSK_SWEEP2_HOLD_T = 0.4;

/**
 * 左からの払い（剣技「崩山」の 2 段目）: 右からの払いの受付時点（0.44s）の姿勢から続けて、左へ引き込んで、右足を踏み込んで、剣を左から右へ薙ぎ戻す。
 * 0 → 0.12 左へ引き込む（0.12〜0.15 は一拍）/ 0.15 → 0.24 薙ぐ（0.24 に前を通る最高速。右足は 0.24 に着地）/ 0.24 → 0.34 右へ払い切る / 0.34 → 0.46 保つ / 0.46 → 0.86 戻り。
 * ルートは 0.04 から 0.24 までに 0.3 m、減速して 0.38 までに 0.6 m。足は世界に固定（足の z は開始時のルートから: 左足 −0.08、右足 −0.3 から始まる）。
 */
export const GSK_SWEEP2: AuthoredAttack = {
  name: 'gskSweep2',
  duration: 0.86,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GSK_SWEEP1, t: GSK_SWEEP1_HOLD_T },
  keys: [
    // ---- 下半身: 後ろにいた右足が弧を描いて前へ踏み込む。左足は少し進めて、あとで引き寄せる ----
    { t: 0.04, ease: 'lin', rootZ: 0 },
    { t: 0.24, ease: 'in', rootZ: 0.3 },
    { t: 0.38, ease: 'out', rootZ: 0.6 },
    { t: 0.04, ease: 'lin', footR: { z: -0.3 } },
    { t: 0.24, ease: 'io', footR: { z: 0.5, arc: 0.15 } },
    { t: 0.46, ease: 'lin', footR: { z: 0.5 } },
    { t: 0.86, ease: 'io', footR: { z: 0.6, arc: 0.03 } },
    { t: 0.14, ease: 'lin', footL: { z: -0.08 } },
    { t: 0.38, ease: 'io', footL: { z: 0.15, arc: 0.06 } },
    { t: 0.46, ease: 'lin', footL: { z: 0.15 } },
    { t: 0.86, ease: 'io', footL: { z: 0.6, arc: 0.1 } },
    // ---- 引き込む → 薙ぐ → 払い切る → 保つ → 戻る ----
    ...pose(0.12, 'io', SWEEP2_COIL),
    ...pose(0.15, 'lin', SWEEP2_COIL),
    ...pose(0.24, 'in', SWEEP_PASS),
    ...pose(0.34, 'out', SWEEP_END_R),
    ...pose(0.46, 'lin', SWEEP_END_R),
    ...pose(0.86, 'io', GS_READY),
  ],
};

// ================================================================= 崩山 3: 叩きつけ（衝撃波）

/** 地面を叩く時刻（AttackDef.impact.t と窓の基準） */
export const GSK_SLAM_IMPACT_T = 0.39;

/**
 * 叩きつけ（剣技「崩山」の締め）: 左からの払いの受付時点（0.4s）の姿勢から続けて、剣を頭上高く振りかぶり、左足を大きく踏み込んで真上から地面へ叩きつける。
 * 切っ先が地面を叩いた瞬間に衝撃波が地面と周囲へ広がる（当たりは AttackDef.windows の円）。跳ね返って沈み、重く落ち着く。
 * 0 → 0.22 剣を頭上へ振りかぶって沈む（0.22〜0.27 は頂点で一拍）/ 0.27 → 0.39 振り下ろす（0.33 に体の前を通る最高速、0.39 に地面を叩く。左足は 0.35 に着地）/
 * 0.39 → 0.49 跳ね返る / 0.49 → 0.63 沈んで落ち着く / 0.63 → 0.85 保つ（硬直は長い）/ 0.85 → 1.3 戻り。
 * ルートは 0.1 から 0.35 までに 0.7 m、減速して 0.5 までに 1.1 m。足は世界に固定（足の z は開始時のルートから: 右足 −0.1、左足 −0.45 から始まる）。
 */
export const GSK_SLAM: AuthoredAttack = {
  name: 'gskSlam',
  duration: 1.3,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GSK_SWEEP2, t: GSK_SWEEP2_HOLD_T },
  keys: [
    // ---- 下半身 ----
    { t: 0.1, ease: 'lin', rootZ: 0 },
    { t: 0.35, ease: 'in', rootZ: 0.7 },
    { t: 0.5, ease: 'out', rootZ: 1.1 },
    { t: 0.1, ease: 'lin', footL: { z: -0.45 } },
    { t: 0.35, ease: 'io', footL: { z: 1.1, arc: 0.16 } },
    { t: 0.85, ease: 'lin', footL: { z: 1.1 } },
    { t: 1.3, ease: 'io', footL: { z: 1.2, arc: 0.02 } },
    { t: 0.1, ease: 'lin', footR: { z: -0.1 } },
    { t: 0.35, ease: 'io', footR: { z: 0.35, arc: 0.05 } },
    { t: 0.5, ease: 'out', footR: { z: 0.7, arc: 0.08 } },
    { t: 0.85, ease: 'lin', footR: { z: 0.7 } },
    { t: 1.3, ease: 'io', footR: { z: 1.2, arc: 0.1 } },
    // ---- 振りかぶる → 振り下ろす → 地面を叩く → 跳ね返る → 沈む → 保つ → 戻る ----
    ...pose(0.22, 'io', RAISE),
    ...pose(0.27, 'lin', RAISE),
    ...pose(0.33, 'in', SMASH_PASS),
    ...pose(GSK_SLAM_IMPACT_T, 'in', IMPACT),
    ...pose(0.41, 'lin', IMPACT),
    ...pose(0.49, 'out', REBOUND),
    ...pose(0.63, 'io', SETTLE),
    ...pose(0.85, 'lin', SETTLE),
    ...pose(1.3, 'io', GS_READY),
  ],
};

// ================================================================= 一閃（溜め → 一瞬のダッシュ → 踏み込み斬り）

/** ダッシュの距離（m）。1 フレーム 0.53 m 以下に収める（敵の体に押し戻されるので、これ以上速いと敵の向こう側へ抜けてしまう） */
export const ISSEN_DASH = 3.2;
/** ダッシュの時刻（秒）: 溜めの終わり → 着地 */
export const ISSEN_DASH_FROM = 0.5;
export const ISSEN_DASH_TO = 0.6;
/** 斬りが体の前を通る最高速の時刻 */
export const ISSEN_PASS_T = 0.63;

/** 引き: 体を右へ大きくひねり、腰を落として、剣を後ろ（右後ろの低い所）へ引く。切っ先は後ろ下がりで床の上 */
const ISSEN_DRAW = {
  hips: { yaw: 30, pitch: 6, z: -0.06, y: -0.22 },
  chest: { yaw: 58, pitch: 8 },
  head: { yaw: 8 },
  grip: [28, -16, 0.32] as V3,
  ...plane(112, -6),
  roll: -40,
  pole: [-0.6, -0.8, 0.1] as V3,
};

/** 溜めの底: さらに沈んで前へ倒れかけ、力を溜める（引きの姿勢から腰が下がり、胸が前へ） */
const ISSEN_CHARGE = {
  ...ISSEN_DRAW,
  hips: { yaw: 32, pitch: 10, z: -0.08, y: -0.32 },
  chest: { yaw: 60, pitch: 13 },
};

/** ダッシュ中: 前へ低く倒れ込む（剣は後ろに引いたまま） */
const ISSEN_DASH_POSE = {
  hips: { yaw: 28, pitch: 20, z: 0.04, y: -0.32 },
  chest: { yaw: 52, pitch: 24 },
  head: { yaw: 6 },
  grip: [26, -10, 0.34] as V3,
  ...plane(108, -8),
  roll: -40,
  pole: [-0.6, -0.8, 0.1] as V3,
};

/** 斬りの途中（体の前を通る最高速）: 着地した前足に体重を乗せ、剣が体の前を水平に通る */
const ISSEN_PASS = {
  hips: { yaw: -6, pitch: 14, z: 0.1, y: -0.3 },
  chest: { yaw: 0, pitch: 18 },
  head: { yaw: -2 },
  grip: [-4, 4, 0.46] as V3,
  ...plane(0, 0),
  roll: -180,
  pole: [-0.4, -0.9, 0] as V3,
};

/** 振り抜き: 剣は左へ大きく抜け、体は左へひねり切る */
const ISSEN_END = {
  hips: { yaw: -20, pitch: 10, z: 0.06, y: -0.28 },
  chest: { yaw: -40, pitch: 14 },
  head: { yaw: -14 },
  grip: [-28, 6, 0.42] as V3,
  ...plane(-70, 0),
  roll: -180,
  pole: [-0.5, -0.8, 0] as V3,
};

/**
 * 一閃（剣技「一閃」）: 剣を後ろへ引いて腰を落とし、少し溜めてから、ほぼ一瞬で前へ踏み込み（ダッシュ 3.2 m）、水平に大きく斬り抜ける。
 * 0 → 0.26 剣を後ろへ引いて沈む / 0.26 → 0.5 溜める（沈みながら体が前へ傾く）/ 0.5 → 0.6 ダッシュ（足は地面を離れ、剣は引いたまま）/
 * 0.6 → 0.63 着地して斬る（0.63 に前を通る最高速。左足が着地）/ 0.63 → 0.72 左へ振り抜く / 0.72 → 0.92 保つ / 0.92 → 1.4 戻り（硬直は長い）。
 * ルートは 0.5 から 0.6 までに 3.2 m（ほぼ一定の速さ）。足は 0.5 まで世界に固定 → ダッシュのあいだは腰にぶら下がる → 左足は腰の 0.38 m 前、右足は 0.3 m 後ろへ着地。
 */
export const GSK_ISSEN: AuthoredAttack = {
  name: 'gskIssen',
  duration: 1.4,
  twoHanded: GS_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [
    // ---- ルート: 溜めのあいだは動かない → 一瞬で踏み込む ----
    { t: ISSEN_DASH_FROM, ease: 'lin', rootZ: 0 },
    { t: ISSEN_DASH_FROM + 0.02, ease: 'in', rootZ: 0.15 },
    { t: ISSEN_DASH_TO, ease: 'lin', rootZ: ISSEN_DASH },
    // ---- 足: 構えから広めの構えへ（左が前、右が後ろ）→ 蹴る → 腰にぶら下がる → 着地で世界に固定 → 戻り ----
    { t: 0.04, ease: 'lin', footL: { z: 0 }, footR: { z: 0 } },
    { t: 0.24, ease: 'io', footL: { z: 0.22, arc: 0.05 }, footR: { z: -0.2, arc: 0.03 } },
    { t: 0.5, ease: 'lin', footL: { rel: 0, z: 0.22, lift: 0 }, footR: { rel: 0, z: -0.2, lift: 0 } },
    { t: 0.54, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.6, lz: -0.3, knee: 0.8 }, footR: { rel: 1, lx: -0.11, ly: -0.62, lz: -0.5, knee: 0.8 } },
    { t: 0.58, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.72, lz: -0.1, knee: 0.2 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.3, knee: 0.2 } },
    { t: 0.62, ease: 'io', footL: { rel: 0, z: ISSEN_DASH + 0.38, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: ISSEN_DASH - 0.3, x: 0, lift: 0, pitch: 0 } },
    { t: 0.92, ease: 'lin', footL: { z: ISSEN_DASH + 0.38 }, footR: { z: ISSEN_DASH - 0.3 } },
    { t: 1.4, ease: 'io', footL: { z: ISSEN_DASH + 0.05, arc: 0.02 }, footR: { z: ISSEN_DASH, arc: 0.1 } },
    // ---- 引く → 溜める（わずかに震える）→ 倒れ込む → 斬る → 振り抜く → 保つ → 戻る ----
    ...pose(0.26, 'io', ISSEN_DRAW),
    ...pose(0.34, 'io', { chest: { yaw: 59, pitch: 11 } }),
    ...pose(0.4, 'io', { chest: { yaw: 61, pitch: 12 } }),
    ...pose(0.45, 'io', { chest: { yaw: 59, pitch: 13 } }),
    ...pose(0.5, 'io', ISSEN_CHARGE),
    ...pose(0.55, 'io', ISSEN_DASH_POSE),
    ...pose(ISSEN_PASS_T, 'in', ISSEN_PASS),
    ...pose(0.72, 'out', ISSEN_END),
    ...pose(0.92, 'lin', ISSEN_END),
    ...pose(1.4, 'io', GS_READY),
  ],
};
