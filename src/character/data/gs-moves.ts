import type { AuthoredAttack } from '../authoring';
import { plane } from './cutting-plane';
import { FROM_STANCE, GS_DODGE, GS_DODGE_BACK, GS_READY, GS_TWO_HAND } from './greatsword';
import { pose } from './stagger';

/**
 * 大剣の特殊な攻撃（スティックの向き・回避直後で出る）。両手持ち（greatsword.ts）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 剣は長い（切っ先が握りから 1.6m）ので、腰・胸が前へ倒れていると、前を向いた刃は下へ傾く（世界の仰角 ≒ 胸の座標の仰角 − 前傾）。切っ先が床に刺さらないよう、前傾の分だけ刃を上げて書く。
 * 手首のねじれは roll で調整してある（大剣の刃は表裏が同じなので、roll は ±180° まで使える。値は ?motionlab=1 の bake で、ねじれ・曲がりが小さく、±180° をまたがない組を探した）。
 */

type V3 = [number, number, number];

// ---------------------------------------------------------------- 踏み込み突き（スティック前）

/**
 * 引き絞り（牛の構え）: 両手を右のこめかみの高さへ引き上げ、切っ先を前下がりで敵の顔へ向けたまま腰を落とす。ここから体ごと前へ飛び込んで、胸の高さへ貫く。
 * 左手は導かれる（右手の握りの下）ので、右手を胸の中心から離しすぎると届かない（距離 0.3m、横は右へ 26° まで）。
 */
const CHAMBER = {
  hips: { yaw: 14, pitch: 0, z: -0.06, y: -0.2 },
  chest: { yaw: 22, pitch: -2 },
  head: { yaw: 8 },
  grip: [26, 34, 0.3] as V3,
  blade: [-0.05, -0.3, 0.95] as V3,
  face: [-1, 0, 0] as V3,
  roll: -165,
  pole: [-0.65, -0.75, -0.1] as V3,
};

/** 突き出し: 両腕が前へ伸び、剣が体の前を真っ直ぐ貫く。腰が前へ倒れるので、刃は胸の座標でやや上向き */
const THRUST = {
  hips: { yaw: -6, pitch: 10, z: 0.1, y: -0.24 },
  chest: { yaw: -8, pitch: 14 },
  head: { yaw: -4 },
  grip: [-4, 0, 0.46] as V3,
  blade: [0.06, 0.4, 0.915] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.4, -0.9, 0] as V3,
};

/**
 * 踏み込み突き（スティック前 + 攻撃）: 腰を落として剣を引き絞り（0.18〜0.27 は一拍）、体ごと大きく踏み込んで両手で貫く。距離を詰める技で、点で突くので範囲は狭いが、威力と踏み込みが大きい。
 * 0 → 0.2 引き絞る / 0.27 → 0.35 突き出す（0.35 に最高速。右足は 0.35 に着地）/ 0.35 → 0.5 伸び切る / 0.5 → 0.58 保つ / 0.58 → 0.9 戻り。
 * 踏み込み: ルートは 0.12 から加速して 0.35 までに 0.8 m、減速して 0.5 までに 1.5 m（後ろステップ直後の追撃にも使う）。右足は腰の 0.5 m 前へ着地、左足は引き寄せる。
 */
export const GS_LUNGE: AuthoredAttack = {
  name: 'gsLunge',
  duration: 0.9,
  twoHanded: GS_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [
    // ---- 下半身 ----
    { t: 0.12, ease: 'lin', rootZ: 0 },
    { t: 0.35, ease: 'in', rootZ: 0.8 },
    { t: 0.5, ease: 'out', rootZ: 1.5 },
    { t: 0.14, ease: 'lin', footR: { z: 0 } },
    { t: 0.35, ease: 'io', footR: { z: 1.3, arc: 0.16 } },
    { t: 0.58, ease: 'lin', footR: { z: 1.3 } },
    { t: 0.9, ease: 'io', footR: { z: 1.5, arc: 0.03 } },
    { t: 0.3, ease: 'lin', footL: { z: 0 } },
    { t: 0.5, ease: 'out', footL: { z: 0.9, arc: 0.08 } },
    { t: 0.58, ease: 'lin', footL: { z: 0.9 } },
    { t: 0.9, ease: 'io', footL: { z: 1.5, arc: 0.1 } },
    // ---- 引き絞る → 突く → 伸び切る → 戻る ----
    ...pose(0.18, 'io', CHAMBER),
    ...pose(0.27, 'lin', CHAMBER),
    ...pose(0.35, 'in', THRUST),
    ...pose(0.5, 'out', { ...THRUST, hips: { yaw: -8, pitch: 8, z: 0.08, y: -0.18 } }),
    ...pose(0.58, 'lin', { ...THRUST, hips: { yaw: -8, pitch: 8, z: 0.08, y: -0.18 } }),
    ...pose(0.9, 'io', GS_READY),
  ],
};

