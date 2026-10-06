import type { AuthoredAttack, AuthoredKey } from '../authoring';
import { DRAW, DRAW2, THRUST, THRUST2 } from './sp-combo';
import { LUNGE_DRAW, LUNGE_THRUST, SPIN_ARMS, SPIN_COIL } from './sp-moves';
import { FROM_STANCE, SP_FEET_Z, SP_READY, SP_TWO_HAND } from './spear';
import { pose } from './stagger';

/**
 * 槍の剣技（槍技。ADR-049）の専用モーション。座標の約束は combo1.ts と同じ（胸の座標系。右 = −X、上 = +Y、前 = +Z）。両手持ち・右手が前（spear.ts）。
 * どのクリップも構え（FROM_STANCE）から始まり、構えへ戻る（技のあいだ足の z は技の開始時のルートからの前進量）。
 *
 *  - 乱れ突き（FLURRY。槍技「乱れ突き」）: 構えから、腕を畳んでは突くを続けざまに繰り返す。Lv で 6 → 9 → 12 連（12 連はとどめの突きが深く長い）。
 *  - 風車（WHIRL。槍技「風車」）: 腰を沈めて左へ巻き込み、跳び上がって体ごと右へ回り続け、槍で水平の円を何周も描く。Lv で 2 → 3 → 4 周。
 *  - 穿ち（BORE。槍技「穿ち」）: 深く引き絞り、一気に 2.0m 踏み込んで貫く。Lv4 で 2 つ目、Lv7 で 3 つ目の突きが続く（前の突きの受付の姿勢から）。
 */

// ================================================================= 乱れ突き

/** 乱れ突きの仕様。クリップは同じ作りで、突きの回数・間隔を変えて 3 つ作る（Lv1〜3 = 6 連 / Lv4〜6 = 9 連 / Lv7〜 = 12 連 + とどめの深い突き） */
export interface SpFlurrySpec {
  id: string;
  /** 突きの回数と、1 回ごとの間隔（秒）。最初の突きが伸び切る時刻 */
  count: number;
  gap: number;
  first: number;
  /** 1 回ごとに間合いを詰める量（m） */
  step: number;
  /** とどめの 1 回を、深く踏み込んで長く突く（12 連） */
  finisher: boolean;
}

export const SPF6: SpFlurrySpec = { id: 'spkFlurry', count: 6, gap: 0.13, first: 0.2, step: 0.07, finisher: false };
export const SPF9: SpFlurrySpec = { id: 'spkFlurry9', count: 9, gap: 0.115, first: 0.2, step: 0.06, finisher: false };
export const SPF12: SpFlurrySpec = { id: 'spkFlurry12', count: 12, gap: 0.105, first: 0.2, step: 0.05, finisher: true };

/** 突きが伸び切る時刻（秒）の列 */
export function spFlurryTimes(spec: SpFlurrySpec): number[] {
  return Array.from({ length: spec.count }, (_, n) => spec.first + spec.gap * n);
}

/** 乱れ突きのクリップの長さ: 最後の突きのあと、伸びたまま 0.12 秒保って、0.36 秒で構えへ戻る */
export function spFlurryDuration(spec: SpFlurrySpec): number {
  return spFlurryTimes(spec)[spec.count - 1]! + 0.12 + 0.36;
}

/** 引き: 腕を畳んで次の突きに備える（右手を腰へ引き、穂先は敵へ向けたまま）。偶数番目は低め（DRAW）、奇数番目は少し高め（DRAW2）に狙う */
const FLURRY_CHAMBER = [DRAW, DRAW2] as const;
const FLURRY_THRUST = [THRUST, THRUST2] as const;

