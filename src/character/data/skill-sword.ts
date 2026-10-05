import type { AuthoredAttack, AuthoredKey } from '../authoring';
import { COMBO2 } from './combo2';
import { plane, planeL } from './cutting-plane';
import { OFFHAND } from './offhand';
import { LEAD, pose } from './stagger';

/**
 * 片手剣の剣技（ADR-031）の専用モーション。座標の約束は combo1.ts と同じ（胸の座標系。右 = −X、上 = +Y、前 = +Z。
 * grip = [方位°（正面から右へ）, 仰角°, 右肩からの距離 m]、plane(θ, tilt) / planeL(θ, tilt) = 斬りの面の中の刃）。
 *
 *  - 四連斬（剣技「四ツ葉」）: 右袈裟（combo1）→ 右逆袈裟（combo2）→ **左袈裟（QUAD3）→ 左逆袈裟（QUAD4）**。左右の斜め斬りが 4 つ連なる。
 *    前半の 2 つは既存の技（手付けの combo1 / combo2）を速めて使い、後半の 2 つを左右反転した新しい動きにした（足は左右が交互に踏み込む）。
 *  - 高速突き 5 連（剣技「五月雨突き」, FLURRY）: フェンシングの構えから、5 回続けて素早く突く。
 *  - 回転斬り 2 周半（剣技「竜巻」, WHIRL）: 体ごと 2 周半回って、前の半円に 3 回、後ろの半円に 2 回当てる。
 */

type V3 = [number, number, number];

export const RETURN = {
  hips: { yaw: 0, pitch: 0, z: 0, y: 0 },
  chest: { yaw: 0, pitch: 0 },
  head: { yaw: 0 },
  grip: 'idle',
  blade: 'idle',
  pole: 'idle',
  left: 'idle',
  leftPole: 'idle',
} as const;

// ================================================================= 左袈裟（四連斬の 3 つ目）

/** 予備動作の頂点: 右上へ抜けた剣を頭上へ回し、左上へ振りかぶる（combo1 の WINDUP の左右反転）。腰を左へひねる */
export const QUAD3_WINDUP = {
  hips: { yaw: -14, pitch: -3, z: -0.04, y: -0.05 },
  chest: { yaw: -34, pitch: -8 },
  head: { yaw: -8 },
  grip: [-42, 60, 0.33] as V3,
  ...planeL(115),
  roll: -20,
  pole: [-0.6, -0.8, -0.1] as V3,
  ...OFFHAND.guard,
};

/** 振り抜きの終わり: 剣は右下へ抜け、体は右へひねり切る（combo1 の FOLLOW の左右反転）。次段（左逆袈裟）はこの姿勢から続く */
export const QUAD3_FOLLOW = {
  hips: { yaw: 16, pitch: 9, z: 0.05, y: -0.1 },
  chest: { yaw: 30, pitch: 14 },
  head: { yaw: 10 },
  grip: [48, -26, 0.43] as V3,
  ...planeL(-68),
  roll: 15,
  pole: [-0.5, -0.8, 0] as V3,
  ...OFFHAND.hip,
};

/** 左袈裟が次段を受け付ける時刻（振り抜いた姿勢を保つ 0.27〜0.36。AttackDef.cancelAt と同じ） */
export const QUAD3_HOLD_T = 0.27;

/**
 * 左袈裟（左上から右下へ斜めに斬り下ろす）: 右逆袈裟（combo2）の受付時点（0.34s）の姿勢から続けて始まる（continueFrom）。左足を踏み込む。
 * 0 → 0.09 頭上へ回して左上へ振りかぶる（0.09〜0.11 は頂点で一拍）/ 0.11 → 0.2 斬り下ろす（0.165 に体の前を通る最高速。左足は 0.15 に着地）/ 0.2 → 0.27 振り抜く / 0.27 → 0.36 保つ（次段の受付）/ 0.36 → 0.52 戻り。
 * 足は世界に固定（足の z はこの技の開始時のルートから: 右足 +0.2、左足 −0.38 から始まる）。ルートは 0.02 から 0.26 までに 0.46 m。
 */