// ---------------------------------------------------------------- 下がりながらの薙ぎ払い（ロック中にスティック後ろ）

/** 巻き込み: 右へひねって、剣を右へ水平に引く（切っ先は右後ろ）。体を沈める */
const SWEEP_COIL = {
  hips: { yaw: 16, pitch: 6, z: 0.02, y: -0.16 },
  chest: { yaw: 32, pitch: 8 },
  head: { yaw: 8 },
  grip: [14, -6, 0.36] as V3,
  ...plane(72, 0),
  roll: -60,
  pole: [-0.6, -0.8, 0.1] as V3,
};

/**
 * 下がりながらの薙ぎ払い（ロック中にスティックを後ろへ倒して攻撃）: 後ろへ大きく跳びながら、剣を右から左へ水平に薙ぎ払い、間合いを取り直しながら敵を押し返す。
 * 後ろステップ（dodge.ts の DODGE_BACK）と同じ足の作り（跳んでいるあいだ足は腰に付いてぶら下がり、着地で世界に固定）。
 * 0 → 0.12 巻き込む / 0.12 → 0.28 跳びながら薙ぐ（0.2 に前を通る最高速）/ 0.28 → 0.38 払い切って着地 / 0.38 → 0.5 保つ / 0.5 → 0.82 戻り。
 * ルートは 0.12 から 0.4 までに 1.3 m 後ろへ（負）。
 */
export const GS_RETREAT: AuthoredAttack = {
  name: 'gsRetreat',
  duration: 0.82,
  twoHanded: GS_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [
    // ---- ルート（後ろへ。負が後ろ） ----
    { t: 0.12, ease: 'lin', rootZ: 0 },
    { t: 0.18, ease: 'in', rootZ: -0.35 },
    { t: 0.32, ease: 'lin', rootZ: -1.18 },
    { t: 0.4, ease: 'out', rootZ: -1.3 },
    // ---- 足: 蹴るまで世界に固定 → 跳んでいるあいだは腰にぶら下がる → 着地で世界に固定 ----
    { t: 0.12, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: 0, lift: 0 } },
    { t: 0.17, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.66, lz: -0.08, knee: 0 }, footR: { rel: 1, lx: -0.11, ly: -0.68, lz: 0, knee: 0 } },
    { t: 0.3, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.72, lz: 0.05, knee: 0 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 0 } },
    { t: 0.36, ease: 'io', footL: { rel: 0, z: -1.2, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: -1.35, x: 0, lift: 0, pitch: 0 } },
    { t: 0.82, ease: 'io', footL: { z: -1.3 }, footR: { z: -1.3 } },
    // ---- 体と剣: 巻き込む → 薙ぐ → 払い切る → 保つ → 戻る ----
    ...pose(0.12, 'io', SWEEP_COIL),
    ...pose(0.2, 'in', {
      hips: { yaw: -4, pitch: -4, z: -0.02, y: 0.08 },
      chest: { yaw: -4, pitch: -4 },
      head: { yaw: -2 },
      grip: [-4, 4, 0.44],
      ...plane(0, 0),
      roll: -180,
      pole: [-0.4, -0.9, 0],
    }),
    ...pose(0.28, 'out', {
      hips: { yaw: -16, pitch: 0, z: 0, y: 0.04 },
      chest: { yaw: -30, pitch: 2 },
      head: { yaw: -12 },
      grip: [-26, 4, 0.42],
      ...plane(-62, 0),
      roll: 165,
      pole: [-0.5, -0.8, 0],
    }),
    ...pose(0.38, 'lin', {
      hips: { yaw: -14, pitch: 8, z: 0.03, y: -0.16 },
      chest: { yaw: -26, pitch: 10 },
      head: { yaw: -10 },
      grip: [-26, 6, 0.42],
      ...plane(-60, 0),
      roll: -180,
      pole: [-0.5, -0.8, 0],
    }),
    ...pose(0.5, 'lin', {
      hips: { yaw: -14, pitch: 8, z: 0.03, y: -0.16 },
      chest: { yaw: -26, pitch: 10 },
      head: { yaw: -10 },
      grip: [-26, 6, 0.42],
      ...plane(-60, 0),
      roll: -180,
      pole: [-0.5, -0.8, 0],
    }),
    ...pose(0.82, 'io', GS_READY),
  ],
};

