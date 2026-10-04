import type { AuthoredAttack } from '../authoring';
import { plane } from './cutting-plane';
import { GS_READY, GS_TWO_HAND } from './greatsword';
import { GS1 } from './gs-combo';
import { GS_HEAVY, GS_HEAVY_HOLD_T } from './gs-heavy';
import { CHAMBER, GS_LUNGE, GS_LUNGE_HOLD_T, GS_RETREAT, GS_RETREAT_HOLD_T, GS_RISE, GS_RISE_HOLD_T, LEAP_GATHER, LEAP_TOP, RISE_END, SLAM, SWEEP_COIL, THRUST } from './gs-moves';
import { pose } from './stagger';

/**
 * 大剣のコンボの分岐の技（ADR-023）。両手持ち（greatsword.ts）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 1 段目の受付（gs1 の 0.56s の姿勢）から、スティックの向きで続きが変わる。
 * 後半（ADR-024）は始動の技の受付に続く技: 突き → 突き払い / 後ろの薙ぎ払い →（前）飛び込み突き / 斬り上げ → 飛翔叩きつけ / 溜め斬り → 地擦り斬り上げ。
 * どれも前の技の保持の姿勢（その技の cancelAt）から続けて始まる（continueFrom）。足の始まりは「arc だけのキー」で前の技から受け取った位置のまま保つ。
 */

type V3 = [number, number, number];

// ---------------------------------------------------------------- 連携回転斬り（1 段目の受付で横へ倒して攻撃）

/** 巻き込み: 1 段目の振り抜き（左前下）からさらに左へ引き込み、腰を深く沈める（跳び上がる前の溜め）。剣は左前へ水平に寝かせる */
const SPIN2_COIL = {
  hips: { yaw: -24, pitch: 8, z: 0.02, y: -0.26 },
  chest: { yaw: -46, pitch: 10 },
  head: { yaw: -12 },
  grip: [-24, -6, 0.4] as V3,
  ...plane(-40, 0),
  roll: 120,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 回転中の腕と剣（胸の座標で一定）: 剣は体の左前へ水平に伸びる。右へ回るので、剣は正面 → 右 → 後ろ → 左と円を描く */
const SPIN2_ARMS = {
  grip: [-20, 2, 0.4] as V3,
  ...plane(-38, 0),
  roll: 120,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/**
 * 連携回転斬り（1 段目の受付で、スティックを横へ倒して攻撃）: 左前下へ振り抜いた剣を引き込んで沈み、跳び上がって体ごと右へ 1 回転しながら、水平の円を描いて薙ぎ払う。
 * 1 段目の流れで正面を先に薙いで全方位へ回る（大回転斬り gsSpin は左回り。こちらは右回り）。全方位を薙ぐ広い技。
 * 1 段目の受付時点（0.56s）の姿勢から続けて始まる（continueFrom）。
 * 0 → 0.14 引き込んで沈む / 0.14 → 0.42 跳び上がって回る（0.2〜0.38 に剣が全周を通る）/ 0.42 → 0.52 着地して沈む / 0.52 → 0.64 保つ / 0.64 → 1.0 戻り。
 * ルートは 0.14 から 0.42 までに 0.6 m 前へ。足は跳ぶまで世界に固定 → 跳んでいるあいだ腰に付いて回る → 着地で世界に固定。
 */
export const GS_SPIN2: AuthoredAttack = {
  name: 'gsSpin2',
  duration: 1.0,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS1, t: 0.56 },
  keys: [
    // ---- ルート ----
    { t: 0.14, ease: 'lin', rootZ: 0 },
    { t: 0.28, ease: 'in', rootZ: 0.25 },
    { t: 0.42, ease: 'out', rootZ: 0.6 },
    // ---- 足（開始時は 1 段目の終わりの位置: 左足 0、右足 −0.2）----
    { t: 0.14, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: -0.2, lift: 0 } },
    { t: 0.19, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.64, lz: 0.08, knee: 1 }, footR: { rel: 1, lx: -0.11, ly: -0.66, lz: -0.04, knee: 1 } },
    { t: 0.38, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.7, lz: 0.06, knee: 0.4 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 0.4 } },
    { t: 0.44, ease: 'io', footL: { rel: 0, z: 0.7, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 0.55, x: 0, lift: 0, pitch: 0 } },
    { t: 1.0, ease: 'io', footL: { z: 0.6 }, footR: { z: 0.6 } },
    // ---- 腰: 沈む（0.14）→ 跳ぶ → 着地で沈む → 立つ ----
    { t: 0.26, ease: 'out', hips: { y: 0.2 } },
    { t: 0.36, ease: 'lin', hips: { y: 0.16 } },
    { t: 0.46, ease: 'in', hips: { y: -0.2 } },
    { t: 0.64, ease: 'lin', hips: { y: -0.2 } },
    // ---- 体の回転（ヨー。腰・胸が 360° 右へ回る）と腕 ----
    ...pose(0.14, 'io', SPIN2_COIL),
    { t: 0.24, ease: 'out', ...SPIN2_ARMS },
    { t: 0.38, ease: 'lin', ...SPIN2_ARMS, hips: { yaw: 336 }, chest: { yaw: 316 }, head: { yaw: 348 } },
    { t: 0.46, ease: 'out', hips: { yaw: 346, pitch: 10 }, chest: { yaw: 330, pitch: 12 }, head: { yaw: 350 } },
    { t: 0.64, ease: 'lin', hips: { yaw: 346, pitch: 10 }, chest: { yaw: 330, pitch: 12 }, head: { yaw: 350 } },
    // 戻り: 回転は 360° で元の向きに戻っているので、構えの姿勢の値は 360° 足したもの
    ...pose(1.0, 'io', { ...GS_READY, hips: { ...GS_READY.hips, yaw: GS_READY.hips.yaw + 360 }, chest: { ...GS_READY.chest, yaw: GS_READY.chest.yaw + 360 }, head: { yaw: GS_READY.head.yaw + 360 } }),
  ],
};