/** 乱れ突きのクリップを作る（spec の回数・間隔。とどめの突きは深い） */
export function buildSpearFlurry(spec: SpFlurrySpec): AuthoredAttack {
  const times = spFlurryTimes(spec);
  const last = times[times.length - 1]!;
  const keys: AuthoredKey[] = [];
  // ---- ルート: 突きのたびに少しずつ前へ（とどめの突きは大きく） ----
  keys.push({ t: spec.first - 0.1, ease: 'lin', rootZ: 0 });
  let root = 0;
  times.forEach((t, n) => {
    root += spec.finisher && n === times.length - 1 ? 0.6 : spec.step;
    keys.push({ t, ease: 'out', rootZ: root });
  });
  // ---- 足: 構えの幅のまま、突きのたびに前足が踏み出して、後ろ足が追う（世界に固定） ----
  keys.push({ t: spec.first - 0.1, ease: 'lin', footR: { z: SP_FEET_Z.R }, footL: { z: SP_FEET_Z.L } });
  let acc = 0;
  times.forEach((t, n) => {
    acc += spec.finisher && n === times.length - 1 ? 0.6 : spec.step;
    keys.push({ t, ease: 'io', footR: { z: SP_FEET_Z.R + acc + 0.08, arc: 0.04 } });
    keys.push({ t: Math.min(last + 0.12, t + spec.gap * 0.7), ease: 'io', footL: { z: SP_FEET_Z.L + acc, arc: 0.03 } });
  });
  keys.push({ t: last + 0.12 + 0.36, ease: 'io', footR: { z: SP_FEET_Z.R + acc, arc: 0.02 }, footL: { z: SP_FEET_Z.L + acc, arc: 0.03 } });
  // ---- 体と槍: 引く → 突く を繰り返す → 保つ → 戻る ----
  times.forEach((t, n) => {
    const chamber = FLURRY_CHAMBER[n % 2]!;
    const thrust = spec.finisher && n === times.length - 1 ? { ...LUNGE_THRUST, hips: { ...LUNGE_THRUST.hips, y: -0.24 } } : FLURRY_THRUST[n % 2]!;
    keys.push(...pose(t - spec.gap * 0.5, 'io', n === 0 ? { ...chamber, hips: { ...chamber.hips, y: -0.14 } } : chamber));
    keys.push(...pose(t, 'in', thrust));
  });
  keys.push(...pose(last + 0.12, 'lin', spec.finisher ? { ...LUNGE_THRUST, hips: { ...LUNGE_THRUST.hips, y: -0.2 } } : THRUST));
  keys.push(...pose(last + 0.12 + 0.36, 'io', SP_READY));
  return { name: spec.id, duration: spFlurryDuration(spec), twoHanded: SP_TWO_HAND, continueFrom: FROM_STANCE, keys };
}

export const SPK_FLURRY: AuthoredAttack = buildSpearFlurry(SPF6);
export const SPK_FLURRY_9: AuthoredAttack = buildSpearFlurry(SPF9);
export const SPK_FLURRY_12: AuthoredAttack = buildSpearFlurry(SPF12);

// ================================================================= 風車

/** 風車の仕様。クリップは同じ作りで、周回の数を変えて 3 つ作る（Lv1〜3 = 2 周 / Lv4〜6 = 3 周 / Lv7〜 = 4 周） */
export interface SpWhirlSpec {
  id: string;
  turns: number;
  /** 1 周にかかる秒（一定の速さで回るとき） */
  period: number;
}

export const SPW2: SpWhirlSpec = { id: 'spkWhirl', turns: 2, period: 0.4 };
export const SPW3: SpWhirlSpec = { id: 'spkWhirl3', turns: 3, period: 0.4 };
export const SPW4: SpWhirlSpec = { id: 'spkWhirl4', turns: 4, period: 0.4 };

/** 回転の区切りの時刻: 巻き込み（〜WHIRL_T0）→ 加速（〜WHIRL_T1）→ 一定の速さ → 減速（0.1 秒）→ 止まる */
export const WHIRL_T0 = 0.2;
export const WHIRL_T1 = 0.3;
const WHIRL_DECEL = 0.1;
/** 巻き込みの胸のヨー（度。SPIN_COIL）。回転はここから右へ turns 周する */
const WHIRL_YAW0 = SPIN_COIL.chest.yaw;

/** 回転が止まる時刻（秒） */
export function spWhirlStopT(spec: SpWhirlSpec): number {
  return WHIRL_T1 + spec.turns * spec.period;
}