export const QUAD3: AuthoredAttack = {
  name: 'quad3',
  duration: 0.52,
  continueFrom: { attack: COMBO2, t: 0.34 },
  keys: [
    // ---- 下半身: 後ろにいた左足が弧を描いて前へ着地する。右足は残り、戻りで揃う ----
    { t: 0.02, ease: 'lin', rootZ: 0 },
    { t: 0.15, ease: 'in', rootZ: 0.22 },
    { t: 0.26, ease: 'out', rootZ: 0.46 },
    { t: 0.02, ease: 'lin', footL: { arc: 0 }, footR: { arc: 0 } },
    { t: 0.15, ease: 'io', footL: { z: 0.4, arc: 0.14 } },
    { t: 0.36, ease: 'lin', footL: { z: 0.4 } },
    { t: 0.52, ease: 'io', footL: { z: 0.46, arc: 0.04 } },
    { t: 0.26, ease: 'lin', footR: { z: 0.2 } },
    { t: 0.36, ease: 'lin', footR: { z: 0.2 } },
    { t: 0.52, ease: 'io', footR: { z: 0.46, arc: 0.1 } },
    // ---- 振りかぶる → 斬り下ろす → 振り抜く → 保つ → 戻る ----
    ...pose(0.09, 'io', QUAD3_WINDUP),
    ...pose(0.11, 'lin', QUAD3_WINDUP),
    ...pose(0.165, 'in', {
      hips: { yaw: 0, pitch: 7, z: 0.05, y: -0.14 },
      chest: { yaw: 0, pitch: 11 },
      head: { yaw: 0 },
      grip: [-8, 12, 0.46],
      ...planeL(-20),
      roll: 20,
      pole: [-0.3, -0.9, -0.2],
      ...OFFHAND.pull,
    }),
    ...pose(0.2, 'out', {
      hips: { yaw: 14, pitch: 8, z: 0.05, y: -0.13 },
      chest: { yaw: 26, pitch: 13 },
      head: { yaw: 8 },
      grip: [34, -18, 0.46],
      ...planeL(-55),
      roll: 20,
      pole: [-0.5, -0.8, 0],
      ...OFFHAND.hip,
    }),
    ...pose(QUAD3_HOLD_T, 'out', QUAD3_FOLLOW),
    ...pose(0.36, 'lin', QUAD3_FOLLOW),
    ...pose(0.52, 'io', RETURN),
  ],
};

// ================================================================= 左逆袈裟（四連斬の 4 つ目）

/** 引き込み: 右下へ抜けた剣を、そのまま右下の低い所へ引いて溜める（combo2 の溜めの左右反転）。右へひねる */
export const QUAD4_COIL = {
  hips: { yaw: 20, pitch: 7, z: 0.03, y: -0.12 },
  chest: { yaw: 38, pitch: 14 },
  head: { yaw: 12 },
  grip: [58, -34, 0.42] as V3,
  ...planeL(-82),
  pole: [-0.5, -0.8, 0] as V3,
  ...OFFHAND.hip,
};

/** 振り抜きの終わり: 剣は左上へ抜け、体は左へひねる（combo2 の FOLLOW の左右反転） */
export const QUAD4_FOLLOW = {
  hips: { yaw: -14, pitch: 6, z: 0.05, y: -0.1 },
  chest: { yaw: -26, pitch: 11 },
  head: { yaw: -10 },
  grip: [-34, 32, 0.45] as V3,
  ...planeL(88),
  pole: [-0.5, -0.85, -0.1] as V3,
  ...OFFHAND.guard,
};

/** 左逆袈裟が次段を受け付ける時刻（振り抜いた姿勢を保つ 0.25〜0.34。AttackDef.cancelAt と同じ。将来、レベルで続きが伸びるときに使う） */
export const QUAD4_HOLD_T = 0.25;

/**
 * 左逆袈裟（右下から左上へ斬り上げる）: 左袈裟（QUAD3）の受付時点（0.27s）の姿勢から続けて始まる（continueFrom）。右足を踏み込む。四連斬のとどめ。
 * 0 → 0.07 右下へ引いて溜める / 0.07 → 0.13 加速 / 0.13 → 0.2 斬り上げて減速（0.13 に体の前を通る最高速。右足は 0.13 に着地）/ 0.2 → 0.25 振り抜く / 0.25 → 0.34 保つ / 0.34 → 0.52 戻り。
 * 足は世界に固定（足の z はこの技の開始時のルートから: 左足 −0.06、右足 −0.26 から始まる）。ルートは 0.01 から 0.24 までに 0.46 m。
 */
export const QUAD4: AuthoredAttack = {
  name: 'quad4',
  duration: 0.52,
  continueFrom: { attack: QUAD3, t: QUAD3_HOLD_T },
  keys: [
    // ---- 下半身: 後ろにいた右足が弧を描いて前へ着地する。左足は残り、戻りで揃う ----
    { t: 0.01, ease: 'lin', rootZ: 0 },
    { t: 0.13, ease: 'in', rootZ: 0.26 },
    { t: 0.24, ease: 'out', rootZ: 0.46 },
    { t: 0.01, ease: 'lin', footL: { arc: 0 }, footR: { arc: 0 } },
    { t: 0.13, ease: 'io', footR: { z: 0.6, arc: 0.14 } },
    { t: 0.34, ease: 'lin', footR: { z: 0.6 } },
    { t: 0.52, ease: 'io', footR: { z: 0.46, arc: 0.04 } },
    { t: 0.24, ease: 'lin', footL: { z: -0.06 } },
    { t: 0.34, ease: 'lin', footL: { z: -0.06 } },
    { t: 0.52, ease: 'io', footL: { z: 0.46, arc: 0.1 } },
    // ---- 引き込む → 斬り上げる → 振り抜く → 保つ → 戻る ----
    ...pose(0.07, 'io', QUAD4_COIL),
    ...pose(0.13, 'in', {
      hips: { yaw: 0, pitch: 7, z: 0.05, y: -0.14 },
      chest: { yaw: -2, pitch: 10 },
      head: { yaw: 0 },
      grip: [-6, 4, 0.46],
      ...planeL(8),
      pole: [-0.3, -0.9, -0.2],
      ...OFFHAND.pull,
    }),
    ...pose(0.2, 'out', {
      hips: { yaw: -12, pitch: 6, z: 0.05, y: -0.12 },
      chest: { yaw: -22, pitch: 10 },
      head: { yaw: -8 },
      grip: [-30, 28, 0.46],
      ...planeL(80),
      pole: [-0.5, -0.85, -0.1],
      ...OFFHAND.guard,
    }),
    ...pose(QUAD4_HOLD_T, 'out', QUAD4_FOLLOW),
    ...pose(0.34, 'lin', QUAD4_FOLLOW),
    ...pose(0.52, 'io', RETURN),
  ],
};