// ---------------------------------------------------------------- 突き払い（踏み込み突きの受付で攻撃）

/** 巻き込み: 突き切った剣を右へ引いて水平に寝かせる。足は深く踏み込んだまま、腰を沈める */
const THRUST_SWEEP_COIL = { ...SWEEP_COIL, hips: { yaw: 16, pitch: 6, z: 0.02, y: -0.22 } };

/** 薙ぎの途中（体の前を通る最高速）: 右から前を通って左へ。前へ踏み抜けるので体は沈んで前へ倒れる */
const THRUST_SWEEP_PASS = {
  hips: { yaw: -4, pitch: 6, z: 0.04, y: -0.2 },
  chest: { yaw: -4, pitch: 8 },
  head: { yaw: -2 },
  grip: [-4, 4, 0.44] as V3,
  ...plane(0, 0),
  roll: -180,
  pole: [-0.4, -0.9, 0] as V3,
};

/** 払い切り: 剣は左へ水平に抜け、体は左へひねり切る（下がりながらの薙ぎ払い gsRetreat の終わりと同じ向き） */
const THRUST_SWEEP_END = {
  hips: { yaw: -16, pitch: 8, z: 0.03, y: -0.18 },
  chest: { yaw: -30, pitch: 10 },
  head: { yaw: -12 },
  grip: [-26, 6, 0.42] as V3,
  ...plane(-62, 0),
  roll: -180,
  pole: [-0.5, -0.8, 0] as V3,
};

/**
 * 突き払い（踏み込み突きの受付で攻撃）: 突き切った剣を右へ引き戻しながら、左足を大きく踏み抜けて、右から左へ水平に薙ぎ払う。突いて、すり抜けながら薙ぐ。
 * 踏み込み突きの保持の姿勢（GS_LUNGE_HOLD_T）から続けて始まる（continueFrom）。
 * 0 → 0.14 巻き込んで沈む / 0.14 → 0.24 薙ぐ（0.24 に前を通る最高速。左足は 0.24 に着地）/ 0.24 → 0.36 左へ払い切る / 0.36 → 0.48 保つ / 0.48 → 0.9 戻り。
 * ルートは 0.08 から 0.4 までに 0.55 m 前へ（足の幅が脚の届く範囲に収まるよう、突きの終わりの開いた足から少しずつ寄せる）。足は世界に固定。
 */
export const GS_LUNGE_SWEEP: AuthoredAttack = {
  name: 'gsLungeSweep',
  duration: 0.9,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_LUNGE, t: GS_LUNGE_HOLD_T },
  keys: [
    // ---- 下半身: 後ろにいた左足が弧を描いて前へ踏み抜ける。右足は残って、あとで引きつける ----
    { t: 0.08, ease: 'lin', rootZ: 0 },
    { t: 0.24, ease: 'in', rootZ: 0.22 },
    { t: 0.4, ease: 'out', rootZ: 0.55 },
    { t: 0.08, ease: 'lin', footL: { arc: 0 } },
    { t: 0.24, ease: 'io', footL: { z: 0.55, arc: 0.16 } },
    { t: 0.5, ease: 'lin', footL: { z: 0.55 } },
    { t: 0.9, ease: 'io', footL: { z: 0.55, arc: 0.03 } },
    { t: 0.26, ease: 'lin', footR: { arc: 0 } },
    { t: 0.4, ease: 'out', footR: { z: 0.3, arc: 0.06 } },
    { t: 0.5, ease: 'lin', footR: { z: 0.3 } },
    { t: 0.9, ease: 'io', footR: { z: 0.55, arc: 0.1 } },
    // ---- 巻き込む → 薙ぐ → 払い切る → 保つ → 戻る ----
    ...pose(0.14, 'io', THRUST_SWEEP_COIL),
    ...pose(0.24, 'in', THRUST_SWEEP_PASS),
    ...pose(0.36, 'out', THRUST_SWEEP_END),
    ...pose(0.48, 'lin', THRUST_SWEEP_END),
    ...pose(0.9, 'io', GS_READY),
  ],
};