/** 風車のクリップの長さ: 止まってから 0.14 秒沈んで保ち、0.36 秒で構えへ戻る */
export function spWhirlDuration(spec: SpWhirlSpec): number {
  return spWhirlStopT(spec) + 0.14 + 0.36;
}

/** 風車の周りの速さ（度/秒） */
const whirlOmega = (spec: SpWhirlSpec): number => 360 / spec.period;

/**
 * 時刻 t の胸のヨー（度）。巻き込み（WHIRL_YAW0）から、加速（WHIRL_T0 → WHIRL_T1 で 0.5 × ω × 0.1 だけ回る。ease: in）→ 一定の速さ → 減速（最後の 0.1 秒。ease: out）の曲線。
 * クリップのキーと同じ補間（in = u²、out = 1 − (1 − u)²）で計算する（刃の方位が前・横・後ろを通る時刻を求めるため）。胸のキーは LEAD.chest だけ早く置かれるが、ここでは無視する（誤差 0.015 秒）
 */
export function spWhirlYawAt(spec: SpWhirlSpec, t: number): number {
  const w = whirlOmega(spec);
  const stop = spWhirlStopT(spec);
  const rampDist = (w * (WHIRL_T1 - WHIRL_T0)) / 2;
  const decelStart = stop - WHIRL_DECEL;
  if (t <= WHIRL_T0) return WHIRL_YAW0;
  if (t <= WHIRL_T1) {
    const u = (t - WHIRL_T0) / (WHIRL_T1 - WHIRL_T0);
    return WHIRL_YAW0 + rampDist * u * u;
  }
  if (t <= decelStart) return WHIRL_YAW0 + rampDist + w * (t - WHIRL_T1);
  const decelDist = (w * WHIRL_DECEL) / 2;
  const u = Math.min(1, (t - decelStart) / WHIRL_DECEL);
  return WHIRL_YAW0 + rampDist + w * (decelStart - WHIRL_T1) + decelDist * (1 - (1 - u) * (1 - u));
}