// ================================================================= 高速突き（フェンシング。レベルで 5 → 7 → 9 連）

/**
 * 高速突きの仕様。クリップは同じ作りで、突きの回数・間隔を変えて 3 つ作る（剣技「五月雨突き」の進化。ADR-034）:
 * Lv1〜3 = 5 連（FLURRY）/ Lv4〜6 = 7 連 / Lv7〜 = 9 連 + とどめの深い突き（finisher）
 */
export interface FlurrySpec {
  id: string;
  /** 突きの回数と、1 回ごとの間隔（秒）。最初の突きが伸び切る時刻 */
  count: number;
  gap: number;
  first: number;
  /** 1 回ごとに間合いを詰める量（m）。回数が増えても総移動が増えすぎないように小さくする */
  step: number;
  /** とどめの 1 回を、深く踏み込んで長く突く（9 連） */
  finisher: boolean;
}

export const FLURRY5: FlurrySpec = { id: 'flurry', count: 5, gap: 0.11, first: 0.17, step: 0.078, finisher: false };
export const FLURRY7: FlurrySpec = { id: 'flurry7', count: 7, gap: 0.1, first: 0.17, step: 0.066, finisher: false };
export const FLURRY9: FlurrySpec = { id: 'flurry9', count: 9, gap: 0.095, first: 0.17, step: 0.058, finisher: true };

/** 突きが伸び切る時刻（秒）の列 */
export function flurryTimes(spec: FlurrySpec): number[] {
  return Array.from({ length: spec.count }, (_, n) => spec.first + spec.gap * n);
}

/** 既存の呼び名（5 連。テスト・古い参照用） */
export const FLURRY_COUNT = FLURRY5.count;
export const FLURRY_FIRST_T = FLURRY5.first;
export const FLURRY_GAP = FLURRY5.gap;
export const flurryThrustT = (n: number): number => FLURRY5.first + FLURRY5.gap * n;

/**
 * 構えの体の向き: 体を左へ開いて（右肩を前に出す）剣を前へ向ける。胸の座標系での「ワールドの前」は、胸の yaw 分だけ右へ振れる
 * （combo3.ts と同じ。yaw −26° なら方位 +26°）ので、突きの剣は方位 +26° へ伸ばす
 */
const FENCE_YAW = { hips: -22, chest: -26, head: -10 };
const FENCE_AZ = 26;
const FENCE_FWD = (pitch: number): V3 => [-0.438, pitch, 0.895];

/** 後ろの手（左）: 突くときは後ろへ振り出してバランスをとり、引きのときは肩の後ろに掲げる（フェンシングの後ろ手） */
const FENCE_REAR = {
  thrust: { left: [-112, -6, 0.46] as V3, leftPole: [0.6, -0.6, -0.5] as V3 },
  ready: { left: [-100, 22, 0.42] as V3, leftPole: [0.5, -0.5, -0.55] as V3 },
};

/** 突き: 腕が前へ伸び切る（剣が体の正面の胸の高さを貫く）。体が前へ飛び出し、上体が倒れる */
const FLURRY_THRUST = {
  hips: { yaw: FENCE_YAW.hips, pitch: 12, z: 0.14, y: -0.13 },
  chest: { yaw: FENCE_YAW.chest, pitch: 16 },
  head: { yaw: FENCE_YAW.head },
  grip: [FENCE_AZ, 6, 0.5] as V3,
  blade: FENCE_FWD(0.06),
  face: [0, 1, 0] as V3,
  roll: 0,
  pole: [-0.4, -0.9, -0.1] as V3,
  ...FENCE_REAR.thrust,
};

/** とどめの突き（9 連）: 深く踏み込み、体を前へ投げ出して、腕を目いっぱい伸ばす */
const FLURRY_THRUST_FINAL = {
  ...FLURRY_THRUST,
  hips: { yaw: FENCE_YAW.hips - 4, pitch: 18, z: 0.24, y: -0.22 },
  chest: { yaw: FENCE_YAW.chest - 4, pitch: 22 },
  grip: [FENCE_AZ, 8, 0.52] as V3,
  blade: FENCE_FWD(0.12),
};

/** 引き: 腕を畳んで次の突きに備える（剣は体の近くで切っ先をやや上げて前へ向けたまま）。上体は起き、体が少し後ろへ戻る */
const FLURRY_CHAMBER = {
  hips: { yaw: FENCE_YAW.hips, pitch: 2, z: -0.05, y: -0.1 },
  chest: { yaw: FENCE_YAW.chest, pitch: 4 },
  head: { yaw: FENCE_YAW.head },
  grip: [FENCE_AZ + 22, -6, 0.27] as V3,
  blade: FENCE_FWD(0.22),
  face: [0, 1, 0] as V3,
  roll: 0,
  pole: [-0.55, -0.8, -0.15] as V3,
  ...FENCE_REAR.ready,
};