// ---------------------------------------------------------------- 飛び込み突き（下がりながらの薙ぎ払いの受付で前へ倒して攻撃）

/**
 * 飛び込み突き（下がりながらの薙ぎ払いの受付で、スティックを前へ倒して攻撃）: 跳び退いて取り直した間合いを、牛の構えから体ごと飛び込んで貫く（1.65 m）。ヒット・アンド・アウェイの「ヒット」。
 * 踏み込み突き（gsLunge）の動きで、より遠くへ。下がりながらの薙ぎ払いの保持の姿勢（GS_RETREAT_HOLD_T）から続けて始まる（continueFrom）。
 * 0 → 0.2 引き絞る（0.2〜0.27 は一拍）/ 0.27 → 0.35 突き出す（0.35 に最高速。右足は 0.35 に着地）/ 0.35 → 0.5 伸び切る / 0.5 → 0.6 保つ / 0.6 → 0.95 戻り。
 * ルートは 0.12 から 0.35 までに 0.95 m、減速して 0.5 までに 1.65 m。足は世界に固定。
 */
export const GS_RETREAT_LUNGE: AuthoredAttack = {
  name: 'gsRetreatLunge',
  duration: 0.95,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_RETREAT, t: GS_RETREAT_HOLD_T },
  keys: [
    // ---- 下半身: 右足が大きく飛び込む。左足は残って、突いたあと引き寄せる ----
    { t: 0.12, ease: 'lin', rootZ: 0 },
    { t: 0.35, ease: 'in', rootZ: 0.95 },
    { t: 0.5, ease: 'out', rootZ: 1.65 },
    { t: 0.14, ease: 'lin', footR: { arc: 0 } },
    { t: 0.35, ease: 'io', footR: { z: 1.45, arc: 0.18 } },
    { t: 0.6, ease: 'lin', footR: { z: 1.45 } },
    { t: 0.95, ease: 'io', footR: { z: 1.65, arc: 0.03 } },
    { t: 0.3, ease: 'lin', footL: { arc: 0 } },
    { t: 0.5, ease: 'out', footL: { z: 1.05, arc: 0.08 } },
    { t: 0.6, ease: 'lin', footL: { z: 1.05 } },
    { t: 0.95, ease: 'io', footL: { z: 1.65, arc: 0.1 } },
    // ---- 引き絞る → 突く → 伸び切る → 保つ → 戻る ----
    ...pose(0.2, 'io', CHAMBER),
    ...pose(0.27, 'lin', CHAMBER),
    ...pose(0.35, 'in', THRUST),
    ...pose(0.5, 'out', { ...THRUST, hips: { yaw: -8, pitch: 8, z: 0.08, y: -0.18 } }),
    ...pose(0.6, 'lin', { ...THRUST, hips: { yaw: -8, pitch: 8, z: 0.08, y: -0.18 } }),
    ...pose(0.95, 'io', GS_READY),
  ],
};

// ---------------------------------------------------------------- 飛翔叩きつけ（斬り上げの受付で攻撃）

/**
 * 飛翔叩きつけ（斬り上げの受付で攻撃）: 左上へ斬り上げた剣を頭上へ引き直し、そのまま前へ跳び上がって、体重を乗せて真上から叩きつける。斬り上げた敵を追い打ちする重い二撃目。
 * 着地で剣が床を叩く（衝撃の輪）。斬り上げの保持の姿勢（GS_RISE_HOLD_T）から続けて始まる（continueFrom）。
 * 0 → 0.12 引き直して沈む / 0.12 → 0.22 跳んで頭上へ掲げる / 0.22 → 0.32 叩きつけて両足で着地（0.3 に最高速、0.33 に床を叩く）/ 0.32 → 0.5 保つ / 0.5 → 0.92 戻り。
 * ルートは 0.1 から 0.32 までに 1.5 m 前へ（跳び込み）。足は蹴るまで世界に固定 → 跳んでいるあいだは腰にぶら下がる → 両足で着地。
 */