/** 穂先の方位が WHIRL_YAW0 + deg になる時刻（秒。二分探索。胸のヨーは単調に増える） */
export function spWhirlTimeAt(spec: SpWhirlSpec, deg: number): number {
  let lo = WHIRL_T0;
  let hi = spWhirlStopT(spec);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (spWhirlYawAt(spec, mid) < WHIRL_YAW0 + deg) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * 風車で、穂先が体の前・左・後ろ・右の四半分（90°）を通る時間帯。周ごとに 4 つ（回り始めの方位から 90° ずつ）。
 * center = 四半分の中心の、巻き込みの方位からの角度（度）。start / end = 穂先がその四半分を通り抜ける時刻（秒）。turn = 何周目か（0 から。同じ周の窓は同じ組にして、同じ敵に重ねて当てない）
 */
export function spWhirlQuarters(spec: SpWhirlSpec): { center: number; start: number; end: number; turn: number }[] {
  const out: { center: number; start: number; end: number; turn: number }[] = [];
  for (let k = 0; k < spec.turns * 4; k++) {
    out.push({ center: 90 * k + 45, start: spWhirlTimeAt(spec, 90 * k), end: spWhirlTimeAt(spec, 90 * (k + 1)), turn: Math.floor(k / 4) });
  }
  return out;
}

/** 風車のクリップを作る（spec の周回の数） */
export function buildSpearWhirl(spec: SpWhirlSpec): AuthoredAttack {
  const stop = spWhirlStopT(spec);
  const decelStart = stop - WHIRL_DECEL;
  const yawAt = (t: number): number => spWhirlYawAt(spec, t);
  // 胸・腰・頭のヨー（腰は胸より 26° 遅れ、頭は 78° 先行する。巻き込みの値の差のまま回す）
  const hipsD = SPIN_COIL.hips.yaw - SPIN_COIL.chest.yaw;
  const headD = SPIN_COIL.head.yaw - SPIN_COIL.chest.yaw;
  const yawKey = (y: number) => ({ hips: { yaw: y + hipsD }, chest: { yaw: y }, head: { yaw: y + headD } });
  const total = 360 * spec.turns;
  const endYaw = WHIRL_YAW0 + total;
  const ex = 0.35 * spec.turns;
  return {
    name: spec.id,
    duration: spWhirlDuration(spec),
    twoHanded: SP_TWO_HAND,
    continueFrom: FROM_STANCE,
    keys: [
      // ---- ルート（周回が増えたぶん、前へ追う距離も増える） ----
      { t: WHIRL_T0, ease: 'lin', rootZ: 0 },
      { t: WHIRL_T1, ease: 'in', rootZ: 0.1 },
      { t: decelStart, ease: 'lin', rootZ: 0.45 + ex },
      { t: stop, ease: 'out', rootZ: 0.6 + ex },
      // ---- 足: 回り始めるまで構えの位置 → 腰に付いて回る（膝を曲げてぶら下がる）→ 止まって世界に固定 ----
      { t: WHIRL_T0, ease: 'lin', footL: { rel: 0, z: SP_FEET_Z.L, lift: 0 }, footR: { rel: 0, z: SP_FEET_Z.R, lift: 0 } },
      { t: WHIRL_T0 + 0.06, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.68, lz: 0.06, knee: 1 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 1 } },
      { t: decelStart, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.72, lz: 0.06, knee: 0.5 }, footR: { rel: 1, lx: -0.11, ly: -0.72, lz: -0.04, knee: 0.5 } },
      { t: stop, ease: 'io', footL: { rel: 0, z: 0.6 + ex + SP_FEET_Z.L, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 0.6 + ex + SP_FEET_Z.R, x: 0, lift: 0, pitch: 0 } },
      { t: spWhirlDuration(spec), ease: 'io', footL: { z: 0.6 + ex + SP_FEET_Z.L }, footR: { z: 0.6 + ex + SP_FEET_Z.R } },
      // ---- 腰: 沈む → 低く回る → 止まって沈む → 立つ ----
      { t: WHIRL_T1, ease: 'out', hips: { y: 0.08 } },
      { t: decelStart, ease: 'lin', hips: { y: 0.04 } },
      { t: stop, ease: 'in', hips: { y: -0.16 } },
      { t: stop + 0.14, ease: 'lin', hips: { y: -0.16 } },
      // ---- 体の回転（ヨー）と腕 ----
      ...pose(WHIRL_T0, 'io', SPIN_COIL),
      { t: WHIRL_T1, ease: 'in', ...SPIN_ARMS, ...yawKey(yawAt(WHIRL_T1)) },
      { t: decelStart, ease: 'lin', ...SPIN_ARMS, ...yawKey(yawAt(decelStart)) },
      { t: stop, ease: 'out', ...yawKey(endYaw), hips: { yaw: endYaw + hipsD, pitch: 10 }, chest: { yaw: endYaw, pitch: 12 } },
      { t: stop + 0.14, ease: 'lin', hips: { yaw: endYaw + hipsD, pitch: 10 }, chest: { yaw: endYaw, pitch: 12 }, head: { yaw: endYaw + headD } },
      // 戻り: 回転は整数周で元の向きに戻っているので、構えの姿勢の値は周回の角度を足したもの
      ...pose(spWhirlDuration(spec), 'io', {
        ...SP_READY,
        hips: { ...SP_READY.hips, yaw: SP_READY.hips.yaw + total },
        chest: { ...SP_READY.chest, yaw: SP_READY.chest.yaw + total },
        head: { yaw: SP_READY.head.yaw + total },
      }),
    ],
  };
}

export const SPK_WHIRL: AuthoredAttack = buildSpearWhirl(SPW2);
export const SPK_WHIRL_3: AuthoredAttack = buildSpearWhirl(SPW3);
export const SPK_WHIRL_4: AuthoredAttack = buildSpearWhirl(SPW4);

// ================================================================= 穿ち

/** 穿ちの 1 つ目が次の突きを受け付ける時刻（突き切った姿勢を保つ 0.5〜0.62。AttackDef.cancelAt と同じ） */
export const SPK_BORE_HOLD_T = 0.5;