/** 高速突きのクリップを作る（spec の回数・間隔。とどめの突きは深い） */
export function buildFlurry(spec: FlurrySpec): AuthoredAttack {
  const times = flurryTimes(spec);
  const last = times[times.length - 1]!;
  const end = last + 0.17;
  // とどめの突きで余分に進む量
  const extra = spec.finisher ? 0.26 : 0;
  const rootAt = (n: number): number => 0.12 + spec.step * (n + 1) + (spec.finisher && n === spec.count - 1 ? extra : 0);
  const rootEnd = 0.12 + spec.step * spec.count + extra;
  const duration = last + 0.39;
  const keys: AuthoredKey[] = [
    // ---- 下半身: 構えで右足が前へ。以降、突くたびに右足が踏み込み、左足が追う ----
    { t: 0.07, ease: 'lin', rootZ: 0 },
    { t: 0.1, ease: 'io', rootZ: 0.12 },
    ...times.map((te, n): AuthoredKey => ({ t: te, ease: 'out', rootZ: rootAt(n) })),
    { t: duration, ease: 'io', rootZ: rootEnd },
    { t: 0.02, ease: 'lin', footR: { z: 0 } },
    { t: 0.1, ease: 'io', footR: { z: 0.42, arc: 0.1 } },
    ...times.map((te, n): AuthoredKey => ({ t: te - 0.01, ease: 'io', footR: { z: 0.42 + spec.step * (n + 1) + (spec.finisher && n === spec.count - 1 ? extra : 0), arc: 0.03 } })),
    { t: end, ease: 'lin', footR: { z: 0.42 + spec.step * spec.count + extra } },
    { t: duration, ease: 'io', footR: { z: rootEnd, arc: 0.03 } },
    { t: 0.02, ease: 'lin', footL: { z: 0 } },
    { t: 0.12, ease: 'io', footL: { z: -0.13, arc: 0.04 } },
    ...times.map((te, n): AuthoredKey => ({ t: te + 0.05, ease: 'io', footL: { z: -0.13 + spec.step * (n + 1) + (spec.finisher && n === spec.count - 1 ? extra : 0), arc: 0.03 } })),
    { t: end, ease: 'lin', footL: { z: -0.13 + spec.step * spec.count + extra } },
    { t: duration, ease: 'io', footL: { z: rootEnd, arc: 0.1 } },
    // ---- 上半身: 構え → 突き ×回数（間に引き）→ 残心 → 戻り ----
    ...pose(0.1, 'io', FLURRY_CHAMBER),
    ...times.flatMap((te, n): AuthoredKey[] => {
      const out: AuthoredKey[] = [...pose(te, 'in', spec.finisher && n === spec.count - 1 ? FLURRY_THRUST_FINAL : FLURRY_THRUST)];
      if (n < spec.count - 1) out.push(...pose(te + spec.gap * 0.55, 'out', FLURRY_CHAMBER));
      return out;
    }),
    ...pose(end, 'out', { ...(spec.finisher ? FLURRY_THRUST_FINAL : FLURRY_THRUST), hips: { yaw: -18, pitch: spec.finisher ? 12 : 8, z: 0.08, y: -0.1 }, ...OFFHAND.hip }),
    ...pose(duration, 'io', RETURN),
  ];
  return { name: spec.id, duration, keys };
}

/**
 * 高速突き 5 連（剣技「五月雨突き」Lv1〜3）: 体を開いてフェンシングの構えをとり、間合いを小刻みに詰めながら、5 回続けて素早く突く。
 * 出が早く（構えは 0.1 秒、最初の突きは 0.17 秒）、1 回ごとの間隔も 0.11 秒と短い。突きは細く、前へ長く届く（当たりは AttackDef.windows）。
 * 0 → 0.1 構える / 0.17, 0.28, 0.39, 0.50, 0.61 に突きが伸び切る（突きの間に引きを挟む）/ 0.61 → 0.78 残心 / 0.78 → 1.0 戻り。
 * 足は世界に固定: 右足が構えで前へ踏み出し、突くたびに小さく踏み込む（0.078 m ずつ）。左足は右足を追う。ルートは 0.07 から 0.61 までに 0.5 m。
 * 7 連・9 連は同じ作りで回数・間隔が違う（FLURRY7 / FLURRY9。9 連はとどめの突きが深い）。
 */
export const FLURRY: AuthoredAttack = buildFlurry(FLURRY5);
export const FLURRY_7: AuthoredAttack = buildFlurry(FLURRY7);
export const FLURRY_9: AuthoredAttack = buildFlurry(FLURRY9);

// ================================================================= 回転斬り 2 周半

/** 回転の溜め: 右へ巻き込んで沈み、剣を右へ水平に寝かせる（comboSpin と同じ。0 → WHIRL_SPIN_T0） */
const WHIRL_COIL = {
  hips: { yaw: 24, pitch: 8, z: 0.02, y: -0.2 },
  chest: { yaw: 48, pitch: 8 },
  head: { yaw: 12 },
  grip: [14, 0, 0.4] as V3,
  ...plane(76, 0),
  roll: -75,
  pole: [-0.6, -0.8, 0.1] as V3,
  ...OFFHAND.guard,
};