// ---------------------------------------------------------------- 大回転斬り（ロック中にスティック横）

/** 巻き込み: 右へ大きくひねって、剣を右後ろへ水平に引く。腰を深く沈める（跳び上がる前の溜め） */
const SPIN_COIL = {
  hips: { yaw: 26, pitch: 8, z: 0, y: -0.26 },
  chest: { yaw: 52, pitch: 8 },
  head: { yaw: 12 },
  grip: [12, -4, 0.38] as V3,
  ...plane(78, 0),
  roll: -75,
  pole: [-0.6, -0.8, 0.1] as V3,
};

/** 回転中の腕と剣（胸の座標で一定）: 剣は体の右前へ水平に伸びる。体が回るあいだ、世界では剣が円を描く */
const SPIN_ARMS = {
  grip: [6, 2, 0.42] as V3,
  ...plane(62, 0),
  roll: -75,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/**
 * 大回転斬り（ロック中にスティックを横へ倒して攻撃）: 腰を沈めて右へ巻き込み、跳び上がりながら体ごと左へ 1 回転して、剣で水平の円を描く。全方位を薙ぐ範囲の広い技。
 * 回転は腰・胸のヨーを 360° 回して作り、腕と剣は胸に対して一定（足は跳んでいるあいだ腰に付いて回る）。
 * 0 → 0.2 巻き込んで沈む / 0.2 → 0.46 跳び上がって回る（0.23〜0.43 に剣が全周を通る）/ 0.46 → 0.56 着地して沈む / 0.56 → 0.64 保つ / 0.64 → 0.98 戻り。
 * ルートは 0.2 から 0.46 までに 0.7 m 前へ（敵の方へ回り込んで跳ぶ）。
 */
export const GS_SPIN: AuthoredAttack = {
  name: 'gsSpin',
  duration: 0.98,
  twoHanded: GS_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [
    // ---- ルート ----
    { t: 0.2, ease: 'lin', rootZ: 0 },
    { t: 0.32, ease: 'in', rootZ: 0.3 },
    { t: 0.46, ease: 'out', rootZ: 0.7 },
    // ---- 足: 跳ぶまで世界に固定 → 腰に付いて回る（膝を曲げてぶら下がる）→ 着地で世界に固定 ----
    { t: 0.2, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: 0, lift: 0 } },
    { t: 0.25, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.64, lz: 0.08, knee: 1 }, footR: { rel: 1, lx: -0.11, ly: -0.66, lz: -0.04, knee: 1 } },
    { t: 0.42, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.7, lz: 0.06, knee: 0.4 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 0.4 } },
    { t: 0.48, ease: 'io', footL: { rel: 0, z: 0.8, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 0.65, x: 0, lift: 0, pitch: 0 } },
    { t: 0.98, ease: 'io', footL: { z: 0.7 }, footR: { z: 0.7 } },
    // ---- 腰: 沈む（0.2 まで。巻き込みの姿勢）→ 跳ぶ → 着地で沈む → 立つ ----
    { t: 0.3, ease: 'out', hips: { y: 0.2 } },
    { t: 0.4, ease: 'lin', hips: { y: 0.16 } },
    { t: 0.5, ease: 'in', hips: { y: -0.2 } },
    { t: 0.64, ease: 'lin', hips: { y: -0.2 } },
    // ---- 体の回転（ヨー。腰・胸が 360° 左へ回る）と腕 ----
    ...pose(0.2, 'io', SPIN_COIL),
    { t: 0.3, ease: 'out', ...SPIN_ARMS },
    { t: 0.4, ease: 'lin', ...SPIN_ARMS, hips: { yaw: -334 }, chest: { yaw: -308 }, head: { yaw: -348 } },
    { t: 0.5, ease: 'out', hips: { yaw: -346, pitch: 10 }, chest: { yaw: -322, pitch: 12 }, head: { yaw: -350 } },
    { t: 0.64, ease: 'lin', hips: { yaw: -346, pitch: 10 }, chest: { yaw: -322, pitch: 12 }, head: { yaw: -350 } },
    // 戻り: 回転は 360° で元の向きに戻っているので、構えの姿勢の値は 360° 引いたもの
    ...pose(0.98, 'io', { ...GS_READY, hips: { ...GS_READY.hips, yaw: GS_READY.hips.yaw - 360 }, chest: { ...GS_READY.chest, yaw: GS_READY.chest.yaw - 360 }, head: { yaw: GS_READY.head.yaw - 360 } }),
  ],
};