const BORE_HOLD = { ...LUNGE_THRUST, hips: { yaw: -5, pitch: 10, z: 0.1, y: -0.2 } };
const BORE_DRAW = { ...LUNGE_DRAW, hips: { ...LUNGE_DRAW.hips, y: -0.26 }, grip: [-8, -40, 0.2] as [number, number, number] };

/**
 * 穿ち（Lv1）: 深く引き絞り（0〜0.26。体を沈めて力を溜める）、一気に踏み込んで貫く。踏み込みは 2.0m（槍技でいちばん長い踏み込み）。
 * 0 → 0.26 引き絞る（0.26〜0.3 は一拍）/ 0.3 → 0.4 一気に踏み込んで突く（0.4 に最高速。右足は 0.4 に着地）/ 0.4 → 0.5 伸び切る / 0.5 → 0.62 保つ（次の突きの受付）/ 0.62 → 1.0 戻り。
 * ルートは 0.3 から加速して 0.4 までに 1.7m、減速して 0.5 までに 2.0m。足は右足が先に踏み出し、左足が引きずって追う（歩幅は 0.85m 以内）。
 */
export const SPK_BORE: AuthoredAttack = {
  name: 'spkBore',
  duration: 1.0,
  twoHanded: SP_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [
    // ---- 下半身 ----
    { t: 0.3, ease: 'lin', rootZ: 0 },
    { t: 0.4, ease: 'in', rootZ: 1.7 },
    { t: 0.5, ease: 'out', rootZ: 2.0 },
    { t: 0.3, ease: 'lin', footR: { z: SP_FEET_Z.R } },
    { t: 0.4, ease: 'in', footR: { z: 1.95, arc: 0.18 } },
    { t: 0.62, ease: 'lin', footR: { z: 1.95 } },
    { t: 1.0, ease: 'io', footR: { z: 2.0 + SP_FEET_Z.R, arc: 0.03 } },
    { t: 0.3, ease: 'lin', footL: { z: SP_FEET_Z.L } },
    { t: 0.36, ease: 'io', footL: { z: 0.4, arc: 0.1 } },
    { t: 0.42, ease: 'io', footL: { z: 1.35, arc: 0.1 } },
    { t: 0.62, ease: 'lin', footL: { z: 1.35 } },
    { t: 1.0, ease: 'io', footL: { z: 2.0 + SP_FEET_Z.L, arc: 0.1 } },
    // ---- 引き絞る → 一拍 → 突く → 伸び切る → 保つ → 戻る ----
    ...pose(0.26, 'io', BORE_DRAW),
    ...pose(0.3, 'lin', BORE_DRAW),
    ...pose(0.4, 'in', LUNGE_THRUST),
    ...pose(0.5, 'out', BORE_HOLD),
    ...pose(0.62, 'lin', BORE_HOLD),
    ...pose(1.0, 'io', SP_READY),
  ],
};

/** 穿ちの 2 つ目が次の突きを受け付ける時刻（0.34〜0.46） */
export const SPK_BORE2_HOLD_T = 0.34;

/**
 * 穿ちの 2 つ目（Lv4 から）: 1 つ目の突き切った姿勢（0.5s）から、槍を素早く引き戻して続けざまに突く。0 → 0.12 引き戻す / 0.12 → 0.2 突く（0.2 に最高速）/ 0.2 → 0.34 伸び切る / 0.34 → 0.46 保つ / 0.46 → 0.8 戻り。
 * ルートは 0.04 から 0.2 までに 0.7m。足は 1 つ目の着地の位置から引きずる（右足は 1 つ目の保持で右 −0.05、左足 −0.65）。
 */