/** 回転中の腕と剣（胸の座標で一定）: 剣は体の右前へ水平に伸びる。体が左へ回るので、世界では剣が円を描く。剣の向き（方位）は胸のヨー + この θ */
const WHIRL_ARMS = {
  grip: [6, 2, 0.44] as V3,
  ...plane(62, 0),
  roll: -75,
  pole: [-0.5, -0.8, 0.1] as V3,
  ...OFFHAND.hip,
};
/** 回転中、剣が胸の正面から右へずれている角（度）。plane(62, 0) の θ */
const WHIRL_BLADE_AZ = 62;

/** 回転の区間（秒）: 加速（WHIRL_SPIN_T0 → WHIRL_SPIN_T1）、一定の速さ（→ T2。周回の数で長さが変わる）、減速して止まる（→ T2 + WHIRL_DECEL） */
export const WHIRL_SPIN_T0 = 0.16;
export const WHIRL_SPIN_T1 = 0.3;
/** 減速して止まるまでの長さ（秒）。止まるまでに 208° 回る */
export const WHIRL_DECEL = 0.3;
const WHIRL_YAW0 = 48;
const WHIRL_YAW_AT_T1 = -62 - 20;
/** 一定の速さ（°/秒）。2 周半（900°）で T2 = 1.12 になる速さ */
const WHIRL_OMEGA = (WHIRL_YAW_AT_T1 - (WHIRL_YAW0 - 900 - 20)) / (1.12 - WHIRL_SPIN_T1);

/**
 * 回転斬りの仕様。クリップは同じ作りで、周回の数を変えて 3 つ作る（剣技「竜巻」の進化。ADR-034）:
 * Lv1〜3 = 2 周半（WHIRL）/ Lv4〜6 = 3 周半 / Lv7〜 = 4 周半。剣は 半周ごとに体の前・後ろを通る（周回 × 2 回: 前・後・前・後…）
 */
export interface WhirlSpec {
  id: string;
  /** 当たりのある周回の数（2.5 = 900°） */
  turns: number;
}

export const WHIRL25: WhirlSpec = { id: 'whirl', turns: 2.5 };
export const WHIRL35: WhirlSpec = { id: 'whirl35', turns: 3.5 };
export const WHIRL45: WhirlSpec = { id: 'whirl45', turns: 4.5 };

/** 仕様から決まる時刻・角度 */
export function whirlTimes(spec: WhirlSpec): { t2: number; stopT: number; duration: number; yawAtT2: number; yawStop: number; hits: number; extraRoot: number } {
  const yawAtT2 = WHIRL_YAW0 - 360 * spec.turns - 20;
  const t2 = WHIRL_SPIN_T1 + (WHIRL_YAW_AT_T1 - yawAtT2) / WHIRL_OMEGA;
  const stopT = t2 + WHIRL_DECEL;
  return {
    t2,
    stopT,
    duration: stopT + 0.3,
    yawAtT2,
    // 止まるのは、回りきった周回の次の整数周（2 周半 → 3 周）
    yawStop: -360 * Math.ceil(spec.turns),
    hits: Math.round(spec.turns * 2),
    // 周回が増えたぶん、前へ追う距離も増える（2 周半で 1.1 m。1 周増えるごとに +0.35 m）
    extraRoot: (spec.turns - 2.5) * 0.35,
  };
}

/** 秒 t の胸のヨー（度）。回転の 3 区間のイージングを authoring.ts と同じ式で再現する（当たりの時刻を求めるため） */
function whirlChestYaw(spec: WhirlSpec, t: number): number {
  const w = whirlTimes(spec);
  // 胸のキーは pose() が基準の時刻より LEAD.chest だけ早く置く（溜めのポーズ → 加速の区間の始まり）
  const t0 = WHIRL_SPIN_T0 - LEAD.chest;
  if (t <= t0) return WHIRL_YAW0;
  if (t <= WHIRL_SPIN_T1) {
    const u = (t - t0) / (WHIRL_SPIN_T1 - t0);
    return WHIRL_YAW0 + (WHIRL_YAW_AT_T1 - WHIRL_YAW0) * u * u; // in
  }
  if (t <= w.t2) {
    const u = (t - WHIRL_SPIN_T1) / (w.t2 - WHIRL_SPIN_T1);
    return WHIRL_YAW_AT_T1 + (w.yawAtT2 - WHIRL_YAW_AT_T1) * u; // lin
  }
  const u = Math.min(1, (t - w.t2) / (w.stopT - w.t2));
  return w.yawAtT2 + (w.yawStop - w.yawAtT2) * (1 - (1 - u) * (1 - u)); // out
}

/**
 * 剣の方位 heading(t)（度。左へ回るので減っていく）が、前（0°）・後ろ（180°）を 360° ごとに横切る時刻を、時刻の早い順に最大 want 個求める。
 * 横切った区間の中点を採る（前・後ろ・前・後ろ…。rear = 後ろを通った）
 */