// ---------------------------------------------------------------- ロール直後の跳び叩きつけ

/** 跳ぶ前の溜め（ロールの着地から立ち上がりながら）: 剣を右肩の後ろへ引き上げる */
const LEAP_GATHER = {
  hips: { yaw: 14, pitch: 6, z: -0.02, y: -0.26 },
  chest: { yaw: 28, pitch: 8 },
  head: { yaw: 6 },
  grip: [24, 38, 0.36] as V3,
  ...plane(118, 66),
  roll: -15,
  pole: [-0.55, -0.8, -0.1] as V3,
};

/** 空中: 剣を頭上へ高く掲げる（刃は後ろ上へ）。体は反る */
const LEAP_TOP = {
  hips: { yaw: 4, pitch: -6, z: -0.04, y: 0.12 },
  chest: { yaw: 6, pitch: -12 },
  head: { yaw: 2 },
  grip: [12, 62, 0.34] as V3,
  ...plane(128, 90),
  roll: 0,
  pole: [-0.65, -0.75, -0.2] as V3,
};

/** 着地と叩きつけ: 深く沈んで前へ倒れ、剣が体の前の低い所を指す（切っ先は床すれすれ） */
const SLAM = {
  hips: { yaw: 0, pitch: 16, z: 0.1, y: -0.26 },
  chest: { yaw: 0, pitch: 26 },
  head: { yaw: 0 },
  grip: [-2, -6, 0.46] as V3,
  blade: [0, -0.06, 1] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.4, -0.9, -0.1] as V3,
};

/**
 * 跳び叩きつけ（ロール直後に攻撃）: 転がって着地した低い姿勢から、剣を引き上げて前へ高く跳び、体重を乗せて真上から叩きつける。ロールで間合いを詰めて一撃を入れる技。
 * ロールの着地の姿勢（0.43s）から続けて始まる（continueFrom）。
 * 0 → 0.15 立ち上がりながら引き上げる / 0.15 → 0.3 跳んで頭上へ掲げる / 0.3 → 0.36 叩きつけて両足で着地（0.34 に最高速。当たりは 0.3〜0.4）/ 0.36 → 0.56 保つ / 0.56 → 0.92 戻り。
 * ルートは 0.15 から 0.36 までに 1.6 m 前へ（跳び込み）。
 */
export const GS_DASH: AuthoredAttack = {
  name: 'gsDash',
  duration: 0.92,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_DODGE, t: 0.43 },
  keys: [
    // ---- ルート ----
    { t: 0.15, ease: 'lin', rootZ: 0 },
    { t: 0.25, ease: 'in', rootZ: 0.5 },
    { t: 0.36, ease: 'out', rootZ: 1.6 },
    // ---- 足: ロールの着地の位置 → 跳ぶあいだは腰にぶら下がる → 両足で着地 ----
    { t: 0.15, ease: 'lin', footL: { rel: 0, z: 0.2, lift: 0 }, footR: { rel: 0, z: -0.05, lift: 0 } },
    { t: 0.2, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.66, lz: 0.06, knee: 0.6 }, footR: { rel: 1, lx: -0.11, ly: -0.68, lz: -0.04, knee: 0.6 } },
    { t: 0.3, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.74, lz: 0.1, knee: 0.1 }, footR: { rel: 1, lx: -0.11, ly: -0.72, lz: 0, knee: 0.1 } },
    { t: 0.36, ease: 'io', footL: { rel: 0, z: 1.9, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 1.5, x: 0, lift: 0, pitch: 0 } },
    { t: 0.92, ease: 'io', footL: { z: 1.6 }, footR: { z: 1.6 } },
    // ---- 引き上げる → 跳んで掲げる → 叩きつける → 保つ → 戻る ----
    ...pose(0.15, 'io', LEAP_GATHER),
    ...pose(0.28, 'out', LEAP_TOP),
    ...pose(0.36, 'in', SLAM),
    ...pose(0.56, 'lin', SLAM),
    ...pose(0.92, 'io', GS_READY),
  ],
};