export const SPK_BORE2: AuthoredAttack = {
  name: 'spkBore2',
  duration: 0.8,
  twoHanded: SP_TWO_HAND,
  continueFrom: { attack: SPK_BORE, t: SPK_BORE_HOLD_T },
  keys: [
    // ---- 下半身（足の z はこの技の開始時のルートからの前進量。1 つ目の保持の終わり: ルート 2.0、右足 1.95、左足 1.35 より手前の補間値） ----
    { t: 0.04, ease: 'lin', rootZ: 0 },
    { t: 0.2, ease: 'out', rootZ: 0.7 },
    { t: 0.03, ease: 'lin', footL: { z: -0.65 } },
    { t: 0.12, ease: 'out', footL: { z: -0.25, arc: 0.08 } },
    { t: 0.2, ease: 'io', footL: { z: 0.1, arc: 0.06 } },
    { t: 0.46, ease: 'lin', footL: { z: 0.1 } },
    { t: 0.8, ease: 'io', footL: { z: 0.7 + SP_FEET_Z.L, arc: 0.08 } },
    { t: 0.04, ease: 'lin', footR: { z: -0.05 } },
    { t: 0.12, ease: 'out', footR: { z: 0.5, arc: 0.12 } },
    { t: 0.2, ease: 'io', footR: { z: 0.78 } },
    { t: 0.46, ease: 'lin', footR: { z: 0.78 } },
    { t: 0.8, ease: 'io', footR: { z: 0.7 + SP_FEET_Z.R, arc: 0.03 } },
    // ---- 引き戻す → 突く → 伸び切る → 保つ → 戻る ----
    ...pose(0.12, 'io', { ...DRAW2, hips: { ...DRAW2.hips, y: -0.2 } }),
    ...pose(0.2, 'in', LUNGE_THRUST),
    ...pose(0.34, 'out', BORE_HOLD),
    ...pose(0.46, 'lin', BORE_HOLD),
    ...pose(0.8, 'io', SP_READY),
  ],
};

/**
 * 穿ちの 3 つ目（Lv7 から。とどめ）: 2 つ目の突き切った姿勢（0.34s）から、体ごと深く沈んで引き絞り、全体重を乗せて長く深く貫く。0 → 0.16 沈む / 0.16 → 0.26 突く（0.26 に最高速）/ 0.26 → 0.4 伸び切る / 0.4 → 0.9 戻り（硬直は長い）。
 * ルートは 0.06 から 0.26 までに 0.95m、減速して 0.38 までに 1.1m。
 */
export const SPK_BORE3: AuthoredAttack = {
  name: 'spkBore3',
  duration: 0.9,
  twoHanded: SP_TWO_HAND,
  continueFrom: { attack: SPK_BORE2, t: SPK_BORE2_HOLD_T },
  keys: [
    // ---- 下半身（2 つ目の保持の終わりは右足 0.08、左足 −0.6） ----
    { t: 0.06, ease: 'lin', rootZ: 0 },
    { t: 0.26, ease: 'in', rootZ: 0.95 },
    { t: 0.38, ease: 'out', rootZ: 1.1 },
    { t: 0.08, ease: 'lin', footR: { z: 0.08 } },
    { t: 0.26, ease: 'in', footR: { z: 1.2, arc: 0.16 } },
    { t: 0.5, ease: 'lin', footR: { z: 1.2 } },
    { t: 0.9, ease: 'io', footR: { z: 1.1 + SP_FEET_Z.R, arc: 0.03 } },
    { t: 0.08, ease: 'lin', footL: { z: -0.6 } },
    { t: 0.2, ease: 'io', footL: { z: 0.1, arc: 0.1 } },
    { t: 0.26, ease: 'io', footL: { z: 0.4, arc: 0.06 } },
    { t: 0.38, ease: 'io', footL: { z: 0.7, arc: 0.04 } },
    { t: 0.5, ease: 'lin', footL: { z: 0.7 } },
    { t: 0.9, ease: 'io', footL: { z: 1.1 + SP_FEET_Z.L, arc: 0.1 } },
    // ---- 沈む → 突く → 伸び切る → 戻る ----
    ...pose(0.16, 'io', { ...BORE_DRAW, hips: { ...BORE_DRAW.hips, y: -0.28 } }),
    ...pose(0.26, 'in', { ...LUNGE_THRUST, hips: { ...LUNGE_THRUST.hips, y: -0.26 } }),
    ...pose(0.4, 'out', { ...BORE_HOLD, hips: { ...BORE_HOLD.hips, y: -0.22 } }),
    ...pose(0.5, 'lin', { ...BORE_HOLD, hips: { ...BORE_HOLD.hips, y: -0.22 } }),
    ...pose(0.9, 'io', SP_READY),
  ],
};