export function findPasses(heading: (t: number) => number, tMax: number, want: number): { t: number; rear: boolean }[] {
  const out: { t: number; rear: boolean }[] = [];
  let prev = heading(0);
  const dt = 0.001;
  for (let t = dt; t <= tMax && out.length < want; t += dt) {
    const h = heading(t);
    const crossed = (target: number): boolean => Math.floor((prev - target) / 360) > Math.floor((h - target) / 360);
    if (crossed(0)) out.push({ t: t - dt / 2, rear: false });
    else if (crossed(180)) out.push({ t: t - dt / 2, rear: true });
    prev = h;
  }
  return out;
}

/**
 * 回転斬りで、剣が体の前・後ろを通る時刻（秒）。剣の方位 = 胸のヨー + WHIRL_BLADE_AZ（左へ回るので減っていく）が 0 / 180 を横切る瞬間を、
 * 胸のヨーの曲線から求める。前・後ろ・前・後ろ・前…（2 周半で 5 回 = 前の半円に 3 回、後ろの半円に 2 回）
 */
export function whirlPasses(spec: WhirlSpec): { t: number; rear: boolean }[] {
  const w = whirlTimes(spec);
  return findPasses((t) => whirlChestYaw(spec, t) + WHIRL_BLADE_AZ, w.stopT, w.hits);
}

/** 回転斬りのクリップを作る（spec の周回の数） */
export function buildWhirl(spec: WhirlSpec): AuthoredAttack {
  const w = whirlTimes(spec);
  const ex = w.extraRoot;
  return {
    name: spec.id,
    duration: w.duration,
    keys: [
      // ---- ルート（周回が増えたぶん、前へ追う距離も増える） ----
      { t: 0.16, ease: 'lin', rootZ: 0 },
      { t: 0.3, ease: 'in', rootZ: 0.15 },
      { t: w.t2 - 0.12, ease: 'lin', rootZ: 0.85 + ex },
      { t: w.stopT - 0.12, ease: 'out', rootZ: 1.1 + ex },
      // ---- 足: 回り始めるまで世界に固定 → 腰に付いて回る（膝を曲げてぶら下がる）→ 止まって世界に固定 ----
      { t: 0.16, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: 0, lift: 0 } },
      { t: 0.22, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.68, lz: 0.06, knee: 1 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 1 } },
      { t: w.t2 + 0.06, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.72, lz: 0.06, knee: 0.5 }, footR: { rel: 1, lx: -0.11, ly: -0.72, lz: -0.04, knee: 0.5 } },
      { t: w.stopT - 0.08, ease: 'io', footL: { rel: 0, z: 1.15 + ex, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 1.0 + ex, x: 0, lift: 0, pitch: 0 } },
      { t: w.duration, ease: 'io', footL: { z: 1.1 + ex }, footR: { z: 1.1 + ex } },
      // ---- 腰: 沈む（0.16）→ 低く回る → 止まって沈む → 立つ ----
      { t: 0.3, ease: 'out', hips: { y: 0.08 } },
      { t: w.t2 - 0.02, ease: 'lin', hips: { y: 0.04 } },
      { t: w.stopT - 0.06, ease: 'in', hips: { y: -0.14 } },
      { t: w.stopT + 0.08, ease: 'lin', hips: { y: -0.14 } },
      // ---- 体の回転（ヨー）と腕 ----
      ...pose(0.16, 'io', WHIRL_COIL),
      { t: WHIRL_SPIN_T1, ease: 'in', ...WHIRL_ARMS, hips: { yaw: WHIRL_YAW_AT_T1 - 24 }, chest: { yaw: WHIRL_YAW_AT_T1 }, head: { yaw: WHIRL_YAW_AT_T1 - 36 } },
      { t: w.t2, ease: 'lin', ...WHIRL_ARMS, hips: { yaw: w.yawAtT2 - 24 }, chest: { yaw: w.yawAtT2 }, head: { yaw: w.yawAtT2 - 36 } },
      { t: w.stopT, ease: 'out', hips: { yaw: w.yawStop - 24, pitch: 10 }, chest: { yaw: w.yawStop, pitch: 12 }, head: { yaw: w.yawStop - 36 } },
      { t: w.stopT + 0.08, ease: 'lin', hips: { yaw: w.yawStop - 24, pitch: 10 }, chest: { yaw: w.yawStop, pitch: 12 }, head: { yaw: w.yawStop - 36 } },
      // 戻り: 回転は整数周で元の向きに戻っているので、値は周回の角度を引いたもの
      ...pose(w.duration, 'io', { ...RETURN, hips: { yaw: w.yawStop, pitch: 0, z: 0, y: 0 }, chest: { yaw: w.yawStop, pitch: 0 }, head: { yaw: w.yawStop } }),
    ],
  };
}

/** 既存の呼び名（2 周半。テスト・古い参照用） */
export const WHIRL_STOP_T = whirlTimes(WHIRL25).stopT;
export const WHIRL_PASSES = whirlPasses(WHIRL25);

