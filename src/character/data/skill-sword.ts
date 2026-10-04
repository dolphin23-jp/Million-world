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

// ================================================================= 左袈裟（四連斬の 3 つ目）

/** 予備動作の頂点: 右上へ抜けた剣を頭上へ回し、左上へ振りかぶる（combo1 の WINDUP の左右反転）。腰を左へひねる */
const QUAD3_WINDUP = {
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
const QUAD3_FOLLOW = {
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
const QUAD4_COIL = {
  hips: { yaw: 20, pitch: 7, z: 0.03, y: -0.12 },
  chest: { yaw: 38, pitch: 14 },
  head: { yaw: 12 },
  grip: [58, -34, 0.42] as V3,
  ...planeL(-82),
  pole: [-0.5, -0.8, 0] as V3,
  ...OFFHAND.hip,
};

/** 振り抜きの終わり: 剣は左上へ抜け、体は左へひねる（combo2 の FOLLOW の左右反転） */
const QUAD4_FOLLOW = {
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

// ================================================================= 高速突き 5 連（フェンシング）

/** 突きの回数と、1 回ごとの間隔（秒）。最初の突きの時刻 */
export const FLURRY_COUNT = 5;
export const FLURRY_FIRST_T = 0.17;
export const FLURRY_GAP = 0.11;
/** n 回目（0 始まり）の突きが伸び切る時刻 */
export const flurryThrustT = (n: number): number => FLURRY_FIRST_T + FLURRY_GAP * n;

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

function flurryKeys(): AuthoredKey[] {
  const keys: AuthoredKey[] = [];
  // 構え（0 → 0.1）
  keys.push(...pose(0.1, 'io', FLURRY_CHAMBER));
  for (let n = 0; n < FLURRY_COUNT; n++) {
    const te = flurryThrustT(n);
    // 突き出し（短く速く: 加速して伸び切る）と、引き（伸び切ってから素早く戻る）
    keys.push(...pose(te, 'in', FLURRY_THRUST));
    if (n < FLURRY_COUNT - 1) keys.push(...pose(te + FLURRY_GAP * 0.55, 'out', FLURRY_CHAMBER));
  }
  return keys;
}

/** 5 回目の突きが伸び切ってから、残心を保つ長さ */
const FLURRY_END = flurryThrustT(FLURRY_COUNT - 1);

/**
 * 高速突き 5 連（剣技）: 体を開いてフェンシングの構えをとり、間合いを小刻みに詰めながら、5 回続けて素早く突く。
 * 出が早く（構えは 0.1 秒、最初の突きは 0.17 秒）、1 回ごとの間隔も 0.11 秒と短い。突きは細く、前へ長く届く（当たりは AttackDef.windows）。
 * 0 → 0.1 構える / 0.17, 0.28, 0.39, 0.50, 0.61 に突きが伸び切る（突きの間に引きを挟む）/ 0.61 → 0.78 残心 / 0.78 → 1.0 戻り。
 * 足は世界に固定: 右足が構えで前へ踏み出し、突くたびに小さく踏み込む（0.07 m ずつ）。左足は右足を追う。ルートは 0.07 から 0.61 までに 0.5 m。
 */
export const FLURRY: AuthoredAttack = {
  name: 'flurry',
  duration: 1.0,
  keys: [
    // ---- 下半身: 構えで右足が前へ。以降、突くたびに右足が踏み込み、左足が追う ----
    { t: 0.07, ease: 'lin', rootZ: 0 },
    { t: 0.1, ease: 'io', rootZ: 0.12 },
    ...Array.from({ length: FLURRY_COUNT }, (_, n): AuthoredKey => ({ t: flurryThrustT(n), ease: 'out', rootZ: 0.12 + 0.078 * (n + 1) })),
    { t: 1.0, ease: 'io', rootZ: 0.51 },
    { t: 0.02, ease: 'lin', footR: { z: 0 } },
    { t: 0.1, ease: 'io', footR: { z: 0.42, arc: 0.1 } },
    ...Array.from({ length: FLURRY_COUNT }, (_, n): AuthoredKey => ({ t: flurryThrustT(n) - 0.01, ease: 'io', footR: { z: 0.42 + 0.078 * (n + 1), arc: 0.03 } })),
    { t: FLURRY_END + 0.17, ease: 'lin', footR: { z: 0.42 + 0.078 * FLURRY_COUNT } },
    { t: 1.0, ease: 'io', footR: { z: 0.51, arc: 0.03 } },
    { t: 0.02, ease: 'lin', footL: { z: 0 } },
    { t: 0.12, ease: 'io', footL: { z: -0.13, arc: 0.04 } },
    ...Array.from({ length: FLURRY_COUNT }, (_, n): AuthoredKey => ({ t: flurryThrustT(n) + 0.05, ease: 'io', footL: { z: -0.13 + 0.078 * (n + 1), arc: 0.03 } })),
    { t: FLURRY_END + 0.17, ease: 'lin', footL: { z: -0.13 + 0.078 * FLURRY_COUNT } },
    { t: 1.0, ease: 'io', footL: { z: 0.51, arc: 0.1 } },
    // ---- 上半身: 構え → 突き ×5（間に引き）→ 残心 → 戻り ----
    ...flurryKeys(),
    ...pose(FLURRY_END + 0.17, 'out', { ...FLURRY_THRUST, hips: { yaw: -18, pitch: 8, z: 0.08, y: -0.1 }, ...OFFHAND.hip }),
    ...pose(1.0, 'io', RETURN),
  ],
};

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

/** 回転の区間（秒）: 加速（WHIRL_SPIN_T0 → WHIRL_SPIN_T1）、一定の速さ（→ WHIRL_SPIN_T2）、減速して止まる（→ WHIRL_STOP_T） */
export const WHIRL_SPIN_T0 = 0.16;
export const WHIRL_SPIN_T1 = 0.3;
export const WHIRL_SPIN_T2 = 1.12;
export const WHIRL_STOP_T = 1.42;
/** 胸のヨー（度）。溜め +48 から、左へ 2 周半（900°）回って −852 になるまでが「当たりのある回転」。そのあと止まるまでに −1080（3 周）へ減速する */
const WHIRL_YAW0 = 48;
const WHIRL_YAW_AT_T1 = -62 - 20;
const WHIRL_YAW_AT_T2 = WHIRL_YAW0 - 900 - 20;
const WHIRL_YAW_STOP = -1080;

/** 秒 t の胸のヨー（度）。回転の 3 区間のイージングを authoring.ts と同じ式で再現する（当たりの時刻を求めるため） */
function whirlChestYaw(t: number): number {
  // 胸のキーは pose() が基準の時刻より LEAD.chest だけ早く置く（溜めのポーズ → 加速の区間の始まり）
  const t0 = WHIRL_SPIN_T0 - LEAD.chest;
  if (t <= t0) return WHIRL_YAW0;
  if (t <= WHIRL_SPIN_T1) {
    const u = (t - t0) / (WHIRL_SPIN_T1 - t0);
    return WHIRL_YAW0 + (WHIRL_YAW_AT_T1 - WHIRL_YAW0) * u * u; // in
  }
  if (t <= WHIRL_SPIN_T2) {
    const u = (t - WHIRL_SPIN_T1) / (WHIRL_SPIN_T2 - WHIRL_SPIN_T1);
    return WHIRL_YAW_AT_T1 + (WHIRL_YAW_AT_T2 - WHIRL_YAW_AT_T1) * u; // lin
  }
  const u = Math.min(1, (t - WHIRL_SPIN_T2) / (WHIRL_STOP_T - WHIRL_SPIN_T2));
  return WHIRL_YAW_AT_T2 + (WHIRL_YAW_STOP - WHIRL_YAW_AT_T2) * (1 - (1 - u) * (1 - u)); // out
}

/**
 * 剣が体の前（方位 0°）・後ろ（180°）を通る時刻（秒）。剣の方位 = 胸のヨー + WHIRL_BLADE_AZ（左へ回るので減っていく）が 0 / 180 を横切る瞬間を、
 * 胸のヨーの曲線から求める。前・後ろ・前・後ろ・前の 5 回（前の半円に 3 回、後ろの半円に 2 回）
 */
function whirlPasses(): { t: number; rear: boolean }[] {
  const out: { t: number; rear: boolean }[] = [];
  const heading = (t: number): number => whirlChestYaw(t) + WHIRL_BLADE_AZ;
  let prev = heading(0);
  const dt = 0.001;
  for (let t = dt; t <= WHIRL_STOP_T && out.length < 5; t += dt) {
    const h = heading(t);
    // 360° ごとに 0 と 180 を横切る（減る向き）。横切った区間の中点を採る
    const crossed = (target: number): boolean => Math.floor((prev - target) / 360) > Math.floor((h - target) / 360);
    if (crossed(0)) out.push({ t: t - dt / 2, rear: false });
    else if (crossed(180)) out.push({ t: t - dt / 2, rear: true });
    prev = h;
  }
  return out;
}

export const WHIRL_PASSES = whirlPasses();

/**
 * 回転斬り 2 周半（剣技）: 腰を沈めて右へ巻き込み、体ごと左へ 2 周半（900°）回りながら水平の円を描く。前の半円に 3 回、後ろの半円に 2 回当たる（AttackDef.windows）。
 * 回転は腰・胸・頭のヨーを回して作り、腕と剣は胸に対して一定。足は腰に付いて回る（床をすべる）。回転は加速 → 一定の速さ → 減速して、3 周（−1080°）で元の向きに止まる。
 * 0 → 0.16 巻き込んで沈む / 0.16 → 0.3 加速 / 0.3 → 1.12 一定の速さで回る（剣は 0.29, 0.5, 0.72, 0.93, 1.15 付近に体の前・後ろを通る）/ 1.12 → 1.42 減速して止まる / 1.42 → 1.72 保って戻り。
 * ルートは 0.16 から 1.2 までに 1.1 m 前へ（敵を追って回る）。
 */
export const WHIRL: AuthoredAttack = {
  name: 'whirl',
  duration: 1.72,
  keys: [
    // ---- ルート ----
    { t: 0.16, ease: 'lin', rootZ: 0 },
    { t: 0.3, ease: 'in', rootZ: 0.15 },
    { t: 1.0, ease: 'lin', rootZ: 0.85 },
    { t: 1.3, ease: 'out', rootZ: 1.1 },
    // ---- 足: 回り始めるまで世界に固定 → 腰に付いて回る（膝を曲げてぶら下がる）→ 止まって世界に固定 ----
    { t: 0.16, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: 0, lift: 0 } },
    { t: 0.22, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.68, lz: 0.06, knee: 1 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 1 } },
    { t: 1.18, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.72, lz: 0.06, knee: 0.5 }, footR: { rel: 1, lx: -0.11, ly: -0.72, lz: -0.04, knee: 0.5 } },
    { t: 1.34, ease: 'io', footL: { rel: 0, z: 1.15, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 1.0, x: 0, lift: 0, pitch: 0 } },
    { t: 1.72, ease: 'io', footL: { z: 1.1 }, footR: { z: 1.1 } },
    // ---- 腰: 沈む（0.16）→ 低く回る → 止まって沈む → 立つ ----
    { t: 0.3, ease: 'out', hips: { y: 0.08 } },
    { t: 1.1, ease: 'lin', hips: { y: 0.04 } },
    { t: 1.36, ease: 'in', hips: { y: -0.14 } },
    { t: 1.5, ease: 'lin', hips: { y: -0.14 } },
    // ---- 体の回転（ヨー）と腕 ----
    ...pose(0.16, 'io', WHIRL_COIL),
    {
      t: WHIRL_SPIN_T1,
      ease: 'in',
      ...WHIRL_ARMS,
      hips: { yaw: WHIRL_YAW_AT_T1 - 24 },
      chest: { yaw: WHIRL_YAW_AT_T1 },
      head: { yaw: WHIRL_YAW_AT_T1 - 36 },
    },
    {
      t: WHIRL_SPIN_T2,
      ease: 'lin',
      ...WHIRL_ARMS,
      hips: { yaw: WHIRL_YAW_AT_T2 - 24 },
      chest: { yaw: WHIRL_YAW_AT_T2 },
      head: { yaw: WHIRL_YAW_AT_T2 - 36 },
    },
    {
      t: WHIRL_STOP_T,
      ease: 'out',
      hips: { yaw: WHIRL_YAW_STOP - 24, pitch: 10 },
      chest: { yaw: WHIRL_YAW_STOP, pitch: 12 },
      head: { yaw: WHIRL_YAW_STOP - 36 },
    },
    { t: 1.5, ease: 'lin', hips: { yaw: WHIRL_YAW_STOP - 24, pitch: 10 }, chest: { yaw: WHIRL_YAW_STOP, pitch: 12 }, head: { yaw: WHIRL_YAW_STOP - 36 } },
    // 戻り: 回転は 3 周（−1080°）で元の向きに戻っているので、値は 1080° 引いたもの
    ...pose(1.72, 'io', { ...RETURN, hips: { yaw: -1080, pitch: 0, z: 0, y: 0 }, chest: { yaw: -1080, pitch: 0 }, head: { yaw: -1080 } }),
  ],
};