// ---------------------------------------------------------------- 後ろステップ直後の斬り上げ

/** 低く構えた巻き込み（着地した低い姿勢から）: 剣を右の低い所へ水平に寝かせて、体を右へひねる */
const RISE_COIL = {
  hips: { yaw: 18, pitch: 12, z: -0.02, y: -0.26 },
  chest: { yaw: 32, pitch: 14 },
  head: { yaw: 8 },
  grip: [20, -24, 0.36] as V3,
  ...plane(104, 0),
  roll: -75,
  pole: [-0.6, -0.8, -0.2] as V3,
};

/** 振り上げの終わり: 剣が左上へ抜け、体は反る */
const RISE_END = {
  hips: { yaw: -8, pitch: -8, z: 0.04, y: -0.08 },
  chest: { yaw: -12, pitch: -14 },
  head: { yaw: -6 },
  grip: [-10, 50, 0.4] as V3,
  ...plane(-72, -35),
  roll: -180,
  pole: [-0.5, -0.8, 0] as V3,
};

/**
 * 斬り上げ（後ろステップ直後に攻撃）: 下がって間合いを取ったあと、低い姿勢から踏み込んで剣を右下から左上へすくい上げる。逆襲の技。
 * 後ろステップの着地の姿勢（0.36s）から続けて始まる（continueFrom）。
 * 0 → 0.14 低く巻き込む / 0.14 → 0.23 すくい上げる（0.23 に前を通る最高速。右足は 0.23 に着地）/ 0.23 → 0.34 左上へ振り抜く / 0.34 → 0.5 保つ / 0.5 → 0.86 戻り。
 * ルートは 0.06 から 0.23 までに 0.6 m、減速して 0.38 までに 1.0 m。
 */
export const GS_RISE: AuthoredAttack = {
  name: 'gsRise',
  duration: 0.86,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_DODGE_BACK, t: 0.36 },
  keys: [
    // ---- 下半身 ----
    { t: 0.06, ease: 'lin', rootZ: 0 },
    { t: 0.23, ease: 'in', rootZ: 0.6 },
    { t: 0.38, ease: 'out', rootZ: 1.0 },
    { t: 0.05, ease: 'lin', footR: { z: 0 } },
    { t: 0.23, ease: 'io', footR: { z: 0.95, arc: 0.14 } },
    { t: 0.5, ease: 'lin', footR: { z: 0.95 } },
    { t: 0.86, ease: 'io', footR: { z: 1.0, arc: 0.03 } },
    { t: 0.2, ease: 'lin', footL: { z: 0 } },
    { t: 0.38, ease: 'out', footL: { z: 0.55, arc: 0.07 } },
    { t: 0.5, ease: 'lin', footL: { z: 0.55 } },
    { t: 0.86, ease: 'io', footL: { z: 1.0, arc: 0.1 } },
    // ---- 巻き込む → すくい上げる → 振り抜く → 保つ → 戻る ----
    ...pose(0.14, 'io', RISE_COIL),
    ...pose(0.23, 'in', {
      hips: { yaw: -4, pitch: 8, z: 0.06, y: -0.22 },
      chest: { yaw: -6, pitch: 10 },
      head: { yaw: -3 },
      grip: [8, 0, 0.44],
      ...plane(-8, -35),
      roll: -165,
      pole: [-0.4, -0.85, -0.1],
    }),
    ...pose(0.34, 'out', RISE_END),
    ...pose(0.5, 'lin', RISE_END),
    ...pose(0.86, 'io', GS_READY),
  ],
};