/**
 * 回転斬り 2 周半（剣技「竜巻」Lv1〜3）: 腰を沈めて右へ巻き込み、体ごと左へ 2 周半（900°）回りながら水平の円を描く。前の半円に 3 回、後ろの半円に 2 回当たる（AttackDef.windows）。
 * 回転は腰・胸・頭のヨーを回して作り、腕と剣は胸に対して一定。足は腰に付いて回る（床をすべる）。回転は加速 → 一定の速さ → 減速して、3 周（−1080°）で元の向きに止まる。
 * 0 → 0.16 巻き込んで沈む / 0.16 → 0.3 加速 / 0.3 → 1.12 一定の速さで回る（剣は 0.29, 0.5, 0.72, 0.93, 1.15 付近に体の前・後ろを通る）/ 1.12 → 1.42 減速して止まる / 1.42 → 1.72 保って戻り。
 * ルートは 0.16 から 1.2 までに 1.1 m 前へ（敵を追って回る）。3 周半（WHIRL_35）・4 周半（WHIRL_45）は同じ作りで周回が増える（一定の速さで回る時間が 0.37 秒ずつ伸びる）。
 */
export const WHIRL: AuthoredAttack = buildWhirl(WHIRL25);
export const WHIRL_35: AuthoredAttack = buildWhirl(WHIRL35);
export const WHIRL_45: AuthoredAttack = buildWhirl(WHIRL45);

// ================================================================= 突き込み（四連斬の 5 つ目。四ツ葉 Lv4 で加わる）

/** 引き絞り: 左上へ抜けた剣を、そのまま右腰へ引いて体を右へひねる。後ろ足を前へ引き寄せて、腰を沈める（combo3 の引き絞りと同じ） */
export const QUAD5_CHAMBER = {
  hips: { yaw: 20, pitch: 2, z: -0.03, y: -0.16 },
  chest: { yaw: 36, pitch: 4 },
  head: { yaw: 10 },
  grip: [50, -8, 0.3] as V3,
  blade: [0.588, 0.1, 0.8] as V3,
  face: [0, 1, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.85, -0.1] as V3,
  ...OFFHAND.guard,
};

/** 突き: 右足を大きく踏み込み、剣が体の正面を真っ直ぐ貫く（切っ先は胸の高さ。胸のヨーを打ち消して、ワールドの前へ伸ばす） */
export const QUAD5_THRUST = {
  hips: { yaw: -8, pitch: 8, z: 0.1, y: -0.18 },
  chest: { yaw: -8, pitch: 12 },
  head: { yaw: -4 },
  grip: [8, 6, 0.48] as V3,
  blade: [-0.139, 0.06, 0.99] as V3,
  face: [0, 1, 0] as V3,
  roll: 0,
  pole: [-0.4, -0.9, 0] as V3,
  ...OFFHAND.pull,
};

/** 突き込みが次段（回し斬り）を受け付ける時刻（伸び切った姿勢を保つ 0.23〜0.34。AttackDef.cancelAt と同じ） */
export const QUAD5_HOLD_T = 0.26;

/**
 * 突き込み（四ツ葉の 5 つ目。Lv4 から）: 左逆袈裟（QUAD4）の受付時点（0.25s）の姿勢から続けて、剣を右腰へ引き絞り、右足を大きく踏み込んで真っ直ぐ突く。長く、強い 1 撃。
 * 0 → 0.12 右へひねって引き絞る（後ろ足を前へ引き寄せる）/ 0.12 → 0.17 突き出す（0.17 に最高速。右足は 0.17 に着地）/ 0.17 → 0.24 伸び切る / 0.24 → 0.34 保つ（次段の受付 0.26〜）/ 0.34 → 0.62 戻り。
 * 足は世界に固定（足の z はこの技の開始時のルートから: 右足 +0.14、左足 −0.52 から始まる）。ルートは 0.04 から 0.17 までに 0.62 m、減速して 0.26 までに 0.85 m。
 */
export const QUAD5: AuthoredAttack = {
  name: 'quad5',
  duration: 0.62,
  continueFrom: { attack: QUAD4, t: QUAD4_HOLD_T },
  keys: [
    // ---- 下半身: 後ろ足を前へ引き寄せてから、前足（右）が弧を描いて飛び込む。着地のあと後ろ足が追い、戻りで揃う ----
    { t: 0.04, ease: 'lin', rootZ: 0 },
    { t: 0.17, ease: 'in', rootZ: 0.62 },
    { t: 0.26, ease: 'out', rootZ: 0.85 },
    { t: 0.04, ease: 'lin', footR: { z: 0.14 }, footL: { z: -0.52 } },
    { t: 0.17, ease: 'io', footR: { z: 1.02, arc: 0.1 } },
    { t: 0.34, ease: 'lin', footR: { z: 1.02 } },
    { t: 0.62, ease: 'io', footR: { z: 0.85, arc: 0.03 } },
    { t: 0.12, ease: 'io', footL: { z: 0.1, arc: 0.06 } },
    { t: 0.17, ease: 'lin', footL: { z: 0.1 } },
    { t: 0.24, ease: 'out', footL: { z: 0.4, arc: 0.05 } },
    { t: 0.34, ease: 'lin', footL: { z: 0.4 } },
    { t: 0.62, ease: 'io', footL: { z: 0.85, arc: 0.1 } },
    // ---- 引き絞る → 突く → 伸び切る → 保つ → 戻る ----
    ...pose(0.1, 'io', QUAD5_CHAMBER),
    ...pose(0.12, 'lin', QUAD5_CHAMBER),
    ...pose(0.17, 'in', QUAD5_THRUST),
    ...pose(0.24, 'out', { ...QUAD5_THRUST, hips: { yaw: -10, pitch: 6, z: 0.08, y: -0.16 } }),
    ...pose(0.34, 'lin', { ...QUAD5_THRUST, hips: { yaw: -10, pitch: 6, z: 0.08, y: -0.16 } }),
    ...pose(0.62, 'io', RETURN),
  ],
};