export const GS_RISE_SLAM: AuthoredAttack = {
  name: 'gsRiseSlam',
  duration: 0.92,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_RISE, t: GS_RISE_HOLD_T },
  keys: [
    // ---- ルート ----
    { t: 0.1, ease: 'lin', rootZ: 0 },
    { t: 0.2, ease: 'in', rootZ: 0.5 },
    { t: 0.32, ease: 'out', rootZ: 1.5 },
    // ---- 足: 受け取った位置 → 跳ぶあいだは腰にぶら下がる → 両足で着地 ----
    { t: 0.1, ease: 'lin', footL: { arc: 0 }, footR: { arc: 0 } },
    { t: 0.15, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.66, lz: 0.06, knee: 0.6 }, footR: { rel: 1, lx: -0.11, ly: -0.68, lz: -0.04, knee: 0.6 } },
    { t: 0.26, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.74, lz: 0.1, knee: 0.1 }, footR: { rel: 1, lx: -0.11, ly: -0.72, lz: 0, knee: 0.1 } },
    { t: 0.32, ease: 'io', footL: { rel: 0, z: 1.75, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 1.4, x: 0, lift: 0, pitch: 0 } },
    { t: 0.92, ease: 'io', footL: { z: 1.5 }, footR: { z: 1.5 } },
    // ---- 引き直す → 跳んで掲げる → 叩きつける → 保つ → 戻る ----
    ...pose(0.12, 'io', LEAP_GATHER),
    ...pose(0.22, 'out', LEAP_TOP),
    ...pose(0.32, 'in', SLAM),
    ...pose(0.5, 'lin', SLAM),
    ...pose(0.92, 'io', GS_READY),
  ],
};

// ---------------------------------------------------------------- 地擦り斬り上げ（溜め斬りの受付で攻撃）

/** すくい上げの途中（体の前を通る最高速）: 床を叩いた剣を、前をかすめて斜め上へ。体は沈んだまま起き上がり始める */
const RIP_PASS = {
  hips: { yaw: -4, pitch: 8, z: 0.06, y: -0.26 },
  chest: { yaw: -6, pitch: 10 },
  head: { yaw: -3 },
  grip: [8, 0, 0.44] as V3,
  ...plane(-8, -35),
  roll: -165,
  pole: [-0.4, -0.85, -0.1] as V3,
};

/**
 * 地擦り斬り上げ（溜め斬りの受付で攻撃）: 床に叩きつけた剣を、そのまま地面をかすめて斬り上げる。唐竹割りの返しの一撃（斬り上げた敵を浮かせる）。
 * 溜め斬りの保持の姿勢（GS_HEAVY_HOLD_T）から続けて始まる（continueFrom）。
 * 0 → 0.2 すくい上げる（0.2 に前を通る最高速。右足が 0.2 に着地）/ 0.2 → 0.3 左上へ振り抜く / 0.3 → 0.44 保つ / 0.44 → 0.8 戻り。
 * ルートは 0.06 から 0.3 までに 0.5 m。足は世界に固定（溜め斬りの終わりは左足が前、右足が後ろ）。
 */
export const GS_HEAVY_RIP: AuthoredAttack = {
  name: 'gsHeavyRip',
  duration: 0.8,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_HEAVY, t: GS_HEAVY_HOLD_T },
  keys: [
    // ---- 下半身: 後ろにいた右足が前へ出る。左足は少し進めて、あとで引きつける ----
    { t: 0.06, ease: 'lin', rootZ: 0 },
    { t: 0.2, ease: 'in', rootZ: 0.25 },
    { t: 0.3, ease: 'out', rootZ: 0.5 },
    { t: 0.06, ease: 'lin', footR: { arc: 0 } },
    { t: 0.2, ease: 'io', footR: { z: 0.28, arc: 0.14 } },
    { t: 0.44, ease: 'lin', footR: { z: 0.28 } },
    { t: 0.8, ease: 'io', footR: { z: 0.5, arc: 0.03 } },
    { t: 0.2, ease: 'lin', footL: { arc: 0 } },
    { t: 0.34, ease: 'out', footL: { z: 0, arc: 0.06 } },
    { t: 0.44, ease: 'lin', footL: { z: 0 } },
    { t: 0.8, ease: 'io', footL: { z: 0.5, arc: 0.1 } },
    // ---- すくい上げる → 振り抜く → 保つ → 戻る ----
    ...pose(0.2, 'in', RIP_PASS),
    ...pose(0.3, 'out', RISE_END),
    ...pose(0.44, 'lin', RISE_END),
    ...pose(0.8, 'io', GS_READY),
  ],
};