// ================================================================= 回し斬り（四連斬の 6 つ目。四ツ葉 Lv7 で加わる）

/** 回し斬りの回転（胸のヨー。度）: 巻き込みの +48 から、左へ 1 周（360°）して −312 まで。腰は胸より 24° 遅れ、頭は 36° 先行する（WHIRL と同じ） */
const SPIN1_T0 = 0.12;
const SPIN1_T1 = 0.32;
const SPIN1_YAW0 = 48;
const SPIN1_YAW1 = SPIN1_YAW0 - 360;

/** 回し斬りで剣が体の前・後ろを通る時刻（胸のヨーは SPIN1_T0 − LEAD.chest から SPIN1_T1 まで直線で減る） */
export const QUAD6_PASSES = findPasses(
  (t) => {
    const t0 = SPIN1_T0 - LEAD.chest;
    const u = Math.min(1, Math.max(0, (t - t0) / (SPIN1_T1 - t0)));
    return SPIN1_YAW0 + (SPIN1_YAW1 - SPIN1_YAW0) * u + WHIRL_BLADE_AZ;
  },
  SPIN1_T1,
  2,
);

/**
 * 回し斬り（四ツ葉の 6 つ目。Lv7 から）: 突き込み（QUAD5）の受付時点（0.26s）の姿勢から続けて、右へ巻き込んで沈み、跳び上がって体ごと左へ 1 回転しながら水平の円を描く。
 * 前の半円に 1 回、後ろの半円に 1 回当たる（AttackDef.windows）。突き込みで貫いた敵を、そのまま回って薙ぎ払う締め。
 * 0 → 0.12 巻き込んで沈む / 0.12 → 0.32 跳び上がって回る / 0.32 → 0.4 着地して沈む / 0.4 → 0.48 保つ / 0.48 → 0.8 戻り。
 * ルートは 0.12 から 0.34 までに 0.45 m 前へ。足は跳ぶまで世界に固定（開始時は突き込みの終わり: 右足 +0.17、左足 −0.45）→ 腰に付いて回る → 着地で世界に固定。
 */
export const QUAD6: AuthoredAttack = {
  name: 'quad6',
  duration: 0.8,
  continueFrom: { attack: QUAD5, t: QUAD5_HOLD_T },
  keys: [
    // ---- ルート ----
    { t: 0.12, ease: 'lin', rootZ: 0 },
    { t: 0.24, ease: 'in', rootZ: 0.18 },
    { t: 0.34, ease: 'out', rootZ: 0.45 },
    // ---- 足 ----
    { t: 0.12, ease: 'lin', footL: { rel: 0, z: -0.45, lift: 0 }, footR: { rel: 0, z: 0.17, lift: 0 } },
    { t: 0.16, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.64, lz: 0.06, knee: 1 }, footR: { rel: 1, lx: -0.11, ly: -0.66, lz: -0.04, knee: 1 } },
    { t: 0.3, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.7, lz: 0.06, knee: 0.4 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 0.4 } },
    { t: 0.36, ease: 'io', footL: { rel: 0, z: 0.5, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 0.35, x: 0, lift: 0, pitch: 0 } },
    { t: 0.8, ease: 'io', footL: { z: 0.45 }, footR: { z: 0.45 } },
    // ---- 腰: 沈む（0.12）→ 跳ぶ → 着地で沈む → 立つ ----
    { t: 0.22, ease: 'out', hips: { y: 0.18 } },
    { t: 0.3, ease: 'lin', hips: { y: 0.14 } },
    { t: 0.38, ease: 'in', hips: { y: -0.18 } },
    { t: 0.48, ease: 'lin', hips: { y: -0.18 } },
    // ---- 体の回転（ヨー。腰・胸が 360° 左へ回る）と腕 ----
    ...pose(SPIN1_T0, 'io', WHIRL_COIL),
    { t: 0.2, ease: 'out', ...WHIRL_ARMS },
    { t: SPIN1_T1, ease: 'lin', ...WHIRL_ARMS, hips: { yaw: SPIN1_YAW1 - 24 }, chest: { yaw: SPIN1_YAW1 }, head: { yaw: SPIN1_YAW1 - 36 } },
    { t: 0.4, ease: 'out', hips: { yaw: SPIN1_YAW1 - 36, pitch: 10 }, chest: { yaw: SPIN1_YAW1 - 18, pitch: 12 }, head: { yaw: SPIN1_YAW1 - 38 } },
    { t: 0.48, ease: 'lin', hips: { yaw: SPIN1_YAW1 - 36, pitch: 10 }, chest: { yaw: SPIN1_YAW1 - 18, pitch: 12 }, head: { yaw: SPIN1_YAW1 - 38 } },
    // 戻り: 回転は 360° で元の向きに戻っているので、値は 360° 引いたもの
    ...pose(0.8, 'io', { ...RETURN, hips: { yaw: -360, pitch: 0, z: 0, y: 0 }, chest: { yaw: -360, pitch: 0 }, head: { yaw: -360 } }),
  ],
};
